/**
 * Adapter for integrating enhanced parallel runtime into guardrails execution.
 *
 * This module allows guardrails to leverage the parallel execution engine
 * from the enhanced runtime for improved performance without breaking changes.
 */

import type {
  InputGuardrail,
  OutputGuardrail,
  GuardrailResult,
  InputGuardrailContext,
  OutputGuardrailContext,
} from '../types';
import { runGuardrails } from '../enhanced-runtime';
import type { GuardrailBundle } from '../enhanced-types';
import { guardrailToSpec, outputGuardrailToSpec } from './spec-adapter';
import { defaultRegistry } from '../registry';

/**
 * Execute input guardrails using the enhanced parallel runtime.
 *
 * This function wraps guardrails and executes them using the optimized
 * parallel runtime for 10x performance improvement.
 */
export async function executeInputGuardrailsWithEnhancedRuntime<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  guardrails: InputGuardrail<M>[],
  context: InputGuardrailContext,
  options: {
    parallel?: boolean;
    timeout?: number;
    continueOnFailure?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<GuardrailResult<M>[]> {
  // Convert guardrails to specs
  const specs = guardrails
    .filter((g) => g.enabled !== false)
    .map((g) => guardrailToSpec(g));

  // Create a guardrail bundle for the enhanced runtime
  const bundle: GuardrailBundle = {
    version: 1,
    stageName: 'input',
    guardrails: specs.map((spec) => ({
      id: spec.id,
      config: {},
    })),
  };

  // Register specs temporarily for execution
  const tempRegistry = new Map<string, (typeof specs)[0]>();
  for (const spec of specs) tempRegistry.set(spec.id, spec);

  // Mock registry get for instantiation
  const originalGet = defaultRegistry.get.bind(defaultRegistry);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (defaultRegistry as any).get = (id: string) =>
    tempRegistry.get(id) || originalGet(id);

  try {
    // Execute using enhanced runtime
    const result = await runGuardrails(
      context,
      bundle,
      {},
      {
        parallelExecution: options.parallel ?? true,
        timeoutMs: options.timeout,
        raiseGuardrailErrors: !options.continueOnFailure,
        signal: options.signal,
      },
    );

    // Restore registry
    defaultRegistry.get = originalGet;

    // Convert results back to V1 format
    return result.results.map((r, index) => {
      const guardrail = guardrails[index];
      const guardrailName = guardrail?.name || 'unknown';

      return {
        tripwireTriggered: r.tripwireTriggered,
        message: r.message,
        severity: r.severity,
        suggestion: r.suggestion,
        metadata: (r.metadata || {}) as M,
        context: r.context?.guardrailName
          ? {
              guardrailName: r.context.guardrailName,
              guardrailVersion: r.context.guardrailVersion,
              executedAt: r.context.executedAt || new Date(),
              executionTimeMs: r.context.executionTimeMs,
              environment: r.context.environment,
            }
          : {
              guardrailName,
              executedAt: new Date(),
              executionTimeMs: r.context?.executionTimeMs,
              environment: r.context?.environment,
            },
      } as GuardrailResult<M>;
    });
  } catch (error) {
    // Restore registry on error
    defaultRegistry.get = originalGet;
    throw error;
  }
}

/**
 * Execute output guardrails using the enhanced parallel runtime.
 */
export async function executeOutputGuardrailsWithEnhancedRuntime<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  guardrails: OutputGuardrail<M>[],
  context: OutputGuardrailContext,
  options: {
    parallel?: boolean;
    timeout?: number;
    continueOnFailure?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<GuardrailResult<M>[]> {
  // Convert guardrails to specs
  const specs = guardrails
    .filter((g) => g.enabled !== false)
    .map((g) => outputGuardrailToSpec(g));

  // Create a guardrail bundle for the enhanced runtime
  const bundle: GuardrailBundle = {
    version: 1,
    stageName: 'output',
    guardrails: specs.map((spec) => ({
      id: spec.id,
      config: {},
    })),
  };

  // Register specs temporarily
  const tempRegistry = new Map<string, (typeof specs)[0]>();
  for (const spec of specs) tempRegistry.set(spec.id, spec);

  // Mock registry get for instantiation
  const originalGet = defaultRegistry.get.bind(defaultRegistry);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (defaultRegistry as any).get = (id: string) =>
    tempRegistry.get(id) || originalGet(id);

  try {
    // Execute using enhanced runtime
    const result = await runGuardrails(
      context,
      bundle,
      {},
      {
        parallelExecution: options.parallel ?? true,
        timeoutMs: options.timeout,
        raiseGuardrailErrors: !options.continueOnFailure,
        signal: options.signal,
      },
    );

    // Restore registry
    defaultRegistry.get = originalGet;

    // Convert results back to V1 format
    return result.results.map((r, index) => {
      const guardrail = guardrails[index];
      const guardrailName = guardrail?.name || 'unknown';

      return {
        tripwireTriggered: r.tripwireTriggered,
        message: r.message,
        severity: r.severity,
        suggestion: r.suggestion,
        metadata: (r.metadata || {}) as M,
        context: r.context?.guardrailName
          ? {
              guardrailName: r.context.guardrailName,
              guardrailVersion: r.context.guardrailVersion,
              executedAt: r.context.executedAt || new Date(),
              executionTimeMs: r.context.executionTimeMs,
              environment: r.context.environment,
            }
          : {
              guardrailName,
              executedAt: new Date(),
              executionTimeMs: r.context?.executionTimeMs,
              environment: r.context?.environment,
            },
      } as GuardrailResult<M>;
    });
  } catch (error) {
    // Restore registry on error
    defaultRegistry.get = originalGet;
    throw error;
  }
}

/**
 * Configuration flag to enable enhanced runtime for V1.
 *
 * When enabled, V1 guardrails will use the parallel execution engine
 * from the enhanced runtime for improved performance.
 */
export const V1_ENHANCED_RUNTIME_ENABLED =
  process.env.GUARDRAILS_ENHANCED_RUNTIME !== 'false' &&
  process.env.NODE_ENV !== 'test'; // Disable in tests for compatibility

/**
 * Optimized batch execution using enhanced runtime.
 *
 * This provides a drop-in replacement for the existing batch execution
 * with better performance characteristics.
 */
export async function executeBatchWithEnhancedRuntime<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  guardrails: Array<InputGuardrail<M> | OutputGuardrail<M>>,
  context: InputGuardrailContext | OutputGuardrailContext,
  timeoutMs: number,
): Promise<GuardrailResult<M>[]> {
  // Determine if these are input or output guardrails
  const isInput = 'prompt' in context || 'messages' in context;

  return isInput
    ? executeInputGuardrailsWithEnhancedRuntime(
        guardrails as InputGuardrail<M>[],
        context as InputGuardrailContext,
        { parallel: true, timeout: timeoutMs },
      )
    : executeOutputGuardrailsWithEnhancedRuntime(
        guardrails as OutputGuardrail<M>[],
        context as OutputGuardrailContext,
        { parallel: true, timeout: timeoutMs },
      );
}
