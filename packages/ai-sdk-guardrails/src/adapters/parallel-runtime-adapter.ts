/**
 * Runs input and output guardrails through the enhanced parallel runtime
 * (`runGuardrails`) and maps the results back to the middleware result shape.
 */

import type {
  InputGuardrail,
  OutputGuardrail,
  GuardrailResult,
  InputGuardrailContext,
  OutputGuardrailContext,
} from '../types';
import { runGuardrails, type RunGuardrailsOptions } from '../enhanced-runtime';
import type { GuardrailBundle, GuardrailContext } from '../enhanced-types';
import type { GuardrailSpec } from '../spec';
import { guardrailToSpec, outputGuardrailToSpec } from './spec-adapter';
import { defaultRegistry } from '../registry';

import type { GuardrailMetadata } from '../enhanced-types';

interface EnhancedRuntimeOptions {
  parallel?: boolean;
  timeout?: number;
  continueOnFailure?: boolean;
  signal?: AbortSignal;
}

/**
 * Runs specs under a stage bundle, resolving their names through a registry
 * override that is removed again once the run settles.
 */
async function runSpecs<M extends GuardrailMetadata>(
  guardrails: ReadonlyArray<{ name: string }>,
  specs: GuardrailSpec[],
  stageName: 'input' | 'output',
  input: InputGuardrailContext | OutputGuardrailContext,
  runtimeContext: GuardrailContext,
  options: EnhancedRuntimeOptions,
): Promise<GuardrailResult<M>[]> {
  const bundle: GuardrailBundle = {
    version: 1,
    stageName,
    guardrails: specs.map((spec) => ({ name: spec.name, config: {} })),
  };

  const specsByName = new Map(specs.map((spec) => [spec.name, spec]));
  const originalGet = defaultRegistry.get.bind(defaultRegistry);
  defaultRegistry.get = (name: string) =>
    specsByName.get(name) || originalGet(name);

  const runOptions: RunGuardrailsOptions = {
    parallelExecution: options.parallel ?? true,
    timeoutMs: options.timeout,
    raiseGuardrailErrors: !options.continueOnFailure,
    signal: options.signal,
  };

  try {
    const result = await runGuardrails(
      input,
      bundle,
      runtimeContext,
      runOptions,
    );

    defaultRegistry.get = originalGet;

    return result.results.map((r, index) => ({
      tripwireTriggered: r.tripwireTriggered,
      message: r.message,
      severity: r.severity,
      suggestion: r.suggestion,
      // SAFETY: r.metadata is what a guardrail typed GuardrailResult<M>
      // returned, or {} when that guardrail failed or returned none.
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
            guardrailName: guardrails[index]?.name || 'unknown',
            executedAt: new Date(),
            executionTimeMs: r.context?.executionTimeMs,
            environment: r.context?.environment,
          },
    }));
  } catch (error) {
    defaultRegistry.get = originalGet;
    throw error;
  }
}

/** Execute input guardrails using the enhanced parallel runtime. */
export async function executeInputGuardrailsWithEnhancedRuntime<
  M extends GuardrailMetadata,
>(
  guardrails: InputGuardrail<M>[],
  context: InputGuardrailContext,
  options: EnhancedRuntimeOptions = {},
): Promise<GuardrailResult<M>[]> {
  const specs = guardrails.flatMap((g) =>
    g.enabled === false ? [] : [guardrailToSpec(g)],
  );

  return runSpecs<M>(guardrails, specs, 'input', context, {}, options);
}

/**
 * Execute output guardrails using the enhanced parallel runtime.
 * `accumulatedText` reaches each guardrail through the runtime context.
 */
export async function executeOutputGuardrailsWithEnhancedRuntime<
  M extends GuardrailMetadata,
>(
  guardrails: OutputGuardrail<M>[],
  context: OutputGuardrailContext,
  options: EnhancedRuntimeOptions & { accumulatedText?: string } = {},
): Promise<GuardrailResult<M>[]> {
  const specs = guardrails.flatMap((g) =>
    g.enabled === false ? [] : [outputGuardrailToSpec(g)],
  );

  const runtimeContext = options.accumulatedText
    ? { accumulatedText: options.accumulatedText }
    : {};

  return runSpecs<M>(
    guardrails,
    specs,
    'output',
    context,
    runtimeContext,
    options,
  );
}
