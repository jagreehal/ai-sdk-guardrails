/**
 * Core type definitions for the v2 guardrails architecture.
 *
 * This module provides the foundational types for implementing guardrails,
 * including context interfaces, result types, and check functions.
 */

import type { LanguageModel } from 'ai';

/**
 * Base context interface that all guardrails receive
 */
export interface GuardrailContext {
  /** Optional reference to an LLM for guardrails that need it */
  llm?: LanguageModel;
  /** Request ID for tracing and correlation */
  requestId?: string;
  /** User ID for user-specific guardrails */
  userId?: string;
  /** Session ID for session tracking */
  sessionId?: string;
  /** Environment information */
  environment?: 'development' | 'staging' | 'production';
  /** Additional context data */
  [key: string]: any;
}

/**
 * Extended context for guardrails that need conversation history
 */
export interface GuardrailContextWithHistory extends GuardrailContext {
  /** Get the full conversation history */
  getConversationHistory(): ConversationMessage[];
  /** Get the index of the last message checked for this guardrail type */
  getLastCheckedIndex(guardrailId: string): number;
  /** Update the index of the last message checked */
  updateLastCheckedIndex(guardrailId: string, index: number): void;
}

/**
 * Conversation message format
 */
export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | any;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/**
 * Tool call format
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Guardrail result matching OpenAI's structure
 * Compatible with OpenAI's GuardrailResult while maintaining our extensions
 */
export interface GuardrailResult<TMetadata = any> {
  /** Whether the guardrail was triggered (blocked the request) */
  tripwireTriggered: boolean;

  /** Whether the guardrail execution failed */
  executionFailed?: boolean;

  /** Original exception if execution failed */
  originalException?: Error;

  /** Info object with structured metadata (using camelCase to match AI SDK convention) */
  info: {
    /** The processed/checked text when the guardrail modifies content */
    checkedText?: string;
    /** The media type this guardrail was designed for */
    mediaType?: string;
    /** The detected content type of the input data */
    detectedContentType?: string;
    /** The stage where this guardrail was executed (pre_flight, input, output) */
    stageName?: string;
    /** The name of the guardrail that produced this result */
    guardrailName?: string;
    /** Additional guardrail-specific metadata */
    [key: string]: unknown;
  };

  /** Human-readable message describing the result (extension beyond OpenAI) */
  message?: string;

  /** Severity level of the violation (extension beyond OpenAI) */
  severity?: 'low' | 'medium' | 'high' | 'critical';

  /** Suggested action to resolve the issue (extension beyond OpenAI) */
  suggestion?: string;

  /** Confidence score (0.0 to 1.0) for ML-based guardrails (extension beyond OpenAI) */
  confidence?: number;

  /** Detailed metadata about the guardrail execution (extension beyond OpenAI) */
  metadata?: TMetadata;

  /** Execution context information (extension beyond OpenAI) */
  context?: {
    guardrailName?: string;
    guardrailVersion?: string;
    executedAt?: Date;
    executionTimeMs?: number;
    environment?: string;
    [key: string]: any;
  };

  /** Modified content if the guardrail made changes (extension beyond OpenAI) */
  modifiedContent?: any;
}

/**
 * Type alias for a guardrail check function
 */
export type CheckFn<
  TContext extends GuardrailContext = GuardrailContext,
  TInput = unknown,
  TConfig = any,
  TMetadata = any,
> = (
  context: TContext,
  input: TInput,
  config: TConfig,
) => GuardrailResult<TMetadata> | Promise<GuardrailResult<TMetadata>>;

/**
 * Configuration for a guardrail instance (OpenAI-compatible)
 */
export interface GuardrailConfig {
  /** The registry name used to look up the guardrail spec (OpenAI format) */
  name: string;
  /** Configuration object for this guardrail instance (OpenAI format) */
  config: Record<string, unknown>;
}

/**
 * Bundle of guardrails for a specific stage (OpenAI-compatible)
 */
export interface GuardrailBundle {
  /** Version of the bundle format */
  version?: number;
  /** Name of the stage this bundle applies to */
  stageName?: string;
  /** Array of guardrail configurations */
  guardrails: GuardrailConfig[];
}

/**
 * Pipeline configuration with stage-based guardrails (OpenAI-compatible)
 */
export interface PipelineConfig {
  /** Configuration version */
  version?: number;
  /** Pre-flight checks before any processing */
  pre_flight?: GuardrailBundle;
  /** Input validation guardrails */
  input?: GuardrailBundle;
  /** Output validation guardrails */
  output?: GuardrailBundle;
}

/**
 * Result from running multiple guardrails
 */
export interface GuardrailBundleResult {
  /** Whether any guardrail was triggered */
  blocked: boolean;
  /** Individual guardrail results */
  results: GuardrailResult[];
  /** Aggregated metadata */
  metadata?: {
    totalExecutionTimeMs: number;
    triggeredCount: number;
    failedCount: number;
    successCount: number;
  };
}

/**
 * Options for retry functionality with guardrails
 */
export interface GuardrailRetryOptions<TParams, TResult> {
  /** Function to generate results */
  generate: (params: TParams, signal?: AbortSignal) => Promise<TResult>;
  /** Initial parameters */
  params: TParams;
  /** Guardrails to validate results */
  guardrails: GuardrailConfig[];
  /** Function to build retry parameters */
  buildRetryParams: (args: {
    lastParams: TParams;
    lastResult?: TResult;
    blockedResults: GuardrailResult[];
    attempt: number;
  }) => TParams;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Backoff strategy */
  backoffMs?: number | ((attempt: number) => number);
  /** Abort signal */
  signal?: AbortSignal;
}

/**
 * Evaluation sample for testing guardrails
 */
export interface EvaluationSample {
  /** Unique sample ID */
  id: string;
  /** Input data to test */
  data: any;
  /** Expected guardrail triggers */
  expectedTriggers: Record<string, boolean>;
  /** Optional metadata */
  metadata?: Record<string, any>;
}

/**
 * Evaluation result for a single sample
 */
export interface EvaluationResult {
  /** Sample ID */
  sampleId: string;
  /** Actual guardrail results */
  actualResults: Record<string, GuardrailResult>;
  /** Expected triggers */
  expectedTriggers: Record<string, boolean>;
  /** Whether the evaluation passed */
  passed: boolean;
  /** Error if evaluation failed */
  error?: string;
}

/**
 * Metrics calculated from evaluation results
 */
export interface EvaluationMetrics {
  /** Overall accuracy */
  accuracy: number;
  /** Precision for each guardrail */
  precision: Record<string, number>;
  /** Recall for each guardrail */
  recall: Record<string, number>;
  /** F1 score for each guardrail */
  f1Score: Record<string, number>;
  /** Confusion matrix for each guardrail */
  confusionMatrix: Record<
    string,
    {
      truePositives: number;
      trueNegatives: number;
      falsePositives: number;
      falseNegatives: number;
    }
  >;
  /** Execution time statistics */
  executionStats: {
    mean: number;
    median: number;
    p95: number;
    p99: number;
  };
}
