import {
  generateText,
  generateObject,
  streamText,
  streamObject,
  embed,
} from 'ai';
import type { LanguageModelV2CallOptions as LMCallOptions } from '@ai-sdk/provider';
import type { GuardrailTelemetrySettings } from './telemetry/types';
import type { GuardrailResult } from './enhanced-types';

// Type inference utilities for automatic metadata type extraction

/**
 * Extracts the metadata type from a guardrail
 */
export type ExtractGuardrailMetadata<T> =
  T extends InputGuardrail<infer M>
    ? M
    : T extends OutputGuardrail<infer M>
      ? M
      : never;

/**
 * Creates a union type from an array of guardrail metadata types
 */
export type UnionFromGuardrails<T extends readonly unknown[]> =
  T extends readonly (infer U)[] ? ExtractGuardrailMetadata<U> : never;

/**
 * Infers input guardrail metadata union from an array
 */
export type InferInputMetadata<T extends readonly InputGuardrail<unknown>[]> =
  T extends readonly InputGuardrail<infer M>[] ? M : Record<string, unknown>;

/**
 * Infers output guardrail metadata union from an array
 */
export type InferOutputMetadata<T extends readonly OutputGuardrail<unknown>[]> =
  T extends readonly OutputGuardrail<infer M>[] ? M : Record<string, unknown>;

/**
 * Result of a guardrail execution with comprehensive error handling information
 *
 * Re-exported from enhanced-types.ts for OpenAI compatibility.
 * This type includes the OpenAI-compatible `info` object structure.
 */
export type { GuardrailResult };

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
  ToolSet,
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

/**
 * Logger interface for configurable logging throughout the guardrails system
 * Compatible with popular loggers like Winston, Pino, Bunyan, or console
 */
export interface Logger {
  /** Log informational messages */
  info(message: string, ...args: any[]): void;
  /** Log warning messages */
  warn(message: string, ...args: any[]): void;
  /** Log error messages */
  error(message: string, ...args: any[]): void;
  /** Log debug messages */
  debug(message: string, ...args: any[]): void;
}

// ============================================================================
// Retry Configuration Types
// ============================================================================

/**
 * Retry configuration that can be specified at the guardrail level.
 * When specified here, it provides guardrail-specific retry behavior.
 * The withGuardrails-level retry config takes precedence when both are specified.
 */
export interface GuardrailRetryConfig {
  /** Maximum retries for this specific guardrail */
  maxRetries?: number;
  /** Backoff between retry attempts (ms or function) */
  backoffMs?: number | ((attempt: number) => number);
}

/**
 * Context provided to getRetryInstruction for generating context-aware retry prompts.
 * Contains information about what failed and the current retry attempt.
 */
export interface RetryInstructionContext<M = Record<string, unknown>> {
  /** The guardrail result that triggered the retry */
  result: GuardrailResult<M>;
  /** Current retry attempt number (1-based) */
  attempt: number;
  /** Maximum retry attempts configured */
  maxRetries: number;
}

/**
 * Retry instruction returned by guardrails.
 * Provides context-aware retry prompts that the default buildRetryParams uses.
 */
export interface RetryInstruction {
  /** The instruction text to append as a user message */
  message: string;
  /** Optional temperature adjustment (e.g., -0.1 to make more deterministic) */
  temperatureAdjustment?: number;
  /** Optional additional context for logging/debugging */
  context?: Record<string, unknown>;
}

// ============================================================================

// Normalized internal types for better type safety and maintainability
export interface NormalizedGuardrailContext {
  /** The main prompt/input text */
  prompt: string;
  /** Chat-style messages if available */
  messages: Array<{
    role: string;
    content: string;
  }>;
  /** System message if available */
  system: string;
  /** Maximum output tokens */
  maxOutputTokens?: number;
  /** Temperature setting */
  temperature?: number;
  /** Additional model parameters */
  modelParams?: Record<string, unknown>;
}

export type InputGuardrailContext =
  | GenerateTextParams
  | GenerateObjectParams
  | StreamTextParams
  | StreamObjectParams
  | EmbedParams
  | NormalizedGuardrailContext;

export type AIResult =
  | GenerateTextResult
  | GenerateObjectResult
  | StreamTextResult
  | StreamObjectResult
  | EmbedResult;

export type OutputGuardrailContext = {
  input: NormalizedGuardrailContext;
  result: AIResult;
};

