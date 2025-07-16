import {
  generateText,
  generateObject,
  streamText,
  streamObject,
  embed,
} from 'ai';

import type { GuardrailError } from './core';

// ============================================================================
// CORE TYPES
// ============================================================================

export interface GuardrailResult {
  /** Whether the guardrail was triggered (blocked the request) */
  tripwireTriggered: boolean;
  /** Human-readable message describing why the guardrail was triggered */
  message?: string;
  /** Detailed metadata about the guardrail execution */
  metadata?: Record<string, unknown>;
  /** Severity level of the guardrail violation */
  severity?: 'low' | 'medium' | 'high' | 'critical';
  /** Suggested action to resolve the issue */
  suggestion?: string;
  /** Performance metrics for the guardrail execution */
  performance?: {
    executionTimeMs: number;
    memoryUsage?: number;
  };
  /** Additional context information */
  context?: {
    guardrailName: string;
    guardrailVersion?: string;
    executedAt: Date;
    environment?: string;
  };
}

export type GuardrailsParams = {
  inputGuardrails?: InputGuardrail[];
  outputGuardrails?: OutputGuardrail[];
  onInputBlocked?: (error: GuardrailError) => void;
  onOutputBlocked?: (error: GuardrailError) => void;
  throwOnBlocked?: boolean;
  enablePerformanceMonitoring?: boolean;
};

// ============================================================================
// AI SDK PARAMETER TYPES
// ============================================================================

export type GenerateTextParams = Parameters<typeof generateText>[0];
export type GenerateObjectParams = Parameters<typeof generateObject>[0];
export type StreamTextParams = Parameters<typeof streamText>[0];
export type StreamObjectParams = Parameters<typeof streamObject>[0];
export type EmbedParams = Parameters<typeof embed>[0];

export type GenerateTextResult = Awaited<ReturnType<typeof generateText>>;
export type GenerateObjectResult = Awaited<ReturnType<typeof generateObject>>;
export type StreamTextResult = ReturnType<typeof streamText>;
export type StreamObjectResult = ReturnType<typeof streamObject>;
export type EmbedResult = ReturnType<typeof embed>;

export type InputGuardrailContext =
  | GenerateTextParams
  | GenerateObjectParams
  | StreamTextParams
  | StreamObjectParams
  | EmbedParams;

export type AIResult =
  | GenerateTextResult
  | GenerateObjectResult
  | StreamTextResult
  | StreamObjectResult
  | EmbedResult;

export type OutputGuardrailContext = {
  input: InputGuardrailContext;
  result: AIResult;
};

// ============================================================================
// GUARDRAIL INTERFACES
// ============================================================================

export interface InputGuardrail {
  /** Unique identifier for the guardrail */
  name: string;
  /** Human-readable description of what this guardrail does */
  description?: string;
  /** Version of the guardrail for tracking changes */
  version?: string;
  /** Tags for categorizing guardrails */
  tags?: string[];
  /** Whether this guardrail is enabled */
  enabled?: boolean;
  /** Priority level for execution order */
  priority?: 'low' | 'medium' | 'high' | 'critical';
  /** Configuration options for the guardrail */
  config?: Record<string, string | number | boolean>;
  /** The main execution function */
  execute: (
    context: InputGuardrailContext,
  ) => Promise<GuardrailResult> | GuardrailResult;
  /** Optional setup function called once when guardrail is initialized */
  setup?: () => Promise<void> | void;
  /** Optional cleanup function called when guardrail is destroyed */
  cleanup?: () => Promise<void> | void;
}

export interface OutputGuardrail {
  /** Unique identifier for the guardrail */
  name: string;
  /** Human-readable description of what this guardrail does */
  description?: string;
  /** Version of the guardrail for tracking changes */
  version?: string;
  /** Tags for categorizing guardrails */
  tags?: string[];
  /** Whether this guardrail is enabled */
  enabled?: boolean;
  /** Priority level for execution order */
  priority?: 'low' | 'medium' | 'high' | 'critical';
  /** Configuration options for the guardrail */
  config?: Record<string, string | number | boolean>;
  /** The main execution function */
  execute: (
    context: OutputGuardrailContext,
    accumulatedText?: string,
  ) => Promise<GuardrailResult> | GuardrailResult;
  /** Optional setup function called once when guardrail is initialized */
  setup?: () => Promise<void> | void;
  /** Optional cleanup function called when guardrail is destroyed */
  cleanup?: () => Promise<void> | void;
}
