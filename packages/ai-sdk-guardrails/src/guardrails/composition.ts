/**
 * Guardrail Composition DSL
 *
 * Provides utilities for composing guardrails with conditional logic,
 * parallel execution, fallbacks, and pipeline patterns.
 */

import type {
  InputGuardrail,
  OutputGuardrail,
  GuardrailResult,
  NormalizedGuardrailContext,
  OutputGuardrailContext,
} from '../types';
import type { GuardrailMetadata } from '../enhanced-types';
import { SEVERITY_RANK, type Severity } from '../severity';

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
export interface PipelineResult<M = GuardrailMetadata> {
  /** Final result from the pipeline */
  result: GuardrailResult<M>;
  /** All intermediate results */
  intermediateResults: GuardrailResult<M>[];
  /** Whether the pipeline short-circuited */
  shortCircuited: boolean;
  /** Execution time in ms */
  executionTimeMs: number;
}

/** Arguments of either guardrail kind's `execute`, forwarded unchanged. */
type ExecuteArgs =
  | Parameters<InputGuardrail['execute']>
  | Parameters<OutputGuardrail['execute']>;

/**
 * The view of a guardrail the combinators work against. The public overloads
 * only accept guardrails of one kind per call, so forwarded args always match.
 */
interface ForwardingGuardrail<M> {
  name: string;
  // Method syntax makes this parameter check bivariant, so both guardrail
  // kinds' `execute` signatures fit the one forwarding signature.
  execute(
    ...args: ExecuteArgs
  ): Promise<GuardrailResult<M>> | GuardrailResult<M>;
}

/** Bookkeeping fields the combinators add to a result's metadata. */
interface CompositionMetadata<M> {
  error?: string;
  guardrailName?: string;
  attempt?: number;
  allTriggered?: GuardrailResult<M>[];
  pipelineStage?: string;
  completedStages?: number;
  totalStages?: number;
}

