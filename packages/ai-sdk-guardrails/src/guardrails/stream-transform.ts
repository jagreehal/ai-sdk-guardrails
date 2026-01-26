/**
 * Stream Transform Integration
 *
 * Creates stream transforms for use with AI SDK's experimental_transform.
 * Enables real-time content filtering, redaction, and modification during streaming.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable unicorn/switch-case-braces */
/* eslint-disable unicorn/no-useless-switch-case */
/* eslint-disable unicorn/prefer-ternary */
/* eslint-disable no-case-declarations */

import type { ToolSet } from 'ai';
import type {
  OutputGuardrail,
  GuardrailResult,
  RequestContext,
} from '../types';

/**
 * Stream part type (simplified for transform context)
 */
export interface StreamPart {
  type: string;
  id?: string;
  text?: string;
  delta?: string;
  textDelta?: string;
  [key: string]: unknown;
}

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
  chunk: StreamPart,
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
  onViolationDetected?: (violation: GuardrailResult, chunk: StreamPart) => void;
}

/**
 * AI SDK StreamTextTransform type
 */
export type StreamTextTransform<TOOLS extends ToolSet> = (options: {
  tools: TOOLS;
  stopStream: () => void;
}) => TransformStream<StreamPart, StreamPart>;

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

    return new TransformStream<StreamPart, StreamPart>({
      async transform(chunk, controller) {
        if (stopped) {
          return; // Don't process more chunks after stopping
        }

        // Extract text from chunk
        const chunkText = chunk.delta || chunk.textDelta || chunk.text || '';

        if (chunk.type === 'text-delta' || chunk.type === 'text') {
          accumulatedText += chunkText;
          chunkCount++;

          // Update context
          context.accumulatedText = accumulatedText;
          context.chunkCount = chunkCount;
          context.violations = violations;

          // Check if we should run guardrails this chunk
          const shouldCheck =
            accumulatedText.length >= minCharsBeforeCheck &&
            chunkCount % checkEveryNChunks === 0;

          if (shouldCheck && guardrails.length > 0) {
            // Run guardrails on accumulated text
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
                    result: { text: accumulatedText } as any,
                  },
                  accumulatedText,
                );

                if (result.tripwireTriggered) {
                  violations.push(result);
                  context.violations = violations;

                  if (onViolationDetected) {
                    onViolationDetected(result, chunk);
                  }

                  // Handle violation based on configured behavior
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
                      // Emit final message before stopping
                      controller.enqueue({
                        ...chunk,
                        type: 'text-delta',
                        delta: `\n[Stream stopped: ${handlerResult.reason || result.message}]`,
                      });
                      return;

                    case 'drop':
                      // Don't enqueue this chunk
                      return;

                    case 'replace':
                      // Replace chunk content
                      controller.enqueue({
                        ...chunk,
                        delta: handlerResult.replacement || replacementText,
                        textDelta: handlerResult.replacement || replacementText,
                      });
                      return;

                    case 'pass':
                    default:
                      // Continue with original chunk
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
              controller.enqueue({
                ...chunk,
                delta: redactedText,
                textDelta: redactedText,
              });
              return;
            }
          }
        }

        // Pass through chunk unchanged
        controller.enqueue(chunk);
      },

      flush(controller) {
        // Final cleanup if needed
        if (stopped && violations.length > 0) {
          // Already handled in transform
        }
      },
    });
  };
}

/**
 * Handles a violation based on configured behavior
 */
async function handleViolation(
  chunk: StreamPart,
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

  if (typeof onViolation === 'function') {
    return onViolation(chunk, violation, context);
  }

  switch (onViolation) {
    case 'stop':
      return { action: 'stop', reason: violation.message };

    case 'drop':
      return { action: 'drop', reason: violation.message };

    case 'redact':
      const chunkText = chunk.delta || chunk.textDelta || '';
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
    if (typeof pattern === 'string') {
      result = result.split(pattern).join(redactionText);
    } else {
      result = result.replace(pattern, redactionText);
    }
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
  const {
    blockedKeywords,
    caseSensitive = false,
    onBlocked,
    requestContext,
  } = options;

  return ({ stopStream }) => {
    let accumulatedText = '';
    let stopped = false;

    return new TransformStream<StreamPart, StreamPart>({
      transform(chunk, controller) {
        if (stopped) return;

        const chunkText = chunk.delta || chunk.textDelta || chunk.text || '';

        if (chunk.type === 'text-delta' || chunk.type === 'text') {
          accumulatedText += chunkText;

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
                type: 'text-delta',
                delta: `\n[Content blocked: prohibited content detected]`,
              });
              return;
            }
          }
        }

        controller.enqueue(chunk);
      },
    });
  };
}
