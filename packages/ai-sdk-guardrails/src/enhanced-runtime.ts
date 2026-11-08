/**
 * Guardrail bundle runtime: parallel or sequential execution, per-guardrail
 * and global timeouts, cancellation, and pipeline configuration loading.
 */

import { z } from 'zod';
import { ConfiguredGuardrail } from './spec';
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
export async function runGuardrails<TInput>(
  input: TInput,
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

  if (signal?.aborted) {
    throw new Error('Guardrails execution aborted');
  }

  let results: GuardrailResult[];

  if (parallelExecution) {
    const promises = guardrails.map((guardrail) =>
      runSingleGuardrail(guardrail, context, input, timeoutMs, signal),
    );

    results = globalTimeoutMs
      ? await Promise.race([
          Promise.all(promises),
          rejectAfter(
            globalTimeoutMs,
            `Global timeout of ${globalTimeoutMs}ms exceeded`,
          ),
        ])
      : await Promise.all(promises);
  } else {
    results = [];

    for (const guardrail of guardrails) {
      if (globalTimeoutMs) {
        const elapsed = Date.now() - startTime;
        const remaining = globalTimeoutMs - elapsed;

        if (remaining <= 0) {
          throw new Error(`Global timeout of ${globalTimeoutMs}ms exceeded`);
        }
      }

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

      // A critical violation stops the remaining sequential checks.
      if (result.tripwireTriggered && result.severity === 'critical') {
        break;
      }
    }
  }

  if (raiseGuardrailErrors) {
    const executionFailures = results.filter((r) => r.executionFailed);

    if (executionFailures.length > 0) {
      const firstFailure = executionFailures[0]!;

      if (firstFailure.originalException) {
        throw firstFailure.originalException;
      }

      throw new Error(firstFailure.message || 'Guardrail execution failed');
    }
  }

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
async function runSingleGuardrail<TInput>(
  guardrail: ConfiguredGuardrail,
  context: GuardrailContext,
  input: TInput,
  timeoutMs?: number,
  signal?: AbortSignal,
): Promise<GuardrailResult> {
  try {
    if (signal?.aborted) {
      throw new Error('Execution aborted');
    }

    if (timeoutMs) {
      return await Promise.race([
        guardrail.run(context, input),
        rejectAfter(timeoutMs, `Guardrail timeout after ${timeoutMs}ms`),
      ]);
    }

    return await guardrail.run(context, input);
  } catch (error) {
    return {
      tripwireTriggered: false,
      executionFailed: true,
      originalException:
        error instanceof Error ? error : new Error(String(error)),
      info: {
        guardrailName: guardrail.spec.name,
        mediaType: guardrail.spec.mediaType,
        error: error instanceof Error ? error.message : String(error),
      },
      message: `Guardrail execution failed: ${error instanceof Error ? error.message : String(error)}`,
      severity: 'high',
      context: {
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
    const spec = defaultRegistry.get(config.name);

    if (!spec) {
      throw new Error(`Guardrail '${config.name}' not found in registry`);
    }

    try {
      const guardrail = spec.instantiate(config.config || {});

      guardrails.push(guardrail);
    } catch (error) {
      throw new Error(
        `Failed to instantiate guardrail '${config.name}': ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
  }

  return guardrails;
}

/**
 * Load a pipeline configuration from an object, a JSON string, or a path to a
 * `.json` file. YAML paths throw.
 */
export async function loadPipelineConfig(
  config: string | PipelineConfig,
): Promise<PipelineConfig> {
  const source = z.string().safeParse(config);

  if (!source.success) {
    // SAFETY: config is typed `string | PipelineConfig` and is not a string.
    return config as PipelineConfig;
  }

  const text = source.data;
  let json = text;

  if (text.includes('.json') || text.includes('.yaml') || text.includes('/')) {
    // Dynamic import keeps node:fs out of browser bundles.
    const fs = await import('node:fs/promises');
    json = await fs.readFile(text, 'utf8');

    if (text.endsWith('.yaml') || text.endsWith('.yml')) {
      throw new Error('YAML support not yet implemented');
    }
  }

  // SAFETY: the JSON is trusted caller configuration; its structure is checked
  // where it is used (validatePipelineConfig, instantiateGuardrails).
  return JSON.parse(json) as PipelineConfig;
}

const bundleSchema = z.looseObject({
  version: z.number().optional().catch(undefined),
  stageName: z.string().optional().catch(undefined),
  guardrails: z.array(z.unknown()),
});

const nameSchema = z.string().min(1);

const guardrailEntrySchema = z.looseObject({
  name: nameSchema,
  // Anything `typeof` reports as 'object': objects, arrays and null.
  config: z
    .union([z.looseObject({}), z.array(z.unknown()), z.null()])
    .optional(),
});

/**
 * Load a guardrail bundle from a bundle object or a bare array of guardrail
 * configs. Throws when the shape or any entry is invalid.
 */
export function loadGuardrailBundle<TConfig>(config: TConfig): GuardrailBundle {
  const bundle = Array.isArray(config)
    ? undefined
    : bundleSchema.safeParse(config).data;

  const entries: unknown[] | undefined = Array.isArray(config)
    ? config
    : bundle?.guardrails;

  if (!entries) {
    throw new Error('Invalid guardrail bundle format');
  }

  const guardrails = entries.map((entry) => {
    const parsed = guardrailEntrySchema.safeParse(entry);

    if (parsed.success) {
      // SAFETY: name is a non-empty string and config is absent or
      // object-typed; instantiateGuardrails defaults a missing config to {}.
      return parsed.data as GuardrailConfig;
    }

    const named = z.looseObject({ name: nameSchema }).safeParse(entry);

    throw new Error(
      named.success
        ? `Invalid config for guardrail '${named.data.name}'`
        : 'Invalid guardrail config: missing or invalid name',
    );
  });

  return {
    version: bundle?.version || 1,
    stageName: bundle?.stageName,
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

    throw Object.assign(error, {
      guardrailResults: result.results.filter((r) => r.tripwireTriggered),
    });
  }
}

/**
 * Create a promise that rejects after a timeout
 */
function rejectAfter(ms: number, message: string): Promise<never> {
  return new Promise((_resolve, reject) =>
    setTimeout(() => reject(new Error(message)), ms),
  );
}

/**
 * Run guardrails for a specific stage in the pipeline
 */
export async function runStageGuardrails<TInput>(
  input: TInput,
  pipeline: PipelineConfig,
  stage: 'pre_flight' | 'input' | 'output',
  context: GuardrailContext = {},
  options?: RunGuardrailsOptions,
): Promise<GuardrailBundleResult | null> {
  const bundle = pipeline[stage];

  if (!bundle) {
    return null;
  }

  return await runGuardrails(input, bundle, context, options);
}

/**
 * Validate a pipeline configuration
 */
export function validatePipelineConfig(config: PipelineConfig): string[] {
  const errors: string[] = [];

  if (config.version && !z.number().safeParse(config.version).success) {
    errors.push('Pipeline version must be a number');
  }

  const stages: Array<keyof PipelineConfig> = ['pre_flight', 'input', 'output'];

  for (const stage of stages) {
    const bundle = config[stage];

    if (bundle) {
      try {
        const loaded = loadGuardrailBundle(bundle);

        for (const { name } of loaded.guardrails) {
          if (!defaultRegistry.get(name)) {
            errors.push(`Unknown guardrail '${name}' in ${stage} stage`);
          }
        }
      } catch (error) {
        errors.push(
          `Invalid ${stage} bundle: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return errors;
}

/** Configuration helpers as one object. */
export const configUtils = {
  loadPipelineConfig,
  loadGuardrailBundle,
  validatePipelineConfig,
};

/** Runtime helpers as one object. */
export const runtimeUtils = {
  runGuardrails,
  runStageGuardrails,
  checkPlainText,
  instantiateGuardrails,
};
