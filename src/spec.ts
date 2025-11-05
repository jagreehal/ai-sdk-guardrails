/**
 * Guardrail specification and model resolution.
 *
 * This module defines the `GuardrailSpec` class, which captures the metadata,
 * configuration schema, and logic for a guardrail. It provides a structured
 * approach for defining, registering, and instantiating guardrails.
 */

import { z } from 'zod';
import type {
  CheckFn,
  GuardrailContext,
  GuardrailResult,
} from './enhanced-types';

/**
 * Structured metadata for a guardrail specification.
 *
 * This interface provides an extensible, strongly-typed way to attach metadata to
 * guardrails for discovery, documentation, or engine-specific introspection.
 */
export interface GuardrailSpecMetadata {
  /** How the guardrail is implemented (regex/LLM/heuristic/etc.) */
  engine?: 'regex' | 'LLM' | 'heuristic' | 'vector' | 'rule-based' | 'custom';
  /** Version of the guardrail implementation */
  version?: string;
  /** Category of the guardrail */
  category?: 'security' | 'quality' | 'compliance' | 'performance' | 'content';
  /** Whether this guardrail makes external API calls */
  requiresExternalApi?: boolean;
  /** Estimated execution time in milliseconds */
  estimatedLatencyMs?: number;
  /** Tags for discovery and filtering */
  tags?: string[];
  /** Additional metadata fields */
  [key: string]: any;
}

/**
 * Stage where a guardrail can be applied
 */
export type GuardrailStage = 'pre_flight' | 'input' | 'output' | 'tool_call';

/**
 * Immutable descriptor for a registered guardrail.
 *
 * Encapsulates all static information about a guardrail, including its name,
 * description, supported stages, configuration schema, validation function,
 * context requirements, and optional metadata.
 *
 * GuardrailSpec instances are registered in a central registry for cataloging
 * and introspection, and can be instantiated with user configuration to create
 * runnable guardrail instances.
 */
export class GuardrailSpec<
  TContext extends GuardrailContext = GuardrailContext,
  TInput = unknown,
  TConfig = any,
  TMetadata = any,
> {
  constructor(
    /** Unique identifier for this guardrail */
    public readonly id: string,
    /** Human-readable name for display */
    public readonly name: string,
    /** Detailed description of what this guardrail does */
    public readonly description: string,
    /** Stages where this guardrail can be applied */
    public readonly supportedStages: GuardrailStage[],
    /** Configuration schema for validation */
    public readonly configSchema: z.ZodType<TConfig>,
    /** The validation function */
    public readonly checkFn: CheckFn<TContext, TInput, TConfig, TMetadata>,
    /** Context requirements schema */
    public readonly contextSchema?: z.ZodType<TContext>,
    /** Optional metadata about the guardrail */
    public readonly metadata?: GuardrailSpecMetadata,
  ) {}

  /**
   * Check if this guardrail supports a specific stage
   */
  supportsStage(stage: GuardrailStage): boolean {
    return this.supportedStages.includes(stage);
  }

  /**
   * Return the JSON schema for the guardrail's configuration model.
   *
   * This method provides the schema needed for UI validation, documentation,
   * or API introspection.
   */
  getConfigSchema(): any {
    // Note: This is a simplified version. In production, you'd want to use
    // a proper Zod-to-JSON-Schema converter
    return {
      type: 'object',
      description: `Configuration for ${this.name}`,
      // Additional schema details would be extracted from Zod
    };
  }

  /**
   * Validate configuration against the schema
   */
  validateConfig(config: unknown): TConfig {
    return this.configSchema.parse(config);
  }

  /**
   * Validate context if schema is provided
   */
  validateContext(context: unknown): TContext {
    if (!this.contextSchema) {
      return context as TContext;
    }
    return this.contextSchema.parse(context);
  }

  /**
   * Create a configured instance of this guardrail
   */
  instantiate(
    config: TConfig,
  ): ConfiguredGuardrail<TContext, TInput, TConfig, TMetadata> {
    const validatedConfig = this.validateConfig(config);
    return new ConfiguredGuardrail(this, validatedConfig);
  }
}

/**
 * A configured, executable guardrail instance.
 *
 * This class binds a `GuardrailSpec` definition to a validated configuration
 * object. The resulting instance is used to run guardrail logic in production
 * pipelines. It supports both sync and async check functions.
 */
export class ConfiguredGuardrail<
  TContext extends GuardrailContext = GuardrailContext,
  TInput = unknown,
  TConfig = any,
  TMetadata = any,
> {
  constructor(
    public readonly spec: GuardrailSpec<TContext, TInput, TConfig, TMetadata>,
    public readonly config: TConfig,
  ) {}

  /**
   * Run the guardrail's check function with the provided context and input.
   *
   * Main entry point for executing guardrails. Handles both sync and async
   * functions, ensuring results are always awaited.
   */
  async run(
    context: TContext,
    input: TInput,
  ): Promise<GuardrailResult<TMetadata>> {
    try {
      // Validate context if schema is provided
      const validatedContext = this.spec.validateContext(context);

      // Execute the check function
      const startTime = Date.now();
      const result = await Promise.resolve(
        this.spec.checkFn(validatedContext, input, this.config),
      );
      const executionTimeMs = Date.now() - startTime;

      // Enhance result with context information
      return {
        ...result,
        context: {
          guardrailId: this.spec.id,
          guardrailName: this.spec.name,
          guardrailVersion: this.spec.metadata?.version,
          executedAt: new Date(),
          executionTimeMs,
          environment: process.env.NODE_ENV,
          ...(result.context || {}),
        },
      };
    } catch (error) {
      // Handle execution errors gracefully
      return {
        tripwireTriggered: false,
        executionFailed: true,
        originalException:
          error instanceof Error ? error : new Error(String(error)),
        message: `Guardrail execution failed: ${error instanceof Error ? error.message : String(error)}`,
        severity: 'high',
        metadata: {} as TMetadata,
        context: {
          guardrailId: this.spec.id,
          guardrailName: this.spec.name,
          executedAt: new Date(),
        },
      };
    }
  }

  /**
   * Get a string representation of this configured guardrail
   */
  toString(): string {
    return `${this.spec.name} (${this.spec.id})`;
  }
}
