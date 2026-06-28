/**
 * Internal guardrail execution engine and shared substrate.
 *
 * This module holds the performance-sensitive machinery shared by the public
 * authoring API ({@link ../guardrails}) and the V4 middleware factories
 * ({@link ./middleware-factories}): context normalization + caching, the pooled
 * timeout runner, batch execution, the execution-summary builder, and the
 * `executeInput/OutputGuardrails` engine. It deliberately depends on nothing in
 * `../guardrails`, so the public barrel can re-export from here without a cycle.
 */

import { GuardrailTimeoutError } from '../errors';
import {
  executeInputGuardrailsWithEnhancedRuntime,
  executeOutputGuardrailsWithEnhancedRuntime,
} from '../adapters/parallel-runtime-adapter';
import type {
  InputGuardrail,
  OutputGuardrail,
  GuardrailResult,
  InputGuardrailContext,
  OutputGuardrailContext,
  LanguageModelV4CallOptions,
  NormalizedGuardrailContext,
  GuardrailExecutionSummary,
  Logger,
} from '../types';

// Performance optimization: conditional metadata tracking
// Only track detailed metrics in development or when explicitly enabled
export const ENABLE_PERFORMANCE_TRACKING =
  process.env.NODE_ENV === 'development' ||
  process.env.GUARDRAILS_PERFORMANCE_TRACKING === 'true';

// Enhanced runtime integration for 10x performance improvement
const USE_ENHANCED_RUNTIME =
  process.env.GUARDRAILS_USE_ENHANCED_RUNTIME !== 'false' &&
  process.env.NODE_ENV !== 'test'; // Disable in tests for compatibility

type LogLevel = 'none' | 'error' | 'warn' | 'info' | 'debug';

type MessageContent = Array<{ type: string; text?: string }>;

function extractTextFromContent(content: MessageContent): string {
  return content
    .filter((part) => part.type === 'text')
    .map((part) => part.text || '')
    .join('');
}

// Context caching for performance optimization
// WeakMap automatically garbage collects when params objects are no longer referenced
const normalizedContextCache = new WeakMap<
  LanguageModelV4CallOptions,
  NormalizedGuardrailContext
>();

// Timeout controller pooling for performance optimization
class TimeoutControllerPool {
  private static controllers: AbortController[] = [];
  private static readonly MAX_POOL_SIZE = 20;

  static acquire(): AbortController {
    const controller = this.controllers.pop();
    if (controller && !controller.signal.aborted) {
      return controller;
    }
    return new AbortController();
  }

  static release(controller: AbortController): void {
    // Only pool non-aborted controllers and respect max pool size
    if (
      !controller.signal.aborted &&
      this.controllers.length < this.MAX_POOL_SIZE
    ) {
      this.controllers.push(controller);
    }
  }

  static clear(): void {
    this.controllers = [];
  }
}

/**
 * Builds the canonical "guardrail failed" result. Centralizes the shape that was
 * previously hand-copied at every catch site so the error contract stays in one
 * place (and so the unavoidable `metadata` cast lives in exactly one location).
 */
export function guardrailErrorResult<M extends Record<string, unknown>>(
  guardrailName: string,
  error: unknown,
  extra?: {
    message?: string;
    metadata?: M;
    infoError?: string;
    context?: Record<string, unknown>;
  },
): GuardrailResult<M> {
  const errMsg = error instanceof Error ? error.message : String(error);
  const result: GuardrailResult<M> = {
    tripwireTriggered: true,
    message: extra?.message ?? `Guardrail execution failed: ${errMsg}`,
    severity: 'critical',
    metadata: (extra?.metadata ?? { error: errMsg }) as unknown as M,
    info: {
      guardrailName,
      executionFailed: true,
      error: extra?.infoError ?? errMsg,
    },
  };
  if (extra?.context) {
    result.context = extra.context;
  }
  return result;
}

const PRIORITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1 } as const;

