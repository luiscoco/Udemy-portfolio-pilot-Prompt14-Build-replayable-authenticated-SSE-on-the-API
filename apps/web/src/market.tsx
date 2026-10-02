import { useQuery } from '@tanstack/react-query';
import { marketSnapshotSchema } from '@portfolio-pilot/contracts';
import { apiRequest } from './lib/api-client';
import { dateTime } from './lib/format';

export function useMarket() {
  return useQuery({ queryKey: ['market'], queryFn: ({ signal }) => apiRequest('/api/market', marketSnapshotSchema, { signal }), refetchInterval: 5000, retry: false });
}
export function MarketStatus() {
  const query = useMarket(); const data = query.data;
  const expired = data?.fetchedAt && Date.now() - Date.parse(data.fetchedAt) > data.staleAfterMs;
  const status = query.isError || expired ? (data ? 'stale' : 'unavailable') : data?.status ?? 'loading';
  return <span role="status">{data ? `${data.mode.toUpperCase()} DATA · ${status}` : 'Provider mode unavailable'}{data?.mode === 'mock' && ' · Synthetic'}{data?.error && ` · ${data.error.replaceAll('_', ' ')}`}</span>;
}
export function MarketNews() {
  const query = useMarket(); const data = query.data;
  return <><div className="page-title"><span className="eyebrow">MARKET PULSE</span><h1>Market news</h1><p>Provider snapshots refreshed every 5 seconds. Polling is near-real-time delivery; mock reporting is fictional.</p></div><section className="card"><h2>Latest stories</h2><MarketStatus />{query.isPending && <p role="status">Loading provider snapshot…</p>}{query.isError && <p role="alert">Provider connection unavailable. Retained values are stale.</p>}{data?.error && <p role="alert">Provider {data.error.replaceAll('_', ' ')}. {data.fetchedAt ? `Last successful fetch: ${dateTime(data.fetchedAt)}. Retained data is stale.` : 'No data available.'}{data.retryAt && ` Retry after ${dateTime(data.retryAt)}.`}</p>}{data && <><p>{data.providers.map(p => `${p.sourceId}: ${p.delivery}, ${p.timeliness} (${p.delayMs} ms delay)`).join(' · ')}</p><p>Snapshot: {dateTime(data.asOf)}. Last successful fetch: {data.fetchedAt ? `${dateTime(data.fetchedAt)}` : 'none'}.</p><div className="news-list">{data.articles.map(article => {
    const stale = query.isError || data.status !== 'fresh' || Date.parse(data.asOf) - Date.parse(article.providerAt) > data.staleAfterMs;
    return <article className="news-item" key={`${article.sourceId}:${article.sourceRecordId}`}><div className="news-meta"><span>{article.category} · Revision {article.revision}</span><span>{stale ? 'Stale' : 'Fresh'} · {article.isSynthetic ? 'Synthetic' : 'Live'} · {article.isDelayed ? `Delayed ${article.delayMs} ms` : 'Real-time'}</span></div><h3><a href={article.canonicalUrl} target="_blank" rel="noopener noreferrer">{article.title}</a></h3><p>{article.summary}</p><div className="news-foot"><span>{article.sourceId} · {article.symbols.join(' · ')}</span></div><small>Published {dateTime(article.publishedAt)} · Provider {dateTime(article.providerAt)} · Ingested {dateTime(article.ingestedAt)}</small></article>;
  })}</div>{!data.articles.length && <p>No news available yet.</p>}<h2>Provider quote sample</h2><p>These samples do not update persisted portfolio valuations.</p>{data.quotes.map(quote => <p key={quote.sourceRecordId}>{quote.security.symbol} / {quote.security.exchangeMic}: {quote.currency} {quote.price} · {query.isError || data.status !== 'fresh' ? 'Stale' : 'Fresh'} · {quote.isSynthetic ? 'Synthetic' : 'Live'} · {quote.isDelayed ? `Delayed ${quote.delayMs} ms` : 'Real-time'} · {quote.sourceId}<br /><small>Provider {dateTime(quote.providerAt)} · Ingested {dateTime(quote.ingestedAt)}</small></p>)}{data.missing.map(security => <p key={`${security.symbol}:${security.exchangeMic}`}>{security.symbol} / {security.exchangeMic}: Missing quote</p>)}</>}</section></>;
}
export function MarketSettings() {
  const query = useMarket();
  return <><MarketStatus /><p>Market mode is selected by server DATA_MODE. No live adapter is installed at this milestone. Live failures never fall back to synthetic data.</p><p>Mock news interval: {query.data?.intervalMs ?? 'unavailable'} ms. Browser snapshot polling: 5000 ms. Times are UTC; quote currency is provided per value.</p></>;
}
