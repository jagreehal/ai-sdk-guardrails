/**
 * Guardrail specification registry. Guardrail names and metadata align with
 * configs authored at guardrails.openai.com.
 */

import { z } from 'zod';
import { GuardrailSpec } from './spec';
import type { GuardrailSpecMetadata } from './spec';
import type { CheckFn, GuardrailContext } from './enhanced-types';

// Loose: a strict z.object({}) strips every key, which silently dropped ctx.llm
// and unschema'd config fields before they reached the check.
const NO_CONFIG = z.looseObject({});

const NO_CONTEXT = z.looseObject({});

/** The config type `GuardrailSpec` defaults to. */
type SpecConfig = z.output<GuardrailSpec['configSchema']>;

export interface RegistryMetadataSnapshot {
  name: string;
  description: string;
  mediaType: string;
  hasConfig: boolean;
  hasContext: boolean;
  metadata?: GuardrailSpecMetadata;
}

export class GuardrailRegistry {
  private specs = new Map<string, GuardrailSpec>();

  registerSpec(spec: GuardrailSpec): void {
    this.specs.set(spec.name, spec);
  }

  register<
    TContext extends GuardrailContext = GuardrailContext,
    TInput = unknown,
    TConfig = SpecConfig,
  >(
    name: string,
    checkFn: CheckFn<TContext, TInput, TConfig>,
    description: string,
    mediaType: string = 'text/plain',
    configSchema?: z.ZodType<TConfig>,
    ctxRequirements?: z.ZodType<TContext>,
    metadata?: GuardrailSpecMetadata,
  ): void {
    // The registry stores specs type-erased. Each spec's checkFn only receives
    // a context and config parsed by that spec's own schemas
    // (ConfiguredGuardrail.run and GuardrailSpec.instantiate).
    this.registerSpec(
      new GuardrailSpec<GuardrailContext, unknown, SpecConfig>(
        name,
        description,
        mediaType,
        // SAFETY: erased to the registry's config type; values reaching
        // checkFn are parsed by this same schema. NO_CONFIG passes any object
        // config through unchanged.
        (configSchema ?? NO_CONFIG) as z.ZodType<SpecConfig>,
        // SAFETY: checkFn is only invoked with values parsed by the schemas
        // above, which produce TContext and TConfig.
        checkFn as CheckFn<GuardrailContext, unknown, SpecConfig>,
        ctxRequirements ?? NO_CONTEXT,
        metadata,
      ),
    );
  }

  get(name: string): GuardrailSpec | undefined {
    return this.specs.get(name);
  }

  has(name: string): boolean {
    return this.specs.has(name);
  }

  remove(name: string): boolean {
    return this.specs.delete(name);
  }

  size(): number {
    return this.specs.size;
  }

  all(): GuardrailSpec[] {
    return [...this.specs.values()];
  }

  list(): GuardrailSpec[] {
    return this.all();
  }

  metadata(): RegistryMetadataSnapshot[] {
    return this.all().map((spec) => ({
      name: spec.name,
      description: spec.description,
      mediaType: spec.mediaType,
      hasConfig: spec.configSchema !== NO_CONFIG,
      hasContext: spec.ctxRequirements !== NO_CONTEXT,
      metadata: spec.metadata,
    }));
  }
}

export const defaultRegistry = new GuardrailRegistry();

export function createRegistry(): GuardrailRegistry {
  return new GuardrailRegistry();
}
