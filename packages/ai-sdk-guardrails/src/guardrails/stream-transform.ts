/**
 * Stream Transform Integration
 *
 * Creates stream transforms for use with AI SDK's experimental_transform.
 * Enables real-time content filtering, redaction, and modification during streaming.
 */

import type { StreamTextTransform, TextStreamPart, ToolSet } from 'ai';
import type {
  AIResult,
  OutputGuardrail,
  GuardrailResult,
  RequestContext,
} from '../types';

export type { StreamTextTransform } from 'ai';

/**
 * Parts a transform must emit after calling `stopStream()`: the SDK drops the
 * rest of the source stream, so without a closing `finish-step` / `finish`
 * `streamText` rejects with "No output generated". Closes the open text block
 * when `textId` is given.
 */
export function guardrailStopParts<TOOLS extends ToolSet>(
  textId?: string,
): Array<TextStreamPart<TOOLS>> {
  // Usage and response metadata of the cut-off step are unknown, so they stay empty.
  const usage = {
    inputTokens: undefined,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokens: undefined,
    outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    totalTokens: undefined,
  };

  const performance = {
    effectiveOutputTokensPerSecond: 0,
    outputTokensPerSecond: undefined,
    inputTokensPerSecond: undefined,
    effectiveTotalTokensPerSecond: 0,
    stepTimeMs: 0,
    responseTimeMs: 0,
    toolExecutionMs: {},
    timeToFirstOutputMs: undefined,
  };

  return [
    ...(textId === undefined
      ? []
      : [{ type: 'text-end' as const, id: textId }]),
    {
      type: 'finish-step',
      finishReason: 'content-filter',
      rawFinishReason: undefined,
      providerMetadata: undefined,
      usage,
      performance,
      response: {
        id: 'guardrail-stop',
        modelId: 'unknown',
        timestamp: new Date(),
      },
    },
    {
      type: 'finish',
      finishReason: 'content-filter',
      rawFinishReason: undefined,
      totalUsage: usage,
    },
  ];
}

/** The `text-delta` stream part a violation was found in. */
export type TextDeltaPart = Extract<
  TextStreamPart<ToolSet>,
  { type: 'text-delta' }
>;

/**
 * Violation handler result
 */
export interface ViolationHandlerResult {
  /** Action to take */
  action: 'pass' | 'drop' | 'replace' | 'stop';
  /** Replacement text if action is 'replace' */
  replacement?: string;
  /** Reason for the action */
  reason?: string;
}

/**
 * Violation handler function type
 */
export type ViolationHandler = (
  chunk: TextDeltaPart,
  violation: GuardrailResult,
  context: StreamTransformContext,
) => ViolationHandlerResult | Promise<ViolationHandlerResult>;

/**
 * Context provided to stream transforms
 */
export interface StreamTransformContext {
  /** Accumulated text so far */
  accumulatedText: string;
  /** Number of chunks processed */
  chunkCount: number;
  /** Violations encountered so far */
  violations: GuardrailResult[];
  /** Request context */
  requestContext?: RequestContext;
}

/**
 * Options for creating guardrail stream transforms
 */
export interface GuardrailTransformOptions {
  /**
   * What to do when a violation is detected:
   * - 'stop': Stop the stream immediately
   * - 'drop': Drop the violating chunk silently
   * - 'redact': Replace matched patterns with redaction text
   * - 'replace': Replace entire chunk with replacement text
   * - function: Custom handler for full control
   */
  onViolation?: 'stop' | 'drop' | 'redact' | 'replace' | ViolationHandler;
  /** Patterns to redact when onViolation is 'redact' */
  redactPatterns?: Array<RegExp | string>;
  /** Text to use for redaction (default: '[REDACTED]') */
  redactionText?: string;
  /** Text to use for replacement when onViolation is 'replace' */
  replacementText?: string;
  /** Minimum characters to accumulate before checking guardrails */
  minCharsBeforeCheck?: number;
  /** Check frequency (every N chunks) to reduce overhead */
  checkEveryNChunks?: number;
  /** Request context to pass to guardrails */
  requestContext?: RequestContext;
  /** Callback when stream is stopped due to violation */
  onStreamStopped?: (
    violations: GuardrailResult[],
    accumulatedText: string,
  ) => void;
  /** Callback for each violation (even if not stopping) */
  onViolationDetected?: (
    violation: GuardrailResult,
    chunk: TextDeltaPart,
  ) => void;
}

