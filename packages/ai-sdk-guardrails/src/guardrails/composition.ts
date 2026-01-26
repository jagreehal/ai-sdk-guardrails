/**
 * Guardrail Composition DSL
 *
 * Provides utilities for composing guardrails with conditional logic,
 * parallel execution, fallbacks, and pipeline patterns.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable unicorn/no-array-reduce */
/* eslint-disable unicorn/numeric-separators-style */

import type {
  InputGuardrail,
  OutputGuardrail,
  GuardrailResult,
  NormalizedGuardrailContext,
  OutputGuardrailContext,
} from '../types';

// ============================================================================
// Composition Types
// ============================================================================

/**
 * A composable guardrail unit that can be used in pipelines
 */
export type ComposableGuardrail<T extends 'input' | 'output'> =
  T extends 'input' ? InputGuardrail : OutputGuardrail;

/**
 * Condition function for conditional guardrails
 */
export type GuardrailCondition<T extends 'input' | 'output'> = T extends 'input'
  ? (context: NormalizedGuardrailContext) => boolean | Promise<boolean>
  : (context: OutputGuardrailContext) => boolean | Promise<boolean>;

/**
 * Pipeline execution result
 */
export interface PipelineResult<M = Record<string, unknown>> {
  /** Final result from the pipeline */
  result: GuardrailResult<M>;
  /** All intermediate results */
  intermediateResults: GuardrailResult<M>[];
  /** Whether the pipeline short-circuited */
  shortCircuited: boolean;
  /** Execution time in ms */
  executionTimeMs: number;
}

// ============================================================================
// Core Composition Functions
// ============================================================================

/**
 * Creates a conditional guardrail that only executes when a condition is met.
 *
 * @example
 * ```typescript
 * // Only run expensive check on long prompts
 * const conditionalGuardrail = when(
 *   (ctx) => ctx.prompt.length > 1000,
 *   promptInjectionDetector()
 * );
 * ```
 */
export function when<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  condition: (
    context: NormalizedGuardrailContext,
  ) => boolean | Promise<boolean>,
  guardrail: InputGuardrail<M>,
): InputGuardrail<M>;

export function when<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  condition: (context: OutputGuardrailContext) => boolean | Promise<boolean>,
  guardrail: OutputGuardrail<M>,
): OutputGuardrail<M>;

export function when<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  condition: (context: any) => boolean | Promise<boolean>,
  guardrail: InputGuardrail<M> | OutputGuardrail<M>,
): InputGuardrail<M> | OutputGuardrail<M> {
  return {
    ...guardrail,
    name: `when(${guardrail.name})`,
    execute: async (context: any, ...rest: any[]) => {
      const shouldExecute = await condition(context);

      if (!shouldExecute) {
        return {
          tripwireTriggered: false,
          message: 'Condition not met, skipped',
        };
      }

      return (guardrail as any).execute(context, ...rest);
    },
  } as any;
}

/**
 * Creates a guardrail that runs only when the previous guardrail passed.
 *
 * @example
 * ```typescript
 * // Run toxicity check only if length check passes
 * const chainedGuardrail = after(lengthCheck, toxicityFilter);
 * ```
 */
export function after<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  prerequisite: InputGuardrail<M>,
  guardrail: InputGuardrail<M>,
): InputGuardrail<M>;

export function after<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  prerequisite: OutputGuardrail<M>,
  guardrail: OutputGuardrail<M>,
): OutputGuardrail<M>;

export function after<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  prerequisite: InputGuardrail<M> | OutputGuardrail<M>,
  guardrail: InputGuardrail<M> | OutputGuardrail<M>,
): InputGuardrail<M> | OutputGuardrail<M> {
  return {
    ...guardrail,
    name: `after(${prerequisite.name}, ${guardrail.name})`,
    execute: async (context: any, ...rest: any[]) => {
      const prereqResult = await (prerequisite as any).execute(
        context,
        ...rest,
      );

      if (prereqResult.tripwireTriggered) {
        return prereqResult; // Short-circuit on prerequisite failure
      }

      return (guardrail as any).execute(context, ...rest);
    },
  } as any;
}

/**
 * Creates a guardrail with a fallback that runs if the primary fails or times out.
 *
 * @example
 * ```typescript
 * // Use AI moderation, fall back to keyword filter if it fails
 * const robustGuardrail = withFallback(
 *   aiContentModerator(),
 *   keywordFilter(),
 *   { timeoutMs: 5000 }
 * );
 * ```
 */
export function withFallback<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  primary: InputGuardrail<M>,
  fallback: InputGuardrail<M>,
  options?: { timeoutMs?: number },
): InputGuardrail<M>;

export function withFallback<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  primary: OutputGuardrail<M>,
  fallback: OutputGuardrail<M>,
  options?: { timeoutMs?: number },
): OutputGuardrail<M>;

