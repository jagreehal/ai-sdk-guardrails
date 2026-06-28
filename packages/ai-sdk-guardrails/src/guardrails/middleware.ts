/**
 * Language Model Middleware Factory
 *
 * Creates guardrails as standard AI SDK middleware for use with wrapLanguageModel.
 * This enables composition with other middleware (logging, caching, etc.).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type {
  LanguageModelV4Middleware,
  LanguageModelV4CallOptions,
  LanguageModelV4FinishReason,
  LanguageModelV4Usage,
} from '@ai-sdk/provider';
import type {
  InputGuardrail,
  OutputGuardrail,
  GuardrailExecutionSummary,
  RequestContext,
} from '../types';
import {
  executeInputGuardrails,
  executeOutputGuardrails,
  normalizeGuardrailContext,
} from '../guardrails';
import { GuardrailsInputError, GuardrailsOutputError } from '../errors';

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

const finishReasonOther: LanguageModelV4FinishReason = {
  unified: 'other',
  raw: undefined,
};

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for guardrail middleware
 */
export interface GuardrailMiddlewareConfig<
  MIn extends Record<string, unknown> = Record<string, unknown>,
  MOut extends Record<string, unknown> = Record<string, unknown>,
  TContext = Record<string, unknown>,
> {
  /** Input guardrails to execute before model call */
  inputGuardrails?: InputGuardrail<MIn>[];
  /** Output guardrails to execute after model call */
  outputGuardrails?: OutputGuardrail<MOut>[];
  /** Request-scoped context (user, session, permissions) */
  context?: RequestContext<TContext>;
  /** Whether to throw on blocked input/output */
  throwOnBlocked?: boolean;
  /** Whether to replace blocked output with placeholder */
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
    result: unknown,
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

// ============================================================================
// Middleware Factory
// ============================================================================

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
  MIn extends Record<string, unknown> = Record<string, unknown>,
  MOut extends Record<string, unknown> = Record<string, unknown>,
  TContext = Record<string, unknown>,
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

  const shouldSkip = (params: LanguageModelV4CallOptions): boolean => {
    if (typeof skipGuardrails === 'function') {
      return skipGuardrails(params);
    }
    return skipGuardrails;
  };

  return {
    specificationVersion: 'v4' as const,
    // Transform params to check input guardrails
    transformParams: async ({ params }) => {
      if (shouldSkip(params) || inputGuardrails.length === 0) {
        return params;
      }

      const baseContext = normalizeGuardrailContext(params);

      // Create new context with request context to avoid mutating cached context
      const normalizedContext = context
        ? ({ ...baseContext, requestContext: context } as typeof baseContext)
        : baseContext;

      const startTime = Date.now();
      const results = await executeInputGuardrails(
        inputGuardrails,
        normalizedContext,
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

        // Store blocked status for wrapGenerate/wrapStream
        return {
          ...params,
          _guardrailsBlocked: blockedResults,
        } as LanguageModelV4CallOptions;
      }

      return params;
    },

    // Wrap generate to check output guardrails
    wrapGenerate: async ({ doGenerate, params }) => {
      // Check if input was blocked
      const paramsWithGuardrails = params as LanguageModelV4CallOptions & {
        _guardrailsBlocked?: unknown[];
      };

      if (paramsWithGuardrails._guardrailsBlocked) {
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

      // Skip output guardrails if configured
      if (shouldSkip(params) || outputGuardrails.length === 0) {
        return doGenerate();
      }

      const result = await doGenerate();

      // Run output guardrails
      const baseContext = normalizeGuardrailContext(params);
      // Create new context with request context to avoid mutating cached context
      const normalizedContext = context
        ? ({ ...baseContext, requestContext: context } as typeof baseContext)
        : baseContext;

      // Pass the full result to output guardrails so they can access
      // usage, finishReason, generationTime, etc.
      const startTime = Date.now();
      const outputResults = await executeOutputGuardrails(
        outputGuardrails,
        {
          input: normalizedContext,
          result: result as any,
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

      return result;
    },

    // Wrap stream to check output guardrails (buffer mode for simplicity)
    wrapStream: async ({ doStream, params }) => {
      // Check if input was blocked
      const paramsWithGuardrails = params as LanguageModelV4CallOptions & {
        _guardrailsBlocked?: unknown[];
      };

      if (paramsWithGuardrails._guardrailsBlocked) {
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

      // Skip output guardrails if configured
      if (shouldSkip(params) || outputGuardrails.length === 0) {
        return doStream();
      }

      const streamResult = await doStream();

      // Buffer and check output guardrails
      let accumulatedText = '';
      let streamUsage: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      } = {};
      let streamFinishReason: string | undefined;
      const chunks: any[] = [];

      const transformStream = new TransformStream({
        transform(chunk) {
          if (chunk.type === 'text-delta') {
            accumulatedText += chunk.delta || chunk.textDelta || '';
          }
          // Capture usage and finishReason from finish chunk
          if (chunk.type === 'finish') {
            if (chunk.usage) {
              streamUsage = chunk.usage;
            }
            if (chunk.finishReason) {
              streamFinishReason = chunk.finishReason;
            }
          }
          chunks.push(chunk);
        },
        async flush(controller) {
          const baseContext = normalizeGuardrailContext(params);
          // Create new context with request context to avoid mutating cached context
          const normalizedContext = context
            ? ({
                ...baseContext,
                requestContext: context,
              } as typeof baseContext)
            : baseContext;

          // Build a result object that includes text, usage, and finishReason
          // so guardrails like tokenUsageLimit can access the usage data
          const streamedResult = {
            text: accumulatedText,
            content: [{ type: 'text', text: accumulatedText }],
            usage: streamUsage,
            finishReason: streamFinishReason,
          };

          const startTime = Date.now();
          const outputResults = await executeOutputGuardrails(
            outputGuardrails,
            {
              input: normalizedContext,
              result: streamedResult as any,
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

          // Pass through all chunks
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
        },
      });

      return { stream: streamResult.stream.pipeThrough(transformStream) };
    },
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function createExecutionSummary<M extends Record<string, unknown>>(
  results: any[],
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

// ============================================================================
// Convenience Factories
// ============================================================================
// For input-only or output-only middleware, call `guardrailMiddleware({ ... })`
// with just `inputGuardrails` or `outputGuardrails`, or use the canonical
// `inputGuardrailsMiddleware` / `outputGuardrailsMiddleware`.

/**
 * Creates a no-op middleware that skips all guardrails (for testing)
 */
export function noopGuardrailMiddleware(): LanguageModelV4Middleware {
  return guardrailMiddleware({
    skipGuardrails: true,
  });
}
