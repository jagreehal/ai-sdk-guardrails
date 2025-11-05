/**
 * Runtime execution module for guardrails with parallel processing support.
 *
 * This module provides the runtime infrastructure for executing guardrails,
 * including parallel execution, timeout handling, and configuration loading.
 */

import { ConfiguredGuardrail, GuardrailSpec } from './spec';
import { defaultRegistry } from './registry';
import type {
  GuardrailBundle,
  GuardrailBundleResult,
  GuardrailConfig,
  GuardrailContext,
  GuardrailResult,
  PipelineConfig,
} from './enhanced-types';

/**
 * Options for running guardrails
 */
export interface RunGuardrailsOptions {
  /** Whether to throw on guardrail execution errors */
  raiseGuardrailErrors?: boolean;
  /** Whether to run guardrails in parallel */
  parallelExecution?: boolean;
  /** Timeout for individual guardrails */
  timeoutMs?: number;
  /** Global timeout for all guardrails */
  globalTimeoutMs?: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Run multiple guardrails and return aggregated results
 */
export async function runGuardrails(
  input: unknown,
  bundle: GuardrailBundle,
  context: GuardrailContext = {},
  options: RunGuardrailsOptions = {},
): Promise<GuardrailBundleResult> {
  const {
    raiseGuardrailErrors = false,
    parallelExecution = true,
    timeoutMs,
    globalTimeoutMs,
    signal,
  } = options;

  const startTime = Date.now();
  const guardrails = await instantiateGuardrails(bundle);

  // Check for cancellation
  if (signal?.aborted) {
    throw new Error('Guardrails execution aborted');
  }

  let results: GuardrailResult[];

  if (parallelExecution) {
    // Run all guardrails in parallel
    const promises = guardrails.map((guardrail) =>
      runSingleGuardrail(guardrail, context, input, timeoutMs, signal),
    );

    // Apply global timeout if specified
    if (globalTimeoutMs) {
      results = await Promise.race([
        Promise.all(promises),
        timeoutPromise(globalTimeoutMs).then(() => {
          throw new Error(`Global timeout of ${globalTimeoutMs}ms exceeded`);
        }),
      ]);
    } else {
      results = await Promise.all(promises);
    }
  } else {
    // Run guardrails sequentially
    results = [];
    for (const guardrail of guardrails) {
      // Check remaining time if global timeout is set
      if (globalTimeoutMs) {
        const elapsed = Date.now() - startTime;
        const remaining = globalTimeoutMs - elapsed;
        if (remaining <= 0) {
          throw new Error(`Global timeout of ${globalTimeoutMs}ms exceeded`);
        }
      }

      // Check for cancellation
      if (signal?.aborted) {
        throw new Error('Guardrails execution aborted');
      }

      const result = await runSingleGuardrail(
        guardrail,
        context,
        input,
        timeoutMs,
        signal,
      );
      results.push(result);

      // Early exit if a critical violation is detected
      if (result.tripwireTriggered && result.severity === 'critical') {
        break;
      }
    }
  }

  // Check for execution failures
  if (raiseGuardrailErrors) {
    const executionFailures = results.filter((r) => r.executionFailed);
    if (executionFailures.length > 0) {
      // Re-raise the first execution failure
      const firstFailure = executionFailures[0]!;
      if (firstFailure.originalException) {
        throw firstFailure.originalException;
      }
      throw new Error(firstFailure.message || 'Guardrail execution failed');
    }
  }

  // Calculate metadata
  const totalExecutionTimeMs = Date.now() - startTime;
  const triggeredCount = results.filter((r) => r.tripwireTriggered).length;
  const failedCount = results.filter((r) => r.executionFailed).length;
  const successCount = results.length - failedCount;

  return {
    blocked: triggeredCount > 0,
    results,
    metadata: {
      totalExecutionTimeMs,
      triggeredCount,
      failedCount,
      successCount,
    },
  };
}

/**
 * Run a single guardrail with timeout and error handling
 */
async function runSingleGuardrail(
  guardrail: ConfiguredGuardrail,
  context: GuardrailContext,
  input: unknown,
  timeoutMs?: number,
  signal?: AbortSignal,
): Promise<GuardrailResult> {
  try {
    // Check for cancellation
    if (signal?.aborted) {
      throw new Error('Execution aborted');
    }

    // Apply timeout if specified
    if (timeoutMs) {
      return await Promise.race([
        guardrail.run(context, input),
        timeoutPromise(timeoutMs).then(() => {
          throw new Error(`Guardrail timeout after ${timeoutMs}ms`);
        }),
      ]);
    }

    return await guardrail.run(context, input);
  } catch (error) {
    // Return execution failure result
    return {
      tripwireTriggered: false,
      executionFailed: true,
      originalException:
        error instanceof Error ? error : new Error(String(error)),
      message: `Guardrail execution failed: ${error instanceof Error ? error.message : String(error)}`,
      severity: 'high',
      context: {
        guardrailId: guardrail.spec.id,
        guardrailName: guardrail.spec.name,
        executedAt: new Date(),
      },
    };
  }
}

/**
 * Instantiate guardrails from a bundle configuration
 */
export async function instantiateGuardrails(
  bundle: GuardrailBundle,
): Promise<ConfiguredGuardrail[]> {
  const guardrails: ConfiguredGuardrail[] = [];

  for (const config of bundle.guardrails) {
    const spec = defaultRegistry.get(config.id);
    if (!spec) {
      throw new Error(`Guardrail '${config.id}' not found in registry`);
    }

    try {
      const guardrail = spec.instantiate(config.config);
      guardrails.push(guardrail);
    } catch (error) {
      throw new Error(
        `Failed to instantiate guardrail '${config.id}': ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return guardrails;
}

/**
 * Load pipeline configuration from various sources
 */
export async function loadPipelineConfig(
  config: string | PipelineConfig,
): Promise<PipelineConfig> {
  if (typeof config === 'string') {
    // Check if it's a file path
    if (
      config.includes('.json') ||
      config.includes('.yaml') ||
      config.includes('/')
    ) {
      // Dynamic import to avoid bundling issues
      const fs = await import('fs/promises');
      const content = await fs.readFile(config, 'utf-8');

      // Parse based on extension
      if (config.endsWith('.yaml') || config.endsWith('.yml')) {
        // Would need to import a YAML parser here
        throw new Error('YAML support not yet implemented');
      }

      return JSON.parse(content) as PipelineConfig;
    } else {
      // It's a JSON string
      return JSON.parse(config) as PipelineConfig;
    }
  }
  return config;
}

/**
 * Load a guardrail bundle from configuration
 */
export function loadGuardrailBundle(config: any): GuardrailBundle {
  // Validate and normalize the bundle configuration
  const guardrails: GuardrailConfig[] = [];

  if (Array.isArray(config)) {
    // Direct array of guardrail configs
    guardrails.push(...config);
  } else if (config.guardrails && Array.isArray(config.guardrails)) {
    // Bundle format
    guardrails.push(...config.guardrails);
  } else {
    throw new Error('Invalid guardrail bundle format');
  }

  // Validate each guardrail config
  for (const guardrail of guardrails) {
    if (!guardrail.id || typeof guardrail.id !== 'string') {
      throw new Error('Invalid guardrail config: missing or invalid id');
    }
    if (!guardrail.config || typeof guardrail.config !== 'object') {
      throw new Error(`Invalid config for guardrail '${guardrail.id}'`);
    }
  }

  return {
    version: config.version || 1,
    stageName: config.stageName,
    guardrails,
  };
}

/**
 * Check plain text with a guardrail bundle
 */
export async function checkPlainText(
  text: string,
  bundle: GuardrailBundle,
  context?: GuardrailContext,
  options?: RunGuardrailsOptions,
): Promise<void> {
  const result = await runGuardrails(text, bundle, context, options);

  if (result.blocked) {
    const triggeredGuardrails = result.results
      .filter((r) => r.tripwireTriggered)
      .map((r) => r.message || 'Guardrail triggered')
      .join(', ');

    const error = new Error(
      `Content validation failed: ${result.metadata?.triggeredCount} violation(s) detected: ${triggeredGuardrails}`,
    );
    (error as any).guardrailResults = result.results.filter(
      (r) => r.tripwireTriggered,
    );
    throw error;
  }
}

/**
 * Create a promise that resolves after a timeout
 */
function timeoutPromise(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run guardrails for a specific stage in the pipeline
 */
export async function runStageGuardrails(
  input: unknown,
  pipeline: PipelineConfig,
  stage: 'pre_flight' | 'input' | 'output' | 'tool_call',
  context: GuardrailContext = {},
  options?: RunGuardrailsOptions,
): Promise<GuardrailBundleResult | null> {
  const bundle = pipeline[stage];
  if (!bundle) {
    return null;
  }

  // Merge pipeline settings with options
  const mergedOptions: RunGuardrailsOptions = {
    raiseGuardrailErrors: pipeline.settings?.raiseGuardrailErrors,
    parallelExecution: pipeline.settings?.parallelExecution,
    globalTimeoutMs: pipeline.settings?.globalTimeoutMs,
    ...options,
  };

  return await runGuardrails(input, bundle, context, mergedOptions);
}

/**
 * Validate a pipeline configuration
 */
export function validatePipelineConfig(config: PipelineConfig): string[] {
  const errors: string[] = [];

  // Check version
  if (config.version && typeof config.version !== 'number') {
    errors.push('Pipeline version must be a number');
  }

  // Validate each stage bundle if present
  const stages: Array<keyof PipelineConfig> = [
    'pre_flight',
    'input',
    'output',
    'tool_call',
  ];
  for (const stage of stages) {
    const bundle = config[stage];
    if (bundle) {
      try {
        loadGuardrailBundle(bundle);
      } catch (error) {
        errors.push(
          `Invalid ${stage} bundle: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  // Validate settings
  if (config.settings) {
    if (
      config.settings.globalTimeoutMs !== undefined &&
      typeof config.settings.globalTimeoutMs !== 'number'
    ) {
      errors.push('globalTimeoutMs must be a number');
    }
  }

  return errors;
}

/**
 * Export configuration utilities
 */
export const configUtils = {
  loadPipelineConfig,
  loadGuardrailBundle,
  validatePipelineConfig,
};

/**
 * Export runtime utilities
 */
export const runtimeUtils = {
  runGuardrails,
  runStageGuardrails,
  checkPlainText,
  instantiateGuardrails,
};