export function withFallback<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  primary: InputGuardrail<M> | OutputGuardrail<M>,
  fallback: InputGuardrail<M> | OutputGuardrail<M>,
  options: { timeoutMs?: number } = {},
): InputGuardrail<M> | OutputGuardrail<M> {
  const { timeoutMs = 30000 } = options;

  return {
    ...primary,
    name: `withFallback(${primary.name}, ${fallback.name})`,
    execute: async (context: any, ...rest: any[]) => {
      try {
        const result = await Promise.race([
          (primary as any).execute(context, ...rest),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), timeoutMs),
          ),
        ]);
        return result;
      } catch (error) {
        // Primary failed or timed out, use fallback
        console.warn(
          `Primary guardrail "${primary.name}" failed, using fallback "${fallback.name}":`,
          error,
        );
        return (fallback as any).execute(context, ...rest);
      }
    },
  } as any;
}

/**
 * Creates a guardrail that runs multiple guardrails in parallel and combines results.
 *
 * @example
 * ```typescript
 * // Run PII and toxicity checks in parallel
 * const parallelGuardrail = parallel([
 *   piiDetector(),
 *   toxicityFilter(),
 * ], { mode: 'any' });  // Block if any fails
 * ```
 */
export function parallel<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  guardrails: InputGuardrail<M>[],
  options?: {
    /** 'any' blocks if any guardrail triggers, 'all' blocks only if all trigger */
    mode?: 'any' | 'all';
    /** Timeout for all guardrails */
    timeoutMs?: number;
  },
): InputGuardrail<M>;

export function parallel<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  guardrails: OutputGuardrail<M>[],
  options?: {
    mode?: 'any' | 'all';
    timeoutMs?: number;
  },
): OutputGuardrail<M>;

