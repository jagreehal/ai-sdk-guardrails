/**
 * Default retry helpers for guardrails.
 *
 * Provides the `buildRetryParams` used when none is configured: it calls
 * `getRetryInstruction()` on blocked guardrails and appends the instructions
 * as user messages.
 */

import type { LanguageModelV4CallOptions as LMCallOptions } from '@ai-sdk/provider';
import type { GuardrailMetadata } from '../enhanced-types';
import type {
  GuardrailExecutionSummary,
  GuardrailResult,
  OutputGuardrail,
  RetryInstruction,
  RetryInstructionContext,
} from '../types';

const SEVERITY_ORDER = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
} as const satisfies Record<NonNullable<GuardrailResult['severity']>, number>;

/**
 * Find the guardrail object that produced a given result by matching names.
 */
function findGuardrailForResult<M>(
  result: GuardrailResult<M>,
  guardrails: OutputGuardrail<M>[],
): OutputGuardrail<M> | undefined {
  const name = result.context?.guardrailName ?? result.info?.guardrailName;

  return guardrails.find((g) => g.name === name);
}

/** True for any object (including cross-realm ones); false for a string. */
function isInstructionObject(
  instruction: RetryInstruction | string,
): instruction is RetryInstruction {
  return Object(instruction) === instruction;
}

/**
 * Get retry instruction from a guardrail result.
 * Tries the guardrail's getRetryInstruction first, falls back to using the message.
 */
function getInstructionFromResult<M>(
  result: GuardrailResult<M>,
  guardrail: OutputGuardrail<M> | undefined,
  context: Omit<RetryInstructionContext<M>, 'result'>,
): RetryInstruction | undefined {
  if (guardrail?.getRetryInstruction) {
    const instruction = guardrail.getRetryInstruction({ ...context, result });

    if (instruction === undefined || instruction === null) return undefined;

    return isInstructionObject(instruction)
      ? instruction
      : { message: instruction };
  }

  if (result.message) {
    const suggestionPart = result.suggestion ? `. ${result.suggestion}` : '';

    return {
      message: `Please try again. The previous response was blocked: ${result.message}${suggestionPart}`,
    };
  }

  return undefined;
}

/**
 * Select which blocked results to use based on strategy.
 */
function selectBlockedResults<M>(
  summary: GuardrailExecutionSummary<M>,
  strategy: 'first' | 'all' | 'highest-severity',
): GuardrailResult<M>[] {
  const { blockedResults } = summary;

  if (blockedResults.length === 0) return [];

  switch (strategy) {
    case 'first': {
      return [blockedResults[0]!];
    }

    case 'all': {
      return blockedResults;
    }

    default: {
      const sorted = [...blockedResults].toSorted((a, b) => {
        const severityA = SEVERITY_ORDER[a.severity ?? 'medium'] ?? 2;
        const severityB = SEVERITY_ORDER[b.severity ?? 'medium'] ?? 2;

        return severityB - severityA;
      });

      return [sorted[0]!];
    }
  }
}

/**
 * Combine multiple retry instructions into a single message.
 */
function combineInstructions(
  instructions: RetryInstruction[],
): RetryInstruction {
  if (instructions.length === 0) {
    return { message: 'Please try again with a different approach.' };
  }

  if (instructions.length === 1) {
    return instructions[0]!;
  }

  const combinedMessage = instructions
    .map((inst, i) => `${i + 1}. ${inst.message}`)
    .join('\n');

  const tempAdjustments = instructions.flatMap((i) =>
    i.temperatureAdjustment === undefined ? [] : [i.temperatureAdjustment],
  );

  const avgTempAdjustment =
    tempAdjustments.length > 0
      ? tempAdjustments.reduce((a, b) => a + b, 0) / tempAdjustments.length
      : undefined;

  return {
    message: `Please address the following issues:\n${combinedMessage}`,
    temperatureAdjustment: avgTempAdjustment,
    context: { combinedFrom: instructions.length },
  };
}

/**
 * Options for creating the default buildRetryParams function.
 */
export interface DefaultBuildRetryParamsOptions<M = GuardrailMetadata> {
  /** The output guardrails to search for getRetryInstruction */
  outputGuardrails: OutputGuardrail<M>[];
  /** Strategy for handling multiple blocked guardrails */
  multipleBlockedStrategy?: 'first' | 'all' | 'highest-severity';
  /** Current retry attempt (1-based) */
  attempt: number;
  /** Maximum retry attempts configured */
  maxRetries: number;
}