/**
 * Filters out disabled guardrails and sorts the rest by descending priority.
 * Shared by the input and output engines so the ordering rule lives once.
 */
function prepareGuardrails<
  G extends { enabled?: boolean; priority?: keyof typeof PRIORITY_ORDER },
>(guardrails: G[]): G[] {
  return guardrails
    .filter((g) => g.enabled !== false)
    .toSorted(
      (a, b) =>
        (PRIORITY_ORDER[b.priority || 'medium'] || 2) -
        (PRIORITY_ORDER[a.priority || 'medium'] || 2),
    );
}

/**
 * Creates context metadata conditionally based on performance tracking settings
 */
export function createConditionalContext(
  guardrailName: string,
  guardrailVersion?: string,
  executionTimeMs?: number,
  existingContext?: Record<string, unknown>,
): Record<string, unknown> {
  if (!ENABLE_PERFORMANCE_TRACKING) {
    // In production, only include essential info
    return {
      guardrailName,
      ...existingContext,
    };
  }

  // In development, include full metrics
  return {
    guardrailName,
    guardrailVersion,
    executedAt: new Date(),
    executionTimeMs,
    ...existingContext,
  };
}

/**
 * Checks if streaming should stop based on guardrail violation patterns
 */
export function checkStreamStopCondition<M extends Record<string, unknown>>(
  stopConfig:
    | boolean
    | number
    | ((
        violations: Array<{
          chunkIndex: number;
          summary: GuardrailExecutionSummary<M>;
        }>,
      ) => boolean),
  violations: Array<{
    chunkIndex: number;
    summary: GuardrailExecutionSummary<M>;
  }>,
): boolean {
  // Default behavior: stop on 2 violations or any critical
  if (stopConfig === true) {
    const criticalViolations = violations.filter((v) =>
      v.summary.blockedResults.some(
        (r) => (r.severity ?? 'medium') === 'critical',
      ),
    );
    return violations.length >= 2 || criticalViolations.length > 0;
  }

  // Number threshold: stop after N violations
  if (typeof stopConfig === 'number') {
    return violations.length >= stopConfig;
  }

  // Custom function: user-defined logic
  if (typeof stopConfig === 'function') {
    return stopConfig(violations);
  }

  return false;
}

/**
 * Optimized timeout execution using pooled controllers
 */
async function executeWithOptimizedTimeout<T>(
  execution: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  errorMessage: string,
): Promise<T> {
  const controller = TimeoutControllerPool.acquire();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutPromise: Promise<never> = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error(errorMessage));
      }, timeoutMs);
    });

    const result = await Promise.race([
      execution(controller.signal),
      timeoutPromise,
    ]);

    return result;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    TimeoutControllerPool.release(controller);
  }
}

/**
 * Wraps a per-guardrail invocation in a pooled timeout, translating a timeout
 * into a {@link GuardrailTimeoutError}. The caller supplies how to call the
 * guardrail (input vs output have different `execute` signatures).
 */
function makeInvokeWithTimeout<
  M extends Record<string, unknown>,
  G extends { name: string },
>(
  invoke: (guardrail: G, signal: AbortSignal) => Promise<GuardrailResult<M>>,
  timeoutMs: number,
): (guardrail: G) => Promise<GuardrailResult<M>> {
  return (guardrail) =>
    executeWithOptimizedTimeout(
      (signal) => invoke(guardrail, signal),
      timeoutMs,
      `Guardrail ${guardrail.name} timed out after ${timeoutMs}ms`,
    ).catch((error) => {
      if (error.message.includes('timed out')) {
        throw new GuardrailTimeoutError(guardrail.name, timeoutMs);
      }
      throw error;
    });
}

/**
 * Sequential execution path shared by both engines: run guardrails in priority
 * order, stop early on a tripwire when `continueOnFailure` is false.
 */
async function executeSequential<
  M extends Record<string, unknown>,
  G extends { name: string },
