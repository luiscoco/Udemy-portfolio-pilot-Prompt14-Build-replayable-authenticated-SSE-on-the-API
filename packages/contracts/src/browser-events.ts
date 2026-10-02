import { z } from 'zod';

const base = { id: z.uuid(), schemaVersion: z.literal(1), occurredAt: z.iso.datetime() };
const resource = z.string().min(1).max(128);
const run = { runId: resource, conversationId: resource };
// Strict public allowlist: no audiences, session tokens, provider/SDK envelopes or tool arguments.
export const browserEventSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('portfolio.updated'), portfolioId: resource,
    change: z.enum(['created', 'renamed', 'archived', 'transaction.recorded']), transactionId: resource.nullable() }).strict(),
  z.object({ ...base, type: z.literal('watchlist.updated'), entryId: resource,
    change: z.enum(['added', 'changed', 'removed']), securityId: resource.nullable() }).strict(),
  z.object({ ...base, type: z.literal('news.available'), articleId: resource,
    change: z.enum(['new', 'correction']), securityIds: z.array(resource).max(1000), portfolioIds: z.array(resource).max(1000), watchlisted: z.boolean() }).strict(),
  z.object({ ...base, type: z.literal('quote.updated'), quotes: z.array(z.object({ securityId: resource, asOf: z.iso.datetime() }).strict()).max(1000) }).strict(),
  z.object({ ...base, ...run, type: z.literal('agent.status'), status: z.enum(['queued', 'running', 'waiting_for_approval', 'failed', 'cancelled']),
    progress: z.enum(['starting', 'reading_portfolio', 'reading_news', 'writing_answer']).optional() }).strict(),
  z.object({ ...base, ...run, type: z.literal('agent.text.delta'), messageId: resource, blockId: resource, sequence: z.number().int().nonnegative(), text: z.string().max(8192) }).strict(),
  z.object({ ...base, ...run, type: z.literal('agent.message.completed'), messageId: resource, text: z.string().max(32768) }).strict(),
  z.object({ ...base, ...run, type: z.literal('agent.run.completed'), status: z.enum(['completed', 'failed', 'cancelled']) }).strict(),
  z.object({ ...base, type: z.literal('stream.reset'), reason: z.enum(['snapshot_required', 'invalid_cursor', 'expired', 'trimmed', 'epoch_changed', 'unavailable', 'slow_client']),
    recoveryUrl: z.literal('/api/events/recovery') }).strict()
]);
export type BrowserEvent = z.infer<typeof browserEventSchema>;
