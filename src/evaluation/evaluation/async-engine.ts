/**
 * Async execution engine for running guardrail evaluations in parallel
 */

import { ConfiguredGuardrail } from '../../spec';
import type { GuardrailContext } from '../../enhanced-types';
import type {
  EvaluationSample,
  SampleResult,
  EvaluationProgress,
} from './types';

/**
 * Options for the async engine
 */
export interface AsyncEngineOptions {
  /** Number of samples to process in parallel */
  batchSize?: number;
  /** Timeout for individual guardrail execution */
  timeoutMs?: number;
  /** Whether to fail fast on first error */
  failFast?: boolean;
  /** Progress callback */
  onProgress?: (progress: EvaluationProgress) => void;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Engine for running evaluations asynchronously with batching
 */
export class AsyncRunEngine {
  private readonly guardrails: Map<string, ConfiguredGuardrail>;

  constructor(guardrails: ConfiguredGuardrail[]) {
    this.guardrails = new Map();
    for (const guardrail of guardrails) {
      this.guardrails.set(guardrail.spec.id, guardrail);
    }
  }

  /**
   * Run evaluation on all samples
   */
  async run(
    context: GuardrailContext,
    samples: EvaluationSample[],
    options: AsyncEngineOptions = {},
  ): Promise<SampleResult[]> {
    const {
      batchSize = 32,
      timeoutMs = 30000,
      failFast = false,
      onProgress,
      signal,
    } = options;

    const results: SampleResult[] = [];
    const totalSamples = samples.length;
    const totalBatches = Math.ceil(totalSamples / batchSize);

    let processedSamples = 0;
    const startTime = Date.now();

    // Process samples in batches
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      // Check for cancellation
      if (signal?.aborted) {
        throw new Error('Evaluation aborted by user');
      }

      const batchStart = batchIndex * batchSize;
      const batchEnd = Math.min(batchStart + batchSize, totalSamples);
      const batch = samples.slice(batchStart, batchEnd);

      // Process batch in parallel
      const batchPromises = batch.map((sample) =>
        this.evaluateSample(sample, context, timeoutMs),
      );

      try {
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        processedSamples += batch.length;

        // Report progress
        if (onProgress) {
          const elapsedMs = Date.now() - startTime;
          const samplesPerSecond = processedSamples / (elapsedMs / 1000);
          const remainingSamples = totalSamples - processedSamples;
          const estimatedTimeRemaining = remainingSamples / samplesPerSecond;

          onProgress({
            currentSample: processedSamples,
            totalSamples,
            percentComplete: (processedSamples / totalSamples) * 100,
            currentBatch: batchIndex + 1,
            totalBatches,
            estimatedTimeRemaining,
            samplesPerSecond,
          });
        }

        // Check for failures if fail-fast is enabled
        if (failFast) {
          const failures = batchResults.filter((r) => !r.passed);
          if (failures.length > 0) {
            throw new Error(
              `Evaluation failed on sample ${failures[0]!.sampleId}: ${failures[0]!.mismatches?.[0]?.message || 'Mismatch detected'}`,
            );
          }
        }
      } catch (error) {
        if (failFast) {
          throw error;
        }
        // Log error but continue
        console.error(`Batch ${batchIndex + 1} error:`, error);
      }
    }

    return results;
  }

  /**
   * Evaluate a single sample against all guardrails
   */
  private async evaluateSample(
    sample: EvaluationSample,
    context: GuardrailContext,
    timeoutMs: number,
  ): Promise<SampleResult> {
    const startTime = Date.now();
    const actualResults: Record<string, any> = {};
    const actualTriggers: Record<string, boolean> = {};
    const errors: Array<{ guardrailId: string; error: string }> = [];
    const mismatches: Array<{
      guardrailId: string;
      expected: boolean;
      actual: boolean;
      message?: string;
    }> = [];

    // Merge sample context with base context
    const mergedContext = {
      ...context,
      ...(sample.context || {}),
    };

    // Run all guardrails in parallel for this sample
    const guardrailPromises = Object.keys(sample.expectedTriggers).map(
      async (guardrailId) => {
        const guardrail = this.guardrails.get(guardrailId);
        if (!guardrail) {
          errors.push({
            guardrailId,
            error: `Guardrail '${guardrailId}' not found in configuration`,
          });
          return;
        }

        try {
          // Run with timeout
          const result = await this.runWithTimeout(
            () => guardrail.run(mergedContext, sample.data),
            timeoutMs,
          );

          actualResults[guardrailId] = result;
          actualTriggers[guardrailId] = result.tripwireTriggered;

          // Check for mismatch
          const expected = sample.expectedTriggers[guardrailId]!;
          const actual = result.tripwireTriggered;

          if (expected !== actual) {
            mismatches.push({
              guardrailId,
              expected,
              actual,
              message: expected
                ? `Expected to trigger but didn't`
                : `Triggered unexpectedly: ${result.message}`,
            });
          }
        } catch (error) {
          errors.push({
            guardrailId,
            error: error instanceof Error ? error.message : String(error),
          });
          // Consider execution errors as not triggered
          actualTriggers[guardrailId] = false;
        }
      },
    );

    await Promise.all(guardrailPromises);

    const executionTimeMs = Date.now() - startTime;
    const passed = mismatches.length === 0 && errors.length === 0;

    return {
      sampleId: sample.id,
      actualResults,
      expectedTriggers: sample.expectedTriggers,
      actualTriggers,
      passed,
      mismatches: mismatches.length > 0 ? mismatches : undefined,
      executionTimeMs,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Run a function with timeout
   */
  private async runWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Timeout after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  }

  /**
   * Get list of guardrails being evaluated
   */
  getGuardrailIds(): string[] {
    return Array.from(this.guardrails.keys());
  }

  /**
   * Add a guardrail to the engine
   */
  addGuardrail(guardrail: ConfiguredGuardrail): void {
    this.guardrails.set(guardrail.spec.id, guardrail);
  }

  /**
   * Remove a guardrail from the engine
   */
  removeGuardrail(guardrailId: string): boolean {
    return this.guardrails.delete(guardrailId);
  }

  /**
   * Get engine statistics
   */
  getStats(): {
    guardrailCount: number;
    guardrailIds: string[];
  } {
    return {
      guardrailCount: this.guardrails.size,
      guardrailIds: this.getGuardrailIds(),
    };
  }
}