export interface InputGuardrail<M = Record<string, unknown>> {
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
  /**
   * The main execution function that validates input and returns guardrail results.
   *
   * Implement comprehensive error handling with appropriate severity levels,
   * clear messages, actionable suggestions, and detailed metadata.
   *
   * @param context The input context to validate
   * @returns GuardrailResult with error details and severity information
   *
   * @example
   * ```typescript
   * execute: async (context) => {
   *   try {
   *     // Perform validation logic
   *     const violations = await detectViolations(context.prompt);
   *
   *     if (violations.length > 0) {
   *       return {
   *         tripwireTriggered: true,
   *         message: `Found ${violations.length} policy violations`,
   *         severity: violations.some(v => v.critical) ? 'critical' : 'high',
   *         suggestion: 'Review and modify content to comply with policies',
   *         metadata: {
   *           violations,
   *           confidence: 0.95,
   *           detectionMethod: 'ml-classifier'
   *         }
   *       };
   *     }
   *
   *     return { tripwireTriggered: false };
   *   } catch (error) {
   *     // Handle execution errors gracefully
   *     return {
   *       tripwireTriggered: true,
   *       message: 'Guardrail execution failed',
   *       severity: 'critical',
   *       suggestion: 'Contact support if this error persists',
   *       metadata: { error: error.message, stack: error.stack }
   *     };
   *   }
   * }
   * ```
   */
  execute: (
    context: InputGuardrailContext,
    options?: { signal?: AbortSignal },
  ) => Promise<GuardrailResult<M>> | GuardrailResult<M>;
  /** Optional setup function called once when guardrail is initialized */
  setup?: () => Promise<void> | void;
  /** Optional cleanup function called when guardrail is destroyed */
  cleanup?: () => Promise<void> | void;
}

export interface OutputGuardrail<M = Record<string, unknown>> {
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
    options?: { signal?: AbortSignal },
  ) => Promise<GuardrailResult<M>> | GuardrailResult<M>;
  /** Optional setup function called once when guardrail is initialized */
  setup?: () => Promise<void> | void;
  /** Optional cleanup function called when guardrail is destroyed */
  cleanup?: () => Promise<void> | void;

  /**
   * Retry configuration specific to this guardrail.
   * When specified, provides guardrail-level retry behavior.
   * The withGuardrails-level retry config takes precedence when both are specified.
   */
  retry?: GuardrailRetryConfig;

  /**
   * Generate a context-aware retry instruction when this guardrail blocks.
   * Called by the default buildRetryParams to create appropriate retry prompts.
   *
   * @param context Information about the blocked result and retry attempt
   * @returns RetryInstruction with message and optional temperature adjustment,
   *          or a simple string message, or undefined to use default fallback
   *
   * @example
   * ```typescript
   * getRetryInstruction: (ctx) => {
   *   const missing = ctx.result.metadata?.missingTools ?? [];
   *   return {
   *     message: `Please use the ${missing.join(', ')} tool(s) to complete this task.`,
   *     temperatureAdjustment: -0.1,
   *   };
   * }
   * ```
   */
  getRetryInstruction?: (
    context: RetryInstructionContext<M>,
  ) => RetryInstruction | string | undefined;
}

/**
 * Enhanced guardrail execution results with comprehensive analytics and error context
 *
 * Provides detailed information about all guardrails executed, including timing metrics,
 * execution statistics, and both successful and failed results for observability.
 *
 * @example
 * ```typescript
 * const onInputBlocked = (summary: GuardrailExecutionSummary) => {
 *   // Handle different severity levels appropriately
 *   const criticalBlocks = summary.blockedResults.filter(r => r.severity === 'critical');
 *   if (criticalBlocks.length > 0) {
 *     await alertSecurityTeam({ summary, criticalBlocks });
 *   }
 *
 *   // Log analytics data
 *   analytics.track('guardrails_blocked', {
 *     totalExecuted: summary.guardrailsExecuted,
 *     blocked: summary.stats.blocked,
 *     executionTime: summary.totalExecutionTime
 *   });
 * };
 * ```
 */
export interface GuardrailExecutionSummary<M = Record<string, unknown>> {
  /**
   * All guardrail results (both triggered and non-triggered).
   * Use for comprehensive logging and analytics.
   */
  allResults: GuardrailResult<M>[];

  /**
   * Only the triggered/blocked results that prevented execution.
   * Use for error handling and user notification.
   */
  blockedResults: GuardrailResult<M>[];

