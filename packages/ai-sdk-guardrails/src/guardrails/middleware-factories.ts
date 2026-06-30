/**
 * AI SDK v7 (provider V4) middleware factories for guardrails.
 *
 * These adapt the `executeInput/OutputGuardrails` engine ({@link ./internal}) to
 * the `LanguageModelV4Middleware` lifecycle (`transformParams` / `wrapGenerate`
 * / `wrapStream`), including the buffer/progressive stream modes and the
 * auto-retry loop. They are the lower-level form behind {@link ../guardrails}'s
 * `withGuardrails`; prefer that for the common path.
 */

import type {
  LanguageModelV4FinishReason,
  LanguageModelV4Usage,
} from '@ai-sdk/provider';
import { GuardrailsOutputError, GuardrailsInputError } from '../errors';
import { extractContent } from './output';
import {
  createDefaultBuildRetryParams,
  resolveRetryConfig,
} from './retry-helpers';
import {
  checkStreamStopCondition,
  createExecutionSummary,
  executeInputGuardrails,
  executeOutputGuardrails,
  normalizeGuardrailContext,
} from './internal';
import {
  snapshotGenerateResultText,
  syncGenerateResultTextAfterGuardrails,
} from './generate-result-sync';
import type {
  OutputGuardrail,
  GuardrailResult,
  OutputGuardrailContext,
  AIResult,
  LanguageModelV4,
  LanguageModelV4Middleware,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamResult,
  LanguageModelV4StreamPart,
  InputGuardrailsMiddlewareConfig,
  OutputGuardrailsMiddlewareConfig,
  GuardrailExecutionSummary,
} from '../types';

// V4-compatible helpers for mock responses
const emptyV4Usage: LanguageModelV4Usage = {
  inputTokens: {
    total: 0,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 0,
    text: undefined,
    reasoning: undefined,
  },
};

const finishReasonStop: LanguageModelV4FinishReason = {
  unified: 'stop',
  raw: undefined,
};

const finishReasonOther: LanguageModelV4FinishReason = {
  unified: 'other',
  raw: undefined,
};

/**
 * Creates an input guardrails middleware that executes before AI calls
 * Follows AI SDK 5 middleware patterns
 *
 * @internal Advanced API - Use withGuardrails() for simpler usage
 * @param config - Input guardrails configuration
 * @returns AI SDK middleware that executes input guardrails
 */
export function inputGuardrailsMiddleware<
  M extends Record<string, unknown> = Record<string, unknown>,
