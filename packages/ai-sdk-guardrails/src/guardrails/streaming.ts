import type { StreamTextTransform, TextStreamPart, ToolSet } from 'ai';
import type {
  OutputGuardrail,
  GuardrailExecutionSummary,
  AIResult,
  GenerateTextResult,
} from '../types';
import { executeOutputGuardrails } from '../guardrails';
import { guardrailStopParts } from './stream-transform';

/**
 * Options for guardrail stream transform
 */
export interface GuardrailStreamTransformOptions {
  /**
   * Stop stream when violations of this severity or higher are detected
   * @default 'critical'
   */
  stopOnSeverity?: 'low' | 'medium' | 'high' | 'critical';

  /**
   * Custom condition to determine when to stop the stream
   * If provided, overrides stopOnSeverity
   */
  stopCondition?: (summary: GuardrailExecutionSummary) => boolean;

  /**
   * Callback invoked when a violation is detected
   */
  onViolation?: (summary: GuardrailExecutionSummary) => void;

  /**
   * How often to check guardrails (in number of chunks)
   * @default 1 (check every chunk)
   * Set higher to reduce overhead for high-throughput streams
   */
  checkInterval?: number;

  /**
   * Timeout for guardrail execution in milliseconds
   * @default 5000
   */
  timeout?: number;

  /**
   * Whether to execute guardrails in parallel
   * @default true
   */
  parallel?: boolean;
}

const SEVERITY_ORDER = { low: 1, medium: 2, high: 3, critical: 4 } as const;

/** Runs the guardrails over the accumulated text and decides whether to stop. */
async function checkAccumulatedText(
  guardrails: OutputGuardrail[],
  text: string,
  options: GuardrailStreamTransformOptions,
): Promise<{ summary: GuardrailExecutionSummary; shouldStop: boolean }> {
  const {
    stopOnSeverity = 'critical',
    stopCondition,
    timeout = 5000,
    parallel = true,
  } = options;

  const content: GenerateTextResult['content'] = [];

  // SAFETY: output guardrails read only text, content, finishReason and usage
  // from a streamed result; the other AIResult members are absent.
  const result = {
    text,
    content,
    finishReason: 'stop',
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  } as AIResult;

  const results = await executeOutputGuardrails(
    guardrails,
    { input: { prompt: '', messages: [], system: '' }, result },
    { parallel, timeout, continueOnFailure: true, logLevel: 'none' },
  );

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
    : summary.blockedResults.some(
        (r) =>
          SEVERITY_ORDER[r.severity ?? 'medium'] >=
          SEVERITY_ORDER[stopOnSeverity],
      );

  return { summary, shouldStop };
}

/**
 * Creates a stream transform that checks guardrails and stops the stream on violations
 *
 * This integrates with AI SDK's `experimental_transform` to provide efficient,
 * source-level stream stopping when guardrails detect violations. Unlike middleware
 * approaches that only stop consumption, this stops the provider stream itself.
 *
 * @param guardrails - Output guardrails to check during streaming
 * @param options - Configuration options
 * @returns Transform function compatible with streamText experimental_transform
 *
 * @example
 * ```typescript
 * import { streamText } from 'ai';
 * import { createGuardrailStreamTransform } from 'ai-sdk-guardrails';
 * import { toxicityFilter, piiDetector } from 'ai-sdk-guardrails/guardrails/output';
 *
 * const result = streamText({
 *   model,
 *   prompt: 'Tell me a story',
 *   experimental_transform: createGuardrailStreamTransform(
 *     [toxicityFilter(), piiDetector()],
 *     {
 *       stopOnSeverity: 'high',
 *       onViolation: (summary) => {
 *         console.log('Violation detected:', summary);
 *       },
 *     }
 *   ),
 * });
 * ```
 *
 * @example Multiple transforms can be composed
 * ```typescript
 * experimental_transform: [
 *   createGuardrailStreamTransform([toxicityFilter()]),
 *   customTransform(),
 * ]
 * ```
 */
