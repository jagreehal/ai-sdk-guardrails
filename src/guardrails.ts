import { wrapLanguageModel } from 'ai';
import {
  GuardrailTimeoutError,
  OutputBlockedError,
  InputBlockedError,
} from './errors';
// Enhanced retry integration temporarily disabled due to AI SDK type complexity
import { extractContent } from './guardrails/output';
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
      const startTime = Date.now();
      const originalExecute = guardrail.execute;

      try {
        const result =
          options === undefined
            ? await originalExecute(params)
            : await originalExecute(params, options);
        const executionTime = Date.now() - startTime;

        return {
          ...result,
          context: {
            guardrailName: guardrail.name,
            guardrailVersion: guardrail.version,
            executedAt: new Date(),
            executionTimeMs: executionTime,
            ...result.context,
          },
        };
      } catch (error) {
        const executionTime = Date.now() - startTime;
        return {
          tripwireTriggered: true,
          message: `Guardrail execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          severity: 'critical',
          context: {
            guardrailName: guardrail.name,
            guardrailVersion: guardrail.version,
            executedAt: new Date(),
            executionTimeMs: executionTime,
          },
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          } as unknown as M,
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
  } = {},
): Promise<GuardrailResult<M>[]> {
  const {
    parallel = true,
    timeout = 30_000, // 30 seconds
    continueOnFailure = true,
    logLevel = 'warn',
    logger = console,
  } = options;

  // logging controlled by logLevel checks at call sites

  // Filter enabled guardrails and sort by priority
  const enabledGuardrails = guardrails
    .filter((g) => g.enabled !== false)
    .sort((a, b) => {
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
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise: Promise<never> = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new GuardrailTimeoutError(guardrail.name, timeout));
      }, timeout);
    });

    const executionPromise = guardrail.execute(
      toNormalizedGuardrailContext(params),
      {
        signal: controller.signal,
      },
    );

    return Promise.race([executionPromise, timeoutPromise]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
  };

  if (parallel) {
    // Execute all guardrails in parallel
    const promises = enabledGuardrails.map(async (guardrail) => {
      try {
        const result = await executeWithTimeout(guardrail);

        if (result.tripwireTriggered && logLevel !== 'none') {
          logger.warn(
            `Input guardrail "${guardrail.name}" triggered: ${result.message}`,
          );
        }

        return result;
      } catch (error) {
        if (logLevel !== 'none') {
          logger.error(
            `Error executing input guardrail "${guardrail.name}":`,
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
        };
        return err;
      }
    });

    results.push(...(await Promise.all(promises)));
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
      const startTime = Date.now();
      const originalExecute = guardrail.execute;

      try {
        const result =
          options === undefined
            ? await originalExecute(params)
            : await originalExecute(params, options);
        const executionTime = Date.now() - startTime;

        return {
          ...result,
          context: {
            guardrailName: guardrail.name,
            guardrailVersion: guardrail.version,
            executedAt: new Date(),
            executionTimeMs: executionTime,
            ...result.context,
          },
        };
      } catch (error) {
        const executionTime = Date.now() - startTime;
        return {
          tripwireTriggered: true,
          message: `Guardrail execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          severity: 'critical',
          context: {
            guardrailName: guardrail.name,
            guardrailVersion: guardrail.version,
            executedAt: new Date(),
            executionTimeMs: executionTime,
          },
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          } as unknown as M,
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
  } = {},
): Promise<GuardrailResult<M>[]> {
  const {
    parallel = true,
    timeout = 30_000, // 30 seconds
    continueOnFailure = true,
    logLevel = 'warn',
    logger = console,
  } = options;

  // Filter enabled guardrails and sort by priority
  const enabledGuardrails = guardrails
    .filter((g) => g.enabled !== false)
    .sort((a, b) => {
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
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise: Promise<never> = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new GuardrailTimeoutError(guardrail.name, timeout));
      }, timeout);
    });

    const executionPromise = guardrail.execute(params, undefined, {
      signal: controller.signal,
    });

    return Promise.race([executionPromise, timeoutPromise]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
  };

  if (parallel) {
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
        };
        return err;
      }
    });

    results.push(...(await Promise.all(promises)));
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

