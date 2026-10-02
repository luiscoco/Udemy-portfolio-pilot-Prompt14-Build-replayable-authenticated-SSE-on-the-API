import { mkdir, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

export type AgentMode = 'mock' | 'claude';
export interface AgentAnswer { answer: string; mode: AgentMode }
export interface AgentService { ask(question: string): Promise<AgentAnswer> }

export class AgentConfigurationError extends Error {}
export class AgentExecutionError extends Error {}
export class AgentTimeoutError extends AgentExecutionError {}

export class MockAgentService implements AgentService {
  async ask(_question: string): Promise<AgentAnswer> {
    return {
      mode: 'mock',
      answer: '[Mock answer] This is a deterministic demo response. Portfolio analysis and current market facts are unavailable in this question-and-answer demo.'
    };
  }
}

type QueryFunction = typeof query;
export interface ClaudeAgentOptions {
  apiKey: string | undefined;
  modelId: string;
  workspaceDir: string;
  timeoutMs?: number;
  queryFunction?: QueryFunction;
}

function isInside(path: string, parent: string): boolean {
  const difference = relative(parent, path);
  return difference === '' || (!difference.startsWith('..') && !isAbsolute(difference));
}

export class ClaudeAgentService implements AgentService {
  constructor(private readonly config: ClaudeAgentOptions) {}

  async ask(question: string): Promise<AgentAnswer> {
    const { apiKey, modelId, workspaceDir, timeoutMs = 20_000, queryFunction = query } = this.config;
    if (!apiKey?.trim()) throw new AgentConfigurationError('Claude API key is missing. Set ANTHROPIC_API_KEY for live agent mode.');
    if (!modelId.trim()) throw new AgentConfigurationError('AGENT_MODEL_ID is required for live agent mode.');
    if (!isAbsolute(workspaceDir)) throw new AgentConfigurationError('AGENT_WORKSPACE_DIR must be an absolute path outside the source repository.');
    const sourceRoot = await realpath(resolve(fileURLToPath(import.meta.url), '../../../..'));
    if (isInside(resolve(workspaceDir), sourceRoot)) throw new AgentConfigurationError('AGENT_WORKSPACE_DIR must be outside the source repository.');
    await mkdir(workspaceDir, { recursive: true });
    const actualWorkspace = await realpath(workspaceDir);
    if (isInside(actualWorkspace, sourceRoot)) throw new AgentConfigurationError('AGENT_WORKSPACE_DIR must be outside the source repository.');

    const abortController = new AbortController();
    const env: Record<string, string | undefined> = { ...process.env, ANTHROPIC_API_KEY: apiKey, CLAUDE_CONFIG_DIR: actualWorkspace };
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    delete env.ANTHROPIC_AUTH_TOKEN;
    const execute = async (): Promise<AgentAnswer> => {
      let result: SDKResultMessage | undefined;
      for await (const message of queryFunction({
        prompt: question,
        options: {
          model: modelId,
          cwd: actualWorkspace,
          env,
          tools: [],
          allowedTools: [],
          settingSources: [],
          persistSession: false,
          permissionMode: 'dontAsk',
          maxTurns: 1,
          maxBudgetUsd: 0.02,
          abortController,
          systemPrompt: 'Answer the question briefly. You have no portfolio, market, news, or browsing data. Say when current facts or source-backed analysis are unavailable. Never claim to execute trades.'
        }
      })) {
        if (message.type === 'result') result = message;
      }
      if (!result) throw new AgentExecutionError('Claude finished without a result.');
      if (result.subtype !== 'success' || result.is_error) throw new AgentExecutionError(`Claude stopped with ${result.subtype}.`);
      if (!result.result.trim()) throw new AgentExecutionError('Claude returned an empty answer.');
      return { mode: 'claude', answer: result.result.trim() };
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        execute(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { abortController.abort(); reject(new AgentTimeoutError('Claude did not answer within the time limit.')); }, timeoutMs);
        })
      ]);
    } catch (error) {
      if (error instanceof AgentExecutionError || error instanceof AgentConfigurationError) throw error;
      throw new AgentExecutionError('Claude could not complete the answer.');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