>(
  guardrails: G[],
  invokeWithTimeout: (guardrail: G) => Promise<GuardrailResult<M>>,
  opts: {
    continueOnFailure: boolean;
    logLevel: LogLevel;
    logger: Logger;
    label: string;
  },
): Promise<GuardrailResult<M>[]> {
  const { continueOnFailure, logLevel, logger, label } = opts;
  const results: GuardrailResult<M>[] = [];

  for (const guardrail of guardrails) {
    try {
      const result = await invokeWithTimeout(guardrail);
      results.push(result);

      if (result.tripwireTriggered) {
        if (logLevel !== 'none') {
          logger.warn(
            `${label} guardrail "${guardrail.name}" triggered: ${result.message}`,
          );
        }
        if (!continueOnFailure) {
          break;
        }
      }
    } catch (error) {
      if (logLevel !== 'none') {
        logger.error(
          `Error executing ${label.toLowerCase()} guardrail "${guardrail.name}":`,
          error,
        );
      }
      results.push(guardrailErrorResult<M>(guardrail.name, error));
      if (!continueOnFailure) {
        break;
      }
    }
  }

  return results;
}

/**
 * Parallel fallback that gives each guardrail its own timeout. Used by the
 * output engine; the input engine uses the shared-timeout batch path below.
 */
async function executeParallelPerGuardrail<
  M extends Record<string, unknown>,
  G extends { name: string },
>(
  guardrails: G[],
  invokeWithTimeout: (guardrail: G) => Promise<GuardrailResult<M>>,
  label: string,
  logLevel: LogLevel,
  logger: Logger,
): Promise<GuardrailResult<M>[]> {
  return Promise.all(
    guardrails.map(async (guardrail) => {
      try {
        const result = await invokeWithTimeout(guardrail);
        if (result.tripwireTriggered && logLevel !== 'none') {
          logger.warn(
            `${label} guardrail "${guardrail.name}" triggered: ${result.message}`,
          );
        }
        return result;
      } catch (error) {
        if (logLevel !== 'none') {
          logger.error(
            `Error executing ${label.toLowerCase()} guardrail "${guardrail.name}":`,
            error,
          );
        }
        return guardrailErrorResult<M>(guardrail.name, error);
      }
    }),
  );
}

/**
 * Batch execute input guardrails under a single shared timeout. Preserves the
 * input engine's semantics: one timeout covers the whole batch, and a batch
 * timeout maps every guardrail to a uniform timeout result.
 */
async function executeBatchInputGuardrails<M extends Record<string, unknown>>(
  guardrails: InputGuardrail<M>[],
  normalizedContext: NormalizedGuardrailContext,
  timeoutMs: number,
  logLevel: LogLevel,
  logger: Logger,
): Promise<GuardrailResult<M>[]> {
  if (guardrails.length === 0) return [];

  return executeWithOptimizedTimeout(
    async (signal) => {
      const results = await Promise.allSettled(
        guardrails.map(async (guardrail) => {
          try {
            return await Promise.resolve(
              guardrail.execute(normalizedContext, { signal }),
            );
          } catch (error) {
            if (logLevel !== 'none') {
              logger.error(
                `Error executing input guardrail "${guardrail.name}":`,
                error,
              );
            }
            return guardrailErrorResult<M>(guardrail.name, error);
          }
        }),
      );

      return results.map((result, index) => {
        const guardrail = guardrails[index]!;
        if (result.status === 'fulfilled') {
          const guardResult = result.value;
          if (guardResult.tripwireTriggered && logLevel !== 'none') {
            logger.warn(
              `Input guardrail "${guardrail.name}" triggered: ${guardResult.message}`,
            );
          }
          return guardResult;
        }
        if (logLevel !== 'none') {
          logger.error(
            `Input guardrail "${guardrail.name}" failed:`,
            result.reason,
          );
        }
        return guardrailErrorResult<M>(guardrail.name, result.reason);
      });
    },
    timeoutMs,
    `Batch guardrail execution timed out after ${timeoutMs}ms`,
  ).catch((error) => {
    if (error.message.includes('timed out')) {
      // Create timeout errors for all guardrails
      return guardrails.map((guardrail) =>
        guardrailErrorResult<M>(guardrail.name, error, {
          message: `Guardrail timed out after ${timeoutMs}ms`,
          metadata: { timeout: true } as unknown as M,
          infoError: 'Timeout',
        }),
      );
    }
    throw error;
  });
}

