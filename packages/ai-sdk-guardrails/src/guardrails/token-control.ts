import type { StreamTextTransform, TextStreamPart, ToolSet } from 'ai';
import type {
  OutputGuardrail,
  GuardrailExecutionSummary,
  OutputGuardrailContext,
  AIResult,
  GenerateTextResult,
} from '../types';
import { executeOutputGuardrails } from '../guardrails';
import { guardrailStopParts } from './stream-transform';

/**
 * Estimate a token count at roughly 4 characters per token (English text).
 * Pass a model-specific `tokenizer` to the transforms for exact counts.
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  // Rough estimate: ~4 chars per token + word boundaries
  const charCount = text.length;
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;

  return Math.ceil(charCount / 4 + wordCount / 2);
}

/**
 * Options for token budget transform
 */
export interface TokenBudgetOptions {
  /**
   * Maximum tokens allowed before stopping the stream
   */
  maxTokens: number;

  /**
   * Custom tokenizer function
   * If not provided, uses estimateTokenCount
   */
  tokenizer?: (text: string) => number;

  /**
   * Callback invoked when token budget is exceeded
   */
  onBudgetExceeded?: (info: { consumed: number; budget: number }) => void;
}

/**
 * Creates a transform that stops streaming after a token budget is exceeded
 *
 * Useful for controlling costs and preventing runaway generation, especially
 * when combined with guardrails that might detect issues late in generation.
 *
 * @param options - Token budget configuration
 * @returns Transform function compatible with streamText experimental_transform
 *
 * @example
 * ```typescript
 * import { streamText } from 'ai';
 * import { createTokenBudgetTransform } from 'ai-sdk-guardrails';
 *
 * const result = streamText({
 *   model,
 *   prompt: 'Write a long story',
 *   experimental_transform: createTokenBudgetTransform({
 *     maxTokens: 1000,
 *     onBudgetExceeded: ({ consumed, budget }) => {
 *       console.log(`Stopped at ${consumed} tokens (budget: ${budget})`);
 *     },
 *   }),
 * });
 * ```
 */
export function createTokenBudgetTransform<TOOLS extends ToolSet = ToolSet>(
  options: TokenBudgetOptions,
): StreamTextTransform<TOOLS> {
  const {
    maxTokens,
    tokenizer = estimateTokenCount,
    onBudgetExceeded,
  } = options;

  return ({ stopStream }) => {
    let accumulatedText = '';
    let tokenCount = 0;
    let stopped = false;

    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(chunk, controller) {
        if (stopped) {
          return;
        }

        if (chunk.type === 'text-delta') {
          const text = chunk.text;
          accumulatedText += text;
          tokenCount = tokenizer(accumulatedText);

          if (tokenCount > maxTokens) {
            stopped = true;
            onBudgetExceeded?.({ consumed: tokenCount, budget: maxTokens });

            controller.enqueue({
              type: 'error',
              error: `Token budget exceeded: ${tokenCount} > ${maxTokens}`,
            });

            stopStream();

            for (const part of guardrailStopParts<TOOLS>(chunk.id)) {
              controller.enqueue(part);
            }

            return;
          }
        }

        controller.enqueue(chunk);
      },
    });
  };
}

/**
 * Options for token-aware guardrail transform
 */
export interface TokenAwareGuardrailOptions {
  /**
   * Check guardrails every N tokens (reduces overhead)
   * @default 10
   */
  checkEveryTokens?: number;

  /**
   * Maximum tokens before stopping (optional)
   * If not set, stream continues until completion
   */
  maxTokens?: number;

  /**
   * Stop on violations of this severity or higher
   * @default 'critical'
   */
  stopOnSeverity?: 'low' | 'medium' | 'high' | 'critical';

  /**
   * Custom stop condition
   */
  stopCondition?: (summary: GuardrailExecutionSummary) => boolean;

  /**
   * Callback invoked when violation detected
   */
  onViolation?: (summary: GuardrailExecutionSummary) => void;

  /**
   * Custom tokenizer function
   */
  tokenizer?: (text: string) => number;

  /**
   * Timeout for guardrail execution
   * @default 5000
   */
  timeout?: number;

  /**
   * Execute guardrails in parallel
   * @default true
   */
  parallel?: boolean;
}