export function createGuardrailStreamTransform<TOOLS extends ToolSet = ToolSet>(
  guardrails: OutputGuardrail[],
  options: GuardrailStreamTransformOptions = {},
): StreamTextTransform<TOOLS> {
  const { onViolation, checkInterval = 1 } = options;

  return ({ stopStream }) => {
    let accumulatedText = '';
    let chunkCount = 0;
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

        accumulatedText += chunk.text;
        chunkCount++;

        if (chunkCount % checkInterval !== 0) {
          controller.enqueue(chunk);

          return;
        }

        try {
          const { summary, shouldStop } = await checkAccumulatedText(
            guardrails,
            accumulatedText,
            options,
          );

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
          // A failing guardrail run lets the chunk through and logs.
          console.error('Guardrail stream transform error:', error);
          controller.enqueue(chunk);
        }
      },
    });
  };
}

/**
 * Creates a transform that buffers each step and checks it before releasing
 * (at the step's `finish-step`). More efficient but less responsive than
 * chunk-by-chunk checking; a blocked step's text is dropped.
 *
 * @param guardrails - Output guardrails to check
 * @param options - Configuration options
 * @returns Transform function
 *
 * @example
 * ```typescript
 * experimental_transform: createGuardrailStreamTransformBuffered(
 *   [minLengthRequirement(100)],
 *   { onViolation: (summary) => console.log(summary) }
 * )
 * ```
 */
export function createGuardrailStreamTransformBuffered<
  TOOLS extends ToolSet = ToolSet,
>(
  guardrails: OutputGuardrail[],
  options: Omit<GuardrailStreamTransformOptions, 'checkInterval'> = {},
): StreamTextTransform<TOOLS> {
  const { onViolation } = options;

  return () => {
    let accumulatedText = '';
    let chunks: Array<TextStreamPart<TOOLS>> = [];
    let stopped = false;

    // Returns true when the buffered text was blocked (and handled).
    async function blocked(
      controller: TransformStreamDefaultController<TextStreamPart<TOOLS>>,
    ): Promise<boolean> {
      try {
        const { summary, shouldStop: shouldBlock } = await checkAccumulatedText(
          guardrails,
          accumulatedText,
          options,
        );

        if (!shouldBlock) return false;

        onViolation?.(summary);
        controller.enqueue({
          type: 'error',
          error: `Guardrail violation: ${summary.blockedResults.map((r) => r.message).join(', ')}`,
        });

        // Drop the text, keep the structural parts.
        for (const chunk of chunks) {
          if (chunk.type !== 'text-delta') controller.enqueue(chunk);
        }

        return true;
      } catch (error) {
        // A failing guardrail run releases the buffered chunks.
        console.error('Guardrail buffered transform error:', error);

        return false;
      }
    }

    function release(
      controller: TransformStreamDefaultController<TextStreamPart<TOOLS>>,
    ) {
      for (const chunk of chunks) controller.enqueue(chunk);
      chunks = [];
    }

    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      // Buffer until each step's `finish-step`: the SDK waits for that part
      // before closing the step, so holding it until flush would deadlock.
      // The step has already finished by then, so a block drops text instead
      // of calling `stopStream()`.
      async transform(chunk, controller) {
        if (stopped) {
          if (chunk.type === 'finish-step' || chunk.type === 'finish') {
            controller.enqueue({ ...chunk, finishReason: 'content-filter' });
          } else if (chunk.type !== 'text-delta') {
            controller.enqueue(chunk);
          }

          return;
        }

        if (chunk.type !== 'finish-step') {
          if (chunk.type === 'text-delta') accumulatedText += chunk.text;
          chunks.push(chunk);

          return;
        }

        if (await blocked(controller)) {
          stopped = true;
          chunks = [];
          controller.enqueue({ ...chunk, finishReason: 'content-filter' });

          return;
        }

        release(controller);
        controller.enqueue(chunk);
      },

      async flush(controller) {
        if (stopped || chunks.length === 0) return;

        if (!(await blocked(controller))) release(controller);
      },
    });
  };
}