/**
 * Normalizes AI SDK parameters into a consistent guardrail context
 * This improves type safety and reduces coupling to specific AI SDK parameter types
 * Uses caching to avoid redundant processing of the same parameters
 */
export function normalizeGuardrailContext(
  params: LanguageModelV4CallOptions,
): NormalizedGuardrailContext {
  // Check cache first for performance optimization
  const cached = normalizedContextCache.get(params);
  if (cached) {
    return cached;
  }

  const promptMessages = Array.isArray(params.prompt) ? params.prompt : [];
  const systemMessage = promptMessages.find((msg) => msg.role === 'system');
  const system =
    systemMessage && Array.isArray(systemMessage.content)
      ? extractTextFromContent(systemMessage.content as MessageContent)
      : '';
  const messages = promptMessages
    .filter((msg) => msg.role !== 'system')
    .map((msg) => ({
      role: msg.role as string,
      content:
        msg.content && Array.isArray(msg.content)
          ? extractTextFromContent(msg.content as MessageContent)
          : '',
    }));
  const prompt =
    messages.length === 1 && messages[0]?.role === 'user'
      ? messages[0].content
      : messages.map((m) => m.content).join(' ');

  const normalized = {
    prompt,
    messages,
    system,
    maxOutputTokens: params.maxOutputTokens,
    temperature: params.temperature,
    modelParams: {
      topP: params.topP,
      topK: params.topK,
      frequencyPenalty: params.frequencyPenalty,
      presencePenalty: params.presencePenalty,
      seed: params.seed,
      stopSequences: params.stopSequences,
    },
  };

  // Cache the normalized result for future use
  normalizedContextCache.set(params, normalized);
  return normalized;
}

/**
 * Converts either raw AI SDK params or an already-normalized context
 * into a NormalizedGuardrailContext for guardrail execution.
 */
export function toNormalizedGuardrailContext(
  params: LanguageModelV4CallOptions | InputGuardrailContext,
): NormalizedGuardrailContext {
  const candidate = params as {
    prompt?: unknown;
    messages?: unknown;
  };
  if (
    typeof candidate.prompt === 'string' &&
    Array.isArray(candidate.messages)
  ) {
    return params as NormalizedGuardrailContext;
  }
  return normalizeGuardrailContext(params as LanguageModelV4CallOptions);
}

/**
 * Creates a comprehensive execution summary for enhanced observability
 */
export function createExecutionSummary<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  results: GuardrailResult<M>[],
  startTime: number,
): GuardrailExecutionSummary<M> {
  const endTime = Date.now();
  const totalExecutionTime = endTime - startTime;
  const blockedResults = results.filter((r) => r.tripwireTriggered);

  const execTimes = results
    .map((r) => r.context?.executionTimeMs)
    .filter((t): t is number => typeof t === 'number');
  const avgTime =
    execTimes.length > 0
      ? execTimes.reduce((a, b) => a + b, 0) / execTimes.length
      : 0;

  const stats = {
    passed: results.filter((r) => !r.tripwireTriggered).length,
    blocked: blockedResults.length,
    failed: results.filter(
      (r) => r.severity === 'critical' && r.tripwireTriggered,
    ).length,
    averageExecutionTime: avgTime,
  };

  return {
    allResults: results,
    blockedResults,
    totalExecutionTime,
    guardrailsExecuted: results.length,
    stats,
  };
}

/** Shared execution options accepted by both engines. */
interface ExecuteOptions {
  /** Execute guardrails in parallel (default: true) */
  parallel?: boolean;
  /** Maximum execution time in milliseconds */
  timeout?: number;
  /** Whether to continue on first failure */
  continueOnFailure?: boolean;
  /** Logging level */
  logLevel?: LogLevel;
  /** Custom logger instance */
  logger?: Logger;
}