  /**
   * Total execution time for all guardrails in milliseconds.
   * Use for performance monitoring and optimization.
   */
  totalExecutionTime: number;

  /**
   * Number of guardrails executed.
   * Use for coverage tracking and guardrail effectiveness analysis.
   */
  guardrailsExecuted: number;

  /**
   * Execution statistics for detailed analysis.
   * Provides breakdown of guardrail outcomes and performance metrics.
   */
  stats: {
    /** Number of guardrails that passed (did not trigger) */
    passed: number;
    /** Number of guardrails that blocked the request */
    blocked: number;
    /** Number of guardrails that failed due to execution errors */
    failed: number;
    /** Average execution time per guardrail in milliseconds */
    averageExecutionTime: number;
  };
}

// Generic metadata type parameterized via usage sites
/* intentionally removed duplicate empty interface */

export interface InputGuardrailsMiddlewareConfig<M = Record<string, unknown>> {
  /** Input guardrails to execute before AI calls */
  inputGuardrails: InputGuardrail<M>[];
  /**
   * Execution options for guardrails with error handling configuration.
   *
   * Configure how guardrails execute and handle errors to optimize for
   * your use case (performance vs. reliability vs. observability).
   */
  executionOptions?: {
    /**
     * Execute guardrails in parallel for better performance.
     *
     * - **true**: All guardrails execute simultaneously (faster)
     * - **false**: Guardrails execute sequentially (more predictable)
     *
     * @default true
     */
    parallel?: boolean;

    /**
     * Maximum execution time per guardrail in milliseconds.
     * Prevents hanging on slow/unresponsive guardrails.
     *
     * @default 30000 (30 seconds)
     */
    timeout?: number;

    /**
     * Whether to continue executing remaining guardrails after one fails.
     *
     * - **true**: Continue execution for comprehensive results
     * - **false**: Stop on first failure for fail-fast behavior
     *
     * @default true
     */
    continueOnFailure?: boolean;

    /**
     * Logging level for guardrail execution.
     *
     * - **none**: No logging (production)
     * - **error**: Only log execution failures
     * - **warn**: Log failures and triggered guardrails
     * - **info**: Log all guardrail executions
     * - **debug**: Verbose logging with timing data
     *
     * @default 'warn'
     */
    logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';

    /**
     * Custom logger instance to use instead of console.
     * Compatible with popular loggers like Winston, Pino, Bunyan.
     * Defaults to console if not provided.
     *
     * @example
     * ```typescript
     * import winston from 'winston';
     *
     * const logger = winston.createLogger({
     *   level: 'info',
     *   format: winston.format.json(),
     *   transports: [new winston.transports.Console()]
     * });
     *
     * const options = { logger, logLevel: 'info' };
     * ```
     */
    logger?: Logger;

    /**
     * OpenTelemetry configuration for observability.
     *
     * Configure distributed tracing to monitor guardrail execution
     * in production. Automatically inherits from AI SDK's experimental_telemetry
     * when available.
     *
     * @example
     * ```typescript
     * import { trace } from '@opentelemetry/api';
     *
     * const guardedModel = withGuardrails(model, {
     *   inputGuardrails: [piiDetector()],
     *   executionOptions: {
     *     telemetry: {
     *       isEnabled: true,
     *       tracer: trace.getTracer('my-app'),
     *       recordInputs: false, // Don't record sensitive inputs
     *     }
     *   }
     * });
     * ```
     */
    telemetry?: GuardrailTelemetrySettings;
  };
  /**
   * Callback for when input is blocked - receives comprehensive execution analytics.
   *
   * **New in v4.0.0:** Enhanced callback interface with comprehensive execution analytics.
   *
   * @param executionSummary Complete execution results with analytics data
   * @param originalParams The original input parameters that were blocked
   *
   * @example
   * ```typescript
   * onInputBlocked: (summary: GuardrailExecutionSummary, params) => {
   *   // Handle different severity levels appropriately
   *   const criticalBlocks = summary.blockedResults.filter(
   *     r => r.severity === 'high' || r.severity === 'critical'
   *   );
   *
   *   if (criticalBlocks.length > 0) {
   *     notifyAdmins({ summary, params, criticalBlocks });
   *     logSecurityEvent(summary);
   *   }
   *
   *   // Track analytics with comprehensive metrics
   *   analytics.track('input_blocked', {
   *     guardrailsTriggered: summary.stats.blocked,
   *     totalExecuted: summary.guardrailsExecuted,
   *     executionTime: summary.totalExecutionTime,
   *     averageExecutionTime: summary.stats.averageExecutionTime
   *   });
   * }
   * ```
   */
  onInputBlocked?: (
    executionSummary: GuardrailExecutionSummary<M>,
    originalParams: InputGuardrailContext,
  ) => void;

