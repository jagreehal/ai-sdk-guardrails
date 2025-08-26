import {
  generateText,
  generateObject,
  streamText,
  streamObject,
  embed,
} from 'ai';

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
 * @example
 * ```typescript
 * const result: GuardrailResult = {
 *   tripwireTriggered: true,
 *   message: "Input contains blocked keywords",
 *   severity: "high",
 *   suggestion: "Remove or replace the flagged content",
 *   metadata: { blockedKeywords: ["password", "secret"] }
 * };
 * ```
 */
export interface GuardrailResult<M = Record<string, unknown>> {
  /** Whether the guardrail was triggered (blocked the request) */
  tripwireTriggered: boolean;

  /**
   * Human-readable message describing why the guardrail was triggered.
   * Should be clear and actionable for developers and end users.
   *
   * @example "Input exceeds maximum length of 1000 characters"
   * @example "Potential PII detected in user message"
   */
  message?: string;

  /**
   * Detailed metadata about the guardrail execution.
   * Use for debugging, analytics, and detailed error context.
   *
   * @example { detectedTypes: ["email", "phone"], confidence: 0.95 }
   * @example { inputLength: 1250, maxLength: 1000, excess: 250 }
   */
  metadata?: M;

  /**
   * Severity level of the guardrail violation. Use to determine response handling:
   *
   * - **low**: Minor issues, typically warnings (log only)
   * - **medium**: Moderate concerns requiring attention (warn user)
   * - **high**: Serious violations that should block requests (block + notify)
   * - **critical**: Security/safety issues requiring immediate action (block + alert)
   *
   * @default "medium"
   * @example
   * ```typescript
   * // Handle different severity levels
   * if (result.severity === 'critical') {
   *   await alertSecurityTeam(result);
   *   throw new Error('Critical violation detected');
   * } else if (result.severity === 'high') {
   *   logWarning(result.message);
   *   return blockRequest(result);
   * }
   * ```
   */
  severity?: 'low' | 'medium' | 'high' | 'critical';

  /**
   * Suggested action to resolve the issue.
   * Provide actionable guidance for developers and end users.
   *
   * @example "Reduce input length to under 1000 characters"
   * @example "Review content for sensitive information before retrying"
   */
  suggestion?: string;

  /**
   * Additional context information about guardrail execution.
   * Automatically populated by the guardrail system for observability.
   */
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
// eslint-disable-next-line @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type
export interface InputGuardrailsMiddlewareConfig {}

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
     * @default false
     */
    parallel?: boolean;

    /**
     * Maximum execution time per guardrail in milliseconds.
     * Prevents hanging on slow/unresponsive guardrails.
     *
     * @default 10000 (10 seconds)
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
   * - **true**: Throws `InputBlockedError` - use for strict validation
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
     * @default false
     */
    parallel?: boolean;

    /**
     * Maximum execution time per guardrail in milliseconds.
     * Prevents hanging on slow/unresponsive guardrails.
     *
     * @default 10000 (10 seconds)
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
   * - **true**: Throws `OutputBlockedError` - use for strict validation
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
}