/**
 * Creates a guardrail-based stream transform for use with AI SDK's experimental_transform.
 *
 * This enables real-time content filtering, redaction, and modification during streaming
 * without buffering the entire response.
 *
 * @example Basic usage - stop on violation
 * ```typescript
 * const result = streamText({
 *   model,
 *   prompt,
 *   experimental_transform: createGuardrailTransform(
 *     [toxicityFilter(), piiDetector()],
 *     { onViolation: 'stop' }
 *   )
 * });
 * ```
 *
 * @example Redaction - replace sensitive patterns
 * ```typescript
 * const result = streamText({
 *   model,
 *   prompt,
 *   experimental_transform: createGuardrailTransform(
 *     [piiDetector()],
 *     {
 *       onViolation: 'redact',
 *       redactPatterns: [
 *         /\b\d{3}-\d{2}-\d{4}\b/g,  // SSN
 *         /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,  // Email
 *       ],
 *       redactionText: '[REDACTED]'
 *     }
 *   )
 * });
 * ```
 *
 * @example Custom handler
 * ```typescript
 * const result = streamText({
 *   model,
 *   prompt,
 *   experimental_transform: createGuardrailTransform(
 *     [toxicityFilter()],
 *     {
 *       onViolation: (chunk, violation, ctx) => {
 *         if (violation.severity === 'critical') {
 *           return { action: 'stop', reason: 'Critical violation' };
 *         }
 *         if (ctx.violations.length > 3) {
 *           return { action: 'stop', reason: 'Too many violations' };
 *         }
 *         return { action: 'pass' };  // Allow through with warning
 *       }
 *     }
 *   )
 * });
 * ```
 */
export function createGuardrailTransform<TOOLS extends ToolSet = ToolSet>(
  guardrails: OutputGuardrail[],
  options: GuardrailTransformOptions = {},
): StreamTextTransform<TOOLS> {
  const {
    onViolation = 'stop',
    redactPatterns = [],
    redactionText = '[REDACTED]',
    replacementText = '[Content filtered]',
    minCharsBeforeCheck = 0,
    checkEveryNChunks = 1,
    requestContext,
    onStreamStopped,
    onViolationDetected,
  } = options;

  return ({ stopStream }) => {
    let accumulatedText = '';
    let chunkCount = 0;
    const violations: GuardrailResult[] = [];
    let stopped = false;

    const context: StreamTransformContext = {
      accumulatedText: '',
      chunkCount: 0,
      violations: [],
      requestContext,
    };

    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      async transform(chunk, controller) {
        if (stopped) {
          return; // Don't process more chunks after stopping
        }

        if (chunk.type === 'text-delta') {
          const chunkText = chunk.text;
          accumulatedText += chunkText;
          chunkCount++;

          context.accumulatedText = accumulatedText;
          context.chunkCount = chunkCount;
          context.violations = violations;

          const shouldCheck =
            accumulatedText.length >= minCharsBeforeCheck &&
            chunkCount % checkEveryNChunks === 0;

          if (shouldCheck && guardrails.length > 0) {
            for (const guardrail of guardrails) {
              if (guardrail.enabled === false) continue;

              try {
                const result = await guardrail.execute(
                  {
                    input: {
                      prompt: '',
                      messages: [],
                      system: '',
                      requestContext,
                    },
                    // SAFETY: mid-stream there is no SDK result yet; output
                    // guardrails read the accumulated text from `result.text`.
                    result: { text: accumulatedText } as AIResult,
                  },
                  accumulatedText,
                );

                if (result.tripwireTriggered) {
                  violations.push(result);
                  context.violations = violations;

                  if (onViolationDetected) {
                    onViolationDetected(result, chunk);
                  }

                  const handlerResult = await handleViolation(
                    chunk,
                    result,
                    context,
                    {
                      onViolation,
                      redactPatterns,
                      redactionText,
                      replacementText,
                    },
                  );

                  switch (handlerResult.action) {
                    case 'stop':
                      stopped = true;
                      stopStream();

                      if (onStreamStopped) {
                        onStreamStopped(violations, accumulatedText);
                      }

                      controller.enqueue({
                        ...chunk,
                        text: `\n[Stream stopped: ${handlerResult.reason || result.message}]`,
                      });

                      for (const part of guardrailStopParts<TOOLS>(chunk.id)) {
                        controller.enqueue(part);
                      }

                      return;

                    case 'drop':
                      // Don't enqueue this chunk
                      return;

                    case 'replace':
                      controller.enqueue({
                        ...chunk,
                        text: handlerResult.replacement || replacementText,
                      });

                      return;

                    case 'pass':
                    default:
                      break;
                  }
                }
              } catch (error) {
                // Log error but don't stop stream for guardrail errors
                console.error(`Guardrail "${guardrail.name}" error:`, error);
              }
            }
          }

          // Apply redaction if configured (even without explicit violation)
          if (redactPatterns.length > 0 && chunkText) {
            const redactedText = applyRedaction(
              chunkText,
              redactPatterns,
              redactionText,
            );

            if (redactedText !== chunkText) {
              controller.enqueue({ ...chunk, text: redactedText });

              return;
            }
          }
        }

        controller.enqueue(chunk);
      },
    });
  };
}

