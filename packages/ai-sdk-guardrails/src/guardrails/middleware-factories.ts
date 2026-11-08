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
import type { GuardrailMetadata } from '../enhanced-types';
import { GuardrailsOutputError, GuardrailsInputError } from '../errors';
import { extractContent } from './output';
import {
  createDefaultBuildRetryParams,
  resolveRetryConfig,
  retryDelayMs,
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
  StreamedOutputSnapshot,
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

// Usage and finish reasons for responses synthesized by the middleware.
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
 * Input results blocked in `transformParams`, keyed by the params object it
 * returns (the AI SDK passes that same object to `wrapGenerate`/`wrapStream`).
 */
const blockedInputs = new WeakMap<
  LanguageModelV4CallOptions,
  GuardrailResult[]
>();

/**
 * View a provider-level or streamed result as the `AIResult` that output
 * guardrails receive.
 */
export function asGuardrailResult(
  result: LanguageModelV4GenerateResult | { text: string },
): AIResult {
  // SAFETY: output guardrails read results structurally (extractContent and
  // optional text/content/usage/finishReason/toolCalls fields). In middleware
  // the value is the provider's V4 result or a streamed partial rather than
  // the generateText result that AIResult names.
  return result as AIResult;
}

/**
 * Creates an input guardrails middleware that executes before AI calls.
 *
 * @internal Advanced API - Use withGuardrails() for simpler usage
 * @param config - Input guardrails configuration
 * @returns AI SDK middleware that executes input guardrails
 */
export function inputGuardrailsMiddleware<
  M extends GuardrailMetadata = GuardrailMetadata,
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
      const baseContext = normalizeGuardrailContext(params);

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

        blockedInputs.set(params, blockedResults);

        return Object.assign(params, { guardrailsBlocked: blockedResults });
      }

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
      const blockedResults = blockedInputs.get(params);

      if (blockedResults) {
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
      const blockedResults = blockedInputs.get(params);

      if (blockedResults) {
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
 * Creates an output guardrails middleware that executes after AI calls.
 *
 * @internal Advanced API - Use withGuardrails() for simpler usage
 * @param config - Output guardrails configuration
 * @returns AI SDK middleware that executes output guardrails
 */
export function outputGuardrailsMiddleware<
  M extends GuardrailMetadata = GuardrailMetadata,
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

      const baseContext = normalizeGuardrailContext(params);

      const guardrailContext = context
        ? { ...baseContext, requestContext: context }
        : baseContext;

      const outputContext: OutputGuardrailContext = {
        input: guardrailContext,
        result: asGuardrailResult(result),
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
        const blockedGuardrailObjects = executionSummary.blockedResults
          .map((r: GuardrailResult) =>
            outputGuardrails.find(
              (g) =>
                g.name === (r.context?.guardrailName ?? r.info?.guardrailName),
            ),
          )
          .filter((g): g is OutputGuardrail<M> => g !== undefined);

        const effectiveRetry = resolveRetryConfig(
          retry,
          blockedGuardrailObjects,
        );

        if (
          effectiveRetry.maxRetries > 0 &&
          (retry?.onlyWhen ? retry.onlyWhen(executionSummary) : true)
        ) {
          const maxRetries = effectiveRetry.maxRetries;
          let lastParams = params;
          let lastResult = result;

          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const wait = retryDelayMs(effectiveRetry.backoffMs, attempt);

            if (wait && wait > 0) {
              await new Promise((r) => setTimeout(r, wait));
            }

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
              lastResult: asGuardrailResult(lastResult),
            });

            const retryRaw = await model.doGenerate(nextParams);

            const retryTextBeforeGuardrails =
              snapshotGenerateResultText(retryRaw);

            const retryContext: OutputGuardrailContext = {
              input: normalizeGuardrailContext(nextParams),
              result: asGuardrailResult(retryRaw),
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

            lastParams = nextParams;
            lastResult = retryRaw;
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

        if (replaceOnBlocked) {
          const blockedMessage = executionSummary.blockedResults
            .map((r) => r.message)
            .join(', ');

          const blockedText = `[Output blocked: ${blockedMessage}]`;

          return {
            ...result,
            text: blockedText,
            content: [{ type: 'text' as const, text: blockedText }],
          };
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
        // Buffer mode: evaluate once the stream has finished.
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
              accumulatedText += chunk.delta;
            } else if (chunk.type === 'finish') {
              streamUsage = chunk.usage;
              streamFinishReason = chunk.finishReason;
            }

            blockedChunks.push(chunk);
          },
          async flush(controller) {
            const baseContext = normalizeGuardrailContext(params);

            const guardrailContext = context
              ? { ...baseContext, requestContext: context }
              : baseContext;

            // Carries usage so guardrails like tokenUsageLimit work.
            const streamedResult: StreamedOutputSnapshot = {
              text: accumulatedText,
              content: [{ type: 'text', text: accumulatedText }],
              usage: streamUsage,
              finishReason: streamFinishReason,
            };

            const streamedTextBeforeGuardrails =
              snapshotGenerateResultText(streamedResult);

            const outputContext: OutputGuardrailContext = {
              input: guardrailContext,
              result: asGuardrailResult(streamedResult),
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
              const blockedGuardrailObjects = executionSummary.blockedResults
                .map((r: GuardrailResult) =>
                  outputGuardrails.find(
                    (g) =>
                      g.name ===
                      (r.context?.guardrailName ?? r.info?.guardrailName),
                  ),
                )
                .filter((g): g is OutputGuardrail<M> => g !== undefined);

              const effectiveRetry = resolveRetryConfig(
                retry,
                blockedGuardrailObjects,
              );

              // Auto-retry (buffer mode only)
              if (
                effectiveRetry.maxRetries > 0 &&
                (retry?.onlyWhen ? retry.onlyWhen(executionSummary) : true)
              ) {
                const maxRetries = effectiveRetry.maxRetries;
                let lastParams = params;

                let lastResult = asGuardrailResult({ text: accumulatedText });

                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                  const wait = retryDelayMs(effectiveRetry.backoffMs, attempt);

                  if (wait && wait > 0) {
                    await new Promise((r) => setTimeout(r, wait));
                  }

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
                    lastResult,
                  });

                  const retryResult = asGuardrailResult(
                    await model.doGenerate(nextParams),
                  );

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
                    const { text: repairedText } = extractContent(retryResult);

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

              const finalText = streamedResult.text;

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
          stream: streamResult.stream.pipeThrough(transformStream),
        };
      }

      // Progressive mode: evaluate on every text delta, with early termination.
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
            accumulatedText += chunk.delta;
            chunkIndex++;

            const baseContext = normalizeGuardrailContext(params);

            const guardrailContext = context
              ? { ...baseContext, requestContext: context }
              : baseContext;

            const outputContext: OutputGuardrailContext = {
              input: guardrailContext,
              result: asGuardrailResult({ text: accumulatedText }),
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
              streamViolationHistory.push({
                chunkIndex,
                summary: executionSummary,
              });

              const shouldStopEarly =
                stopOnGuardrailViolation &&
                checkStreamStopCondition(
                  stopOnGuardrailViolation,
                  streamViolationHistory,
                );

              if (shouldStopEarly) {
                blocked = true;
              }

              // Block only once the stop condition is met.
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
        stream: streamResult.stream.pipeThrough(transformStream),
      };
    },
  };
}
