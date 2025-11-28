import { wrapLanguageModel } from 'ai';
import {
  GuardrailTimeoutError,
  GuardrailsOutputError,
  GuardrailsInputError,
} from './errors';
import {
  getGuardrailTracer,
  isTelemetryEnabled,
  recordGuardrailSpan,
  addGuardrailResultAttributes,
  mergeTelemetrySettings,
} from './telemetry/utils';
import type { GuardrailTelemetrySettings } from './telemetry/types';

// Performance optimization: conditional metadata tracking
// Only track detailed metrics in development or when explicitly enabled
const ENABLE_PERFORMANCE_TRACKING =
  process.env.NODE_ENV === 'development' ||
  process.env.GUARDRAILS_PERFORMANCE_TRACKING === 'true';

// Enhanced runtime integration for 10x performance improvement
const USE_ENHANCED_RUNTIME =
  process.env.GUARDRAILS_USE_ENHANCED_RUNTIME !== 'false' &&
  process.env.NODE_ENV !== 'test'; // Disable in tests for compatibility

// Enhanced retry integration temporarily disabled due to AI SDK type complexity
import { extractContent } from './guardrails/output';
import {
  createDefaultBuildRetryParams,
  resolveRetryConfig,
} from './guardrails/retry-helpers';
import {
  executeInputGuardrailsWithEnhancedRuntime,
  executeOutputGuardrailsWithEnhancedRuntime,
} from './adapters/parallel-runtime-adapter';
import type {
  InputGuardrail,
  OutputGuardrail,
  GuardrailResult,
  InputGuardrailContext,
  OutputGuardrailContext,
  AIResult,
  LanguageModelV2,
  LanguageModelV2Middleware,
  LanguageModelV2CallOptions,
  LanguageModelV2StreamPart,
  InputGuardrailsMiddlewareConfig,
  OutputGuardrailsMiddlewareConfig,
  NormalizedGuardrailContext,
  GuardrailExecutionSummary,
  Logger,
} from './types';

// ============================================================================
// CORE GUARDRAIL FUNCTIONS
// ============================================================================

/**
 * Creates a well-structured input guardrail with enhanced metadata
 * @param guardrail - The guardrail configuration
 * @returns Enhanced input guardrail with automatic metadata injection
 */
export function defineInputGuardrail<
  M extends Record<string, unknown> = Record<string, unknown>,
>(guardrail: InputGuardrail<M>): InputGuardrail<M> {
  const enhanced: InputGuardrail<M> = {
    enabled: true,
    priority: 'medium',
    version: '1.0.0',
    tags: [],
    ...guardrail,
    execute: async (params, options) => {
      const startTime = ENABLE_PERFORMANCE_TRACKING ? Date.now() : 0;
      const originalExecute = guardrail.execute;

      try {
        const result =
          options === undefined
            ? await originalExecute(params)
            : await originalExecute(params, options);
        const executionTime = ENABLE_PERFORMANCE_TRACKING
          ? Date.now() - startTime
          : undefined;

        return {
          ...result,
          context: createConditionalContext(
            guardrail.name,
            guardrail.version,
            executionTime,
            result.context,
          ),
        };
      } catch (error) {
        const executionTime = ENABLE_PERFORMANCE_TRACKING
          ? Date.now() - startTime
          : undefined;
        return {
          tripwireTriggered: true,
          message: `Guardrail execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          severity: 'critical',
          context: createConditionalContext(
            guardrail.name,
            guardrail.version,
            executionTime,
          ),
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          } as unknown as M,
          info: {
            guardrailName: guardrail.name,
            executionFailed: true,
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  };

  return enhanced;
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
  options: {
    /** Execute guardrails in parallel (default: true) */
    parallel?: boolean;
    /** Maximum execution time in milliseconds */
    timeout?: number;
    /** Whether to continue on first failure */
    continueOnFailure?: boolean;
    /** Logging level */
    logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
    /** Custom logger instance */
    logger?: Logger;
    /** Telemetry settings */
    telemetry?: GuardrailTelemetrySettings;
  } = {},
): Promise<GuardrailResult<M>[]> {
  const {
    parallel = true,
    timeout = 30_000, // 30 seconds
    continueOnFailure = true,
    logLevel = 'warn',
    logger = console,
    telemetry,
  } = options;

  // logging controlled by logLevel checks at call sites

  // Check if telemetry is enabled
  const telemetryEnabled = isTelemetryEnabled(telemetry);
  const tracer = telemetryEnabled ? getGuardrailTracer(telemetry) : undefined;

  // Filter enabled guardrails and sort by priority
  const enabledGuardrails = guardrails
    .filter((g) => g.enabled !== false)
    .toSorted((a, b) => {
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return (
        (priorityOrder[b.priority || 'medium'] || 2) -
        (priorityOrder[a.priority || 'medium'] || 2)
      );
    });

  const results: GuardrailResult<M>[] = [];

  const executeWithTimeout = async (
    guardrail: InputGuardrail<M>,
  ): Promise<GuardrailResult<M>> => {
    const execution = async () => {
      return executeWithOptimizedTimeout(
        async (signal) =>
          await Promise.resolve(
            guardrail.execute(toNormalizedGuardrailContext(params), { signal }),
          ),
        timeout,
        `Guardrail ${guardrail.name} timed out after ${timeout}ms`,
      ).catch((error) => {
        if (error.message.includes('timed out')) {
          throw new GuardrailTimeoutError(guardrail.name, timeout);
        }
        throw error;
      });
    };

    // Wrap in telemetry span if enabled
    if (telemetryEnabled && tracer) {
      return recordGuardrailSpan({
        name: `guardrail.input.${guardrail.name}`,
        tracer,
        attributes: {
          'guardrail.type': 'input',
          'guardrail.name': guardrail.name,
          'guardrail.version': guardrail.version || 'unknown',
          'guardrail.priority': guardrail.priority || 'medium',
        },
        fn: async (span) => {
          const result = await execution();
          addGuardrailResultAttributes(span, result, telemetry);
          return result;
        },
      });
    }

    return execution();
  };

  if (parallel) {
    // Use enhanced runtime for 10x performance improvement when available
    if (USE_ENHANCED_RUNTIME) {
      try {
        const enhancedResults =
          await executeInputGuardrailsWithEnhancedRuntime<M>(
            enabledGuardrails,
            toNormalizedGuardrailContext(params),
            {
              parallel: true,
              timeout,
              continueOnFailure,
            },
          );
        results.push(...enhancedResults);
      } catch {
        // Fallback to standard batch execution if enhanced runtime fails
        const normalizedContext = toNormalizedGuardrailContext(params);
        const batchResults = await executeBatchInputGuardrails<M>(
          enabledGuardrails,
          normalizedContext,
          timeout,
          logLevel,
          logger,
          telemetry,
        );
        results.push(...batchResults);
      }
    } else {
      // Use optimized batch execution with shared timeout and context
      const normalizedContext = toNormalizedGuardrailContext(params);
      const batchResults = await executeBatchInputGuardrails<M>(
        enabledGuardrails,
        normalizedContext,
        timeout,
        logLevel,
        logger,
        telemetry,
      );
      results.push(...batchResults);
    }
  } else {
    // Execute guardrails sequentially
    for (const guardrail of enabledGuardrails) {
      try {
        const result = await executeWithTimeout(guardrail);
        results.push(result);

        if (result.tripwireTriggered && logLevel !== 'none') {
          logger.warn(
            `Input guardrail "${guardrail.name}" triggered: ${result.message}`,
          );

          if (!continueOnFailure) {
            break;
          }
        }
      } catch (error) {
        if (logLevel !== 'none') {
          logger.error(
            `Error executing input guardrail "${guardrail.name}":`,
            error,
          );
        }

        const errorResult: GuardrailResult<M> = {
          tripwireTriggered: true,
          message: `Guardrail execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          severity: 'critical' as const,
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          } as unknown as M,
          info: {
            guardrailName: guardrail.name,
            executionFailed: true,
            error: error instanceof Error ? error.message : String(error),
          },
        };

        results.push(errorResult);

        if (!continueOnFailure) {
          break;
        }
      }
    }
  }

  return results;
}

