/**
 * Adapters for converting between guardrails and spec patterns
 *
 * This module enables:
 * - Guardrails to work with evaluation framework
 * - Enhanced specs to export as standard guardrails
 * - Parallel execution for guardrails
 * - Configuration support for guardrails
 */

import { z } from 'zod';
import type {
  InputGuardrail,
  OutputGuardrail,
  InputGuardrailContext,
  OutputGuardrailContext,
} from '../types';
import { GuardrailSpec } from '../spec';
import { defaultRegistry } from '../registry';
import type { GuardrailContext } from '../enhanced-types';

/**
 * Convert an input guardrail to a GuardrailSpec
 * This allows guardrails to be:
 * - Registered in the registry
 * - Evaluated with the evaluation framework
 * - Run with parallel runtime
 */
export function guardrailToSpec(
  guardrail: InputGuardrail,
  options?: {
    stages?: Array<'input' | 'pre_flight'>;
    metadata?: Record<string, unknown>;
  },
): GuardrailSpec {
  const stages = options?.stages || ['input'];

  return new GuardrailSpec(
    guardrail.name,
    guardrail.name,
    guardrail.description || `Guardrail: ${guardrail.name}`,
    stages,
    z.unknown(), // Legacy guardrails don't have config schemas
    async (context: GuardrailContext, input: unknown) => {
      // Call the guardrail execute function
      const result = await guardrail.execute(input as InputGuardrailContext);

      // Results are already GuardrailResult compatible
      return result;
    },
    undefined, // No context schema for legacy guardrails
    {
      engine: 'custom' as const,
      version: guardrail.version,
      tags: guardrail.tags,
      category: 'security' as const,
      ...options?.metadata,
    },
  );
}

/**
 * Convert an output guardrail to a GuardrailSpec
 */
export function outputGuardrailToSpec(
  guardrail: OutputGuardrail,
  options?: {
    metadata?: Record<string, unknown>;
  },
): GuardrailSpec {
  return new GuardrailSpec(
    guardrail.name,
    guardrail.name,
    guardrail.description || `Output guardrail: ${guardrail.name}`,
    ['output'],
    z.unknown(),
    async (context: GuardrailContext, input: unknown) => {
      // Pass through the OutputGuardrailContext directly
      // input is already the correct OutputGuardrailContext from the runtime
      const result = await guardrail.execute(input as OutputGuardrailContext);
      return result;
    },
    undefined,
    {
      engine: 'custom' as const,
      version: guardrail.version,
      tags: guardrail.tags,
      category: 'security' as const,
      ...options?.metadata,
    },
  );
}

/**
 * Convert a GuardrailSpec to an input guardrail
 * This allows enhanced specs to be used with existing guardrail code
 */
export function specToInputGuardrail(spec: GuardrailSpec): InputGuardrail {
  return {
    name: spec.id,
    description: spec.description,
    execute: async (context) => {
      // Run the spec with default config
      const configured = spec.instantiate({});
      const result = await configured.run(
        context as unknown as GuardrailContext,
        context,
      );

      // Map enhanced result to V1 format
      return {
        tripwireTriggered: result.tripwireTriggered,
        message: result.message,
        metadata: result.metadata,
        severity: result.severity,
        suggestion: result.suggestion,
      };
    },
  };
}

/**
 * Convert a GuardrailSpec to an output guardrail
 */
export function specToOutputGuardrail(spec: GuardrailSpec): OutputGuardrail {
  return {
    name: spec.id,
    description: spec.description,
    execute: async (context, accumulatedText) => {
      const configured = spec.instantiate({});
      const result = await configured.run(
        context as unknown as GuardrailContext,
        { context, accumulatedText },
      );

      return {
        tripwireTriggered: result.tripwireTriggered,
        message: result.message,
        metadata: result.metadata,
        severity: result.severity,
        suggestion: result.suggestion,
      };
    },
  };
}

/**
 * Register guardrails in the enhanced registry
 * This enables:
 * - Discovery through registry
 * - Evaluation support
 * - Configuration management
 */