  /**
   * Whether to throw errors when guardrails are triggered.
   *
   * - **true**: Throws `GuardrailsInputError` - use for strict validation
   * - **false**: Logs warnings and continues - use for monitoring/analytics
   *
   * @default false
   */
  throwOnBlocked?: boolean;
}

export interface OutputGuardrailsMiddlewareConfig<M = Record<string, unknown>> {
  /** Output guardrails to execute after AI calls */
  outputGuardrails: OutputGuardrail<M>[];
  /**
   * Execution options for guardrails with error handling configuration.
   *
   * Configure how guardrails execute and handle errors to optimize for
   * your use case (performance vs. reliability vs. observability).
   */
  executionOptions?: {
    /**
     * Execute guardrails in parallel for better performance.
     *
     * - **true**: All guardrails execute simultaneously (faster)
     * - **false**: Guardrails execute sequentially (more predictable)
     *
     * @default true
     */
    parallel?: boolean;

    /**
     * Maximum execution time per guardrail in milliseconds.
     * Prevents hanging on slow/unresponsive guardrails.
     *
     * @default 30000 (30 seconds)
     */
    timeout?: number;

    /**
     * Whether to continue executing remaining guardrails after one fails.
     *
     * - **true**: Continue execution for comprehensive results
     * - **false**: Stop on first failure for fail-fast behavior
     *
     * @default true
     */
    continueOnFailure?: boolean;

    /**
     * Logging level for guardrail execution.
     *
     * - **none**: No logging (production)
     * - **error**: Only log execution failures
     * - **warn**: Log failures and triggered guardrails
     * - **info**: Log all guardrail executions
     * - **debug**: Verbose logging with timing data
     *
     * @default 'warn'
     */
    logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';

    /**
     * Custom logger instance to use instead of console.
     * Compatible with popular loggers like Winston, Pino, Bunyan.
     * Defaults to console if not provided.
     *
     * @example
     * ```typescript
     * import winston from 'winston';
     *
     * const logger = winston.createLogger({
     *   level: 'info',
     *   format: winston.format.json(),
     *   transports: [new winston.transports.Console()]
     * });
     *
     * const options = { logger, logLevel: 'info' };
     * ```
     */
    logger?: Logger;

    /**
     * OpenTelemetry configuration for observability.
     *
     * Configure distributed tracing to monitor guardrail execution
     * in production. Automatically inherits from AI SDK's experimental_telemetry
     * when available.
     *
     * @example
     * ```typescript
     * import { trace } from '@opentelemetry/api';
     *
     * const guardedModel = withGuardrails(model, {
     *   outputGuardrails: [minLength(100)],
     *   executionOptions: {
     *     telemetry: {
     *       isEnabled: true,
     *       tracer: trace.getTracer('my-app'),
     *       recordOutputs: false, // Don't record sensitive outputs
     *     }
     *   }
     * });
     * ```
     */
    telemetry?: GuardrailTelemetrySettings;
  };
  /**
   * Callback for when output is blocked - receives comprehensive execution analytics.
   *
   * **New in v4.0.0:** Enhanced callback interface with comprehensive execution analytics.
   *
   * @param executionSummary Complete execution results with analytics data
   * @param originalParams The original input parameters that generated blocked output
   * @param result The AI result that was blocked
   *
   * @example
   * ```typescript
   * onOutputBlocked: (summary: GuardrailExecutionSummary, params, result) => {
   *   // Handle critical security violations
   *   const criticalViolations = summary.blockedResults.filter(
   *     r => r.severity === 'critical'
   *   );
   *
   *   if (criticalViolations.length > 0) {
   *     auditLogger.critical('AI output blocked for security', {
   *       violations: criticalViolations,
   *       inputContext: params.prompt,
   *       timestamp: new Date().toISOString()
   *     });
   *   }
   *
   *   // Track comprehensive analytics
   *   analytics.track('output_blocked', {
   *     guardrailsTriggered: summary.stats.blocked,
   *     totalExecuted: summary.guardrailsExecuted,
   *     executionTime: summary.totalExecutionTime
   *   });
   * }
   * ```
   */
  onOutputBlocked?: (
    executionSummary: GuardrailExecutionSummary<M>,
    originalParams: InputGuardrailContext,
    result: unknown,
  ) => void;

