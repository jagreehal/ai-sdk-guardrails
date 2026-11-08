/**
 * Guardrails as standard AI SDK middleware for `wrapLanguageModel`, so they
 * compose with other middleware (logging, caching, etc.).
 */

import type {
  LanguageModelV4Middleware,
  LanguageModelV4CallOptions,
  LanguageModelV4FinishReason,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from '@ai-sdk/provider';
import type { GuardrailMetadata, GuardrailResult } from '../enhanced-types';
import type {
  StreamedOutputSnapshot,
  BlockedOutputResult,
  InputGuardrail,
  OutputGuardrail,
  GuardrailExecutionSummary,
  NormalizedGuardrailContext,
  RequestContext,
} from '../types';
import {
  executeInputGuardrails,
  executeOutputGuardrails,
  normalizeGuardrailContext,
} from '../guardrails';
import { GuardrailsInputError, GuardrailsOutputError } from '../errors';
import {
  snapshotGenerateResultText,
  syncGenerateResultTextAfterGuardrails,
} from './generate-result-sync';
import { asGuardrailResult } from './middleware-factories';

// Usage and finish reason for responses synthesized by the middleware.
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

const finishReasonOther: LanguageModelV4FinishReason = {
  unified: 'other',
  raw: undefined,
};

/**
 * Configuration for guardrail middleware
 */
export interface GuardrailMiddlewareConfig<
  MIn extends GuardrailMetadata = GuardrailMetadata,
  MOut extends GuardrailMetadata = GuardrailMetadata,
  TContext = GuardrailMetadata,
> {
  /** Input guardrails to execute before model call */
  inputGuardrails?: InputGuardrail<MIn>[];
  /** Output guardrails to execute after model call */
  outputGuardrails?: OutputGuardrail<MOut>[];
  /** Request-scoped context (user, session, permissions) */
  context?: RequestContext<TContext>;
  /** Whether to throw on blocked input/output */
  throwOnBlocked?: boolean;
  /** Whether to replace blocked output with a `[Output blocked: ...]` message */
  replaceOnBlocked?: boolean;
  /** Callback when input is blocked */
  onInputBlocked?: (
    summary: GuardrailExecutionSummary<MIn>,
    params: LanguageModelV4CallOptions,
  ) => void | Promise<void>;
  /** Callback when output is blocked */
  onOutputBlocked?: (
    summary: GuardrailExecutionSummary<MOut>,
    params: LanguageModelV4CallOptions,
    result: BlockedOutputResult,
  ) => void | Promise<void>;
  /** Execution options */
  executionOptions?: {
    parallel?: boolean;
    timeout?: number;
    continueOnFailure?: boolean;
    logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
  };
  /** Skip guardrails for this request (useful for testing) */
  skipGuardrails?: boolean | ((params: LanguageModelV4CallOptions) => boolean);
}

/**
 * Creates a guardrail middleware for use with AI SDK's wrapLanguageModel.
 *
 * This allows guardrails to be composed with other middleware like logging,
 * caching, rate limiting, etc.
 *
 * @example Basic usage
 * ```typescript
 * import { wrapLanguageModel } from 'ai';
 * import { anthropic } from '@ai-sdk/anthropic';
 * import { guardrailMiddleware } from 'ai-sdk-guardrails/guardrails/middleware';
 *
 * const model = wrapLanguageModel({
 *   model: anthropic('claude-3-opus'),
 *   middleware: [
 *     guardrailMiddleware({
 *       inputGuardrails: [promptInjectionDetector()],
 *       outputGuardrails: [piiRedactor()],
 *       throwOnBlocked: true,
 *     }),
 *   ],
 * });
 * ```
 *
 * @example Composing with other middleware
 * ```typescript
 * const model = wrapLanguageModel({
 *   model: openai('gpt-4'),
 *   middleware: [
 *     loggingMiddleware(),
 *     guardrailMiddleware({
 *       inputGuardrails: [rateLimiter(), piiDetector()],
 *       outputGuardrails: [contentFilter()],
 *     }),
 *     cachingMiddleware(),
 *   ],
 * });
 * ```
 *
 * @example With request context
 * ```typescript
 * // Create middleware with context getter
 * const createUserGuardrails = (user: User) =>
 *   guardrailMiddleware({
 *     inputGuardrails: [roleBasedAccess()],
 *     context: {
 *       userId: user.id,
 *       permissions: user.permissions,
 *       organizationId: user.orgId,
 *     },
 *   });
 *
 * // Use per-request
 * const userModel = wrapLanguageModel({
 *   model: baseModel,
 *   middleware: [createUserGuardrails(currentUser)],
 * });
 * ```
 */
export function guardrailMiddleware<
  MIn extends GuardrailMetadata = GuardrailMetadata,
  MOut extends GuardrailMetadata = GuardrailMetadata,
  TContext = GuardrailMetadata,
>(
  config: GuardrailMiddlewareConfig<MIn, MOut, TContext>,
): LanguageModelV4Middleware {
  const {
    inputGuardrails = [],
    outputGuardrails = [],
    context,
    throwOnBlocked = false,
    replaceOnBlocked = true,
    onInputBlocked,
    onOutputBlocked,
    executionOptions = {},
    skipGuardrails = false,
  } = config;

  const shouldSkip = (params: LanguageModelV4CallOptions): boolean =>
    skipGuardrails instanceof Function
      ? skipGuardrails(params)
      : skipGuardrails;

  const guardrailContext = (
    params: LanguageModelV4CallOptions,
  ): NormalizedGuardrailContext => {
    const baseContext = normalizeGuardrailContext(params);

    if (!context) return baseContext;

    // A new object, so the cached normalized context is not mutated.
    // SAFETY: guardrails treat requestContext.metadata as an opaque value the
    // caller supplied; TContext only types the caller's side of it.
    return {
      ...baseContext,
      requestContext: context,
    } as NormalizedGuardrailContext;
  };

  return {
    specificationVersion: 'v4' as const,
    transformParams: async ({ params }) => {
      if (shouldSkip(params) || inputGuardrails.length === 0) {
        return params;
      }

      const startTime = Date.now();

      const results = await executeInputGuardrails(
        inputGuardrails,
        guardrailContext(params),
        executionOptions,
      );

      const blockedResults = results.filter((r) => r.tripwireTriggered);

      if (blockedResults.length > 0) {
        const summary = createExecutionSummary<MIn>(results, startTime);

        if (onInputBlocked) {
          await onInputBlocked(summary, params);
        }

        if (throwOnBlocked) {
          throw new GuardrailsInputError(
            blockedResults.map((r) => ({
              name: r.context?.guardrailName || 'unknown',
              message: r.message || 'Blocked',
              severity: r.severity || 'medium',
            })),
          );
        }

        // Marks the params so wrapGenerate/wrapStream short-circuit.
        return { ...params, _guardrailsBlocked: blockedResults };
      }

      return params;
    },

    wrapGenerate: async ({ doGenerate, params }) => {
      if ('_guardrailsBlocked' in params) {
        const blockedMessage = 'Input blocked by guardrails';
        const blockedText = `[${blockedMessage}]`;

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

      if (shouldSkip(params) || outputGuardrails.length === 0) {
        return doGenerate();
      }

      const result = await doGenerate();
      const resultTextBeforeGuardrails = snapshotGenerateResultText(result);

      // The full result goes to output guardrails so they can read usage,
      // finishReason, etc.
      const startTime = Date.now();

      const outputResults = await executeOutputGuardrails(
        outputGuardrails,
        {
          input: guardrailContext(params),
          result: asGuardrailResult(result),
        },
        executionOptions,
      );

      const blockedResults = outputResults.filter((r) => r.tripwireTriggered);

      if (blockedResults.length > 0) {
        const summary = createExecutionSummary<MOut>(outputResults, startTime);

        if (onOutputBlocked) {
          await onOutputBlocked(summary, params, result);
        }

        if (throwOnBlocked) {
          throw new GuardrailsOutputError(
            blockedResults.map((r) => ({
              name: r.context?.guardrailName || 'unknown',
              message: r.message || 'Blocked',
              severity: r.severity || 'medium',
            })),
          );
        }

        if (replaceOnBlocked) {
          const blockedMessage = blockedResults
            .map((r) => r.message)
            .join('; ');

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

    // Streams are buffered and checked once complete.
    wrapStream: async ({ doStream, params }) => {
      if ('_guardrailsBlocked' in params) {
        const blockedMessage = 'Input blocked by guardrails';

        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: 'text-delta',
              id: '1',
              delta: `[${blockedMessage}]`,
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

      if (shouldSkip(params) || outputGuardrails.length === 0) {
        return doStream();
      }

      const streamResult = await doStream();

      let accumulatedText = '';
      let streamUsage: LanguageModelV4Usage | undefined;
      let streamFinishReason: LanguageModelV4FinishReason | undefined;
      const chunks: LanguageModelV4StreamPart[] = [];

      const transformStream = new TransformStream<
        LanguageModelV4StreamPart,
        LanguageModelV4StreamPart
      >({
        transform(chunk) {
          if (chunk.type === 'text-delta') {
            accumulatedText += chunk.delta;
          } else if (chunk.type === 'finish') {
            streamUsage = chunk.usage ?? streamUsage;
            streamFinishReason = chunk.finishReason ?? streamFinishReason;
          }

          chunks.push(chunk);
        },
        async flush(controller) {
          // Includes usage and finishReason so guardrails like
          // tokenUsageLimit can read them.
          const streamedResult: StreamedOutputSnapshot = {
            text: accumulatedText,
            content: [{ type: 'text', text: accumulatedText }],
            usage: streamUsage ?? {},
            finishReason: streamFinishReason,
          };

          const startTime = Date.now();

          const outputResults = await executeOutputGuardrails(
            outputGuardrails,
            {
              input: guardrailContext(params),
              result: asGuardrailResult(streamedResult),
            },
            executionOptions,
          );

          const blockedResults = outputResults.filter(
            (r) => r.tripwireTriggered,
          );

          if (blockedResults.length > 0) {
            const summary = createExecutionSummary<MOut>(
              outputResults,
              startTime,
            );

            if (onOutputBlocked) {
              await onOutputBlocked(summary, params, streamedResult);
            }

            if (throwOnBlocked) {
              controller.error(
                new GuardrailsOutputError(
                  blockedResults.map((r) => ({
                    name: r.context?.guardrailName || 'unknown',
                    message: r.message || 'Blocked',
                    severity: r.severity || 'medium',
                  })),
                ),
              );

              return;
            }

            if (replaceOnBlocked) {
              const blockedMessage = blockedResults
                .map((r) => r.message)
                .join('; ');

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
          }

          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
        },
      });

      return { stream: streamResult.stream.pipeThrough(transformStream) };
    },
  };
}

function createExecutionSummary<M extends GuardrailMetadata>(
  results: GuardrailResult<M>[],
  startTime: number,
): GuardrailExecutionSummary<M> {
  const endTime = Date.now();
  const blockedResults = results.filter((r) => r.tripwireTriggered);

  return {
    allResults: results,
    blockedResults,
    totalExecutionTime: endTime - startTime,
    guardrailsExecuted: results.length,
    stats: {
      passed: results.filter((r) => !r.tripwireTriggered).length,
      blocked: blockedResults.length,
      failed: results.filter(
        (r) => r.severity === 'critical' && r.tripwireTriggered,
      ).length,
      averageExecutionTime: 0,
    },
  };
}

/**
 * Creates a no-op middleware that skips all guardrails (for testing)
 */
export function noopGuardrailMiddleware(): LanguageModelV4Middleware {
  return guardrailMiddleware({
    skipGuardrails: true,
  });
}
