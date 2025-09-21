export type { InputGuardrail, OutputGuardrail, Logger } from './types';
import type { InputGuardrail, OutputGuardrail } from './types';

// Export error classes
export {
  GuardrailsError,
  GuardrailValidationError,
  GuardrailExecutionError,
  GuardrailTimeoutError,
  GuardrailConfigurationError,
  InputBlockedError,
  OutputBlockedError,
  MiddlewareError,
  isGuardrailsError,
  extractErrorInfo,
} from './errors';

export function createInputGuardrail(
  name: string,
  description: string,
  execute: InputGuardrail['execute'],
): InputGuardrail {
  return { name, description, execute };
}

export function createOutputGuardrail(
  name: string,
  execute: OutputGuardrail['execute'],
): OutputGuardrail {
  return { name, execute };
}

// Types for enhanced retry functionality
export interface RetryAttemptInfo<R = unknown> {
  attempt: number;
  totalAttempts: number;
  lastResult?: R;
  waitMs?: number;
  isRetry: boolean;
}

/**
 * Configuration options for the retry function
 *
 * @example Basic retry with token increase
 * ```ts
 * const result = await retry({
 *   generate: (params) => generateText(params),
 *   params: { prompt: 'Explain AI', maxOutputTokens: 100 },
 *   validate: (result) => ({
 *     blocked: result.text.length < 200,
 *     message: 'Response too short'
 *   }),
 *   buildRetryParams: retryHelpers.increaseTokens(200),
 *   maxRetries: 2
 * });
 * ```
 *
 * @example Advanced retry with custom backoff and error handling
 * ```ts
 * const result = await retry({
 *   generate: (params, signal) => generateText(params),
 *   params: { prompt: 'Write essay', maxOutputTokens: 500 },
 *   validate: async (result) => ({
 *     blocked: await checkQuality(result.text) < 0.8,
 *     message: 'Quality too low',
 *     metadata: { quality: await checkQuality(result.text) }
 *   }),
 *   buildRetryParams: ({ summary, lastParams }) => ({
 *     ...lastParams,
 *     temperature: Math.min(0.9, lastParams.temperature + 0.1),
 *     maxOutputTokens: lastParams.maxOutputTokens + 100
 *   }),
 *   maxRetries: 3,
 *   backoffMs: (attempt) => attempt * 1000, // 1s, 2s, 3s
 *   signal: controller.signal,
 *   onAttempt: ({ attempt, isRetry }) =>
 *     logger.info(`Attempt ${attempt}${isRetry ? ' (retry)' : ''}`),
 *   retryOnError: (error, attempt) =>
 *     error instanceof RateLimitError && attempt <= 2,
 *   onError: (error, attempt) =>
 *     logger.warn(`Generation failed on attempt ${attempt}:`, error),
 *   onExhausted: 'throw'
 * });
 * ```
 */