export function registerGuardrails(
  guardrails: Array<InputGuardrail | OutputGuardrail>,
  options?: {
    prefix?: string;
    override?: boolean;
  },
): void {
  const prefix = options?.prefix || '';

  for (const guardrail of guardrails) {
    const isInput = 'execute' in guardrail && guardrail.execute.length === 1;
    const spec = isInput
      ? guardrailToSpec(guardrail as InputGuardrail)
      : outputGuardrailToSpec(guardrail as OutputGuardrail);

    // Register with prefixed ID
    const id = prefix ? `${prefix}-${guardrail.name}` : guardrail.name;
    const prefixedSpec = new GuardrailSpec(
      id,
      spec.name,
      spec.description,
      spec.supportedStages,
      spec.configSchema,
      spec.checkFn,
      spec.contextSchema,
      spec.metadata,
    );

    defaultRegistry.register(prefixedSpec, {
      override: options?.override,
    });
  }
}

/**
 * Create a guardrail factory from a spec
 * This allows specs to be used exactly like standard guardrails
 */
export function createGuardrailFactory<TConfig = unknown>(
  spec: GuardrailSpec<GuardrailContext, unknown, TConfig>,
): (config?: Partial<TConfig>) => InputGuardrail {
  return (config?: Partial<TConfig>) => {
    const fullConfig = (config || {}) as TConfig;

    return {
      name: spec.id,
      description: spec.description,
      execute: async (context) => {
        const configured = spec.instantiate(fullConfig);
        const result = await configured.run(
          context as unknown as GuardrailContext,
          context,
        );

        return {
          tripwireTriggered: result.tripwireTriggered,
          message: result.message,
          metadata: result.metadata,
          severity: result.severity,
          suggestion: result.suggestion,
        };
      },
    };
  };
}

/**
 * Wrap guardrails to add evaluation support
 * This allows testing guardrails with the evaluation framework
 */
export function withEvaluation<T extends InputGuardrail | OutputGuardrail>(
  guardrail: T,
): T {
  // Add evaluation metadata
  const enhanced = { ...guardrail };

  // Track execution for metrics
  const originalExecute = enhanced.execute;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  enhanced.execute = (async (...args: any[]) => {
    const startTime = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (originalExecute as any)(...args);

    // Add execution metadata
    return {
      ...result,
      context: {
        ...result.context,
        executionTimeMs: Date.now() - startTime,
        guardrailName: guardrail.name,
      },
    };
  }) as T['execute'];

  return enhanced;
}

/**
 * Create a batch evaluator for guardrails
 */
export class GuardrailEvaluator {
  private specs: GuardrailSpec[] = [];

  /**
   * Add a guardrail for evaluation
   */
  addGuardrail(guardrail: InputGuardrail | OutputGuardrail): void {
    const isInput = 'execute' in guardrail && guardrail.execute.length === 1;
    const spec = isInput
      ? guardrailToSpec(guardrail as InputGuardrail)
      : outputGuardrailToSpec(guardrail as OutputGuardrail);

    this.specs.push(spec);
  }

  /**
   * Get specs for evaluation
   */
  getSpecs(): GuardrailSpec[] {
    return this.specs;
  }

  /**
   * Clear all guardrails
   */
  clear(): void {
    this.specs = [];
  }
}

/**
 * Helper to check if a guardrail is a standard guardrail
 */
export function isStandardGuardrail(
  guardrail: unknown,
): guardrail is InputGuardrail | OutputGuardrail {
  return (
    typeof guardrail === 'object' &&
    guardrail !== null &&
    'name' in guardrail &&
    'execute' in guardrail &&
    typeof guardrail.execute === 'function'
  );
}

/**
 * Helper to check if a guardrail is an enhanced spec
 */
export function isGuardrailSpec(
  guardrail: unknown,
): guardrail is GuardrailSpec {
  return guardrail instanceof GuardrailSpec;
}