/** Report combinator bookkeeping under the caller's metadata type. */
function compositionMetadata<M extends GuardrailMetadata>(
  fields: CompositionMetadata<M>,
  base?: M,
): M {
  // SAFETY: the public signatures return GuardrailResult<M>; the combinator
  // keys are additive, and callers read them dynamically from the metadata bag.
  return { ...base, ...fields } as M;
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
export function when<M extends GuardrailMetadata>(
  condition: (
    context: NormalizedGuardrailContext,
  ) => boolean | Promise<boolean>,
  guardrail: InputGuardrail<M>,
): InputGuardrail<M>;

export function when<M extends GuardrailMetadata>(
  condition: (context: OutputGuardrailContext) => boolean | Promise<boolean>,
  guardrail: OutputGuardrail<M>,
): OutputGuardrail<M>;

export function when<M extends GuardrailMetadata>(
  condition: GuardrailCondition<'input'> | GuardrailCondition<'output'>,
  guardrail: ForwardingGuardrail<M>,
): InputGuardrail<M> | OutputGuardrail<M> {
  // SAFETY: the overloads pair an input condition with an input guardrail and
  // an output condition with an output guardrail, so the condition always
  // receives the context kind it was written for.
  const check = condition as (
    context: ExecuteArgs[0],
  ) => boolean | Promise<boolean>;

  return {
    ...guardrail,
    name: `when(${guardrail.name})`,
    execute: async (...args: ExecuteArgs) => {
      const shouldExecute = await check(args[0]);

      if (!shouldExecute) {
        return {
          tripwireTriggered: false,
          message: 'Condition not met, skipped',
        };
      }

      return guardrail.execute(...args);
    },
  };
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
export function after<M extends GuardrailMetadata>(
  prerequisite: InputGuardrail<M>,
  guardrail: InputGuardrail<M>,
): InputGuardrail<M>;

export function after<M extends GuardrailMetadata>(
  prerequisite: OutputGuardrail<M>,
  guardrail: OutputGuardrail<M>,
): OutputGuardrail<M>;

export function after<M extends GuardrailMetadata>(
  prerequisite: ForwardingGuardrail<M>,
  guardrail: ForwardingGuardrail<M>,
): InputGuardrail<M> | OutputGuardrail<M> {
  return {
    ...guardrail,
    name: `after(${prerequisite.name}, ${guardrail.name})`,
    execute: async (...args: ExecuteArgs) => {
      const prereqResult = await prerequisite.execute(...args);

      if (prereqResult.tripwireTriggered) {
        return prereqResult;
      }

      return guardrail.execute(...args);
    },
  };
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
export function withFallback<M extends GuardrailMetadata>(
  primary: InputGuardrail<M>,
  fallback: InputGuardrail<M>,
  options?: { timeoutMs?: number },
): InputGuardrail<M>;

export function withFallback<M extends GuardrailMetadata>(
  primary: OutputGuardrail<M>,
  fallback: OutputGuardrail<M>,
  options?: { timeoutMs?: number },
): OutputGuardrail<M>;

export function withFallback<M extends GuardrailMetadata>(
  primary: ForwardingGuardrail<M>,
  fallback: ForwardingGuardrail<M>,
  options: { timeoutMs?: number } = {},
): InputGuardrail<M> | OutputGuardrail<M> {
  const { timeoutMs = 30000 } = options;

  return {
    ...primary,
    name: `withFallback(${primary.name}, ${fallback.name})`,
    execute: async (...args: ExecuteArgs) => {
      try {
        const result = await Promise.race([
          primary.execute(...args),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), timeoutMs),
          ),
        ]);

        return result;
      } catch (error) {
        console.warn(
          `Primary guardrail "${primary.name}" failed, using fallback "${fallback.name}":`,
          error,
        );

        return fallback.execute(...args);
      }
    },
  };
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
export function parallel<M extends GuardrailMetadata>(
  guardrails: InputGuardrail<M>[],
  options?: {
    /** 'any' blocks if any guardrail triggers, 'all' blocks only if all trigger */
    mode?: 'any' | 'all';
    /** Timeout for all guardrails */
    timeoutMs?: number;
  },
): InputGuardrail<M>;

export function parallel<M extends GuardrailMetadata>(
  guardrails: OutputGuardrail<M>[],
  options?: {
    mode?: 'any' | 'all';
    timeoutMs?: number;
  },
): OutputGuardrail<M>;

export function parallel<M extends GuardrailMetadata>(
  guardrails: ForwardingGuardrail<M>[],
  options: { mode?: 'any' | 'all'; timeoutMs?: number } = {},
): InputGuardrail<M> | OutputGuardrail<M> {
  const { mode = 'any', timeoutMs = 30000 } = options;
  const names = guardrails.map((g) => g.name).join(', ');

  return {
    name: `parallel(${names})`,
    description: `Parallel execution of: ${names}`,
    execute: async (...args: ExecuteArgs) => {
      const promises = guardrails.map(
        async (g): Promise<GuardrailResult<M>> => {
          try {
            return await Promise.race([
              g.execute(...args),
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
              metadata: compositionMetadata<M>({
                error: String(error),
                guardrailName: g.name,
              }),
            };
          }
        },
      );

      const results = await Promise.all(promises);
      const triggered = results.filter((r) => r.tripwireTriggered);

      const [first] = triggered;

      if (mode === 'any' && first !== undefined) {
        const messages = triggered.map((r) => r.message).join('; ');

        return {
          ...first,
          message: messages,
          metadata: compositionMetadata<M>(
            { allTriggered: triggered },
            first.metadata,
          ),
        };
      }

      if (mode === 'all' && triggered.length === results.length) {
        const messages = triggered.map((r) => r.message).join('; ');

        return {
          tripwireTriggered: true,
          message: `All guardrails triggered: ${messages}`,
          severity: triggered.reduce<Severity | undefined>(
            (max, r) =>
              compareSeverity(r.severity, max) > 0 ? r.severity : max,
            'low',
          ),
          metadata: compositionMetadata<M>({ allTriggered: triggered }),
        };
      }

      return { tripwireTriggered: false };
    },
  };
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
export function createPipeline<M extends GuardrailMetadata>(
  guardrails: InputGuardrail<M>[],
  options?: {
    name?: string;
    shortCircuitOnBlock?: boolean;
  },
): InputGuardrail<M>;

export function createPipeline<M extends GuardrailMetadata>(
  guardrails: OutputGuardrail<M>[],
  options?: {
    name?: string;
    shortCircuitOnBlock?: boolean;
  },
): OutputGuardrail<M>;

export function createPipeline<M extends GuardrailMetadata>(
  guardrails: ForwardingGuardrail<M>[],
  options: { name?: string; shortCircuitOnBlock?: boolean } = {},
): InputGuardrail<M> | OutputGuardrail<M> {
  const { name = 'pipeline', shortCircuitOnBlock = true } = options;

  return {
    name,
    description: `Pipeline: ${guardrails.map((g) => g.name).join(' -> ')}`,
    execute: async (...args: ExecuteArgs) => {
      const results: GuardrailResult<M>[] = [];

      for (const guardrail of guardrails) {
        const result = await guardrail.execute(...args);
        results.push(result);

        if (result.tripwireTriggered && shortCircuitOnBlock) {
          return {
            ...result,
            metadata: compositionMetadata<M>(
              {
                pipelineStage: guardrail.name,
                completedStages: results.length,
                totalStages: guardrails.length,
              },
              result.metadata,
            ),
          };
        }
      }

      return {
        tripwireTriggered: false,
        metadata: compositionMetadata<M>({
          completedStages: results.length,
          totalStages: guardrails.length,
        }),
      };
    },
  };
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
export function not<M extends GuardrailMetadata>(
  guardrail: InputGuardrail<M>,
): InputGuardrail<M>;

export function not<M extends GuardrailMetadata>(
  guardrail: OutputGuardrail<M>,
): OutputGuardrail<M>;

export function not<M extends GuardrailMetadata>(
  guardrail: ForwardingGuardrail<M>,
): InputGuardrail<M> | OutputGuardrail<M> {
  return {
    ...guardrail,
    name: `not(${guardrail.name})`,
    execute: async (...args: ExecuteArgs) => {
      const result = await guardrail.execute(...args);

      return {
        ...result,
        tripwireTriggered: !result.tripwireTriggered,
        message: result.tripwireTriggered
          ? 'Passed (negated)'
          : `Blocked (negated): ${result.message || 'Condition not met'}`,
      };
    },
  };
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
export function withRetry<M extends GuardrailMetadata>(
  guardrail: InputGuardrail<M>,
  options: {
    maxRetries?: number;
    backoffMs?: number | ((attempt: number) => number);
    retryOn?: (result: GuardrailResult<M>) => boolean;
  },
): InputGuardrail<M>;

export function withRetry<M extends GuardrailMetadata>(
  guardrail: OutputGuardrail<M>,
  options: {
    maxRetries?: number;
    backoffMs?: number | ((attempt: number) => number);
    retryOn?: (result: GuardrailResult<M>) => boolean;
  },
): OutputGuardrail<M>;

export function withRetry<M extends GuardrailMetadata>(
  guardrail: ForwardingGuardrail<M>,
  options: {
    maxRetries?: number;
    backoffMs?: number | ((attempt: number) => number);
    retryOn?: (result: GuardrailResult<M>) => boolean;
  } = {},
): InputGuardrail<M> | OutputGuardrail<M> {
  const {
    maxRetries = 3,
    backoffMs = 1000,
    retryOn = (r) => r.severity === 'critical' && Boolean(r.metadata?.error),
  } = options;

  return {
    ...guardrail,
    name: `withRetry(${guardrail.name})`,
    execute: async (...args: ExecuteArgs) => {
      let lastResult: GuardrailResult<M> | null = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const result = await guardrail.execute(...args);

          if (!result.tripwireTriggered || !retryOn(result)) {
            return result;
          }

          lastResult = result;
        } catch (error) {
          lastResult = {
            tripwireTriggered: true,
            message: `Execution failed: ${error instanceof Error ? error.message : 'Unknown'}`,
            severity: 'critical',
            metadata: compositionMetadata<M>({ error: String(error), attempt }),
          };
        }

        if (attempt < maxRetries) {
          const delay =
            backoffMs instanceof Function ? backoffMs(attempt + 1) : backoffMs;

          await new Promise((r) => setTimeout(r, delay));
        }
      }

      return lastResult || { tripwireTriggered: false };
    },
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Orders severities, treating a missing severity as `medium`. */
function compareSeverity(
  a: Severity | undefined,
  b: Severity | undefined,
): number {
  return SEVERITY_RANK[a || 'medium'] - SEVERITY_RANK[b || 'medium'];
}

// ============================================================================
// Convenience Wrappers
// ============================================================================

/**
 * Creates an input guardrail pipeline
 */
export const inputPipeline = <M extends GuardrailMetadata>(
  guardrails: InputGuardrail<M>[],
  options?: { name?: string; shortCircuitOnBlock?: boolean },
): InputGuardrail<M> => createPipeline(guardrails, options);

/**
 * Creates an output guardrail pipeline
 */
export const outputPipeline = <M extends GuardrailMetadata>(
  guardrails: OutputGuardrail<M>[],
  options?: { name?: string; shortCircuitOnBlock?: boolean },
): OutputGuardrail<M> => createPipeline(guardrails, options);
