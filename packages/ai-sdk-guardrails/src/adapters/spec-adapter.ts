/**
 * Adapters that turn input and output guardrails into `GuardrailSpec`s so they
 * can be registered and run by the spec runtime.
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

/** The config type `GuardrailSpec` defaults to. */
type SpecConfig = z.output<GuardrailSpec['configSchema']>;

/** These guardrails take no config, so any config value is accepted. */
const anyConfig = z.custom<SpecConfig>();

/**
 * Convert an input guardrail to a GuardrailSpec so it can be registered and
 * run by the spec runtime.
 */
export function guardrailToSpec(guardrail: InputGuardrail): GuardrailSpec {
  return new GuardrailSpec<GuardrailContext, unknown, SpecConfig>(
    guardrail.name,
    guardrail.description || `Guardrail: ${guardrail.name}`,
    'text/plain',
    anyConfig,
    // SAFETY: the spec runtime passes the input guardrail context it was
    // called with as `input` (see adapters/parallel-runtime-adapter).
    (_context, input) => guardrail.execute(input as InputGuardrailContext),
    undefined,
    {
      engine: 'custom',
      version: guardrail.version,
      tags: guardrail.tags,
      category: 'security',
    },
  );
}

/**
 * Convert an output guardrail to a GuardrailSpec.
 */
export function outputGuardrailToSpec(
  guardrail: OutputGuardrail,
): GuardrailSpec {
  return new GuardrailSpec<GuardrailContext, unknown, SpecConfig>(
    guardrail.name,
    guardrail.description || `Output guardrail: ${guardrail.name}`,
    'text/plain',
    anyConfig,
    (context, input) => {
      const { accumulatedText } = context;

      return guardrail.execute(
        // SAFETY: the spec runtime passes the output guardrail context it was
        // called with as `input` (see adapters/parallel-runtime-adapter).
        input as OutputGuardrailContext,
        accumulatedText,
      );
    },
    undefined,
    {
      engine: 'custom',
      version: guardrail.version,
      tags: guardrail.tags,
      category: 'security',
    },
  );
}

/** Input guardrails take one argument; output guardrails take more. */
function isInputGuardrail(
  guardrail: InputGuardrail | OutputGuardrail,
): guardrail is InputGuardrail {
  return guardrail.execute.length === 1;
}

/**
 * Register guardrails in the default registry, optionally prefixing names.
 */
export function registerGuardrails(
  guardrails: Array<InputGuardrail | OutputGuardrail>,
  options?: {
    prefix?: string;
  },
): void {
  const prefix = options?.prefix || '';

  for (const guardrail of guardrails) {
    const spec = isInputGuardrail(guardrail)
      ? guardrailToSpec(guardrail)
      : outputGuardrailToSpec(guardrail);

    const name = prefix ? `${prefix}-${guardrail.name}` : guardrail.name;

    defaultRegistry.registerSpec(
      new GuardrailSpec(
        name,
        spec.description,
        spec.mediaType,
        spec.configSchema,
        spec.checkFn,
        spec.ctxRequirements,
        spec.metadata,
      ),
    );
  }
}