/**
 * Handles a violation based on configured behavior
 */
async function handleViolation(
  chunk: TextDeltaPart,
  violation: GuardrailResult,
  context: StreamTransformContext,
  options: {
    onViolation: 'stop' | 'drop' | 'redact' | 'replace' | ViolationHandler;
    redactPatterns: Array<RegExp | string>;
    redactionText: string;
    replacementText: string;
  },
): Promise<ViolationHandlerResult> {
  const { onViolation, redactPatterns, redactionText, replacementText } =
    options;

  if (onViolation instanceof Function) {
    return onViolation(chunk, violation, context);
  }

  switch (onViolation) {
    case 'stop':
      return { action: 'stop', reason: violation.message };

    case 'drop':
      return { action: 'drop', reason: violation.message };

    case 'redact':
      const chunkText = chunk.text;
      const redacted = applyRedaction(chunkText, redactPatterns, redactionText);

      if (redacted !== chunkText) {
        return {
          action: 'replace',
          replacement: redacted,
          reason: 'Content redacted',
        };
      }

      return { action: 'pass' };

    case 'replace':
      return {
        action: 'replace',
        replacement: replacementText,
        reason: violation.message,
      };

    default:
      return { action: 'pass' };
  }
}

/**
 * Applies redaction patterns to text
 */
function applyRedaction(
  text: string,
  patterns: Array<RegExp | string>,
  redactionText: string,
): string {
  let result = text;

  for (const pattern of patterns) {
    result =
      pattern instanceof RegExp
        ? result.replace(pattern, () => redactionText)
        : result.split(pattern).join(redactionText);
  }

  return result;
}

// ============================================================================
// Built-in Redaction Patterns
// ============================================================================

/**
 * Common PII patterns for redaction
 */
export const PII_PATTERNS = {
  /** US Social Security Number */
  SSN: /\b\d{3}-\d{2}-\d{4}\b/g,
  /** Email addresses */
  EMAIL: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  /** Phone numbers (various formats) */
  PHONE: /\b(\+\d{1,2}\s?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
  /** Credit card numbers */
  CREDIT_CARD: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  /** IP addresses */
  IP_ADDRESS: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
  /** API keys (generic pattern) */
  API_KEY: /\b(sk|pk|api)[_-]?[a-zA-Z0-9]{20,}\b/gi,
};

/**
 * Creates a PII redaction transform
 */
export function createPIIRedactionTransform<TOOLS extends ToolSet = ToolSet>(
  options: {
    patterns?: Array<RegExp | string>;
    redactionText?: string;
    requestContext?: RequestContext;
  } = {},
): StreamTextTransform<TOOLS> {
  const patterns = options.patterns || [
    PII_PATTERNS.SSN,
    PII_PATTERNS.EMAIL,
    PII_PATTERNS.PHONE,
    PII_PATTERNS.CREDIT_CARD,
  ];

  return createGuardrailTransform<TOOLS>([], {
    onViolation: 'redact', // No guardrails, just pattern redaction
    redactPatterns: patterns,
    redactionText: options.redactionText || '[REDACTED]',
    requestContext: options.requestContext,
  });
}

/**
 * Creates a simple content filter transform that stops on specific keywords
 */
export function createContentFilterTransform<
  TOOLS extends ToolSet = ToolSet,
>(options: {
  blockedKeywords: string[];
  caseSensitive?: boolean;
  onBlocked?: (keyword: string, text: string) => void;
  requestContext?: RequestContext;
}): StreamTextTransform<TOOLS> {
  const { blockedKeywords, caseSensitive = false, onBlocked } = options;

  return ({ stopStream }) => {
    let accumulatedText = '';
    let stopped = false;

    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(chunk, controller) {
        if (stopped) return;

        if (chunk.type === 'text-delta') {
          accumulatedText += chunk.text;

          const textToCheck = caseSensitive
            ? accumulatedText
            : accumulatedText.toLowerCase();

          for (const keyword of blockedKeywords) {
            const keywordToCheck = caseSensitive
              ? keyword
              : keyword.toLowerCase();

            if (textToCheck.includes(keywordToCheck)) {
              stopped = true;
              stopStream();

              if (onBlocked) {
                onBlocked(keyword, accumulatedText);
              }

              controller.enqueue({
                ...chunk,
                text: `\n[Content blocked: prohibited content detected]`,
              });

              for (const part of guardrailStopParts<TOOLS>(chunk.id)) {
                controller.enqueue(part);
              }

              return;
            }
          }
        }

        controller.enqueue(chunk);
      },
    });
  };
}