export function parallel<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  guardrails: Array<InputGuardrail<M> | OutputGuardrail<M>>,
  options: { mode?: 'any' | 'all'; timeoutMs?: number } = {},
): InputGuardrail<M> | OutputGuardrail<M> {
  const { mode = 'any', timeoutMs = 30000 } = options;
  const names = guardrails.map((g) => g.name).join(', ');

  return {
    name: `parallel(${names})`,
    description: `Parallel execution of: ${names}`,
    execute: async (context: any, ...rest: any[]) => {
      const promises = guardrails.map(async (g) => {
        try {
          return await Promise.race([
            (g as any).execute(context, ...rest),
            new Promise<GuardrailResult<M>>((_, reject) =>
              setTimeout(
                () => reject(new Error(`Timeout: ${g.name}`)),
                timeoutMs,
              ),
            ),
          ]);
        } catch (error) {
          return {
            tripwireTriggered: true,
            message: `Guardrail "${g.name}" failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            severity: 'high' as const,
            metadata: {
              error: String(error),
              guardrailName: g.name,
            } as unknown as M,
          };
        }
      });

      const results = await Promise.all(promises);
      const triggered = results.filter((r) => r.tripwireTriggered);

      if (mode === 'any' && triggered.length > 0) {
        // Return first triggered result with combined message
        const messages = triggered.map((r) => r.message).join('; ');
        return {
          ...triggered[0],
          message: messages,
          metadata: {
            ...triggered[0]?.metadata,
            allTriggered: triggered,
          } as M,
        };
      }

      if (mode === 'all' && triggered.length === results.length) {
        const messages = triggered.map((r) => r.message).join('; ');
        return {
          tripwireTriggered: true,
          message: `All guardrails triggered: ${messages}`,
          severity: triggered.reduce(
            (max, r) =>
              compareSeverity(r.severity, max) > 0 ? r.severity : max,
            'low' as const,
          ),
          metadata: { allTriggered: triggered } as unknown as M,
        };
      }

      return { tripwireTriggered: false };
    },
  } as any;
}

/**
 * Creates a guardrail pipeline that executes guardrails in sequence.
 *
 * @example
 * ```typescript
 * const pipeline = createPipeline([
 *   lengthLimit({ max: 10000 }),
 *   when((ctx) => ctx.prompt.length > 100, promptInjectionDetector()),
 *   parallel([piiDetector(), toxicityFilter()]),
 * ], {
 *   shortCircuitOnBlock: true,
 *   name: 'input-validation-pipeline'
 * });
 * ```
 */
export function createPipeline<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  guardrails: InputGuardrail<M>[],
  options?: {
    name?: string;
    shortCircuitOnBlock?: boolean;
  },
): InputGuardrail<M>;

export function createPipeline<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  guardrails: OutputGuardrail<M>[],
  options?: {
    name?: string;
    shortCircuitOnBlock?: boolean;
  },
): OutputGuardrail<M>;

export function createPipeline<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  guardrails: Array<InputGuardrail<M> | OutputGuardrail<M>>,
  options: { name?: string; shortCircuitOnBlock?: boolean } = {},
): InputGuardrail<M> | OutputGuardrail<M> {
  const { name = 'pipeline', shortCircuitOnBlock = true } = options;

  return {
    name,
    description: `Pipeline: ${guardrails.map((g) => g.name).join(' -> ')}`,
    execute: async (context: any, ...rest: any[]) => {
      const results: GuardrailResult<M>[] = [];

      for (const guardrail of guardrails) {
        const result = await (guardrail as any).execute(context, ...rest);
        results.push(result);

        if (result.tripwireTriggered && shortCircuitOnBlock) {
          return {
            ...result,
            metadata: {
              ...result.metadata,
              pipelineStage: guardrail.name,
              completedStages: results.length,
              totalStages: guardrails.length,
            } as M,
          };
        }
      }

      // All passed
      return {
        tripwireTriggered: false,
        metadata: {
          completedStages: results.length,
          totalStages: guardrails.length,
        } as unknown as M,
      };
    },
  } as any;
}

/**
 * Creates a guardrail that negates the result of another guardrail.
 * Useful for allowlist patterns.
 *
 * @example
 * ```typescript
 * // Only allow if NOT on blocklist
 * const allowlist = not(blockedUsersGuardrail());
 * ```
 */
export function not<
  M extends Record<string, unknown> = Record<string, unknown>,
>(guardrail: InputGuardrail<M>): InputGuardrail<M>;

export function not<
  M extends Record<string, unknown> = Record<string, unknown>,
>(guardrail: OutputGuardrail<M>): OutputGuardrail<M>;

export function not<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  guardrail: InputGuardrail<M> | OutputGuardrail<M>,
): InputGuardrail<M> | OutputGuardrail<M> {
  return {
    ...guardrail,
    name: `not(${guardrail.name})`,
    execute: async (context: any, ...rest: any[]) => {
      const result = await (guardrail as any).execute(context, ...rest);
      return {
        ...result,
        tripwireTriggered: !result.tripwireTriggered,
        message: result.tripwireTriggered
          ? 'Passed (negated)'
          : `Blocked (negated): ${result.message || 'Condition not met'}`,
      };
    },
  } as any;
}

/**
 * Creates a guardrail that retries on failure with configurable backoff.
 *
 * @example
 * ```typescript
 * const resilientGuardrail = withRetry(aiModerator(), {
 *   maxRetries: 3,
 *   backoffMs: (attempt) => attempt * 1000,
 * });
 * ```
 */
export function withRetry<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  guardrail: InputGuardrail<M>,
  options: {
    maxRetries?: number;
    backoffMs?: number | ((attempt: number) => number);
    retryOn?: (result: GuardrailResult<M>) => boolean;
  },
): InputGuardrail<M>;

export function withRetry<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  guardrail: OutputGuardrail<M>,
  options: {
    maxRetries?: number;
    backoffMs?: number | ((attempt: number) => number);
    retryOn?: (result: GuardrailResult<M>) => boolean;
  },
): OutputGuardrail<M>;

export function withRetry<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  guardrail: InputGuardrail<M> | OutputGuardrail<M>,
  options: {
    maxRetries?: number;
    backoffMs?: number | ((attempt: number) => number);
    retryOn?: (result: GuardrailResult<M>) => boolean;
  } = {},
): InputGuardrail<M> | OutputGuardrail<M> {
  const {
    maxRetries = 3,
    backoffMs = 1000,
    retryOn = (r) => r.severity === 'critical' && r.metadata?.error,
  } = options;

  return {
    ...guardrail,
    name: `withRetry(${guardrail.name})`,
    execute: async (context: any, ...rest: any[]) => {
      let lastResult: GuardrailResult<M> | null = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const result = await (guardrail as any).execute(context, ...rest);

          if (!result.tripwireTriggered || !retryOn(result)) {
            return result;
          }

          lastResult = result;
        } catch (error) {
          lastResult = {
            tripwireTriggered: true,
            message: `Execution failed: ${error instanceof Error ? error.message : 'Unknown'}`,
            severity: 'critical',
            metadata: { error: String(error), attempt } as unknown as M,
          };
        }

        if (attempt < maxRetries) {
          const delay =
            typeof backoffMs === 'function'
              ? backoffMs(attempt + 1)
              : backoffMs;
          await new Promise((r) => setTimeout(r, delay));
        }
      }

      return lastResult || { tripwireTriggered: false };
    },
  } as any;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Compares severity levels
 */
function compareSeverity(
  a: 'low' | 'medium' | 'high' | 'critical' | undefined,
  b: 'low' | 'medium' | 'high' | 'critical' | undefined,
): number {
  const order = { low: 1, medium: 2, high: 3, critical: 4 };
  return (order[a || 'medium'] || 2) - (order[b || 'medium'] || 2);
}

// ============================================================================
// Convenience Re-exports
// ============================================================================

/**
 * Creates an input guardrail pipeline
 */
export const inputPipeline = <
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  guardrails: InputGuardrail<M>[],
  options?: { name?: string; shortCircuitOnBlock?: boolean },
): InputGuardrail<M> => createPipeline(guardrails, options);

/**
 * Creates an output guardrail pipeline
 */
export const outputPipeline = <
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  guardrails: OutputGuardrail<M>[],
  options?: { name?: string; shortCircuitOnBlock?: boolean },
): OutputGuardrail<M> => createPipeline(guardrails, options);
