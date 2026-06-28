/**
 * Utility functions for creating common guardrail-based stop conditions
 * Similar to AI SDK's stepCountIs, toolCallCountIs, etc.
 */

import type { GuardrailExecutionSummary } from '../types';

export type GuardrailViolation =
  | {
      step: number; // For agent violations
      summary: GuardrailExecutionSummary;
    }
  | {
      chunkIndex: number; // For streaming violations
      summary: GuardrailExecutionSummary;
    };

/**
 * Creates a stop condition that triggers when a critical severity violation occurs
 *
 * Note: Only explicit 'critical' severity triggers this condition. Undefined severity
 * defaults to 'medium' and will not trigger.
 *
 * @example
 * ```typescript
 * const agent = new ToolLoopAgent({
 *   ...agentGuardrails({ model,
 *     outputGuardrails: [piiGuardrail],
 *     stopOnGuardrailViolation: hasCriticalViolation(), // guardrail violations
 *     stopWhen: stepCountIs(10), // composed with the guardrail stop condition
 *   }),
 *   tools: { search: searchTool },
 * });
 * ```
 */
export function hasCriticalViolation() {
  return (violations: GuardrailViolation[]): boolean => {
    return violations.some((v) =>
      v.summary.blockedResults.some(
        (r) => (r.severity ?? 'medium') === 'critical',
      ),
    );
  };
}

/**
 * Creates a stop condition that triggers after N guardrail violations
 *
 * @param count - Number of violations before stopping
 *
 * @example
 * ```typescript
 * const agent = new ToolLoopAgent({
 *   ...agentGuardrails({ model,
 *     outputGuardrails: [qualityGuardrail],
 *     stopOnGuardrailViolation: isViolationCount(3),
 *   }),
 *   tools: { search: searchTool },
 * });
 * ```
 */
export function isViolationCount(count: number) {
  return (violations: GuardrailViolation[]): boolean => {
    return violations.length >= count;
  };
}

/**
 * Creates a stop condition that triggers when violations of a specific severity occur
 *
 * Note: Guardrail severity defaults to 'medium' when not specified. This helper
 * treats undefined severity as 'medium' to match the documented behavior.
 *
 * @param severity - The severity level to check for
 * @param minCount - Minimum number of violations of this severity (default: 1)
 *
 * @example
 * ```typescript
 * const agent = new ToolLoopAgent({
 *   ...agentGuardrails({ model,
 *     outputGuardrails: [securityGuardrail],
 *     stopOnGuardrailViolation: hasViolationSeverity('high', 2),
 *   }),
 *   tools: { search: searchTool },
 * });
 * ```
 */
export function hasViolationSeverity(
  severity: 'low' | 'medium' | 'high' | 'critical',
  minCount: number = 1,
) {
  return (violations: GuardrailViolation[]): boolean => {
    const matchingViolations = violations.filter((v) =>
      v.summary.blockedResults.some(
        (r) => (r.severity ?? 'medium') === severity,
      ),
    );
    return matchingViolations.length >= minCount;
  };
}

/**
 * Creates a stop condition that triggers when a specific guardrail is violated
 *
 * @param guardrailName - The name of the guardrail to watch for
 * @param minCount - Minimum number of violations of this guardrail (default: 1)
 *
 * @example
 * ```typescript
 * const agent = new ToolLoopAgent({
 *   ...agentGuardrails({ model,
 *     outputGuardrails: [piiGuardrail, qualityGuardrail],
 *     stopOnGuardrailViolation: hasGuardrailViolation('pii-detection'),
 *   }),
 *   tools: { search: searchTool },
 * });
 * ```
 */
export function hasGuardrailViolation(
  guardrailName: string,
  minCount: number = 1,
) {
  return (violations: GuardrailViolation[]): boolean => {
    const matchingViolations = violations.filter((v) =>
      v.summary.blockedResults.some(
        (r) => r.context?.guardrailName === guardrailName,
      ),
    );
    return matchingViolations.length >= minCount;
  };
}

/**
 * Creates a stop condition that triggers when violations occur in consecutive steps
 *
 * @param consecutiveCount - Number of consecutive violations before stopping
 *
 * @example
 * ```typescript
 * const agent = new ToolLoopAgent({
 *   ...agentGuardrails({ model,
 *     outputGuardrails: [qualityGuardrail],
 *     stopOnGuardrailViolation: hasConsecutiveViolations(2),
 *   }),
 *   tools: { search: searchTool },
 * });
 * ```
 */
export function hasConsecutiveViolations(consecutiveCount: number) {
  return (violations: GuardrailViolation[]): boolean => {
    if (violations.length < consecutiveCount) return false;

    // Check if the last N violations are consecutive steps/chunks
    const recentViolations = violations.slice(-consecutiveCount);
    const indices = recentViolations.map((v) =>
      'step' in v ? v.step : v.chunkIndex,
    );

    for (let i = 1; i < indices.length; i++) {
      if (indices[i]! - indices[i - 1]! !== 1) {
        return false;
      }
    }

    return true;
  };
}

/**
 * Combines multiple stop conditions with OR logic
 *
 * @param conditions - Array of stop condition functions
 *
 * @example
 * ```typescript
 * const agent = new ToolLoopAgent({
 *   ...agentGuardrails({ model,
 *     outputGuardrails: [piiGuardrail, qualityGuardrail],
 *     stopOnGuardrailViolation: anyOf([
 *       hasCriticalViolation(),
 *       isViolationCount(5),
 *       hasConsecutiveViolations(3),
 *     ]),
 *   }),
 *   tools: { search: searchTool },
 * });
 * ```
 */
export function anyOf(
  conditions: Array<(violations: GuardrailViolation[]) => boolean>,
) {
  return (violations: GuardrailViolation[]): boolean => {
    return conditions.some((condition) => condition(violations));
  };
}

/**
 * Combines multiple stop conditions with AND logic
 *
 * @param conditions - Array of stop condition functions
 *
 * @example
 * ```typescript
 * const agent = new ToolLoopAgent({
 *   ...agentGuardrails({ model,
 *     outputGuardrails: [piiGuardrail, qualityGuardrail],
 *     stopOnGuardrailViolation: allOf([
 *       isViolationCount(3),
 *       hasViolationSeverity('high'),
 *     ]),
 *   }),
 *   tools: { search: searchTool },
 * });
 * ```
 */
export function allOf(
  conditions: Array<(violations: GuardrailViolation[]) => boolean>,
) {
  return (violations: GuardrailViolation[]): boolean => {
    return conditions.every((condition) => condition(violations));
  };
}

/**
 * Creates a stop condition with a custom predicate
 * Useful for complex logic not covered by other helpers
 *
 * @param predicate - Custom function that receives violations and returns boolean
 *
 * @example
 * ```typescript
 * const agent = new ToolLoopAgent({
 *   ...agentGuardrails({ model,
 *     outputGuardrails: [piiGuardrail, qualityGuardrail],
 *     stopOnGuardrailViolation: custom((violations) => {
 *       const avgSeverity = calculateAverageSeverity(violations);
 *       return avgSeverity > 0.7;
 *     }),
 *   }),
 *   tools: { search: searchTool },
 * });
 * ```
 */
export function custom(
  predicate: (violations: GuardrailViolation[]) => boolean,
) {
  return predicate;
}
