// Ambient declarations for docs code samples (see check-snippets.mjs).
//
// 1. Common imports samples often leave out. Only names from the root
//    `ai-sdk-guardrails` entry, `ai`, and `@ai-sdk/openai` belong here;
//    subpath-only APIs (governance, config, advanced, ...) must be imported
//    explicitly in the sample so readers can see where they come from.
// 2. Free variables samples assume the reader already has.
// 3. Type shims for packages the docs mention that are not installed in this
//    workspace (subset of their real public API).

// --- implicit imports -------------------------------------------------------
declare const openai: typeof import('@ai-sdk/openai').openai;
declare const generateText: typeof import('ai').generateText;
declare const streamText: typeof import('ai').streamText;
declare const ToolLoopAgent: typeof import('ai').ToolLoopAgent;

declare const withGuardrails: typeof import('ai-sdk-guardrails').withGuardrails;
declare const defineInputGuardrail: typeof import('ai-sdk-guardrails').defineInputGuardrail;
declare const defineOutputGuardrail: typeof import('ai-sdk-guardrails').defineOutputGuardrail;
declare const extractContent: typeof import('ai-sdk-guardrails').extractContent;
declare const extractTextContent: typeof import('ai-sdk-guardrails').extractTextContent;
declare const guardrailApproval: typeof import('ai-sdk-guardrails').guardrailApproval;
declare const inputLengthLimit: typeof import('ai-sdk-guardrails').inputLengthLimit;
declare const minLengthRequirement: typeof import('ai-sdk-guardrails').minLengthRequirement;
declare const piiDetector: typeof import('ai-sdk-guardrails').piiDetector;
declare const profanityFilter: typeof import('ai-sdk-guardrails').profanityFilter;
declare const promptInjectionDetector: typeof import('ai-sdk-guardrails').promptInjectionDetector;
declare const rateLimiting: typeof import('ai-sdk-guardrails').rateLimiting;
declare const schemaValidation: typeof import('ai-sdk-guardrails').schemaValidation;
declare const sensitiveDataFilter: typeof import('ai-sdk-guardrails').sensitiveDataFilter;
declare const sqlInjectionGuardrail: typeof import('ai-sdk-guardrails').sqlInjectionGuardrail;
declare const toxicityFilter: typeof import('ai-sdk-guardrails').toxicityFilter;

// --- free variables ---------------------------------------------------------
/** Any AI SDK model. */
declare const model: import('ai').LanguageModel;
declare const baseModel: import('ai').LanguageModel;
declare const tools: import('ai').ToolSet;
declare const searchTool: import('ai').Tool;
declare const analysisTool: import('ai').Tool;
declare const calculatorTool: import('ai').Tool;
declare const transferFundsTool: import('ai').Tool<
  { to: string; amount: number },
  { ok: boolean }
>;
declare const tracer: import('@opentelemetry/api').Tracer;
declare const logger: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;

declare const userPrompt: string;
declare const userInput: string;
declare const user: { id: string; role: string; permissions: string[] };
declare const session: { id: string; user: { id: string }; scopes: string[] };
declare const db: {
  execute(sql: string): Promise<unknown>;
  users: { isAllowed(userId: string | undefined): Promise<boolean> };
};
declare const externalAPI: {
  check(input: unknown): Promise<{ isValid: boolean }>;
};

/** A user-defined (e.g. LLM-judged) input guardrail. */
declare const offTopicJudge: import('ai-sdk-guardrails').InputGuardrail;
declare const mySystemPrompt: string;
declare const mySchema: import('zod').ZodType;

/** A guardrail run summary, e.g. the argument of `onOutputBlocked`. */
declare const summary: import('ai-sdk-guardrails').GuardrailExecutionSummary;

/** A `guardrailApproval(...)` gate built in an earlier block. */
declare const gate: import('ai-sdk-guardrails').GuardrailApprovalFunction;

/** MCP connection: `createMCPClient({ transport })` from `@ai-sdk/mcp`. */
declare const transport: import('@ai-sdk/mcp').MCPTransportConfig;
declare const mcpClient: import('@ai-sdk/mcp').MCPClient;
declare const loadPins: () => Promise<Record<string, string>>;
declare const savePins: (pins: Record<string, string>) => Promise<void>;