export interface RetryOptions<P, R> {
  /** Function to generate results - receives params and optional AbortSignal */
  generate:
    | ((params: P, signal?: AbortSignal) => Promise<R>)
    | ((params: P) => Promise<R>);
  /** Initial parameters for generation */
  params: P;
  /**
   * Function to validate results - return { blocked: true } to trigger retry
   * @example
   * ```ts
   * validate: (result) => ({
   *   blocked: result.text.length < 100,
   *   message: 'Too short',
   *   metadata: { actualLength: result.text.length }
   * })
   * ```
   */
  validate:
    | ((
        result: R,
      ) => Promise<{ blocked: boolean; message?: string; metadata?: unknown }>)
    | ((result: R) => {
        blocked: boolean;
        message?: string;
        metadata?: unknown;
      });
  /**
   * Function to build retry parameters based on previous attempts
   * @example
   * ```ts
   * buildRetryParams: ({ lastParams, summary }) => ({
   *   ...lastParams,
   *   maxOutputTokens: lastParams.maxOutputTokens + 200,
   *   temperature: Math.min(0.9, lastParams.temperature + 0.1)
   * })
   * ```
   */
  buildRetryParams: (args: {
    summary: {
      blockedResults: Array<{ message?: string; metadata?: unknown }>;
      totalAttempts?: number;
      attempts?: Array<{
        attempt: number;
        result?: R;
        blocked: boolean;
        waitMs?: number;
      }>;
    };
    originalParams: P;
    lastParams: P;
    lastResult?: R;
  }) => P;
  /** Maximum number of retry attempts (default: 1) */
  maxRetries?: number;
  /**
   * Backoff delay between retries in milliseconds
   * @example
   * ```ts
   * backoffMs: 1000 // Fixed 1 second delay
   * backoffMs: (attempt) => attempt * 500 // Progressive: 500ms, 1s, 1.5s...
   * ```
   */
  backoffMs?: number | ((attempt: number) => number);
  /**
   * Optional cancellation signal - passed to generate function and honored during backoff
   * @example
   * ```ts
   * const controller = new AbortController();
   * setTimeout(() => controller.abort(), 30000); // Cancel after 30s
   * signal: controller.signal
   * ```
   */
  signal?: AbortSignal;
  /**
   * Callback for each attempt (including initial) - useful for logging/metrics
   * @example
   * ```ts
   * onAttempt: ({ attempt, isRetry, waitMs }) =>
   *   logger.info(`${isRetry ? 'Retry' : 'Initial'} attempt ${attempt}, waiting ${waitMs}ms`)
   * ```
   */
  onAttempt?: (info: RetryAttemptInfo<R>) => void;
  /**
   * Retry on generation errors (not just validation failures)
   * @example
   * ```ts
   * retryOnError: (error, attempt) =>
   *   error instanceof RateLimitError && attempt <= 2
   * ```
   */
  retryOnError?: (error: unknown, attempt: number) => boolean;
  /**
   * Callback when generation errors occur
   * @example
   * ```ts
   * onError: (error, attempt) =>
   *   logger.error(`Generation failed on attempt ${attempt}:`, error)
   * ```
   */
  onError?: (error: unknown, attempt: number) => void;
  /**
   * Behavior when max retries exhausted: 'return-last' (default) | 'throw'
   * - 'return-last': Return the last generated result even if it failed validation
   * - 'throw': Throw an error when retries are exhausted
   */
  onExhausted?: 'return-last' | 'throw';
}

// Helper types for internal retry logic
interface AttemptHistory<R> {
  attempt: number;
  result: R;
  blocked: boolean;
  waitMs?: number;
}

interface ValidationResult {
  blocked: boolean;
  message?: string;
  metadata?: unknown;
}

interface RetrySummary<R> {
  blockedResults: Array<{ message?: string; metadata?: unknown }>;
  totalAttempts?: number;
  attempts?: Array<AttemptHistory<R>>;
}

// Extracted helper functions to reduce complexity
function createGenerateWithErrorHandling<P, R>(
  generate: RetryOptions<P, R>['generate'],
  signal: AbortSignal | undefined,
  onError: RetryOptions<P, R>['onError'],
  retryOnError: RetryOptions<P, R>['retryOnError'],
  maxRetries: number,
) {
  return async (params: P, attemptNum: number): Promise<R> => {
    try {
      return signal ? await generate(params, signal) : await generate(params);
    } catch (error) {
      onError?.(error, attemptNum);
      if (retryOnError?.(error, attemptNum) && attemptNum <= maxRetries) {
        throw error; // Will be caught by retry loop
      }
      throw error; // Re-throw if not retrying
    }
  };
}

function buildRetrySummary<R>(
  attemptHistory: Array<AttemptHistory<R>>,
  validationResult: ValidationResult,
  isUsingEnhancedFeatures: boolean,
  maxRetries: number,
): RetrySummary<R> {
  const blockedResults = attemptHistory
    .filter((historyAttempt) => historyAttempt.blocked)
    .map(() => ({
      message: validationResult.message,
      metadata: validationResult.metadata,
    }));

  const summary: RetrySummary<R> = { blockedResults };

  if (isUsingEnhancedFeatures) {
    summary.totalAttempts = maxRetries + 1;
    summary.attempts = [...attemptHistory];
  }

  return summary;
}

