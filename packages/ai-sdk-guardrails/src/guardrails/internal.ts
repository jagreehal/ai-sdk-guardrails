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

import type {
  LanguageModelV4Message,
  LanguageModelV4ToolResultOutput,
} from '@ai-sdk/provider';
import { z } from 'zod';
import { traceGuardrails } from './otel';
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

import type { GuardrailMetadata } from '../enhanced-types';

/** Detailed timing metadata is tracked only in development or when explicitly enabled. */
export const ENABLE_PERFORMANCE_TRACKING =
  process.env.NODE_ENV === 'development' ||
  process.env.GUARDRAILS_PERFORMANCE_TRACKING === 'true';

const USE_ENHANCED_RUNTIME =
  process.env.GUARDRAILS_USE_ENHANCED_RUNTIME !== 'false' &&
  process.env.NODE_ENV !== 'test';

/** Metadata type of a result whose guardrail declares none. */
type DefaultMetadata = NonNullable<GuardrailResult['metadata']>;

type LogLevel = 'none' | 'error' | 'warn' | 'info' | 'debug';

type PromptPart = Exclude<
  LanguageModelV4Message,
  { role: 'system' }
>['content'][number];

const stringOrEmpty = z.string().catch('');

/** Text of a tool result, so input guardrails can scan what tools fed the model. */
function toolOutputText(output: LanguageModelV4ToolResultOutput): string {
  switch (output.type) {
    case 'text':
    case 'error-text': {
      return stringOrEmpty.parse(output.value);
    }

    case 'json':
    case 'error-json': {
      return JSON.stringify(output.value ?? null);
    }

    case 'content': {
      return Array.isArray(output.value)
        ? output.value
            .map((p) => (p.type === 'text' ? (p.text ?? '') : ''))
            .join('')
        : '';
    }

    default: {
      return '';
    }
  }
}

function extractTextFromContent(content: readonly PromptPart[]): string {
  return content
    .flatMap((part) => {
      const text =
        part.type === 'text'
          ? (part.text ?? '')
          : part.type === 'tool-result' && part.output
            ? toolOutputText(part.output)
            : '';

      return text ? [text] : [];
    })
    .join('\n');
}

const normalizedContextCache = new WeakMap<
  LanguageModelV4CallOptions,
  NormalizedGuardrailContext
>();

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

/** Builds the canonical "guardrail failed" result used at every catch site. */
export function guardrailErrorResult<M extends GuardrailMetadata>(
  guardrailName: string,
  cause: unknown,
  extra?: {
    message?: string;
    metadata?: M;
    infoError?: string;
    context?: GuardrailResult<M>['context'];
  },
): GuardrailResult<M> {
  const errMsg = cause instanceof Error ? cause.message : String(cause);
  const failureMetadata: DefaultMetadata = { error: errMsg };

  const result: GuardrailResult<M> = {
    tripwireTriggered: true,
    message: extra?.message ?? `Guardrail execution failed: ${errMsg}`,
    severity: 'critical',
    // SAFETY: M describes a guardrail's success metadata. Failure results always
    // carry `{ error }` instead, and consumers detect them via `info.executionFailed`.
    metadata: extra?.metadata ?? (failureMetadata as M),
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

/** Builds result context; timing fields are included only when performance tracking is on. */
export function createConditionalContext(
  guardrailName: string,
  guardrailVersion?: string,
  executionTimeMs?: number,
  existingContext?: GuardrailResult['context'],
): NonNullable<GuardrailResult['context']> {
  if (!ENABLE_PERFORMANCE_TRACKING) {
    return {
      guardrailName,
      ...existingContext,
    };
  }

  return {
    guardrailName,
    guardrailVersion,
    executedAt: new Date(),
    executionTimeMs,
    ...existingContext,
  };
}

/**
 * Decides whether streaming should stop. `true` stops after two violations or
 * any critical one, a number stops after that many, a function decides itself.
 */
export function checkStreamStopCondition<M extends GuardrailMetadata>(
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
  if (stopConfig === true) {
    const criticalViolations = violations.filter((v) =>
      v.summary.blockedResults.some(
        (r) => (r.severity ?? 'medium') === 'critical',
      ),
    );

    return violations.length >= 2 || criticalViolations.length > 0;
  }

  if (stopConfig === false) {
    return false;
  }

  if (stopConfig instanceof Function) {
    return stopConfig(violations);
  }

  return violations.length >= stopConfig;
}

/** Runs `execution` with a pooled AbortController that aborts after `timeoutMs`. */
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
  M extends GuardrailMetadata,
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
  M extends GuardrailMetadata,
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
  M extends GuardrailMetadata,
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
async function executeBatchInputGuardrails<M extends GuardrailMetadata>(
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
            return await guardrail.execute(normalizedContext, { signal });
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
      const timeoutMetadata: DefaultMetadata = { timeout: true };

      return guardrails.map((guardrail) =>
        guardrailErrorResult<M>(guardrail.name, error, {
          message: `Guardrail timed out after ${timeoutMs}ms`,
          // SAFETY: timeout results replace the guardrail's own metadata with
          // `{ timeout: true }`; consumers detect them via `info.executionFailed`.
          metadata: timeoutMetadata as M,
          infoError: 'Timeout',
        }),
      );
    }

    throw error;
  });
}