/**
 * Creates a transform that checks guardrails at token intervals
 *
 * More efficient than checking every chunk - reduces guardrail overhead
 * while maintaining safety. Particularly useful for high-throughput streams.
 *
 * @param guardrails - Output guardrails to check
 * @param options - Configuration options
 * @returns Transform function compatible with streamText experimental_transform
 *
 * @example
 * ```typescript
 * import { streamText } from 'ai';
 * import { createTokenAwareGuardrailTransform } from 'ai-sdk-guardrails';
 * import { toxicityFilter } from 'ai-sdk-guardrails/guardrails/output';
 *
 * const result = streamText({
 *   model,
 *   prompt: 'Write a story',
 *   experimental_transform: createTokenAwareGuardrailTransform(
 *     [toxicityFilter()],
 *     {
 *       checkEveryTokens: 50, // Check every 50 tokens
 *       maxTokens: 1000,      // Stop at 1000 tokens
 *       stopOnSeverity: 'high',
 *     }
 *   ),
 * });
 * ```
 *
 * @example Combine with token budget for cost control
 * ```typescript
 * experimental_transform: [
 *   createTokenBudgetTransform({ maxTokens: 2000 }),
 *   createTokenAwareGuardrailTransform([piiDetector()], {
 *     checkEveryTokens: 100,
 *   }),
 * ]
 * ```
 */
export function createTokenAwareGuardrailTransform<
  TOOLS extends ToolSet = ToolSet,
>(
  guardrails: OutputGuardrail[],
  options: TokenAwareGuardrailOptions = {},
): StreamTextTransform<TOOLS> {
  const {
    checkEveryTokens = 10,
    maxTokens,
    stopOnSeverity = 'critical',
    stopCondition,
    onViolation,
    tokenizer = estimateTokenCount,
    timeout = 5000,
    parallel = true,
  } = options;

  const severityOrder = { low: 1, medium: 2, high: 3, critical: 4 };
  const minLevel = severityOrder[stopOnSeverity];

  return ({ stopStream }) => {
    let accumulatedText = '';
    let tokenCount = 0;
    let lastCheckTokens = 0;
    let stopped = false;

    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      async transform(chunk, controller) {
        if (stopped) {
          return;
        }

        if (chunk.type !== 'text-delta') {
          controller.enqueue(chunk);

          return;
        }

        const text = chunk.text;
        accumulatedText += text;
        tokenCount = tokenizer(accumulatedText);

        if (maxTokens !== undefined && tokenCount > maxTokens) {
          stopped = true;
          controller.enqueue({
            type: 'error',
            error: `Token limit exceeded: ${tokenCount} > ${maxTokens}`,
          });
          stopStream();

          for (const part of guardrailStopParts<TOOLS>(chunk.id)) {
            controller.enqueue(part);
          }

          return;
        }

        const tokensSinceLastCheck = tokenCount - lastCheckTokens;

        if (tokensSinceLastCheck < checkEveryTokens) {
          controller.enqueue(chunk);

          return;
        }

        lastCheckTokens = tokenCount;

        try {
          const content: GenerateTextResult['content'] = [];

          // SAFETY: output guardrails read only text, content, finishReason and
          // usage from a streamed result; the other AIResult members are absent.
          const partialResult = {
            text: accumulatedText,
            content,
            finishReason: 'stop',
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          } as AIResult;

          const context: OutputGuardrailContext = {
            input: {
              prompt: '',
              messages: [],
              system: '',
            },
            result: partialResult,
          };

          const results = await executeOutputGuardrails(guardrails, context, {
            parallel,
            timeout,
            continueOnFailure: true,
            logLevel: 'none',
          });

          const summary: GuardrailExecutionSummary = {
            allResults: results,
            blockedResults: results.filter((r) => r.tripwireTriggered),
            totalExecutionTime: 0,
            guardrailsExecuted: results.length,
            stats: {
              passed: results.filter((r) => !r.tripwireTriggered).length,
              blocked: results.filter((r) => r.tripwireTriggered).length,
              failed: 0,
              averageExecutionTime: 0,
            },
          };

          const shouldStop = stopCondition
            ? stopCondition(summary)
            : summary.blockedResults.some((result) => {
                const resultSeverity = result.severity ?? 'medium';

                return severityOrder[resultSeverity] >= minLevel;
              });

          if (shouldStop) {
            stopped = true;
            onViolation?.(summary);

            controller.enqueue({
              type: 'error',
              error: `Guardrail violation: ${summary.blockedResults.map((r) => r.message).join(', ')}`,
            });

            stopStream();

            for (const part of guardrailStopParts<TOOLS>(chunk.id)) {
              controller.enqueue(part);
            }

            return;
          }

          controller.enqueue(chunk);
        } catch (error) {
          // Guardrail errors do not stop the stream.
          console.error('Token-aware guardrail error:', error);
          controller.enqueue(chunk);
        }
      },
    });
  };
}
