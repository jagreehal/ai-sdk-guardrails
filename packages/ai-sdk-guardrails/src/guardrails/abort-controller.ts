import type { GuardrailExecutionSummary } from '../types';

/**
 * Custom error class for guardrail-triggered aborts
 * Extends Error to provide violation context when aborting
 */
export class GuardrailViolationAbort extends Error {
  public readonly summary: GuardrailExecutionSummary;

  constructor(summary: GuardrailExecutionSummary) {
    const messages = summary.blockedResults
      .map((r) => r.message)
      .filter(Boolean)
      .join(', ');
    super(`Guardrail violation: ${messages}`);
    this.name = 'GuardrailViolationAbort';
    this.summary = summary;
  }
}

/**
 * Creates an AbortController that can be triggered by guardrail violations
 *
 * This provides a clean, standard way to cancel AI SDK operations when
 * guardrails detect violations. The AbortSignal can be passed to any
 * AI SDK function that supports cancellation.
 *
 * @example
 * ```typescript
 * const { signal, abortOnViolation } = createGuardrailAbortController();
 *
 * const guardedModel = withGuardrails(model, {
 *   outputGuardrails: [piiDetector()],
 *   onOutputBlocked: abortOnViolation('critical'),
 * });
 *
 * const result = await streamText({
 *   model: guardedModel,
 *   prompt: '...',
 *   abortSignal: signal, // Cancels on critical violations
 * });
 * ```
 *
 * @returns Object with AbortController signal and helper functions
 */
export function createGuardrailAbortController() {
  const controller = new AbortController();

  return {
    /**
     * The AbortSignal that can be passed to AI SDK functions
     */
    signal: controller.signal,

    /**
     * Creates a callback that aborts on violations of specified severity or higher
     *
     * @param minSeverity - Minimum severity to trigger abort (default: 'critical')
     * @returns Callback function for use with onInputBlocked/onOutputBlocked
     *
     * @example
     * ```typescript
     * const { signal, abortOnViolation } = createGuardrailAbortController();
     *
     * withGuardrails(model, {
     *   outputGuardrails: [toxicityFilter()],
     *   onOutputBlocked: abortOnViolation('high'), // Abort on high or critical
     * });
     * ```
     */
    abortOnViolation: (
      minSeverity: 'low' | 'medium' | 'high' | 'critical' = 'critical',
    ) => {
      const severityOrder = { low: 1, medium: 2, high: 3, critical: 4 };
      const minLevel = severityOrder[minSeverity];

      return (summary: GuardrailExecutionSummary) => {
        const hasViolation = summary.blockedResults.some((result) => {
          const resultSeverity = result.severity ?? 'medium';
          return severityOrder[resultSeverity] >= minLevel;
        });

        if (hasViolation) {
          controller.abort(new GuardrailViolationAbort(summary));
        }
      };
    },

    /**
     * Creates a callback that aborts based on custom condition
     *
     * @param condition - Function that returns true to trigger abort
     * @returns Callback function for use with onInputBlocked/onOutputBlocked
     *
     * @example
     * ```typescript
     * const { signal, abortOnCondition } = createGuardrailAbortController();
     *
     * withGuardrails(model, {
     *   outputGuardrails: [qualityCheck()],
     *   onOutputBlocked: abortOnCondition(
     *     (summary) => summary.blockedResults.length > 2
     *   ),
     * });
     * ```
     */
    abortOnCondition: (
      condition: (summary: GuardrailExecutionSummary) => boolean,
    ) => {
      return (summary: GuardrailExecutionSummary) => {
        if (condition(summary)) {
          controller.abort(new GuardrailViolationAbort(summary));
        }
      };
    },

    /**
     * Manually abort with custom reason
     *
     * @param reason - Custom abort reason
     *
     * @example
     * ```typescript
     * const { abort } = createGuardrailAbortController();
     * abort('User requested cancellation');
     * ```
     */
    abort: (reason?: string) => {
      controller.abort(reason);
    },
  };
}
