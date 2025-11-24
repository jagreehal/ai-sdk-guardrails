/**
 * Guardrail specification registry compatible with OpenAI's config/runtime.
 *
 * This closely mirrors the implementation from openai-guardrails-js so
 * guardrail names and metadata align with configs authored in the wizard.
 */

import { z } from 'zod';
import { GuardrailSpec } from './spec';
import type { GuardrailSpecMetadata } from './spec';
import type { CheckFn, GuardrailContext } from './enhanced-types';

const NO_CONFIG = z.object({});
const NO_CONTEXT = z.object({});

export interface RegistryMetadataSnapshot {
  name: string;
  description: string;
  mediaType: string;
  hasConfig: boolean;
  hasContext: boolean;
  metadata?: GuardrailSpecMetadata;
}

export class GuardrailRegistry {
  private specs = new Map<
    string,
    GuardrailSpec<GuardrailContext, unknown, Record<string, unknown>>
  >();

  registerSpec(
    spec: GuardrailSpec<GuardrailContext, unknown, Record<string, unknown>>,
  ): void {
    this.specs.set(spec.name, spec);
  }

  register<
    TContext extends GuardrailContext = GuardrailContext,
    TInput = unknown,
    TConfig = Record<string, unknown>,
  >(
    name: string,
    checkFn: CheckFn<TContext, TInput, TConfig>,
    description: string,
    mediaType: string = 'text/plain',
    configSchema?: z.ZodType<TConfig>,
    ctxRequirements?: z.ZodType<TContext>,
    metadata?: GuardrailSpecMetadata,
  ): void {
    const spec = new GuardrailSpec(
      name,
      description,
      mediaType,
      (configSchema ||
        (NO_CONFIG as unknown as z.ZodType<TConfig>)) as z.ZodType<TConfig>,
      checkFn,
      (ctxRequirements ||
        (NO_CONTEXT as unknown as z.ZodType<TContext>)) as z.ZodType<TContext>,
      metadata,
    );
    this.registerSpec(
      spec as unknown as GuardrailSpec<
        GuardrailContext,
        unknown,
        Record<string, unknown>
      >,
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
    return Array.from(this.specs.values());
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
