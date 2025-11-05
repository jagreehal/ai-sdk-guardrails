/**
 * Guardrail registry for centralized management and discovery.
 *
 * This module provides a registry system for guardrails, allowing them to be
 * registered, discovered, and instantiated dynamically. It supports filtering
 * by stage, category, tags, and other metadata.
 */

import { z } from 'zod';
import {
  GuardrailSpec,
  type GuardrailSpecMetadata,
  type GuardrailStage,
} from './spec';
import type { GuardrailContext, CheckFn } from './enhanced-types';

/**
 * Filter options for searching guardrails in the registry
 */
export interface GuardrailFilter {
  /** Filter by supported stage */
  stage?: GuardrailStage;
  /** Filter by category */
  category?: GuardrailSpecMetadata['category'];
  /** Filter by engine type */
  engine?: GuardrailSpecMetadata['engine'];
  /** Filter by tags (matches if guardrail has any of the specified tags) */
  tags?: string[];
  /** Filter by whether guardrail requires external API */
  requiresExternalApi?: boolean;
  /** Maximum acceptable latency in milliseconds */
  maxLatencyMs?: number;
}

/**
 * Registry entry containing the guardrail spec and registration metadata
 */
interface RegistryEntry {
  spec: GuardrailSpec<any, any, any, any>;
  registeredAt: Date;
  registeredBy?: string;
}

/**
 * Central registry for all guardrail specifications.
 *
 * This class manages the registration, discovery, and instantiation of guardrails.
 * It provides methods for searching, filtering, and retrieving guardrail specs.
 */
export class GuardrailRegistry {
  private readonly guardrails = new Map<string, RegistryEntry>();
  private readonly aliases = new Map<string, string>();

  constructor(private readonly name: string = 'default') {}

  /**
   * Register a new guardrail specification
   */
  register<
    TContext extends GuardrailContext = GuardrailContext,
    TInput = unknown,
    TConfig = any,
    TMetadata = any,
  >(
    spec: GuardrailSpec<TContext, TInput, TConfig, TMetadata>,
    options?: {
      /** Optional alias for the guardrail */
      alias?: string;
      /** Who is registering this guardrail */
      registeredBy?: string;
      /** Whether to override if already exists */
      override?: boolean;
    },
  ): void {
    const { alias, registeredBy, override = false } = options || {};

    // Check if already registered
    if (this.guardrails.has(spec.id) && !override) {
      throw new Error(
        `Guardrail '${spec.id}' is already registered. Use override:true to replace.`,
      );
    }

    // Register the spec
    this.guardrails.set(spec.id, {
      spec,
      registeredAt: new Date(),
      registeredBy,
    });

    // Register alias if provided
    if (alias) {
      this.registerAlias(alias, spec.id);
    }
  }

  /**
   * Register a guardrail using a builder pattern for convenience
   */
  registerFromDefinition<
    TContext extends GuardrailContext = GuardrailContext,
    TInput = unknown,
    TConfig = any,
    TMetadata = any,
  >(
    id: string,
    name: string,
    checkFn: CheckFn<TContext, TInput, TConfig, TMetadata>,
    options: {
      description: string;
      stages: GuardrailStage[];
      configSchema?: z.ZodType<TConfig>;
      contextSchema?: z.ZodType<TContext>;
      metadata?: GuardrailSpecMetadata;
      alias?: string;
      registeredBy?: string;
    },
  ): void {
    const spec = new GuardrailSpec(
      id,
      name,
      options.description,
      options.stages,
      options.configSchema || z.any(),
      checkFn,
      options.contextSchema,
      options.metadata,
    );

    this.register(spec, {
      alias: options.alias,
      registeredBy: options.registeredBy,
    });
  }

  /**
   * Register an alias for a guardrail ID
   */
  registerAlias(alias: string, guardrailId: string): void {
    if (this.aliases.has(alias)) {
      throw new Error(`Alias '${alias}' is already registered`);
    }
    if (!this.guardrails.has(guardrailId)) {
      throw new Error(`Guardrail '${guardrailId}' not found in registry`);
    }
    this.aliases.set(alias, guardrailId);
  }

  /**
   * Get a guardrail spec by ID or alias
   */
  get<
    TContext extends GuardrailContext = GuardrailContext,
    TInput = unknown,
    TConfig = any,
    TMetadata = any,
  >(
    idOrAlias: string,
  ): GuardrailSpec<TContext, TInput, TConfig, TMetadata> | undefined {
    // Try direct ID lookup
    const entry = this.guardrails.get(idOrAlias);
    if (entry) {
      return entry.spec as GuardrailSpec<TContext, TInput, TConfig, TMetadata>;
    }

    // Try alias lookup
    const id = this.aliases.get(idOrAlias);
    if (id) {
      const aliasEntry = this.guardrails.get(id);
      return aliasEntry?.spec as GuardrailSpec<
        TContext,
        TInput,
        TConfig,
        TMetadata
      >;
    }

    return undefined;
  }

  /**
   * Get a guardrail spec by ID or alias (throws if not found)
   */
  require<
    TContext extends GuardrailContext = GuardrailContext,
    TInput = unknown,
    TConfig = any,
    TMetadata = any,
  >(idOrAlias: string): GuardrailSpec<TContext, TInput, TConfig, TMetadata> {
    const spec = this.get<TContext, TInput, TConfig, TMetadata>(idOrAlias);
    if (!spec) {
      throw new Error(`Guardrail '${idOrAlias}' not found in registry`);
    }
    return spec;
  }