>(config: InputGuardrailsMiddlewareConfig<M>): LanguageModelV4Middleware {
  const {
    inputGuardrails,
    context,
    executionOptions = {},
    onInputBlocked,
    throwOnBlocked = false,
  } = config;

  return {
    specificationVersion: 'v4' as const,
    transformParams: async ({
      params,
    }: {
      type: 'generate' | 'stream';
      params: LanguageModelV4CallOptions;
      model: LanguageModelV4;
    }) => {
      // Start from original params; only add helper property if we actually block
      const baseContext = normalizeGuardrailContext(params);

      // Create new context with request context to avoid mutating cached context
      const guardrailContext = context
        ? { ...baseContext, requestContext: context }
        : baseContext;

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

          throw new GuardrailsInputError(blockedGuardrails);
        }

        // Store blocked results for later use by wrapGenerate/wrapStream
        const enhancedParams = params as LanguageModelV4CallOptions & {
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
      doGenerate: () => PromiseLike<LanguageModelV4GenerateResult>;
      doStream: () => PromiseLike<LanguageModelV4StreamResult>;
      params: LanguageModelV4CallOptions;
      model: LanguageModelV4;
    }) => {
      const paramsWithGuardrails = params as LanguageModelV4CallOptions & {
        guardrailsBlocked?: GuardrailResult[];
      };

      if (paramsWithGuardrails.guardrailsBlocked) {
        const blockedResults = paramsWithGuardrails.guardrailsBlocked;
        const blockedMessage = blockedResults.map((r) => r.message).join(', ');
        const blockedText = `[Input blocked: ${blockedMessage}]`;

        return {
          text: blockedText,
          content: [{ type: 'text', text: blockedText }],
          finishReason: finishReasonOther,
          usage: emptyV4Usage,
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
      doGenerate: () => PromiseLike<LanguageModelV4GenerateResult>;
      doStream: () => PromiseLike<LanguageModelV4StreamResult>;
      params: LanguageModelV4CallOptions;
      model: LanguageModelV4;
    }) => {
      const paramsWithGuardrails = params as LanguageModelV4CallOptions & {
        guardrailsBlocked?: GuardrailResult[];
      };

      if (paramsWithGuardrails.guardrailsBlocked) {
        const blockedResults = paramsWithGuardrails.guardrailsBlocked;
        const blockedMessage = blockedResults.map((r) => r.message).join(', ');

        const stream = new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.enqueue({
              type: 'text-delta',
              id: '1',
              delta: `[Input blocked: ${blockedMessage}]`,
            });
            controller.enqueue({
              type: 'finish',
              finishReason: finishReasonOther,
              usage: emptyV4Usage,
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
 * @internal Advanced API - Use withGuardrails() for simpler usage
 * @param config - Output guardrails configuration
 * @returns AI SDK middleware that executes output guardrails
 */
export function outputGuardrailsMiddleware<
  M extends Record<string, unknown> = Record<string, unknown>,
>(config: OutputGuardrailsMiddlewareConfig<M>): LanguageModelV4Middleware {
  const {
    outputGuardrails,
    context,
    executionOptions = {},
    onOutputBlocked,
    throwOnBlocked = false,
    replaceOnBlocked = true,
    streamMode = 'buffer',
    retry,
    stopOnGuardrailViolation,
  } = config;

  return {
    specificationVersion: 'v4' as const,
    wrapGenerate: async ({
      doGenerate,
      params,
      model,
    }: {
      doGenerate: () => PromiseLike<LanguageModelV4GenerateResult>;
      doStream: () => PromiseLike<LanguageModelV4StreamResult>;
      params: LanguageModelV4CallOptions;
      model: LanguageModelV4;
    }) => {
      const result = await doGenerate();
      const resultTextBeforeGuardrails = snapshotGenerateResultText(result);

      // Use normalized context for better type safety
      const baseContext = normalizeGuardrailContext(params);

      // Create new context with request context to avoid mutating cached context
      const guardrailContext = context
        ? { ...baseContext, requestContext: context }
        : baseContext;

      // Create a proper AIResult that works for both generateText and generateText with Output.object()
      const aiResult: AIResult = result as unknown as AIResult;
      // For middleware, we work with the raw model result
      // Note: generateText with Output.object() scenarios should use executeOutputGuardrails() post-generation

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
              lastResult: lastResult as unknown as AIResult,
            });

            // Call model with new params
            const retryRaw = await model.doGenerate(nextParams);
            const retryTextBeforeGuardrails =
              snapshotGenerateResultText(retryRaw);
            const retryResult = retryRaw;

            const retryContext: OutputGuardrailContext = {
              input: normalizeGuardrailContext(nextParams),
              result: retryResult as unknown as AIResult,
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
              return syncGenerateResultTextAfterGuardrails(
                retryRaw,
                retryTextBeforeGuardrails,
              );
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
          const blockedText = `[Output blocked: ${blockedMessage}]`;
          const replaced = {
            ...(result as unknown as Record<string, unknown>),
            text: blockedText,
            content: [{ type: 'text' as const, text: blockedText }],
          } as unknown as typeof result;
          return replaced;
        }
      }

      return syncGenerateResultTextAfterGuardrails(
        result,
        resultTextBeforeGuardrails,
      );
    },

    wrapStream: async ({
      doStream,
      params,
      model,
    }: {
      doGenerate: () => PromiseLike<LanguageModelV4GenerateResult>;
      doStream: () => PromiseLike<LanguageModelV4StreamResult>;
      params: LanguageModelV4CallOptions;
      model: LanguageModelV4;
    }) => {
      const streamResult = await doStream();

      if (streamMode === 'buffer') {
        // Buffer mode: evaluate at the end
        let accumulatedText = '';
        let streamUsage: LanguageModelV4Usage | undefined;
        let streamFinishReason: LanguageModelV4FinishReason | undefined;
        const blockedChunks: LanguageModelV4StreamPart[] = [];

        const transformStream = new TransformStream<
          LanguageModelV4StreamPart,
          LanguageModelV4StreamPart
        >({
          transform(chunk: LanguageModelV4StreamPart) {
            if (chunk.type === 'text-delta') {
              const anyChunk = chunk as {
                type: string;
                delta?: string;
                textDelta?: string;
              };
              accumulatedText += anyChunk.delta ?? anyChunk.textDelta ?? '';
            }
            // Capture usage and finishReason from finish chunk
            if (chunk.type === 'finish') {
              streamUsage = chunk.usage;
              streamFinishReason = chunk.finishReason;
            }
            blockedChunks.push(chunk);
          },
          async flush(controller) {
            const baseContext = normalizeGuardrailContext(params);

            // Create new context with request context to avoid mutating cached context
            const guardrailContext = context
              ? { ...baseContext, requestContext: context }
              : baseContext;

            // Build result with usage data so guardrails like tokenUsageLimit work
            const streamedResult = {
              text: accumulatedText,
              content: [{ type: 'text', text: accumulatedText }],
              usage: streamUsage,
              finishReason: streamFinishReason,
            };
            const streamedTextBeforeGuardrails =
              snapshotGenerateResultText(streamedResult);

            const outputContext: OutputGuardrailContext = {
              input: guardrailContext,
              result: streamedResult as unknown as AIResult,
            };
            const startTime = Date.now();
            const outputResults = await executeOutputGuardrails<M>(
              outputGuardrails,
              outputContext,
              {
                ...executionOptions,
                accumulatedText,
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
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    nextParams as any,
                  )) as unknown as AIResult;

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
                      finishReason: finishReasonStop,
                      usage: emptyV4Usage,
                    });
                    return;
                  }
                  lastParams = nextParams;
                  lastResult = retryResult;
                }
              }

              if (onOutputBlocked) {
                onOutputBlocked(
                  executionSummary,
                  guardrailContext,
                  streamedResult,
                );
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
                  finishReason: finishReasonOther,
                  usage: emptyV4Usage,
                });
              } else {
                for (const chunk of blockedChunks) {
                  controller.enqueue(chunk);
                }
              }
            } else {
              syncGenerateResultTextAfterGuardrails(
                streamedResult,
                streamedTextBeforeGuardrails,
              );
              const finalText =
                typeof streamedResult.text === 'string'
                  ? streamedResult.text
                  : accumulatedText;

              if (finalText === accumulatedText) {
                for (const chunk of blockedChunks) {
                  controller.enqueue(chunk);
                }
              } else {
                controller.enqueue({
                  type: 'text-delta',
                  id: '1',
                  delta: finalText,
                });
                controller.enqueue({
                  type: 'finish',
                  finishReason: streamFinishReason ?? finishReasonStop,
                  usage: streamUsage ?? emptyV4Usage,
                });
              }
            }
          },
        });

        return {
          stream: streamResult.stream.pipeThrough(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            transformStream as any,
          ),
        };
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
        LanguageModelV4StreamPart,
        LanguageModelV4StreamPart
      >({
        async transform(chunk: LanguageModelV4StreamPart, controller) {
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

            const baseContext = normalizeGuardrailContext(params);

            // Create new context with request context to avoid mutating cached context
            const guardrailContext = context
              ? { ...baseContext, requestContext: context }
              : baseContext;

            const outputContext: OutputGuardrailContext = {
              input: guardrailContext,
              result: { text: accumulatedText } as AIResult,
            };
            const startTime = Date.now();
            const outputResults = await executeOutputGuardrails<M>(
              outputGuardrails,
              outputContext,
              {
                ...executionOptions,
                accumulatedText,
              },
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
                    finishReason: finishReasonOther,
                    usage: emptyV4Usage,
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

      return {
        stream: streamResult.stream.pipeThrough(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          transformStream as any,
        ),
      };
    },
  };
}