/**
 * Creates the default buildRetryParams function.
 *
 * This function is used when users don't provide their own `buildRetryParams`.
 * It works by:
 * 1. Finding which guardrail(s) blocked based on the configured strategy
 * 2. Calling their `getRetryInstruction()` method if available
 * 3. Appending the instruction as a user message to the prompt
 * 4. Optionally adjusting temperature based on guardrail suggestions
 *
 * @example
 * ```typescript
 * const buildRetryParams = createDefaultBuildRetryParams({
 *   outputGuardrails: [expectedToolUse({ tools: 'calculator' })],
 *   multipleBlockedStrategy: 'highest-severity',
 *   attempt: 1,
 *   maxRetries: 2,
 * });
 *
 * const nextParams = buildRetryParams({
 *   summary: executionSummary,
 *   originalParams: params,
 *   lastParams: params,
 *   lastResult: result,
 * });
 * ```
 */
export function createDefaultBuildRetryParams<M = GuardrailMetadata>(
  options: DefaultBuildRetryParamsOptions<M>,
): (args: {
  summary: GuardrailExecutionSummary<M>;
  originalParams: LMCallOptions;
  lastParams: LMCallOptions;
  lastResult: unknown;
}) => LMCallOptions {
  const {
    outputGuardrails,
    multipleBlockedStrategy = 'highest-severity',
    attempt,
    maxRetries,
  } = options;

  return ({ summary, originalParams, lastParams }) => {
    const selectedResults = selectBlockedResults(
      summary,
      multipleBlockedStrategy,
    );

    const instructionContext = { attempt, maxRetries };
    const instructions: RetryInstruction[] = [];

    for (const result of selectedResults) {
      const guardrail = findGuardrailForResult(result, outputGuardrails);

      const instruction = getInstructionFromResult(
        result,
        guardrail,
        instructionContext,
      );

      if (instruction) {
        instructions.push(instruction);
      }
    }

    const finalInstruction = combineInstructions(instructions);

    let newTemperature = lastParams.temperature ?? 0.7;

    if (finalInstruction.temperatureAdjustment !== undefined) {
      newTemperature = Math.max(
        0,
        Math.min(1, newTemperature + finalInstruction.temperatureAdjustment),
      );
    }

    const existingPrompt = Array.isArray(lastParams.prompt)
      ? lastParams.prompt
      : Array.isArray(originalParams.prompt)
        ? originalParams.prompt
        : [];

    return {
      ...lastParams,
      temperature: newTemperature,
      prompt: [
        ...existingPrompt,
        {
          role: 'user' as const,
          content: [{ type: 'text' as const, text: finalInstruction.message }],
        },
      ],
    };
  };
}

/** Effective retry settings after merging global and guardrail-level config. */
export interface ResolvedRetryConfig {
  maxRetries: number;
  backoffMs: number | ((attempt: number) => number);
}

/** Milliseconds to wait before retry `attempt`. */
export function retryDelayMs(
  backoffMs: ResolvedRetryConfig['backoffMs'],
  attempt: number,
): number {
  return backoffMs instanceof Function ? backoffMs(attempt) : backoffMs;
}

/**
 * Resolves the effective retry configuration by merging guardrail-level
 * and withGuardrails-level configs. withGuardrails-level takes precedence.
 */
export function resolveRetryConfig<M>(
  globalRetry:
    | {
        maxRetries?: number;
        backoffMs?: number | ((attempt: number) => number);
      }
    | undefined,
  blockedGuardrails: OutputGuardrail<M>[],
): ResolvedRetryConfig {
  let maxRetries = globalRetry?.maxRetries ?? 0;

  let backoffMs: number | ((attempt: number) => number) =
    globalRetry?.backoffMs ?? 0;

  // Guardrail-level config applies only when no global maxRetries is set.
  if (maxRetries === 0) {
    for (const guardrail of blockedGuardrails) {
      if (guardrail.retry?.maxRetries !== undefined) {
        maxRetries = Math.max(maxRetries, guardrail.retry.maxRetries);
      }

      if (guardrail.retry?.backoffMs !== undefined && backoffMs === 0) {
        backoffMs = guardrail.retry.backoffMs;
      }
    }
  }

  return { maxRetries, backoffMs };
}