  /**
   * Check if a guardrail is registered
   */
  has(idOrAlias: string): boolean {
    return this.guardrails.has(idOrAlias) || this.aliases.has(idOrAlias);
  }

  /**
   * Remove a guardrail from the registry
   */
  unregister(id: string): boolean {
    // Remove any aliases pointing to this ID
    for (const [alias, targetId] of this.aliases.entries()) {
      if (targetId === id) {
        this.aliases.delete(alias);
      }
    }
    return this.guardrails.delete(id);
  }

  /**
   * List all registered guardrails
   */
  list(filter?: GuardrailFilter): GuardrailSpec[] {
    let specs = Array.from(this.guardrails.values()).map((entry) => entry.spec);

    if (filter) {
      specs = this.filterSpecs(specs, filter);
    }

    return specs;
  }

  /**
   * Get all guardrails for a specific stage
   */
  getByStage(stage: GuardrailStage): GuardrailSpec[] {
    return this.list({ stage });
  }

  /**
   * Get all guardrails by category
   */
  getByCategory(category: GuardrailSpecMetadata['category']): GuardrailSpec[] {
    return this.list({ category });
  }

  /**
   * Search guardrails by text query
   */
  search(query: string): GuardrailSpec[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.guardrails.values())
      .map((entry) => entry.spec)
      .filter(
        (spec) =>
          spec.id.toLowerCase().includes(lowerQuery) ||
          spec.name.toLowerCase().includes(lowerQuery) ||
          spec.description.toLowerCase().includes(lowerQuery) ||
          spec.metadata?.tags?.some((tag) =>
            tag.toLowerCase().includes(lowerQuery),
          ),
      );
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    total: number;
    byStage: Record<GuardrailStage, number>;
    byCategory: Record<string, number>;
    byEngine: Record<string, number>;
  } {
    const specs = Array.from(this.guardrails.values()).map(
      (entry) => entry.spec,
    );

    const byStage: Record<GuardrailStage, number> = {
      pre_flight: 0,
      input: 0,
      output: 0,
      tool_call: 0,
    };

    const byCategory: Record<string, number> = {};
    const byEngine: Record<string, number> = {};

    for (const spec of specs) {
      // Count by stage
      for (const stage of spec.supportedStages) {
        byStage[stage]++;
      }

      // Count by category
      if (spec.metadata?.category) {
        byCategory[spec.metadata.category] =
          (byCategory[spec.metadata.category] || 0) + 1;
      }

      // Count by engine
      if (spec.metadata?.engine) {
        byEngine[spec.metadata.engine] =
          (byEngine[spec.metadata.engine] || 0) + 1;
      }
    }

    return {
      total: specs.length,
      byStage,
      byCategory,
      byEngine,
    };
  }

  /**
   * Export registry as JSON for serialization
   */
  export(): {
    name: string;
    guardrails: Array<{
      id: string;
      name: string;
      description: string;
      stages: GuardrailStage[];
      metadata?: GuardrailSpecMetadata;
      registeredAt: string;
      registeredBy?: string;
    }>;
    aliases: Record<string, string>;
  } {
    const guardrails = Array.from(this.guardrails.entries()).map(
      ([id, entry]) => ({
        id,
        name: entry.spec.name,
        description: entry.spec.description,
        stages: entry.spec.supportedStages,
        metadata: entry.spec.metadata,
        registeredAt: entry.registeredAt.toISOString(),
        registeredBy: entry.registeredBy,
      }),
    );

    const aliases: Record<string, string> = {};
    for (const [alias, id] of this.aliases.entries()) {
      aliases[alias] = id;
    }

    return {
      name: this.name,
      guardrails,
      aliases,
    };
  }

  /**
   * Clear all registered guardrails
   */
  clear(): void {
    this.guardrails.clear();
    this.aliases.clear();
  }

  /**
   * Get the size of the registry
   */
  get size(): number {
    return this.guardrails.size;
  }

  /**
   * Filter specs based on criteria
   */
  private filterSpecs(
    specs: GuardrailSpec[],
    filter: GuardrailFilter,
  ): GuardrailSpec[] {
    return specs.filter((spec) => {
      // Filter by stage
      if (filter.stage && !spec.supportsStage(filter.stage)) {
        return false;
      }

      // Filter by category
      if (filter.category && spec.metadata?.category !== filter.category) {
        return false;
      }

      // Filter by engine
      if (filter.engine && spec.metadata?.engine !== filter.engine) {
        return false;
      }

      // Filter by tags
      if (filter.tags && filter.tags.length > 0) {
        const specTags = spec.metadata?.tags || [];
        if (!filter.tags.some((tag) => specTags.includes(tag))) {
          return false;
        }
      }

      // Filter by external API requirement
      if (filter.requiresExternalApi !== undefined) {
        if (spec.metadata?.requiresExternalApi !== filter.requiresExternalApi) {
          return false;
        }
      }

      // Filter by max latency
      if (filter.maxLatencyMs !== undefined) {
        const estimatedLatency = spec.metadata?.estimatedLatencyMs;
        if (estimatedLatency && estimatedLatency > filter.maxLatencyMs) {
          return false;
        }
      }

      return true;
    });
  }
}

/**
 * Default global registry instance
 */
export const defaultRegistry = new GuardrailRegistry('default');

/**
 * Create a new isolated registry
 */
export function createRegistry(name: string): GuardrailRegistry {
  return new GuardrailRegistry(name);
}
