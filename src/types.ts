import {
  generateText,
  generateObject,
  streamText,
  streamObject,
  embed,
} from 'ai';

export interface GuardrailResult {
  /** Whether the guardrail was triggered (blocked the request) */
  tripwireTriggered: boolean;
  /** Human-readable message describing why the guardrail was triggered */
  message?: string;
  /** Detailed metadata about the guardrail execution */
  metadata?: Record<string, unknown>;
  /** Severity level of the guardrail violation */
  severity?: 'low' | 'medium' | 'high' | 'critical';
  /** Suggested action to resolve the issue */
  suggestion?: string;
  /** Additional context information */
  context?: {
    guardrailName: string;
    guardrailVersion?: string;
    executedAt: Date;
    executionTimeMs?: number;
    environment?: string;
  };
}

export type GuardrailsParams = {
  inputGuardrails?: InputGuardrail[];
  outputGuardrails?: OutputGuardrail[];
  throwOnBlocked?: boolean;
  enablePerformanceMonitoring?: boolean;
};

export type GenerateTextParams = Parameters<typeof generateText>[0];
export type GenerateObjectParams = Parameters<typeof generateObject>[0];
export type StreamTextParams = Parameters<typeof streamText>[0];
export type StreamObjectParams = Parameters<typeof streamObject>[0];
export type EmbedParams = Parameters<typeof embed>[0];

// Derive result types since the AI SDK types are generic and require type parameters
export type GenerateTextResult = Awaited<ReturnType<typeof generateText>>;
export type GenerateObjectResult = Awaited<ReturnType<typeof generateObject>>;
export type StreamTextResult = ReturnType<typeof streamText>;
export type StreamObjectResult = ReturnType<typeof streamObject>;
export type EmbedResult = ReturnType<typeof embed>;

// Re-export available AI SDK utility types
export type {
  CallWarning,
  FinishReason,
  ProviderMetadata,
  LanguageModelUsage,
  LanguageModelRequestMetadata,
  LanguageModelResponseMetadata,
} from 'ai';

// Re-export middleware and provider types for convenience
export type {
  LanguageModelV2,
  LanguageModelV2Middleware,
  LanguageModelV2CallOptions,
  LanguageModelV2StreamPart,
  LanguageModelV2FinishReason,
  LanguageModelV2CallWarning,
  LanguageModelV2ResponseMetadata,
  LanguageModelV2Usage,
} from '@ai-sdk/provider';

export type InputGuardrailContext =
  | GenerateTextParams
  | GenerateObjectParams
  | StreamTextParams
  | StreamObjectParams
  | EmbedParams;

export type AIResult =
  | GenerateTextResult
  | GenerateObjectResult
  | StreamTextResult
  | StreamObjectResult
  | EmbedResult;

export type OutputGuardrailContext = {
  input: InputGuardrailContext;
  result: AIResult;
};

export interface InputGuardrail {
  /** Unique identifier for the guardrail */
  name: string;
  /** Human-readable description of what this guardrail does */
  description?: string;
  /** Version of the guardrail for tracking changes */
  version?: string;
  /** Tags for categorizing guardrails */
  tags?: string[];
  /** Whether this guardrail is enabled */
  enabled?: boolean;
  /** Priority level for execution order */
  priority?: 'low' | 'medium' | 'high' | 'critical';
  /** Configuration options for the guardrail */
  config?: Record<string, string | number | boolean>;
  /** The main execution function */
  execute: (
    context: InputGuardrailContext,
  ) => Promise<GuardrailResult> | GuardrailResult;
  /** Optional setup function called once when guardrail is initialized */
  setup?: () => Promise<void> | void;
  /** Optional cleanup function called when guardrail is destroyed */
  cleanup?: () => Promise<void> | void;
}

export interface OutputGuardrail {
  /** Unique identifier for the guardrail */
  name: string;
  /** Human-readable description of what this guardrail does */
  description?: string;
  /** Version of the guardrail for tracking changes */
  version?: string;
  /** Tags for categorizing guardrails */
  tags?: string[];
  /** Whether this guardrail is enabled */
  enabled?: boolean;
  /** Priority level for execution order */
  priority?: 'low' | 'medium' | 'high' | 'critical';
  /** Configuration options for the guardrail */
  config?: Record<string, string | number | boolean>;
  /** The main execution function */
  execute: (
    context: OutputGuardrailContext,
    accumulatedText?: string,
  ) => Promise<GuardrailResult> | GuardrailResult;
  /** Optional setup function called once when guardrail is initialized */
  setup?: () => Promise<void> | void;
  /** Optional cleanup function called when guardrail is destroyed */
  cleanup?: () => Promise<void> | void;
}

export interface InputGuardrailsMiddlewareConfig {
  /** Input guardrails to execute before AI calls */
  inputGuardrails: InputGuardrail[];
  /** Execution options for guardrails */
  executionOptions?: {
    parallel?: boolean;
    timeout?: number;
    continueOnFailure?: boolean;
    logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
  };
  /** Callback for when input is blocked */
  onInputBlocked?: (
    results: GuardrailResult[],
    originalParams: InputGuardrailContext,
  ) => void;
  /** Whether to throw errors when guardrails are triggered */
  throwOnBlocked?: boolean;
}

export interface OutputGuardrailsMiddlewareConfig {
  /** Output guardrails to execute after AI calls */
  outputGuardrails: OutputGuardrail[];
  /** Execution options for guardrails */
  executionOptions?: {
    parallel?: boolean;
    timeout?: number;
    continueOnFailure?: boolean;
    logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
  };
  /** Callback for when output is blocked */
  onOutputBlocked?: (
    results: GuardrailResult[],
    originalParams: InputGuardrailContext,
    result: unknown,
  ) => void;
  /** Whether to throw errors when guardrails are triggered */
  throwOnBlocked?: boolean;
}
