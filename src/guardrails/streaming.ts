import type {
  OutputGuardrail,
  GuardrailExecutionSummary,
  OutputGuardrailContext,
  AIResult,
} from '../types';
import { executeOutputGuardrails } from '../guardrails';

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
export function createGuardrailStreamTransform<
  TOOLS extends Record<string, unknown>,
>(
  guardrails: OutputGuardrail[],
  options: GuardrailStreamTransformOptions = {},
): (transformOptions: {
  tools: TOOLS;
  stopStream: () => void;
}) => TransformStream<
  { type: string; id?: string; text?: string; delta?: string },
  { type: string; id?: string; text?: string; delta?: string; error?: unknown }
> {
  const {
    stopOnSeverity = 'critical',
    stopCondition,
    onViolation,
    checkInterval = 1,
    timeout = 5000,
    parallel = true,
  } = options;

  const severityOrder = { low: 1, medium: 2, high: 3, critical: 4 };
  const minLevel = severityOrder[stopOnSeverity];

  return ({ stopStream }) => {
    let accumulatedText = '';
    let chunkCount = 0;
    let stopped = false;

    return new TransformStream({
      async transform(chunk, controller) {
        // If already stopped, don't process more chunks
        if (stopped) {
          return;
        }

        // Pass through non-text chunks immediately
        if (chunk.type !== 'text-delta') {
          controller.enqueue(chunk);
          return;
        }

        // Extract text from chunk
        const text = chunk.text || chunk.delta || '';
        accumulatedText += text;
        chunkCount++;

        // Check guardrails at specified intervals
        if (chunkCount % checkInterval !== 0) {
          controller.enqueue(chunk);
          return;
        }

        try {
          // Execute guardrails on accumulated text
          const mockResult = {
            text: accumulatedText,
            content: [],
            finishReason: 'stop',
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          } as unknown as AIResult;

          const context: OutputGuardrailContext = {
            input: {
              prompt: '',
              messages: [],
              system: '',
            },
            result: mockResult,
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

          // Determine if we should stop
          const shouldStop = stopCondition
            ? stopCondition(summary)
            : summary.blockedResults.some((result) => {
                const resultSeverity = result.severity ?? 'medium';
                return severityOrder[resultSeverity] >= minLevel;
              });

          if (shouldStop) {
            stopped = true;
            onViolation?.(summary);

            // Enqueue error chunk
            controller.enqueue({
              type: 'error',
              error: `Guardrail violation: ${summary.blockedResults.map((r) => r.message).join(', ')}`,
            });

            // Stop the source stream
            stopStream();
            return;
          }

          // No violation, pass through the chunk
          controller.enqueue(chunk);
        } catch (error) {
          // On guardrail execution error, pass through but log
          console.error('Guardrail stream transform error:', error);
          controller.enqueue(chunk);
        }
      },

      flush() {
        // Stream completed without violations
        if (!stopped) {
          // Optional: run final check on complete text
        }
      },
    });
  };
}

/**
 * Creates a simple transform that accumulates text and checks on flush
 * More efficient but less responsive than chunk-by-chunk checking
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
  TOOLS extends Record<string, unknown>,
>(
  guardrails: OutputGuardrail[],
  options: Omit<GuardrailStreamTransformOptions, 'checkInterval'> = {},
): (transformOptions: {
  tools: TOOLS;
  stopStream: () => void;
}) => TransformStream<
  { type: string; id?: string; text?: string; delta?: string },
  { type: string; id?: string; text?: string; delta?: string; error?: unknown }
> {
  const {
    stopOnSeverity = 'critical',
    stopCondition,
    onViolation,
    timeout = 5000,
    parallel = true,
  } = options;

  const severityOrder = { low: 1, medium: 2, high: 3, critical: 4 };
  const minLevel = severityOrder[stopOnSeverity];

  return ({ stopStream }) => {
    let accumulatedText = '';
    const chunks: Array<{
      type: string;
      id?: string;
      text?: string;
      delta?: string;
    }> = [];

    return new TransformStream({
      transform(chunk) {
        if (chunk.type === 'text-delta') {
          const text = chunk.text || chunk.delta || '';
          accumulatedText += text;
        }
        chunks.push(chunk);
      },

      async flush(controller) {
        // Check guardrails on complete text
        try {
          const mockResult = {
            text: accumulatedText,
            content: [],
            finishReason: 'stop',
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          } as unknown as AIResult;

          const context: OutputGuardrailContext = {
            input: {
              prompt: '',
              messages: [],
              system: '',
            },
            result: mockResult,
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

          // Determine if we should block
          const shouldBlock = stopCondition
            ? stopCondition(summary)
            : summary.blockedResults.some((result) => {
                const resultSeverity = result.severity ?? 'medium';
                return severityOrder[resultSeverity] >= minLevel;
              });

          if (shouldBlock) {
            onViolation?.(summary);

            // Enqueue error instead of chunks
            controller.enqueue({
              type: 'error',
              error: `Guardrail violation: ${summary.blockedResults.map((r) => r.message).join(', ')}`,
            });

            stopStream();
            return;
          }

          // No violation, enqueue all chunks
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
        } catch (error) {
          // On error, enqueue chunks anyway
          console.error('Guardrail buffered transform error:', error);
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
        }
      },
    });
  };
}