  /**
   * Whether to throw errors when guardrails are triggered.
   *
   * - **true**: Throws `GuardrailsOutputError` - use for strict validation
   * - **false**: Logs warnings and continues - use for monitoring/analytics
   *
   * @default false
   */
  throwOnBlocked?: boolean;

  /**
   * Whether to replace blocked output with placeholder text.
   *
   * - **true**: Returns placeholder message instead of blocked content
   * - **false**: Returns original content despite being flagged
   *
   * @default true
   */
  replaceOnBlocked?: boolean;

  /**
   * Streaming evaluation mode for output guardrails.
   * - 'buffer': accumulate all output and evaluate once at the end (default)
   * - 'progressive': evaluate progressively and stop early when blocked
   */
  streamMode?: 'buffer' | 'progressive';

  /**
   * Enable automatic early termination when guardrails are violated during streaming.
   * Only applies when streamMode is 'progressive'.
   *
   * When enabled, the stream will be terminated early based on:
   * - Critical severity violations (immediate termination)
   * - Repeated guardrail violations (configurable threshold)
   * - Custom violation patterns
   *
   * Can be:
   * - boolean: true enables default behavior (stop on 2 violations or any critical)
   * - number: stop after N violations
   * - function: custom stop condition based on violation history during streaming
   *
   * @example
   * ```typescript
   * const model = withGuardrails(openai('gpt-4o'), {
   *   outputGuardrails: [piiGuardrail, toxicityGuardrail],
   *   streamMode: 'progressive',
   *   stopOnGuardrailViolation: true, // Stop on 2 violations or critical
   * });
   * ```
   */
  stopOnGuardrailViolation?:
    | boolean
    | number
    | ((
        violations: Array<{
          chunkIndex: number;
          summary: GuardrailExecutionSummary<M>;
        }>,
      ) => boolean);

  /**
   * Optional automatic retry when output guardrails block a result.
   *
   * **Improved DX in v5.0:** When `buildRetryParams` is not provided, the library
   * uses a default implementation that:
   * 1. Finds which guardrail(s) blocked the result
   * 2. Calls their `getRetryInstruction()` method if available
   * 3. Appends the instruction as a user message to the prompt
   *
   * @example Simple usage (default retry behavior)
   * ```typescript
   * withGuardrails(model, {
   *   outputGuardrails: [expectedToolUse({ tools: 'calculator' })],
   *   retry: { maxRetries: 2 },
   * });
   * ```
   *
   * @example Custom retry behavior
   * ```typescript
   * withGuardrails(model, {
   *   outputGuardrails: [expectedToolUse({ tools: 'calculator' })],
   *   retry: {
   *     maxRetries: 2,
   *     buildRetryParams: ({ summary, lastParams }) => ({
   *       ...lastParams,
   *       temperature: 0.2,
   *     }),
   *   },
   * });
   * ```
   */
  retry?: {
    /** Maximum number of retry attempts. Default: 1 */
    maxRetries?: number;
    /** Backoff between attempts (ms) or function per attempt (1-based). Default: 0 */
    backoffMs?: number | ((attempt: number) => number);
    /** Optional predicate to enable retries only for certain violations */
    onlyWhen?: (summary: GuardrailExecutionSummary<M>) => boolean;
    /**
     * Strategy for handling multiple blocked guardrails when generating retry instructions.
     * Only used when `buildRetryParams` is not provided (default implementation).
     *
     * - 'first': Use instruction from first blocked guardrail only
     * - 'all': Combine instructions from all blocked guardrails
     * - 'highest-severity': Use instruction from highest severity guardrail (default)
     *
     * @default 'highest-severity'
     */
    multipleBlockedStrategy?: 'first' | 'all' | 'highest-severity';
    /**
     * Build next call params based on previous failure.
     *
     * **Optional in v5.0:** When not provided, the library uses a default implementation
     * that appends retry instructions from blocked guardrails' `getRetryInstruction()` methods.
     *
     * When provided, this function has full control over the retry parameters.
     * Must return complete LanguageModelV2CallOptions for the next attempt.
     */
    buildRetryParams?: (args: {
      summary: GuardrailExecutionSummary<M>;
      originalParams: LMCallOptions;
      lastParams: LMCallOptions;
      lastResult: AIResult;
    }) => LMCallOptions;
  };
}
