import type { GuardrailViolation } from './stop-conditions';
import type { LanguageModelV2 } from '../types';

/**
 * Options for guardrail-aware prepareStep
 */
export interface GuardrailPrepareStepOptions {
  /**
   * How many recent steps to consider for violations
   * @default 2
   */
  lookback?: number;

  /**
   * Temperature to set when violations detected
   * @default 0.3
   */
  temperatureReduction?: number;

  /**
   * Whether to stop execution on critical violations
   * @default false
   */
  stopOnCritical?: boolean;

  /**
   * Custom system message to add on violations
   */
  warningMessage?: string;
}

/**
 * Creates a prepareStep function that adjusts generation based on guardrail violations
 *
 * This enables adaptive behavior in multi-step agent execution:
 * - Reduces temperature after violations (more conservative)
 * - Adds warning messages to system prompt
 * - Can stop execution entirely on critical violations
 *
 * @param violations - Array of guardrail violations from agent execution
 * @param options - Configuration options
 * @returns prepareStep function for use with streamText/Agent
 *
 * @example
 * ```typescript
 * import { streamText } from 'ai';
 * import { createGuardrailPrepareStep } from 'ai-sdk-guardrails';
 *
 * const violations: GuardrailViolation[] = [];
 *
 * const result = streamText({
 *   model,
 *   prompt: 'Multi-step task',
 *   tools: { search: searchTool },
 *   prepareStep: createGuardrailPrepareStep(violations, {
 *     temperatureReduction: 0.2,
 *     stopOnCritical: true,
 *   }),
 * });
 * ```
 *
 * @example With agent guardrails
 * ```typescript
 * const violations: GuardrailViolation[] = [];
 *
 * const agent = withAgentGuardrails({
 *   model,
 *   tools: { search: searchTool },
 *   prepareStep: createGuardrailPrepareStep(violations),
 * }, {
 *   outputGuardrails: [toxicityFilter()],
 *   onOutputBlocked: (summary, context, step) => {
 *     violations.push({ step, summary });
 *   },
 * });
 * ```
 */
export function createGuardrailPrepareStep(
  violations: GuardrailViolation[],
  options: GuardrailPrepareStepOptions = {},
): (args: {
  steps: Array<{ content: unknown }>;
  stepNumber: number;
  messages: unknown[];
  model: LanguageModelV2;
}) =>
  | {
      temperature?: number;
      system?: string;
      stopWhen?: () => boolean;
    }
  | undefined {
  const {
    lookback = 2,
    temperatureReduction = 0.3,
    stopOnCritical = false,
    warningMessage = 'Previous responses violated guidelines. Please be more careful and follow all safety guidelines.',
  } = options;

  return ({ stepNumber }) => {
    // Filter violations within lookback window
    const recentViolations = violations.filter((v) => {
      if ('step' in v) {
        return v.step >= stepNumber - lookback && v.step < stepNumber;
      }
      return false; // Skip chunkIndex violations for prepareStep
    });

    if (recentViolations.length === 0) {
      return;
    }

    // Check for critical violations
    const hasCritical = recentViolations.some((v) =>
      v.summary.blockedResults.some((r) => r.severity === 'critical'),
    );

    const result: {
      temperature?: number;
      system?: string;
      stopWhen?: () => boolean;
    } = {
      temperature: temperatureReduction,
      system: warningMessage,
    };

    // Stop on critical if configured
    if (hasCritical && stopOnCritical) {
      result.stopWhen = () => true;
    }

    return result;
  };
}

/**
 * Options for adaptive prepareStep
 */
export interface AdaptivePrepareStepOptions {
  /**
   * Violation history to track
   */
  violations: GuardrailViolation[];

  /**
   * Custom strategy function to apply on violations
   * If not provided, uses default temperature reduction
   */
  strategy?: (violations: GuardrailViolation[]) => {
    temperature?: number;
    topP?: number;
    topK?: number;
    system?: string;
    stopWhen?: () => boolean;
  };

  /**
   * Callback when violations are detected
   */
  onViolationDetected?: (violations: GuardrailViolation[]) => void;

  /**
   * Number of violations before escalating to stop
   * @default 5
   */
  escalateAfter?: number;

  /**
   * Lookback window for recent violations
   * @default 3
   */
  lookback?: number;
}

/**
 * Creates an adaptive prepareStep that escalates restrictions based on violation patterns
 *
 * More sophisticated than createGuardrailPrepareStep - tracks violation trends
 * and escalates restrictions progressively.
 *
 * @param options - Configuration options
 * @returns prepareStep function for use with streamText/Agent
 *
 * @example
 * ```typescript
 * import { Experimental_Agent as Agent } from 'ai';
 * import { createAdaptivePrepareStep } from 'ai-sdk-guardrails';
 *
 * const violations: GuardrailViolation[] = [];
 *
 * const agent = new Agent({
 *   model,
 *   tools: { search: searchTool },
 *   prepareStep: createAdaptivePrepareStep({
 *     violations,
 *     escalateAfter: 3,
 *     strategy: (violations) => {
 *       const count = violations.length;
 *       return {
 *         temperature: Math.max(0.1, 0.7 - count * 0.1),
 *         system: `You have ${count} violations. Be extremely careful.`,
 *       };
 *     },
 *   }),
 * });
 * ```
 */
export function createAdaptivePrepareStep(
  options: AdaptivePrepareStepOptions,
): (args: {
  steps: Array<{ content: unknown }>;
  stepNumber: number;
  messages: unknown[];
  model: LanguageModelV2;
}) =>
  | {
      temperature?: number;
      topP?: number;
      topK?: number;
      system?: string;
      stopWhen?: () => boolean;
    }
  | undefined {
  const {
    violations,
    strategy,
    onViolationDetected,
    escalateAfter = 5,
    lookback = 3,
  } = options;

  return ({ stepNumber }) => {
    // Filter recent violations
    const recentViolations = violations.filter((v) => {
      if ('step' in v) {
        return v.step >= stepNumber - lookback && v.step < stepNumber;
      }
      return false; // Skip chunkIndex violations for prepareStep
    });

    if (recentViolations.length === 0) {
      return;
    }

    // Notify callback
    onViolationDetected?.(recentViolations);

    // Apply custom strategy if provided
    if (strategy) {
      return strategy(recentViolations);
    }

    // Default strategy: progressive temperature reduction
    const violationCount = recentViolations.length;
    const temperatureReduction = Math.max(0.1, 0.7 - violationCount * 0.15);

    const result: {
      temperature?: number;
      system?: string;
      stopWhen?: () => boolean;
    } = {
      temperature: temperatureReduction,
      system: `Warning: ${violationCount} guardrail violation(s) detected in recent steps. Please ensure responses comply with all safety guidelines.`,
    };

    // Escalate to stop if too many violations
    if (violationCount >= escalateAfter) {
      result.stopWhen = () => true;
      result.system += ' Execution will stop due to repeated violations.';
    }

    return result;
  };
}
