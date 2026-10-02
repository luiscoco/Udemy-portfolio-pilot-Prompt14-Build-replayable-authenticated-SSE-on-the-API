import { cachedQuoteSchema, newsFeedQuerySchema, newsFeedSchema, quoteListSchema, quoteRequestSchema, type NewsFeed } from '@portfolio-pilot/contracts';
import type { PrismaClient } from './generated/prisma/client.js';
import { CACHE_POLICIES, type Cache } from './cache.js';
import { safeKeyId } from './redis-keys.js';
import { requireOwner, type AuthenticatedOwner } from './repositories.js';
import { PortfolioError } from './portfolio-service.js';

const nullableQuote = cachedQuoteSchema.nullable();

/** Global market data: one key per security, shared by every user (it contains no user data). */
export function quoteReads(db: PrismaClient, cache: Cache) {
  return {
    latest: async (input: unknown) => {
      const ids = [...new Set(quoteRequestSchema.parse(input))];
      const quotes = await Promise.all(ids.map(securityId => cache.getOrLoad(cache.keys.quoteLatest(securityId), CACHE_POLICIES.quoteLatest, nullableQuote, async () => {
        const row = await db.quoteSnapshot.findFirst({ where: { securityId, asOf: { lte: new Date() } }, orderBy: [{ asOf: 'desc' }, { id: 'asc' }] });
        return row ? { securityId, price: row.price.toFixed(), currency: row.currency, asOf: row.asOf.toISOString(), provider: row.provider, isSynthetic: row.isSynthetic } : null;
      })));
      return quoteListSchema.parse({ quotes: quotes.filter(q => q !== null), missing: ids.filter((_, i) => quotes[i] === null), servedAt: new Date().toISOString() });
    }
  };
}

/**
 * Owner-scoped news. Keys contain the session-derived user ID, the owner's cache generation and,
 * when present, the portfolio ID. Only this owner's loader writes them, after an owner-filtered
 * PostgreSQL read; portfolio ownership is immutable, so a cached portfolio entry cannot change hands.
 */
export function newsReads(db: PrismaClient, cache: Cache, owner: AuthenticatedOwner) {
  const ownerId = requireOwner(owner);
  async function load(portfolioId: string | null, limit: number): Promise<NewsFeed> {
    if (portfolioId && !await db.portfolio.findFirst({ where: { id: portfolioId, ownerId }, select: { id: true } })) throw new PortfolioError(404, 'Resource not found.');
    const interest = portfolioId
      ? { transactions: { some: { portfolioId, portfolio: { ownerId } } } }
      // Same interest rule as the news fan-out: archived portfolios stop contributing to the combined feed.
      : { OR: [{ watchlist: { some: { ownerId } } }, { transactions: { some: { portfolio: { ownerId, archivedAt: null } } } }] };
    const rows = await db.newsArticle.findMany({ where: { securities: { some: { security: interest } } }, orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }], take: limit,
      include: { securities: { include: { security: { select: { id: true, symbol: true, exchangeMic: true } } } } } });
    return newsFeedSchema.parse({ portfolioId, generatedAt: new Date().toISOString(), articles: rows.map(row => ({
      id: row.id, provider: row.provider, title: row.title, summary: row.summary, url: row.url, isSynthetic: row.isSynthetic,
      publishedAt: row.publishedAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      securities: row.securities.map(link => link.security).sort((a, b) => a.symbol.localeCompare(b.symbol) || a.exchangeMic.localeCompare(b.exchangeMic))
    })) });
  }
  return {
    feed: async (input: unknown = {}) => {
      const { portfolioId, limit } = newsFeedQuerySchema.parse(input);
      const generation = await cache.generation(cache.keys.userGeneration(safeKeyId(ownerId)));
      // Without a readable generation the correct key is unknown: read PostgreSQL directly.
      if (generation === null) return load(portfolioId, limit);
      return cache.getOrLoad(cache.keys.ownerNews(ownerId, generation, portfolioId, limit), CACHE_POLICIES.ownerNews, newsFeedSchema, () => load(portfolioId, limit));
    }
  };
}