// --- cookbook excerpts ------------------------------------------------------
// Helpers the cookbook recipes reference from their linked example files.
type InputGuardrail_ = import('ai-sdk-guardrails').InputGuardrail;
type OutputGuardrail_ = import('ai-sdk-guardrails').OutputGuardrail;
declare const lengthGuardrail: InputGuardrail_;
declare const keywordGuardrail: InputGuardrail_;
declare const outputLengthGuardrail: OutputGuardrail_;
declare const minLengthGuardrail: OutputGuardrail_;
declare const qualityGuardrail: OutputGuardrail_;
declare const llmJudgeGuardrail: import('ai-sdk-guardrails').OutputGuardrail<{
  llmJudgment: { score: number; issues: string[] };
}>;
type RiskLevel_ = 'low' | 'medium' | 'high' | 'critical';
declare function calculateInjectionScore(text: string): {
  score: number;
  detectedPatterns: string[];
  riskLevel: RiskLevel_;
};
declare function scoreJailbreak(text: string): {
  score: number;
  detectedPatterns: string[];
  riskLevel: RiskLevel_;
  safeResponse: string;
};
type FoundSecret_ = { type: string; value: string };
declare function scanForSecrets(text: string): FoundSecret_[];
declare function countCategories(secrets: FoundSecret_[]): number;
declare function categoriesOf(secrets: FoundSecret_[]): string[];
declare function extractToolCalls(
  result: import('ai-sdk-guardrails').AIResult,
): Array<{ function?: string; functionName?: string; name: string }>;

// --- shims for packages not installed in the workspace ----------------------
// @ai-sdk/mcp@2 (packages/mcp/src/tool/mcp-client.ts in the AI SDK repo).
declare module '@ai-sdk/mcp' {
  export type MCPTransportConfig = {
    type: 'sse' | 'http';
    url: string;
    headers?: Record<string, string>;
    redirect?: 'follow' | 'error';
  };
  export interface MCPTransport {
    start(): Promise<void>;
    send(message: unknown): Promise<void>;
    close(): Promise<void>;
  }
  export interface MCPClientConfig {
    transport: MCPTransportConfig | MCPTransport;
    name?: string;
    onUncaughtError?: (error: unknown) => void;
  }
  export interface ListToolsResult {
    tools: Array<{
      name: string;
      title?: string;
      description?: string;
      inputSchema: { type?: unknown; properties?: Record<string, unknown> };
    }>;
    nextCursor?: string;
  }
  export interface MCPClient {
    readonly instructions?: string;
    tools(): Promise<Record<string, import('ai').Tool<unknown, unknown>>>;
    listTools(): Promise<ListToolsResult>;
    close(): Promise<void>;
  }
  export function createMCPClient(config: MCPClientConfig): Promise<MCPClient>;
}

// @ai-sdk/anthropic: the provider function.
declare module '@ai-sdk/anthropic' {
  export const anthropic: (modelId: string) => import('ai').LanguageModel;
}

// @ai-sdk/otel (packages/otel/src/open-telemetry.ts in the AI SDK repo).
declare module '@ai-sdk/otel' {
  import type { Tracer } from '@opentelemetry/api';
  import type { Telemetry } from 'ai';
  export interface OpenTelemetryOptions {
    tracer?: Tracer;
  }
  export class OpenTelemetry implements Telemetry {
    constructor(options?: OpenTelemetryOptions);
  }
}

// @opentelemetry/sdk-node: only the zero-config start used in the docs.
declare module '@opentelemetry/sdk-node' {
  export class NodeSDK {
    constructor(config?: Record<string, unknown>);
    start(): void;
    shutdown(): Promise<void>;
  }
}

// Web frameworks used in integration examples: just the calls the docs make.
declare module 'express' {
  interface Req {
    body: { prompt: string };
  }
  interface Res {
    json(body: unknown): void;
  }
  interface App {
    use(handler: unknown): void;
    post(path: string, handler: (req: Req, res: Res) => unknown): void;
    listen(port: number): void;
  }
  function express(): App;
  namespace express {
    function json(): unknown;
  }
  export default express;
}
declare module 'hono' {
  interface HonoContext {
    req: { json(): Promise<{ prompt: string }> };
    json(body: unknown): Response;
  }
  export class Hono {
    post(path: string, handler: (c: HonoContext) => unknown): void;
  }
}
