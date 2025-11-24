/**
 * Type definitions for the guardrail evaluation framework
 */

import type { GuardrailResult } from '../../enhanced-types';

/**
 * A sample in an evaluation dataset
 */
export interface EvaluationSample {
  /** Unique identifier for this sample */
  id: string;

  /** The input data to evaluate */
  data: string | Record<string, any>;

  /** Expected guardrail triggers (guardrail ID -> should trigger) */
  expectedTriggers: Record<string, boolean>;

  /** Optional metadata about the sample */
  metadata?: {
    /** Category or type of this sample */
    category?: string;
    /** Source of this sample */
    source?: string;
    /** Difficulty level */
    difficulty?: 'easy' | 'medium' | 'hard';
    /** Additional custom metadata */
    [key: string]: any;
  };

  /** Optional context to pass to guardrails */
  context?: Record<string, any>;
}

/**
 * Result of evaluating a single sample
 */
export interface SampleResult {
  /** Sample ID */
  sampleId: string;

  /** Actual results from each guardrail */
  actualResults: Record<string, GuardrailResult>;

  /** Expected triggers for comparison */
  expectedTriggers: Record<string, boolean>;

  /** Actual triggers that occurred */
  actualTriggers: Record<string, boolean>;

  /** Whether this sample passed (actual matches expected) */
  passed: boolean;

  /** Details about any mismatches */
  mismatches?: Array<{
    guardrailId: string;
    expected: boolean;
    actual: boolean;
    message?: string;
  }>;

  /** Execution time in milliseconds */
  executionTimeMs: number;

  /** Any errors that occurred */
  errors?: Array<{
    guardrailId: string;
    error: string;
  }>;
}

/**
 * Metrics for a single guardrail
 */
export interface GuardrailMetrics {
  /** Total samples evaluated */
  totalSamples: number;

  /** True positives (correctly triggered) */
  truePositives: number;

  /** True negatives (correctly not triggered) */
  trueNegatives: number;

  /** False positives (incorrectly triggered) */
  falsePositives: number;

  /** False negatives (incorrectly not triggered) */
  falseNegatives: number;

  /** Precision: TP / (TP + FP) */
  precision: number;

  /** Recall: TP / (TP + FN) */
  recall: number;

  /** F1 Score: 2 * (precision * recall) / (precision + recall) */
  f1Score: number;

  /** Accuracy: (TP + TN) / total */
  accuracy: number;

  /** Execution time statistics */
  executionStats: {
    mean: number;
    median: number;
    min: number;
    max: number;
    p95: number;
    p99: number;
  };
}

/**
 * Overall evaluation metrics
 */
export interface EvaluationMetrics {
  /** Timestamp when evaluation was run */
  timestamp: Date;

  /** Total samples in the dataset */
  totalSamples: number;

  /** Samples that passed all checks */
  passedSamples: number;

  /** Samples that had mismatches */
  failedSamples: number;

  /** Overall accuracy across all guardrails */
  overallAccuracy: number;

  /** Metrics per guardrail */
  guardrailMetrics: Record<string, GuardrailMetrics>;

  /** Total execution time */
  totalExecutionTimeMs: number;

  /** Average time per sample */
  averageTimePerSample: number;

  /** Configuration used for evaluation */
  config?: {
    batchSize: number;
    parallelExecution: boolean;
    timeoutMs?: number;
  };
}

/**
 * Full evaluation report
 */
export interface EvaluationReport {
  /** Evaluation metadata */
  metadata: {
    evaluationId: string;
    timestamp: Date;
    datasetPath: string;
    configPath: string;
    guardrailsEvaluated: string[];
    environment?: string;
  };

  /** Overall metrics */
  metrics: EvaluationMetrics;

  /** Individual sample results */
  sampleResults: SampleResult[];

  /** Summary statistics */
  summary: {
    strongPerformers: Array<{
      guardrailId: string;
      f1Score: number;
    }>;
    weakPerformers: Array<{
      guardrailId: string;
      f1Score: number;
      issues: string[];
    }>;
    recommendations?: string[];
  };
}

/**
 * Configuration for running evaluations
 */
export interface EvaluationConfig {
  /** Path to JSONL dataset */
  datasetPath: string;

  /** Path to guardrail configuration */
  configPath: string;

  /** Output directory for results */
  outputDir?: string;

  /** Number of samples to process in parallel */
  batchSize?: number;

  /** Whether to save detailed results */
  saveDetailedResults?: boolean;

  /** Whether to generate visualizations */
  generateVisualizations?: boolean;

  /** Timeout for individual guardrail execution */
  timeoutMs?: number;

  /** Whether to fail fast on first error */
  failFast?: boolean;

  /** Filter to run only specific guardrails */
  guardrailFilter?: string[];

  /** Filter to run only specific sample categories */
  sampleFilter?: {
    categories?: string[];
    difficulty?: Array<'easy' | 'medium' | 'hard'>;
  };
}

/**
 * Progress callback for evaluation runs
 */
export interface EvaluationProgress {
  /** Current sample being processed */
  currentSample: number;

  /** Total samples to process */
  totalSamples: number;

  /** Percentage complete */
  percentComplete: number;

  /** Current batch */
  currentBatch: number;

  /** Total batches */
  totalBatches: number;

  /** Estimated time remaining in seconds */
  estimatedTimeRemaining?: number;

  /** Samples processed per second */
  samplesPerSecond?: number;
}