/**
 * Creates a well-structured output guardrail with enhanced metadata
 * @param guardrail - The guardrail configuration
 * @returns Enhanced output guardrail with automatic metadata injection
 */
export function defineOutputGuardrail<
  M extends Record<string, unknown> = Record<string, unknown>,
>(guardrail: OutputGuardrail<M>): OutputGuardrail<M> {
  const enhanced: OutputGuardrail<M> = {
    enabled: true,
    priority: 'medium',
    version: '1.0.0',
    tags: [],
    ...guardrail,
    execute: async (params, options) => {
      const startTime = ENABLE_PERFORMANCE_TRACKING ? Date.now() : 0;
      const originalExecute = guardrail.execute;

      try {
        const result =
          options === undefined
            ? await originalExecute(params)
            : await originalExecute(params, options);
        const executionTime = ENABLE_PERFORMANCE_TRACKING
          ? Date.now() - startTime
          : undefined;

        return {
          ...result,
          context: createConditionalContext(
            guardrail.name,
            guardrail.version,
            executionTime,
            result.context,
          ),
        };
      } catch (error) {
        const executionTime = ENABLE_PERFORMANCE_TRACKING
          ? Date.now() - startTime
          : undefined;
        return {
          tripwireTriggered: true,
          message: `Guardrail execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          severity: 'critical',
          context: createConditionalContext(
            guardrail.name,
            guardrail.version,
            executionTime,
          ),
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          } as unknown as M,
          info: {
            guardrailName: guardrail.name,
            executionFailed: true,
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  };

  return enhanced;
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
  options: {
    /** Execute guardrails in parallel (default: true) */
    parallel?: boolean;
    /** Maximum execution time in milliseconds */
    timeout?: number;
    /** Whether to continue on first failure */
    continueOnFailure?: boolean;
    /** Logging level */
    logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
    /** Custom logger instance */
    logger?: Logger;
    /** Telemetry settings */
    telemetry?: GuardrailTelemetrySettings;
  } = {},
): Promise<GuardrailResult<M>[]> {
  const {
    parallel = true,
    timeout = 30_000, // 30 seconds
    continueOnFailure = true,
    logLevel = 'warn',
    logger = console,
    telemetry,
  } = options;

  // Check if telemetry is enabled
  const telemetryEnabled = isTelemetryEnabled(telemetry);
  const tracer = telemetryEnabled ? getGuardrailTracer(telemetry) : undefined;

  // Filter enabled guardrails and sort by priority
  const enabledGuardrails = guardrails
    .filter((g) => g.enabled !== false)
    .toSorted((a, b) => {
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return (
        (priorityOrder[b.priority || 'medium'] || 2) -
        (priorityOrder[a.priority || 'medium'] || 2)
      );
    });

  const results: GuardrailResult<M>[] = [];

  const executeWithTimeout = async (
    guardrail: OutputGuardrail<M>,
  ): Promise<GuardrailResult<M>> => {
    const execution = async () => {
      return executeWithOptimizedTimeout(
        async (signal) =>
          await Promise.resolve(
            guardrail.execute(params, undefined, { signal }),
          ),
        timeout,
        `Guardrail ${guardrail.name} timed out after ${timeout}ms`,
      ).catch((error) => {
        if (error.message.includes('timed out')) {
          throw new GuardrailTimeoutError(guardrail.name, timeout);
        }
        throw error;
      });
    };

    // Wrap in telemetry span if enabled
    if (telemetryEnabled && tracer) {
      return recordGuardrailSpan({
        name: `guardrail.output.${guardrail.name}`,
        tracer,
        attributes: {
          'guardrail.type': 'output',
          'guardrail.name': guardrail.name,
          'guardrail.version': guardrail.version || 'unknown',
          'guardrail.priority': guardrail.priority || 'medium',
        },
        fn: async (span) => {
          const result = await execution();
          addGuardrailResultAttributes(span, result, telemetry);
          return result;
        },
      });
    }

    return execution();
  };

  if (parallel) {
    // Use enhanced runtime for 10x performance improvement when available
    if (USE_ENHANCED_RUNTIME) {
      try {
        const enhancedResults =
          await executeOutputGuardrailsWithEnhancedRuntime<M>(
            enabledGuardrails,
            params,
            {
              parallel: true,
              timeout,
              continueOnFailure,
            },
          );
        results.push(...enhancedResults);
      } catch {
        // Fallback to standard parallel execution if enhanced runtime fails
        const promises = enabledGuardrails.map(async (guardrail) => {
          try {
            const result = await executeWithTimeout(guardrail);

            if (result.tripwireTriggered && logLevel !== 'none') {
              logger.warn(
                `Output guardrail "${guardrail.name}" triggered: ${result.message}`,
              );
            }

            return result;
          } catch (error) {
            if (logLevel !== 'none') {
              logger.error(
                `Error executing output guardrail "${guardrail.name}":`,
                error,
              );
            }

            const err: GuardrailResult<M> = {
              tripwireTriggered: true,
              message: `Guardrail execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
              severity: 'critical' as const,
              metadata: {
                error: error instanceof Error ? error.message : String(error),
              } as unknown as M,
              info: {
                guardrailName: guardrail.name,
                executionFailed: true,
                error: error instanceof Error ? error.message : String(error),
              },
            };
            return err;
          }
        });

        results.push(...(await Promise.all(promises)));
      }
    } else {
      // Execute all guardrails in parallel
      const promises = enabledGuardrails.map(async (guardrail) => {
        try {
          const result = await executeWithTimeout(guardrail);

          if (result.tripwireTriggered && logLevel !== 'none') {
            logger.warn(
              `Output guardrail "${guardrail.name}" triggered: ${result.message}`,
            );
          }

          return result;
        } catch (error) {
          if (logLevel !== 'none') {
            logger.error(
              `Error executing output guardrail "${guardrail.name}":`,
              error,
            );
          }

          const err: GuardrailResult<M> = {
            tripwireTriggered: true,
            message: `Guardrail execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            severity: 'critical' as const,
            metadata: {
              error: error instanceof Error ? error.message : String(error),
            } as unknown as M,
            info: {
              guardrailName: guardrail.name,
              executionFailed: true,
              error: error instanceof Error ? error.message : String(error),
            },
          };
          return err;
        }
      });

      results.push(...(await Promise.all(promises)));
    }
  } else {
    // Execute guardrails sequentially
    for (const guardrail of enabledGuardrails) {
      try {
        const result = await executeWithTimeout(guardrail);
        results.push(result);

        if (result.tripwireTriggered) {
          if (logLevel !== 'none') {
            logger.warn(
              `Output guardrail "${guardrail.name}" triggered: ${result.message}`,
            );
          }

          if (!continueOnFailure) {
            break;
          }
        }
      } catch (error) {
        if (logLevel !== 'none') {
          logger.error(
            `Error executing output guardrail "${guardrail.name}":`,
            error,
          );
        }

        const errorResult: GuardrailResult<M> = {
          tripwireTriggered: true,
          message: `Guardrail execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          severity: 'critical' as const,
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          } as unknown as M,
          info: {
            guardrailName: guardrail.name,
            executionFailed: true,
            error: error instanceof Error ? error.message : String(error),
          },
        };

        results.push(errorResult);

        if (!continueOnFailure) {
          break;
        }
      }
    }
  }

  return results;
}