async function performInitialAttempt<P, R>(
  params: P,
  generateFn: (params: P, attemptNum: number) => Promise<R>,
  validate: RetryOptions<P, R>['validate'],
  onAttempt: RetryOptions<P, R>['onAttempt'],
  maxRetries: number,
  retryOnError: RetryOptions<P, R>['retryOnError'],
): Promise<{
  result: R | undefined;
  validationResult: ValidationResult;
  attemptHistory: Array<AttemptHistory<R>>;
}> {
  const attemptHistory: Array<AttemptHistory<R>> = [];

  onAttempt?.({
    attempt: 0,
    totalAttempts: maxRetries + 1,
    isRetry: false,
  });

  try {
    const result = await generateFn(params, 0);
    const validationResult = await Promise.resolve(validate(result));
    attemptHistory.push({
      attempt: 0,
      result,
      blocked: validationResult.blocked,
    });
    return { result, validationResult, attemptHistory };
  } catch (error) {
    if (!retryOnError?.(error, 0)) {
      throw error;
    }
    return {
      result: undefined,
      validationResult: {
        blocked: true,
        message: `Generation error: ${error}`,
      },
      attemptHistory,
    };
  }
}

async function performBackoffWait(
  backoffMs: RetryOptions<unknown, unknown>['backoffMs'],
  attempt: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  const wait =
    typeof backoffMs === 'function' ? backoffMs(attempt) : (backoffMs ?? 0);

  if (wait && wait > 0) {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, wait);
      signal?.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new Error('Aborted during retry backoff'));
      });
    });
  }

  return Promise.resolve();
}

/**
 * Lightweight helper for DX-friendly retries with comprehensive error handling and cancellation support
 *
 * @example Simple retry with helpers
 * ```ts
 * const result = await retry({
 *   generate: (params) => generateText(params),
 *   params: { prompt: 'Write a story', maxOutputTokens: 200 },
 *   validate: (result) => ({ blocked: result.text.length < 500 }),
 *   buildRetryParams: retryHelpers.improveResponse(300, 'Please write more detail'),
 *   maxRetries: 2
 * });
 * ```
 *
 * Exported for users and reused internally by guardrail middleware
 */
export async function retry<P, R>(options: RetryOptions<P, R>): Promise<R> {
  const {
    generate,
    params,
    validate,
    buildRetryParams,
    maxRetries = 1,
    backoffMs,
    signal,
    onAttempt,
    retryOnError,
    onError,
    onExhausted = 'return-last',
  } = options;

  // Check cancellation before starting
  signal?.throwIfAborted();

  const generateFn = createGenerateWithErrorHandling(
    generate,
    signal,
    onError,
    retryOnError,
    maxRetries,
  );

  // Initial attempt
  const {
    result: initialResult,
    validationResult,
    attemptHistory,
  } = await performInitialAttempt(
    params,
    generateFn,
    validate,
    onAttempt,
    maxRetries,
    retryOnError,
  );

  let result = initialResult;
  let v = validationResult;
  let lastParams = params;
  let attempt = 0;

  // Retry loop
  while (v.blocked && attempt < maxRetries) {
    attempt++;
    signal?.throwIfAborted();

    const enhancedFeatures = !!(
      signal ||
      onAttempt ||
      retryOnError ||
      onError ||
      onExhausted !== 'return-last'
    );
    const summary = buildRetrySummary(
      attemptHistory,
      v,
      enhancedFeatures,
      maxRetries,
    );

    const nextParams = buildRetryParams({
      summary,
      originalParams: params,
      lastParams,
      lastResult: result,
    });

    const wait =
      typeof backoffMs === 'function' ? backoffMs(attempt) : (backoffMs ?? 0);

    onAttempt?.({
      attempt,
      totalAttempts: maxRetries + 1,
      lastResult: result,
      waitMs: wait,
      isRetry: true,
    });

    await performBackoffWait(backoffMs, attempt, signal);

    lastParams = nextParams;
    try {
      result = await generateFn(lastParams, attempt);
      v = await Promise.resolve(validate(result));
      attemptHistory.push({
        attempt,
        result,
        blocked: v.blocked,
        waitMs: wait,
      });
    } catch (error) {
      if (!retryOnError?.(error, attempt)) {
        throw error;
      }
      // Continue retry loop on retryable error
      v = { blocked: true, message: `Generation error: ${error}` };
    }
  }

  // Handle exhaustion behavior
  if (v.blocked && onExhausted === 'throw') {
    throw new Error(
      `Retry exhausted after ${maxRetries} attempts: ${v.message}`,
    );
  }

  return result as R;
}