/**
 * Normalizes AI SDK call options into a guardrail context. Results are cached
 * per params object.
 */
export function normalizeGuardrailContext(
  params: LanguageModelV4CallOptions,
): NormalizedGuardrailContext {
  const cached = normalizedContextCache.get(params);

  if (cached) {
    return cached;
  }

  const promptMessages = Array.isArray(params.prompt) ? params.prompt : [];
  const systemMessage = promptMessages.find((msg) => msg.role === 'system');

  // In the LanguageModel prompt format a system message carries a plain
  // string; only user/assistant/tool messages carry part arrays.
  const systemContent = systemMessage?.content;

  const system = Array.isArray(systemContent)
    ? extractTextFromContent(systemContent)
    : stringOrEmpty.parse(systemContent);

  const messages = promptMessages
    .filter((msg) => msg.role !== 'system')
    .map((msg) => ({
      role: msg.role,
      content: Array.isArray(msg.content)
        ? extractTextFromContent(msg.content)
        : '',
    }));

  // Tool results stay in `messages` (role `tool`) but not in `prompt`, so
  // rails that read `prompt` judge what the user and assistant said.
  const conversation = messages.filter((m) => m.role !== 'tool');

  const prompt =
    conversation.length === 1 && conversation[0]?.role === 'user'
      ? conversation[0].content
      : conversation.map((m) => m.content).join(' ');

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

  normalizedContextCache.set(params, normalized);

  return normalized;
}

const normalizedContextSchema = z.object({
  prompt: z.string(),
  messages: z.array(z.unknown()),
});

function isNormalizedContext(
  params: LanguageModelV4CallOptions | InputGuardrailContext,
): params is NormalizedGuardrailContext {
  return normalizedContextSchema.safeParse(params).success;
}

/**
 * Converts either raw AI SDK params or an already-normalized context
 * into a NormalizedGuardrailContext for guardrail execution.
 */
export function toNormalizedGuardrailContext(
  params: LanguageModelV4CallOptions | InputGuardrailContext,
): NormalizedGuardrailContext {
  if (isNormalizedContext(params)) {
    return params;
  }

  // SAFETY: normalizeGuardrailContext only reads `prompt` (falling back to no
  // messages when it is not a message array) and optional sampling settings,
  // which every remaining member of the union either carries or omits.
  return normalizeGuardrailContext(params as LanguageModelV4CallOptions);
}

/** Summarizes a batch of guardrail results: blocked results, timings and pass/block counts. */
export function createExecutionSummary<
  M extends GuardrailMetadata = DefaultMetadata,
>(
  results: GuardrailResult<M>[],
  startTime: number,
): GuardrailExecutionSummary<M> {
  const endTime = Date.now();
  const totalExecutionTime = endTime - startTime;
  const blockedResults = results.filter((r) => r.tripwireTriggered);

  const execTimes = results.flatMap((r) => r.context?.executionTimeMs ?? []);

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
  M extends GuardrailMetadata = DefaultMetadata,
>(
  guardrails: InputGuardrail<M>[],
  params: InputGuardrailContext,
  options: ExecuteOptions = {},
): Promise<GuardrailResult<M>[]> {
  const {
    parallel = true,
    timeout = 30_000,
    continueOnFailure = true,
    logLevel = 'warn',
    logger = console,
  } = options;

  const enabledGuardrails = prepareGuardrails(guardrails);

  if (enabledGuardrails.length === 0) return [];

  return traceGuardrails('input', enabledGuardrails.length, async () => {
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
        return runFallback();
      }
    }

    return runFallback();
  });
}

/**
 * Executes output guardrails with enhanced performance monitoring and error handling
 * @param guardrails - Array of output guardrails to execute
 * @param params - Parameters for guardrail execution
 * @param options - Execution options
 * @returns Promise resolving to array of guardrail results
 */
export async function executeOutputGuardrails<
  M extends GuardrailMetadata = DefaultMetadata,
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
    timeout = 30_000,
    continueOnFailure = true,
    logLevel = 'warn',
    logger = console,
    accumulatedText,
  } = options;

  const enabledGuardrails = prepareGuardrails(guardrails);

  if (enabledGuardrails.length === 0) return [];

  return traceGuardrails('output', enabledGuardrails.length, async () => {
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
        return runFallback();
      }
    }

    return runFallback();
  });
}

/**
 * Callable check that works across realms (vm contexts, iframes, workers),
 * where `instanceof Function` is false for real functions.
 */
export function isCallable<T>(
  value: T,
): value is Extract<T, (...args: never[]) => void> {
  return Object.prototype.toString.call(value).endsWith('Function]');
}

/** Object check that works across realms, unlike `instanceof Object`. */
export function isObjectLike(value: unknown): value is object {
  return value !== null && Object(value) === value;
}
