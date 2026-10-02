import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentService } from '@portfolio-pilot/agent';
import { handleDemoAsk } from './route';

const request = (body: unknown) => new Request('http://127.0.0.1:3001/api/demo/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => { vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('DATA_MODE', 'mock'); vi.stubEnv('AGENT_MODE', 'mock'); });
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/demo/ask', () => {
  it('rejects empty and oversized questions before invoking the agent', async () => {
    const service: AgentService = { ask: vi.fn() };
    expect((await handleDemoAsk(request({ question: ' ' }), service)).status).toBe(400);
    expect((await handleDemoAsk(request({ question: 'x'.repeat(501) }), service)).status).toBe(400);
    expect(service.ask).not.toHaveBeenCalled();
  });
  it('returns the completed, labeled answer', async () => {
    const service: AgentService = { ask: vi.fn(async () => ({ answer: '[Mock answer] Test', mode: 'mock' as const })) };
    const response = await handleDemoAsk(request({ question: 'Hi' }), service);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ answer: '[Mock answer] Test', mode: 'mock' });
    expect(service.ask).toHaveBeenCalledWith('Hi');
  });
  it('does not expose the endpoint in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect((await handleDemoAsk(request({ question: 'Hi' }))).status).toBe(404);
  });
  it('reports missing live credentials without falling back to mock', async () => {
    vi.stubEnv('AGENT_MODE', 'claude');
    vi.stubEnv('AGENT_MODEL_ID', 'configured-test-model');
    vi.stubEnv('AGENT_WORKSPACE_DIR', 'C:\\portfolio-pilot-agent-test-runtime');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const response = await handleDemoAsk(request({ question: 'Hi' }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'CONFIGURATION_ERROR', message: expect.stringContaining('ANTHROPIC_API_KEY') } });
  });
});