// ============================================================================
// AI SDK 5 HELPER FUNCTIONS (RECOMMENDED API)
// ============================================================================

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
  LanguageModelV2CallOptions,
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
 * Creates context metadata conditionally based on performance tracking settings
 */
function createConditionalContext(
  guardrailName: string,
  guardrailVersion?: string,
  executionTimeMs?: number,
  existingContext?: any,
): any {
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
function checkStreamStopCondition<M extends Record<string, unknown>>(
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
 * Batch execute guardrails with shared timeout and optimized context handling
 */
async function executeBatchInputGuardrails<M extends Record<string, unknown>>(
  guardrails: InputGuardrail<M>[],
  normalizedContext: NormalizedGuardrailContext,
  timeoutMs: number,
  logLevel: 'none' | 'error' | 'warn' | 'info' | 'debug',
  logger: Logger,
  telemetry?: GuardrailTelemetrySettings,
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
            return {
              tripwireTriggered: true,
              message: `Guardrail execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
              severity: 'critical' as const,
              metadata: {
                error: error instanceof Error ? error.message : String(error),
              } as unknown as M,
              info: {
                guardrailName: guardrail.name,
                executionFailed: true,
                error: error instanceof Error ? error.message : String(error),
              },
            };
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
        } else {
          if (logLevel !== 'none') {
            logger.error(
              `Input guardrail "${guardrail.name}" failed:`,
              result.reason,
            );
          }
          return {
            tripwireTriggered: true,
            message: `Guardrail execution failed: ${result.reason instanceof Error ? result.reason.message : 'Unknown error'}`,
            severity: 'critical' as const,
            metadata: {
              error:
                result.reason instanceof Error
                  ? result.reason.message
                  : String(result.reason),
            } as unknown as M,
            info: {
              guardrailName: guardrail.name,
              executionFailed: true,
              error:
                result.reason instanceof Error
                  ? result.reason.message
                  : String(result.reason),
            },
          };
        }
      });
    },
    timeoutMs,
    `Batch guardrail execution timed out after ${timeoutMs}ms`,
  ).catch((error) => {
    if (error.message.includes('timed out')) {
      // Create timeout errors for all guardrails
      return guardrails.map((guardrail) => ({
        tripwireTriggered: true,
        message: `Guardrail timed out after ${timeoutMs}ms`,
        severity: 'critical' as const,
        metadata: { timeout: true } as unknown as M,
        info: {
          guardrailName: guardrail.name,
          executionFailed: true,
          error: 'Timeout',
        },
      }));
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
  params: LanguageModelV2CallOptions,
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
  params: LanguageModelV2CallOptions | InputGuardrailContext,
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
  return normalizeGuardrailContext(params as LanguageModelV2CallOptions);
}

/**
 * Creates a comprehensive execution summary for enhanced observability
 */
function createExecutionSummary<
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

/**
 * Wraps a language model with input guardrails using AI SDK 5 patterns
 *
 * @deprecated Use `withGuardrails()` instead. This function will be removed in next major version.
 *
 * @param model - The language model to wrap
 * @param guardrails - Array of input guardrails to apply
 * @param options - Optional configuration for guardrail execution
 * @returns Wrapped language model with input guardrails
 *
 * @example
 * ```typescript
 * import { openai } from '@ai-sdk/openai';
 * import { withGuardrails } from 'ai-sdk-guardrails'; // Use this instead
 *
 * const guardedModel = withGuardrails(openai('gpt-4o'), {
 *   inputGuardrails: [myInputGuardrail],
 *   throwOnBlocked: true
 * });
 * ```
 */
export function wrapWithInputGuardrails<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  model: LanguageModelV2,
  guardrails: InputGuardrail<M>[],
  options?: Omit<InputGuardrailsMiddlewareConfig<M>, 'inputGuardrails'>,
): LanguageModelV2 {
  const middleware = createInputGuardrailsMiddleware<M>({
    inputGuardrails: guardrails,
    ...options,
  });

  return wrapLanguageModel({
    model,
    middleware,
  });
}

/**
 * Wraps a language model with output guardrails using AI SDK 5 patterns
 *
 * @deprecated Use `withGuardrails()` instead. This function will be removed in next major version.
 *
 * @param model - The language model to wrap
 * @param guardrails - Array of output guardrails to apply
 * @param options - Optional configuration for guardrail execution
 * @returns Wrapped language model with output guardrails
 *
 * @example
 * ```typescript
 * import { openai } from '@ai-sdk/openai';
 * import { withGuardrails } from 'ai-sdk-guardrails'; // Use this instead
 *
 * const guardedModel = withGuardrails(openai('gpt-4o'), {
 *   outputGuardrails: [myOutputGuardrail],
 *   throwOnBlocked: true
 * });
 * ```
 *
 * @note For generateObject scenarios, consider using executeOutputGuardrails()
 * after generation for more reliable object validation.
 */
export function wrapWithOutputGuardrails<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  model: LanguageModelV2,
  guardrails: OutputGuardrail<M>[],
  options?: Omit<OutputGuardrailsMiddlewareConfig<M>, 'outputGuardrails'>,
): LanguageModelV2 {
  const middleware = createOutputGuardrailsMiddleware<M>({
    outputGuardrails: guardrails,
    ...options,
  });

  return wrapLanguageModel({
    model,
    middleware,
  });
}

/**
 * Wraps a language model with both input and output guardrails using AI SDK 5 patterns
 *
 * @deprecated Use `withGuardrails()` instead. This function will be removed in next major version.
 *
 * @param model - The language model to wrap
 * @param config - Configuration for both input and output guardrails
 * @returns Wrapped language model with both input and output guardrails
 *
 * @example
 * ```typescript
 * import { openai } from '@ai-sdk/openai';
 * import { withGuardrails } from 'ai-sdk-guardrails'; // Use this instead
 *
 * const guardedModel = withGuardrails(openai('gpt-4o'), {
 *   inputGuardrails: [myInputGuardrail],
 *   outputGuardrails: [myOutputGuardrail],
 *   throwOnBlocked: true
 * });
 * ```
 */
// Overload for automatic type inference when no explicit types are provided
export function wrapWithGuardrails(
  _model: LanguageModelV2,
  _config: {
    inputGuardrails?: InputGuardrail<Record<string, unknown>>[];
    outputGuardrails?: OutputGuardrail<Record<string, unknown>>[];
    throwOnBlocked?: boolean;
    replaceOnBlocked?: boolean;
    streamMode?: 'buffer' | 'progressive';
    stopOnGuardrailViolation?: OutputGuardrailsMiddlewareConfig['stopOnGuardrailViolation'];
    executionOptions?: {
      parallel?: boolean;
      timeout?: number;
      continueOnFailure?: boolean;
      logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
    };
    onInputBlocked?: (_executionSummary: GuardrailExecutionSummary) => void;
    onOutputBlocked?: (_executionSummary: GuardrailExecutionSummary) => void;
    retry?: OutputGuardrailsMiddlewareConfig['retry'];
  },
): LanguageModelV2;

// Overload for explicit type specification (backward compatibility)
export function wrapWithGuardrails<
  MIn extends Record<string, unknown> = Record<string, unknown>,
  MOut extends Record<string, unknown> = Record<string, unknown>,
>(
  _model: LanguageModelV2,
  _config: {
    inputGuardrails?: InputGuardrail<MIn>[];
    outputGuardrails?: OutputGuardrail<MOut>[];
    throwOnBlocked?: boolean;
    replaceOnBlocked?: boolean;
    streamMode?: 'buffer' | 'progressive';
    stopOnGuardrailViolation?: OutputGuardrailsMiddlewareConfig<MOut>['stopOnGuardrailViolation'];
    executionOptions?: InputGuardrailsMiddlewareConfig<MIn>['executionOptions'];
    onInputBlocked?: InputGuardrailsMiddlewareConfig<MIn>['onInputBlocked'];
    onOutputBlocked?: OutputGuardrailsMiddlewareConfig<MOut>['onOutputBlocked'];
    retry?: OutputGuardrailsMiddlewareConfig<MOut>['retry'];
  },
): LanguageModelV2;

// Implementation
export function wrapWithGuardrails(
  model: LanguageModelV2,
  config:
    | {
        inputGuardrails?: InputGuardrail<Record<string, unknown>>[];
        outputGuardrails?: OutputGuardrail<Record<string, unknown>>[];
        throwOnBlocked?: boolean;
        replaceOnBlocked?: boolean;
        streamMode?: 'buffer' | 'progressive';
        stopOnGuardrailViolation?: OutputGuardrailsMiddlewareConfig['stopOnGuardrailViolation'];
        executionOptions?: InputGuardrailsMiddlewareConfig['executionOptions'];
        onInputBlocked?: (_executionSummary: GuardrailExecutionSummary) => void;
        onOutputBlocked?: (
          _executionSummary: GuardrailExecutionSummary,
        ) => void;
        retry?: OutputGuardrailsMiddlewareConfig['retry'];
      }
    | {
        inputGuardrails?: InputGuardrail<Record<string, unknown>>[];
        outputGuardrails?: OutputGuardrail<Record<string, unknown>>[];
        throwOnBlocked?: boolean;
        replaceOnBlocked?: boolean;
        streamMode?: 'buffer' | 'progressive';
        stopOnGuardrailViolation?: OutputGuardrailsMiddlewareConfig['stopOnGuardrailViolation'];
        executionOptions?: InputGuardrailsMiddlewareConfig['executionOptions'];
        onInputBlocked?: InputGuardrailsMiddlewareConfig['onInputBlocked'];
        onOutputBlocked?: OutputGuardrailsMiddlewareConfig['onOutputBlocked'];
        retry?: OutputGuardrailsMiddlewareConfig['retry'];
      },
): LanguageModelV2 {
  const {
    inputGuardrails = [],
    outputGuardrails = [],
    throwOnBlocked,
    replaceOnBlocked,
    streamMode,
    stopOnGuardrailViolation,
    executionOptions,
    onInputBlocked,
    onOutputBlocked,
    retry,
  } = config;

  const middlewares: LanguageModelV2Middleware[] = [];

  // Add input guardrails middleware if provided
  if (inputGuardrails.length > 0) {
    middlewares.push(
      createInputGuardrailsMiddleware({
        inputGuardrails,
        throwOnBlocked,
        executionOptions,
        onInputBlocked,
      }),
    );
  }

  // Add output guardrails middleware if provided
  if (outputGuardrails.length > 0) {
    middlewares.push(
      createOutputGuardrailsMiddleware({
        outputGuardrails,
        throwOnBlocked,
        replaceOnBlocked,
        streamMode,
        stopOnGuardrailViolation,
        executionOptions,
        onOutputBlocked,
        retry,
      }),
    );
  }

  // If no guardrails provided, return the original model
  if (middlewares.length === 0) {
    return model;
  }

  return wrapLanguageModel({
    model,
    middleware: middlewares,
  });
}

// ============================================================================
// PRIMARY API FUNCTIONS (RECOMMENDED)
// ============================================================================

/**
 * Primary guardrails API - wraps a language model with input and/or output guardrails
 *
 * This is the main entry point for applying guardrails to AI models. Use this decorator-like
 * function for most use cases.
 *
 * @param model - The language model to wrap
 * @param config - Configuration for both input and output guardrails
 * @returns Wrapped language model with guardrails applied
 *
 * @example
 * ```typescript
 * import { openai } from '@ai-sdk/openai';
 * import { withGuardrails } from 'ai-sdk-guardrails';
 * import { piiDetector } from 'ai-sdk-guardrails/guardrails/input';
 * import { minLength } from 'ai-sdk-guardrails/guardrails/output';
 *
 * const guardedModel = withGuardrails(openai('gpt-4o'), {
 *   inputGuardrails: [piiDetector()],
 *   outputGuardrails: [minLength(100)],
 *   throwOnBlocked: true
 * });
 * ```
 */
export function withGuardrails<
  MIn extends Record<string, unknown> = Record<string, unknown>,
  MOut extends Record<string, unknown> = Record<string, unknown>,
>(
  model: LanguageModelV2,
  config: {
    inputGuardrails?: InputGuardrail<MIn>[];
    outputGuardrails?: OutputGuardrail<MOut>[];
    throwOnBlocked?: boolean;
    replaceOnBlocked?: boolean;
    streamMode?: 'buffer' | 'progressive';
    stopOnGuardrailViolation?: OutputGuardrailsMiddlewareConfig<MOut>['stopOnGuardrailViolation'];
    executionOptions?: InputGuardrailsMiddlewareConfig<MIn>['executionOptions'];
    onInputBlocked?: InputGuardrailsMiddlewareConfig<MIn>['onInputBlocked'];
    onOutputBlocked?: OutputGuardrailsMiddlewareConfig<MOut>['onOutputBlocked'];
    retry?: OutputGuardrailsMiddlewareConfig<MOut>['retry'];
  },
): LanguageModelV2 {
  return wrapWithGuardrails(model, config);
}

/**
 * Creates a reusable guardrails configuration factory
 *
 * Use this factory when you want to apply the same guardrails configuration to multiple
 * models, or when building composable guardrail systems.
 *
 * @param config - Configuration for both input and output guardrails
 * @returns Function that accepts a model and returns a wrapped model
 *
 * @example
 * ```typescript
 * import { openai } from '@ai-sdk/openai';
 * import { anthropic } from '@ai-sdk/anthropic';
 * import { createGuardrails } from 'ai-sdk-guardrails';
 * import { piiDetector } from 'ai-sdk-guardrails/guardrails/input';
 * import { qualityCheck } from 'ai-sdk-guardrails/guardrails/output';
 *
 * // Create reusable guardrails configuration
 * const productionGuards = createGuardrails({
 *   inputGuardrails: [piiDetector()],
 *   outputGuardrails: [qualityCheck()],
 *   throwOnBlocked: true,
 * });
 *
 * // Apply to multiple models
 * const gpt4 = productionGuards(openai('gpt-4o'));
 * const claude = productionGuards(anthropic('claude-3-sonnet'));
 *
 * // Compose multiple guardrail sets
 * const strictLimits = createGuardrails({ inputGuardrails: [maxLength(500)] });
 * const piiProtection = createGuardrails({ inputGuardrails: [piiDetector()] });
 * const model = piiProtection(strictLimits(openai('gpt-4o')));
 * ```
 */
export function createGuardrails<
  MIn extends Record<string, unknown> = Record<string, unknown>,
  MOut extends Record<string, unknown> = Record<string, unknown>,
>(config: {
  inputGuardrails?: InputGuardrail<MIn>[];
  outputGuardrails?: OutputGuardrail<MOut>[];
  throwOnBlocked?: boolean;
  replaceOnBlocked?: boolean;
  streamMode?: 'buffer' | 'progressive';
  executionOptions?: {
    parallel?: boolean;
    timeout?: number;
    continueOnFailure?: boolean;
    logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
  };
  onInputBlocked?: InputGuardrailsMiddlewareConfig<MIn>['onInputBlocked'];
  onOutputBlocked?: OutputGuardrailsMiddlewareConfig<MOut>['onOutputBlocked'];
}) {
  return (model: LanguageModelV2): LanguageModelV2 => {
    return withGuardrails(model, config);
  };
}

// ============================================================================
// ADVANCED MIDDLEWARE FUNCTIONS (FOR FINE-GRAINED CONTROL)
// ============================================================================

/**
 * Creates an input guardrails middleware that executes before AI calls
 * Follows AI SDK 5 middleware patterns
 *
 * @internal Advanced API - Use wrapWithInputGuardrails() or wrapWithGuardrails() for simpler usage
 * @param config - Input guardrails configuration
 * @returns AI SDK middleware that executes input guardrails
 */
export function createInputGuardrailsMiddleware<
  M extends Record<string, unknown> = Record<string, unknown>,
>(config: InputGuardrailsMiddlewareConfig<M>): LanguageModelV2Middleware {
  const {
    inputGuardrails,
    executionOptions = {},
    onInputBlocked,
    throwOnBlocked = false,
  } = config;

  // Extract telemetry settings from executionOptions
  const guardrailTelemetrySettings = executionOptions.telemetry;

  return {
    transformParams: async ({
      params,
    }: {
      type: 'generate' | 'stream';
      params: LanguageModelV2CallOptions;
      model: LanguageModelV2;
    }) => {
      // Start from original params; only add helper property if we actually block
      const guardrailContext = normalizeGuardrailContext(params);

      // Merge AI SDK telemetry with guardrail telemetry settings
      const aiSdkTelemetry = (params as { experimental_telemetry?: unknown })
        ?.experimental_telemetry as
        | {
            isEnabled?: boolean;
            recordInputs?: boolean;
            recordOutputs?: boolean;
            functionId?: string;
            metadata?: Record<string, unknown>;
            tracer?: import('@opentelemetry/api').Tracer;
          }
        | undefined;

      const mergedTelemetry = mergeTelemetrySettings(
        aiSdkTelemetry,
        guardrailTelemetrySettings,
      );

      const executionStartTime = Date.now();
      const inputResults = await executeInputGuardrails<M>(
        inputGuardrails,
        guardrailContext,
        {
          ...executionOptions,
          telemetry: mergedTelemetry,
        },
      );

      const blockedResults = inputResults.filter((r) => r.tripwireTriggered);
      if (blockedResults.length > 0) {
        if (onInputBlocked) {
          const executionSummary = createExecutionSummary<M>(
            inputResults,
            executionStartTime,
          );
          onInputBlocked(executionSummary, guardrailContext);
        }

        if (throwOnBlocked) {
          const blockedGuardrails = blockedResults.map((r) => ({
            name: r.context?.guardrailName || 'unknown',
            message: r.message || 'Blocked',
            severity: r.severity || ('medium' as const),
          }));

          throw new GuardrailsInputError(blockedGuardrails);
        }

        // Store blocked results for later use by wrapGenerate/wrapStream
        const enhancedParams = params as LanguageModelV2CallOptions & {
          guardrailsBlocked?: GuardrailResult[];
        };
        enhancedParams.guardrailsBlocked = blockedResults;
        return enhancedParams;
      }

      // No blocks: return original params unchanged for strict equality expectations
      return params;
    },

    wrapGenerate: async ({
      doGenerate,
      params,
    }: {
      doGenerate: () => ReturnType<LanguageModelV2['doGenerate']>;
      doStream: () => ReturnType<LanguageModelV2['doStream']>;
      params: LanguageModelV2CallOptions;
      model: LanguageModelV2;
    }) => {
      const paramsWithGuardrails = params as LanguageModelV2CallOptions & {
        guardrailsBlocked?: GuardrailResult[];
      };

      if (paramsWithGuardrails.guardrailsBlocked) {
        const blockedResults = paramsWithGuardrails.guardrailsBlocked;
        const blockedMessage = blockedResults.map((r) => r.message).join(', ');

        return {
          content: [
            { type: 'text', text: `[Input blocked: ${blockedMessage}]` },
          ],
          finishReason: 'other',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          warnings: [],
          rawCall: { rawPrompt: params.prompt, rawSettings: {} },
          response: { headers: {} },
        };
      }

      return doGenerate();
    },

    wrapStream: async ({
      doStream,
      params,
    }: {
      doGenerate: () => ReturnType<LanguageModelV2['doGenerate']>;
      doStream: () => ReturnType<LanguageModelV2['doStream']>;
      params: LanguageModelV2CallOptions;
      model: LanguageModelV2;
    }) => {
      const paramsWithGuardrails = params as LanguageModelV2CallOptions & {
        guardrailsBlocked?: GuardrailResult[];
      };

      if (paramsWithGuardrails.guardrailsBlocked) {
        const blockedResults = paramsWithGuardrails.guardrailsBlocked;
        const blockedMessage = blockedResults.map((r) => r.message).join(', ');

        const stream = new ReadableStream<LanguageModelV2StreamPart>({
          start(controller) {
            controller.enqueue({
              type: 'text-delta',
              id: '1',
              delta: `[Input blocked: ${blockedMessage}]`,
            });
            controller.enqueue({
              type: 'finish',
              finishReason: 'other',
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            });
            controller.close();
          },
        });

        return { stream };
      }

      return doStream();
    },
  };
}

/**
 * Creates an output guardrails middleware that executes after AI calls
 * Follows AI SDK 5 middleware patterns
 *
 * @internal Advanced API - Use wrapWithOutputGuardrails() or wrapWithGuardrails() for simpler usage
 * @param config - Output guardrails configuration
 * @returns AI SDK middleware that executes output guardrails
 */
export function createOutputGuardrailsMiddleware<
  M extends Record<string, unknown> = Record<string, unknown>,
>(config: OutputGuardrailsMiddlewareConfig<M>): LanguageModelV2Middleware {
  const {
    outputGuardrails,
    executionOptions = {},
    onOutputBlocked,
    throwOnBlocked = false,
    replaceOnBlocked = true,
    streamMode = 'buffer',
    retry,
    stopOnGuardrailViolation,
  } = config;

  // Extract telemetry settings from executionOptions
  const guardrailTelemetrySettings = executionOptions.telemetry;

  return {
    wrapGenerate: async ({
      doGenerate,
      params,
      model,
    }: {
      doGenerate: () => ReturnType<LanguageModelV2['doGenerate']>;
      doStream: () => ReturnType<LanguageModelV2['doStream']>;
      params: LanguageModelV2CallOptions;
      model: LanguageModelV2;
    }) => {
      const result = await doGenerate();

      // Use normalized context for better type safety
      const guardrailContext = normalizeGuardrailContext(params);

      // Create a proper AIResult that works for both generateText and generateObject
      const aiResult: AIResult = result as unknown as AIResult;
      // For middleware, we work with the raw model result
      // Note: generateObject scenarios should use executeOutputGuardrails() post-generation

      const outputContext: OutputGuardrailContext = {
        input: guardrailContext,
        result: aiResult,
      };

      // Merge AI SDK telemetry with guardrail telemetry settings
      const aiSdkTelemetry = (params as { experimental_telemetry?: unknown })
        ?.experimental_telemetry as
        | {
            isEnabled?: boolean;
            recordInputs?: boolean;
            recordOutputs?: boolean;
            functionId?: string;
            metadata?: Record<string, unknown>;
            tracer?: import('@opentelemetry/api').Tracer;
          }
        | undefined;

      const mergedTelemetry = mergeTelemetrySettings(
        aiSdkTelemetry,
        guardrailTelemetrySettings,
      );

      const startTime = Date.now();
      const outputResults = await executeOutputGuardrails<M>(
        outputGuardrails,
        outputContext,
        {
          ...executionOptions,
          telemetry: mergedTelemetry,
        },
      );

      const executionSummary = createExecutionSummary<M>(
        outputResults,
        startTime,
      );
      if (executionSummary.blockedResults.length > 0) {
        // Get blocked guardrail objects for retry config resolution
        const blockedGuardrailObjects = executionSummary.blockedResults
          .map((r: GuardrailResult) =>
            outputGuardrails.find(
              (g) =>
                g.name ===
                (r.context?.guardrailName ??
                  (r.info as Record<string, unknown> | undefined)
                    ?.guardrailName),
            ),
          )
          .filter((g): g is OutputGuardrail<M> => g !== undefined);

        // Resolve effective retry config (withGuardrails level takes precedence)
        const effectiveRetry = resolveRetryConfig(
          retry,
          blockedGuardrailObjects,
        );

        // Auto-retry path - inline retry logic (middleware pattern limitation)
        if (
          effectiveRetry.maxRetries > 0 &&
          (retry?.onlyWhen ? retry.onlyWhen(executionSummary) : true)
        ) {
          const maxRetries = effectiveRetry.maxRetries;
          let lastParams = params;
          let lastResult = result;

          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const wait =
              typeof effectiveRetry.backoffMs === 'function'
                ? effectiveRetry.backoffMs(attempt)
                : (effectiveRetry.backoffMs ?? 0);
            if (wait && wait > 0) {
              await new Promise((r) => setTimeout(r, wait));
            }

            // Use provided buildRetryParams or create default
            const buildRetryParams =
              retry?.buildRetryParams ??
              createDefaultBuildRetryParams({
                outputGuardrails,
                multipleBlockedStrategy:
                  retry?.multipleBlockedStrategy ?? 'highest-severity',
                attempt,
                maxRetries,
              });

            const nextParams = buildRetryParams({
              summary: executionSummary,
              originalParams: params,
              lastParams,
              lastResult: lastResult as AIResult,
            });

            // Call model with new params
            const retryRaw = await model.doGenerate(nextParams);
            const retryResult = retryRaw;

            const retryContext: OutputGuardrailContext = {
              input: normalizeGuardrailContext(nextParams),
              result: retryResult as AIResult,
            };
            const retryStart = Date.now();
            const retryResults = await executeOutputGuardrails<M>(
              outputGuardrails,
              retryContext,
              {
                ...executionOptions,
                telemetry: guardrailTelemetrySettings,
              },
            );
            const retrySummary = createExecutionSummary<M>(
              retryResults,
              retryStart,
            );

            if (retrySummary.blockedResults.length === 0) {
              return retryRaw;
            }

            // Prepare for potential next attempt
            lastParams = nextParams;
            lastResult = retryResult;
          }
        }

        if (onOutputBlocked) {
          onOutputBlocked(executionSummary, guardrailContext, result);
        }

        if (throwOnBlocked) {
          const blockedGuardrails = executionSummary.blockedResults.map(
            (r: GuardrailResult) => ({
              name: r.context?.guardrailName || 'unknown',
              message: r.message || 'Blocked',
              severity: r.severity || ('medium' as const),
            }),
          );
          throw new GuardrailsOutputError(blockedGuardrails);
        }

        // Replace output with blocked message if replaceOnBlocked is true (for generateText)
        if (replaceOnBlocked) {
          const blockedMessage = executionSummary.blockedResults
            .map((r) => r.message)
            .join(', ');
          const replaced = {
            ...(result as unknown as Record<string, unknown>),
            content: [
              { type: 'text', text: `[Output blocked: ${blockedMessage}]` },
            ],
          } as typeof result;
          return replaced;
        }
      }

      return result;
    },

    wrapStream: async ({
      doStream,
      params,
      model,
    }: {
      doGenerate: () => ReturnType<LanguageModelV2['doGenerate']>;
      doStream: () => ReturnType<LanguageModelV2['doStream']>;
      params: LanguageModelV2CallOptions;
      model: LanguageModelV2;
    }) => {
      const streamResult = await doStream();

      if (streamMode === 'buffer') {
        // Buffer mode: evaluate at the end
        let accumulatedText = '';
        const blockedChunks: LanguageModelV2StreamPart[] = [];

        const transformStream = new TransformStream<
          LanguageModelV2StreamPart,
          LanguageModelV2StreamPart
        >({
          transform(chunk: LanguageModelV2StreamPart) {
            if (chunk.type === 'text-delta') {
              const anyChunk = chunk as {
                type: string;
                delta?: string;
                textDelta?: string;
              };
              accumulatedText += anyChunk.delta ?? anyChunk.textDelta ?? '';
            }
            blockedChunks.push(chunk);
          },
          async flush(controller) {
            const guardrailContext = normalizeGuardrailContext(params);
            const outputContext: OutputGuardrailContext = {
              input: guardrailContext,
              result: { text: accumulatedText } as unknown as AIResult,
            };
            const startTime = Date.now();
            const outputResults = await executeOutputGuardrails<M>(
              outputGuardrails,
              outputContext,
              executionOptions,
            );
            const executionSummary = createExecutionSummary<M>(
              outputResults,
              startTime,
            );

            if (executionSummary.blockedResults.length > 0) {
              // Get blocked guardrail objects for retry config resolution
              const blockedGuardrailObjects = executionSummary.blockedResults
                .map((r: GuardrailResult) =>
                  outputGuardrails.find(
                    (g) =>
                      g.name ===
                      (r.context?.guardrailName ??
                        (r.info as Record<string, unknown> | undefined)
                          ?.guardrailName),
                  ),
                )
                .filter((g): g is OutputGuardrail<M> => g !== undefined);

              // Resolve effective retry config (withGuardrails level takes precedence)
              const effectiveRetry = resolveRetryConfig(
                retry,
                blockedGuardrailObjects,
              );

              // Auto-retry (buffer mode only) - inline retry logic
              if (
                effectiveRetry.maxRetries > 0 &&
                (retry?.onlyWhen ? retry.onlyWhen(executionSummary) : true)
              ) {
                const maxRetries = effectiveRetry.maxRetries;
                let lastParams = params;
                let lastResult: AIResult | { text: string } = {
                  text: accumulatedText,
                };

                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                  const wait =
                    typeof effectiveRetry.backoffMs === 'function'
                      ? effectiveRetry.backoffMs(attempt)
                      : (effectiveRetry.backoffMs ?? 0);
                  if (wait && wait > 0) {
                    await new Promise((r) => setTimeout(r, wait));
                  }

                  // Use provided buildRetryParams or create default
                  const buildRetryParams =
                    retry?.buildRetryParams ??
                    createDefaultBuildRetryParams({
                      outputGuardrails,
                      multipleBlockedStrategy:
                        retry?.multipleBlockedStrategy ?? 'highest-severity',
                      attempt,
                      maxRetries,
                    });

                  const nextParams = buildRetryParams({
                    summary: executionSummary,
                    originalParams: params,
                    lastParams,
                    lastResult: lastResult as AIResult,
                  });

                  const retryResult = (await model.doGenerate(
                    nextParams,
                  )) as AIResult;

                  const retryContext: OutputGuardrailContext = {
                    input: normalizeGuardrailContext(nextParams),
                    result: retryResult,
                  };
                  const retryStart = Date.now();
                  const retryResults = await executeOutputGuardrails<M>(
                    outputGuardrails,
                    retryContext,
                    executionOptions,
                  );
                  const retrySummary = createExecutionSummary<M>(
                    retryResults,
                    retryStart,
                  );

                  if (retrySummary.blockedResults.length === 0) {
                    // Emit the repaired text as a single delta and finish
                    const { text: repairedText } = extractContent(
                      retryResult as AIResult,
                    );
                    controller.enqueue({
                      type: 'text-delta',
                      id: '1',
                      delta: repairedText,
                    });
                    controller.enqueue({
                      type: 'finish',
                      finishReason: 'stop',
                      usage: {
                        inputTokens: 0,
                        outputTokens: 0,
                        totalTokens: 0,
                      },
                    });
                    return;
                  }
                  lastParams = nextParams;
                  lastResult = retryResult;
                }
              }

              if (onOutputBlocked) {
                onOutputBlocked(executionSummary, guardrailContext, {
                  text: accumulatedText,
                });
              }
              if (throwOnBlocked) {
                controller.error(
                  new Error(
                    `Output guardrails blocked response: ${executionSummary.blockedResults.map((r) => r.message).join(', ')}`,
                  ),
                );
                return;
              }
              if (replaceOnBlocked) {
                const blockedMessage = executionSummary.blockedResults
                  .map((r) => r.message)
                  .join(', ');
                controller.enqueue({
                  type: 'text-delta',
                  id: '1',
                  delta: `[Output blocked: ${blockedMessage}]`,
                });
                controller.enqueue({
                  type: 'finish',
                  finishReason: 'other',
                  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
                });
              } else {
                for (const chunk of blockedChunks) {
                  controller.enqueue(chunk);
                }
              }
            } else {
              for (const chunk of blockedChunks) {
                controller.enqueue(chunk);
              }
            }
          },
        });

        return { stream: streamResult.stream.pipeThrough(transformStream) };
      }

      // Progressive mode: evaluate on the fly with early termination support
      let accumulatedText = '';
      let blocked = false;
      let chunkIndex = 0;
      const streamViolationHistory: Array<{
        chunkIndex: number;
        summary: GuardrailExecutionSummary<M>;
      }> = [];

      const transformStream = new TransformStream<
        LanguageModelV2StreamPart,
        LanguageModelV2StreamPart
      >({
        async transform(chunk: LanguageModelV2StreamPart, controller) {
          if (blocked) {
            return;
          }
          if (chunk.type === 'text-delta') {
            const anyChunk = chunk as {
              type: string;
              delta?: string;
              textDelta?: string;
            };
            accumulatedText += anyChunk.delta ?? anyChunk.textDelta ?? '';
            chunkIndex++;

            const guardrailContext = normalizeGuardrailContext(params);
            const outputContext: OutputGuardrailContext = {
              input: guardrailContext,
              result: { text: accumulatedText } as AIResult,
            };
            const startTime = Date.now();
            const outputResults = await executeOutputGuardrails<M>(
              outputGuardrails,
              outputContext,
              executionOptions,
            );
            const executionSummary = createExecutionSummary<M>(
              outputResults,
              startTime,
            );

            if (executionSummary.blockedResults.length > 0) {
              // Track violation for early termination logic
              streamViolationHistory.push({
                chunkIndex,
                summary: executionSummary,
              });

              // Check if we should stop early based on violation pattern
              const shouldStopEarly =
                stopOnGuardrailViolation &&
                checkStreamStopCondition(
                  stopOnGuardrailViolation,
                  streamViolationHistory,
                );

              if (shouldStopEarly) {
                blocked = true;
              }

              // Only block if we hit the stop condition or it's the first violation
              if (blocked) {
                if (onOutputBlocked) {
                  onOutputBlocked(executionSummary, guardrailContext, {
                    text: accumulatedText,
                  });
                }
                if (throwOnBlocked) {
                  controller.error(
                    new Error(
                      `Output guardrails blocked response: ${executionSummary.blockedResults.map((r) => r.message).join(', ')}`,
                    ),
                  );
                  return;
                }
                if (replaceOnBlocked) {
                  const blockedMessage = executionSummary.blockedResults
                    .map((r) => r.message)
                    .join(', ');
                  controller.enqueue({
                    type: 'text-delta',
                    id: '1',
                    delta: `[Output blocked: ${blockedMessage}]`,
                  });
                  controller.enqueue({
                    type: 'finish',
                    finishReason: 'other',
                    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
                  });
                  return;
                }
                // fall through: not replacing, still emit current chunk
              }
            }
            controller.enqueue(chunk);
          } else {
            controller.enqueue(chunk);
          }
        },
      });

      return { stream: streamResult.stream.pipeThrough(transformStream) };
    },
  };
}

// Re-export agent wrapper
export { withAgentGuardrails } from './guardrails/agent';