/**
 * Normalizes AI SDK parameters into a consistent guardrail context
 * This improves type safety and reduces coupling to specific AI SDK parameter types
 */
export function normalizeGuardrailContext(
  params: LanguageModelV2CallOptions,
): NormalizedGuardrailContext {
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

  return {
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
 * @param model - The language model to wrap
 * @param guardrails - Array of input guardrails to apply
 * @param options - Optional configuration for guardrail execution
 * @returns Wrapped language model with input guardrails
 *
 * @example
 * ```typescript
 * import { openai } from '@ai-sdk/openai';
 * import { wrapWithInputGuardrails } from 'ai-sdk-guardrails';
 *
 * const guardedModel = wrapWithInputGuardrails(
 *   openai('gpt-4o'),
 *   [myInputGuardrail],
 *   { throwOnBlocked: true }
 * );
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
 * @param model - The language model to wrap
 * @param guardrails - Array of output guardrails to apply
 * @param options - Optional configuration for guardrail execution
 * @returns Wrapped language model with output guardrails
 *
 * @example
 * ```typescript
 * import { openai } from '@ai-sdk/openai';
 * import { wrapWithOutputGuardrails } from 'ai-sdk-guardrails';
 *
 * const guardedModel = wrapWithOutputGuardrails(
 *   openai('gpt-4o'),
 *   [myOutputGuardrail],
 *   { throwOnBlocked: true }
 * );
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
 * @param model - The language model to wrap
 * @param config - Configuration for both input and output guardrails
 * @returns Wrapped language model with both input and output guardrails
 *
 * @example
 * ```typescript
 * import { openai } from '@ai-sdk/openai';
 * import { wrapWithGuardrails } from 'ai-sdk-guardrails';
 *
 * const guardedModel = wrapWithGuardrails(openai('gpt-4o'), {
 *   inputGuardrails: [myInputGuardrail],
 *   outputGuardrails: [myOutputGuardrail],
 *   throwOnBlocked: true
 * });
 * ```
 */
// Overload for automatic type inference when no explicit types are provided
export function wrapWithGuardrails(
  model: LanguageModelV2,
  config: {
    inputGuardrails?: InputGuardrail<Record<string, unknown>>[];
    outputGuardrails?: OutputGuardrail<Record<string, unknown>>[];
    throwOnBlocked?: boolean;
    replaceOnBlocked?: boolean;
    streamMode?: 'buffer' | 'progressive';
    executionOptions?: {
      parallel?: boolean;
      timeout?: number;
      continueOnFailure?: boolean;
      logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
    };
    onInputBlocked?: (executionSummary: GuardrailExecutionSummary) => void;
    onOutputBlocked?: (executionSummary: GuardrailExecutionSummary) => void;
  },
): LanguageModelV2;

// Overload for explicit type specification (backward compatibility)
export function wrapWithGuardrails<
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
    executionOptions?: {
      parallel?: boolean;
      timeout?: number;
      continueOnFailure?: boolean;
      logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
    };
    onInputBlocked?: InputGuardrailsMiddlewareConfig<MIn>['onInputBlocked'];
    onOutputBlocked?: OutputGuardrailsMiddlewareConfig<MOut>['onOutputBlocked'];
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
        executionOptions?: {
          parallel?: boolean;
          timeout?: number;
          continueOnFailure?: boolean;
          logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
        };
        onInputBlocked?: (executionSummary: GuardrailExecutionSummary) => void;
        onOutputBlocked?: (executionSummary: GuardrailExecutionSummary) => void;
      }
    | {
        inputGuardrails?: InputGuardrail<Record<string, unknown>>[];
        outputGuardrails?: OutputGuardrail<Record<string, unknown>>[];
        throwOnBlocked?: boolean;
        replaceOnBlocked?: boolean;
        streamMode?: 'buffer' | 'progressive';
        executionOptions?: {
          parallel?: boolean;
          timeout?: number;
          continueOnFailure?: boolean;
          logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
        };
        onInputBlocked?: InputGuardrailsMiddlewareConfig['onInputBlocked'];
        onOutputBlocked?: OutputGuardrailsMiddlewareConfig['onOutputBlocked'];
      },
): LanguageModelV2 {
  const {
    inputGuardrails = [],
    outputGuardrails = [],
    throwOnBlocked,
    replaceOnBlocked,
    streamMode,
    executionOptions,
    onInputBlocked,
    onOutputBlocked,
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
        executionOptions,
        onOutputBlocked,
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

      const executionStartTime = Date.now();
      const inputResults = await executeInputGuardrails<M>(
        inputGuardrails,
        guardrailContext,
        executionOptions,
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

          throw new InputBlockedError(blockedGuardrails);
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
  } = config;

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
        // Auto-retry path - inline retry logic (middleware pattern limitation)
        if (
          retry &&
          (retry.onlyWhen ? retry.onlyWhen(executionSummary) : true)
        ) {
          const maxRetries = retry.maxRetries ?? 1;
          let lastParams = params;
          let lastResult = result;

          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const wait =
              typeof retry.backoffMs === 'function'
                ? retry.backoffMs(attempt)
                : (retry.backoffMs ?? 0);
            if (wait && wait > 0) {
              await new Promise((r) => setTimeout(r, wait));
            }

            const nextParams = retry.buildRetryParams({
              summary: executionSummary,
              originalParams: params,
              lastParams,
              lastResult: lastResult as any,
            });

            // Call model with new params
            const retryRaw = await model.doGenerate(nextParams);
            const retryResult = retryRaw;

            const retryContext: OutputGuardrailContext = {
              input: normalizeGuardrailContext(nextParams),
              result: retryResult as any,
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
          throw new OutputBlockedError(blockedGuardrails);
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
              // Auto-retry (buffer mode only) - inline retry logic
              if (
                retry &&
                (retry.onlyWhen ? retry.onlyWhen(executionSummary) : true)
              ) {
                const maxRetries = retry.maxRetries ?? 1;
                let lastParams = params;
                let lastResult: AIResult | { text: string } = {
                  text: accumulatedText,
                };

                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                  const wait =
                    typeof retry.backoffMs === 'function'
                      ? retry.backoffMs(attempt)
                      : (retry.backoffMs ?? 0);
                  if (wait && wait > 0) {
                    await new Promise((r) => setTimeout(r, wait));
                  }

                  const nextParams = retry.buildRetryParams({
                    summary: executionSummary,
                    originalParams: params,
                    lastParams,
                    lastResult: lastResult as any,
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
                      retryResult as any,
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
                for (const chunk of blockedChunks) controller.enqueue(chunk);
              }
            } else {
              for (const chunk of blockedChunks) controller.enqueue(chunk);
            }
          },
        });

        return { stream: streamResult.stream.pipeThrough(transformStream) };
      }

      // Progressive mode: evaluate on the fly
      let accumulatedText = '';
      let blocked = false;
      const transformStream = new TransformStream<
        LanguageModelV2StreamPart,
        LanguageModelV2StreamPart
      >({
        async transform(chunk: LanguageModelV2StreamPart, controller) {
          if (blocked) return;
          if (chunk.type === 'text-delta') {
            const anyChunk = chunk as {
              type: string;
              delta?: string;
              textDelta?: string;
            };
            accumulatedText += anyChunk.delta ?? anyChunk.textDelta ?? '';

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
              blocked = true;
              if (onOutputBlocked)
                onOutputBlocked(executionSummary, guardrailContext, {
                  text: accumulatedText,
                });
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
export { wrapAgentWithGuardrails } from './guardrails/agent';
