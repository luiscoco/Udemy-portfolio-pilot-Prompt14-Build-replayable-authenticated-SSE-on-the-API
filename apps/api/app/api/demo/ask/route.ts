import { ClaudeAgentService, MockAgentService, AgentConfigurationError, AgentTimeoutError, type AgentService } from '@portfolio-pilot/agent';
import { parseServerConfig } from '@portfolio-pilot/config/server';
import { demoAskRequestSchema, demoAskResponseSchema, REQUEST_ID_HEADER } from '@portfolio-pilot/contracts';
import { errorResponse, getRequestId } from '../../../../lib/http';
import { requireAuthorization, accessResponse } from '../../../../lib/authorization';

export const runtime = 'nodejs';
const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

export async function handleDemoAsk(request: Request, service?: AgentService): Promise<Response> {
  const requestId = getRequestId(request);
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  let localOrigin = !origin;
  if (origin) { try { localOrigin = localHosts.has(new URL(origin).hostname); } catch { localOrigin = false; } }
  if (process.env.NODE_ENV !== 'development' || !localHosts.has(url.hostname) || !localOrigin) {
    return errorResponse('INTERNAL_ERROR', 'Demo questions are available only in local development.', requestId, 404);
  }
  let payload: unknown;
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 2048) throw new Error('Too large');
    const body = await request.text();
    if (body.length > 2048) throw new Error('Too large');
    payload = JSON.parse(body);
  } catch {
    return errorResponse('BAD_REQUEST', 'Expected a JSON question of at most 500 characters.', requestId, 400);
  }
  const parsed = demoAskRequestSchema.safeParse(payload);
  if (!parsed.success) return errorResponse('BAD_REQUEST', 'Question must be 1 to 500 characters.', requestId, 400);
  let config;
  try { config = parseServerConfig(process.env); }
  catch { return errorResponse('CONFIGURATION_ERROR', 'Server configuration is invalid.', requestId, 500); }
  const agent = service ?? (config.AGENT_MODE === 'mock'
    ? new MockAgentService()
    : new ClaudeAgentService({ apiKey: config.ANTHROPIC_API_KEY, modelId: config.AGENT_MODEL_ID!, workspaceDir: config.AGENT_WORKSPACE_DIR! }));
  try {
    const result = await agent.ask(parsed.data.question);
    return Response.json(demoAskResponseSchema.parse({ ...result, requestId }), { headers: { [REQUEST_ID_HEADER]: requestId } });
  } catch (error) {
    if (error instanceof AgentConfigurationError) return errorResponse('CONFIGURATION_ERROR', error.message, requestId, 503);
    if (error instanceof AgentTimeoutError) return errorResponse('INTERNAL_ERROR', error.message, requestId, 504);
    return errorResponse('INTERNAL_ERROR', 'The assistant could not complete this answer.', requestId, 502);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireAuthorization(request);
    if (!parseServerConfig(process.env).DEMO_AUTH_ENABLED) return errorResponse('NOT_FOUND', 'Resource not found.', getRequestId(request), 404);
    return handleDemoAsk(request);
  } catch (error) { return accessResponse(request, error); }
}