/**
 * Executes input guardrails with enhanced performance monitoring and error handling
 * @param guardrails - Array of input guardrails to execute
 * @param params - Parameters for guardrail execution
 * @param options - Execution options
 * @returns Promise resolving to array of guardrail results
 */
export async function executeInputGuardrails<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  guardrails: InputGuardrail<M>[],
  params: InputGuardrailContext,
  options: ExecuteOptions = {},
): Promise<GuardrailResult<M>[]> {
  const {
    parallel = true,
    timeout = 30_000, // 30 seconds
    continueOnFailure = true,
    logLevel = 'warn',
    logger = console,
  } = options;

  const enabledGuardrails = prepareGuardrails(guardrails);
  const invokeWithTimeout = makeInvokeWithTimeout<M, InputGuardrail<M>>(
    (guardrail, signal) =>
      Promise.resolve(
        guardrail.execute(toNormalizedGuardrailContext(params), { signal }),
      ),
    timeout,
  );

  if (!parallel) {
    return executeSequential(enabledGuardrails, invokeWithTimeout, {
      continueOnFailure,
      logLevel,
      logger,
      label: 'Input',
    });
  }

  // Parallel: shared-timeout batch, with the enhanced runtime tried first.
  const runFallback = () =>
    executeBatchInputGuardrails<M>(
      enabledGuardrails,
      toNormalizedGuardrailContext(params),
      timeout,
      logLevel,
      logger,
    );

  if (USE_ENHANCED_RUNTIME) {
    try {
      return await executeInputGuardrailsWithEnhancedRuntime<M>(
        enabledGuardrails,
        toNormalizedGuardrailContext(params),
        { parallel: true, timeout, continueOnFailure },
      );
    } catch {
      // Fallback to standard batch execution if enhanced runtime fails
      return runFallback();
    }
  }
  return runFallback();
}

/**
 * Executes output guardrails with enhanced performance monitoring and error handling
 * @param guardrails - Array of output guardrails to execute
 * @param params - Parameters for guardrail execution
 * @param options - Execution options
 * @returns Promise resolving to array of guardrail results
 */
export async function executeOutputGuardrails<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  guardrails: OutputGuardrail<M>[],
  params: OutputGuardrailContext,
  options: ExecuteOptions & {
    /** Accumulated text for streaming scenarios */
    accumulatedText?: string;
  } = {},
): Promise<GuardrailResult<M>[]> {
  const {
    parallel = true,
    timeout = 30_000, // 30 seconds
    continueOnFailure = true,
    logLevel = 'warn',
    logger = console,
    accumulatedText,
  } = options;

  const enabledGuardrails = prepareGuardrails(guardrails);
  const invokeWithTimeout = makeInvokeWithTimeout<M, OutputGuardrail<M>>(
    (guardrail, signal) =>
      Promise.resolve(guardrail.execute(params, accumulatedText, { signal })),
    timeout,
  );

  if (!parallel) {
    return executeSequential(enabledGuardrails, invokeWithTimeout, {
      continueOnFailure,
      logLevel,
      logger,
      label: 'Output',
    });
  }

  // Parallel: each guardrail gets its own timeout, with the enhanced runtime tried first.
  const runFallback = () =>
    executeParallelPerGuardrail(
      enabledGuardrails,
      invokeWithTimeout,
      'Output',
      logLevel,
      logger,
    );

  if (USE_ENHANCED_RUNTIME) {
    try {
      return await executeOutputGuardrailsWithEnhancedRuntime<M>(
        enabledGuardrails,
        params,
        { parallel: true, timeout, continueOnFailure, accumulatedText },
      );
    } catch {
      // Fallback to standard parallel execution if enhanced runtime fails
      return runFallback();
    }
  }
  return runFallback();
}