// ============================================================================
// CONVENIENCE SUGAR APIs
// ============================================================================

// Helper types for retry parameter builders
export interface RetryBuilderArgs<P, R> {
  summary: {
    blockedResults: Array<{ message?: string; metadata?: unknown }>;
    totalAttempts?: number;
    attempts?: Array<{
      attempt: number;
      result: R;
      blocked: boolean;
      waitMs?: number;
    }>;
  };
  originalParams: P;
  lastParams: P;
  lastResult: R;
}

/**
 * Parameter building helpers for common retry patterns
 *
 * @example
 * ```ts
 * // Simple token increase
 * buildRetryParams: retryHelpers.increaseTokens(300)
 *
 * // Add encouraging prompt
 * buildRetryParams: retryHelpers.addEncouragingPrompt(
 *   'Please be more specific and detailed.'
 * )
 *
 * // Combine both strategies
 * buildRetryParams: retryHelpers.improveResponse(300, 'Try again with more detail.')
 * ```
 */
export const retryHelpers = {
  /**
   * Increases max output tokens for retry attempts
   */
  increaseTokens:
    (increase: number = 200) =>
    <P extends { maxOutputTokens?: number }>({
      lastParams,
    }: RetryBuilderArgs<P, unknown>): P =>
      ({
        ...lastParams,
        maxOutputTokens: Math.max(
          400,
          (lastParams.maxOutputTokens ?? 400) + increase,
        ),
      }) as P,

  /**
   * Adds encouraging prompt for retry attempts
   */
  addEncouragingPrompt:
    (
      encouragement: string = 'Please provide a more detailed and comprehensive response.',
    ) =>
    <P extends { prompt?: unknown }>({
      lastParams,
      summary,
    }: RetryBuilderArgs<P, unknown>): P => {
      const basePrompt = Array.isArray(lastParams.prompt)
        ? lastParams.prompt
        : [
            {
              role: 'user',
              content: [
                { type: 'text', text: String(lastParams.prompt || '') },
              ],
            },
          ];

      return {
        ...lastParams,
        prompt: [
          ...basePrompt,
          {
            role: 'user' as const,
            content: [
              {
                type: 'text',
                text: `${summary.blockedResults[0]?.message ? `Note: ${summary.blockedResults[0].message}.` : ''} ${encouragement}`,
              },
            ],
          },
        ],
      } as P;
    },

  /**
   * Combines token increase with encouraging prompt
   */
  improveResponse:
    (tokenIncrease: number = 200, encouragement?: string) =>
    <P extends { maxOutputTokens?: number; prompt?: unknown }>(
      args: RetryBuilderArgs<P, unknown>,
    ): P => {
      const withTokens = retryHelpers.increaseTokens(tokenIncrease)(args);
      const withEncouragement = retryHelpers.addEncouragingPrompt(
        encouragement,
      )({ ...args, lastParams: withTokens });
      return { ...withTokens, ...withEncouragement };
    },

  /**
   * Simple parameter passthrough (no changes)
   */
  noChange:
    <P>() =>
    ({ lastParams }: RetryBuilderArgs<P, unknown>): P =>
      lastParams,
} as const;
