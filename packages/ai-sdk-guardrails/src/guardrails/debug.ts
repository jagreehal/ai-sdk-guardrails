/**
 * Debug/Tracing Mode
 *
 * Provides detailed execution traces for debugging guardrail behavior,
 * including timing, decisions, patterns matched, and full context.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable unicorn/catch-error-name */
/* eslint-disable unicorn/no-immediate-mutation */
/* eslint-disable unicorn/prefer-single-call */
/* eslint-disable unicorn/switch-case-braces */
/* eslint-disable unicorn/no-useless-switch-case */

import { z } from 'zod';
import type {
  InputGuardrail,
  OutputGuardrail,
  GuardrailResult,
  NormalizedGuardrailContext,
} from '../types';

import type { GuardrailMetadata } from '../enhanced-types';

/** Metadata attached to a guardrail result. */
type ResultMetadata = NonNullable<GuardrailResult['metadata']>;

// ============================================================================
// Types
// ============================================================================

/**
 * Trace entry for a single guardrail execution
 */
export interface GuardrailTraceEntry {
  /** Guardrail name */
  guardrailName: string;
  /** Guardrail version if available */
  guardrailVersion?: string;
  /** Start time relative to trace start (ms) */
  startMs: number;
  /** End time relative to trace start (ms) */
  endMs: number;
  /** Duration in ms */
  durationMs: number;
  /** Result of execution */
  result: 'pass' | 'block' | 'error';
  /** Whether the guardrail triggered */
  triggered: boolean;
  /** Severity if triggered */
  severity?: 'low' | 'medium' | 'high' | 'critical';
  /** Message from the guardrail */
  message?: string;
  /** Patterns or keywords that matched (if any) */
  matchedPatterns?: string[];
  /** Confidence score if available */
  confidence?: number;
  /** Full decision details */
  decision: GuardrailResult;
  /** The result's metadata */
  debugInfo?: ResultMetadata;
}

/**
 * Complete execution trace
 */
export interface ExecutionTrace {
  /** Unique trace ID */
  traceId: string;
  /** Timestamp when trace started */
  timestamp: Date;
  /** Type of guardrails executed */
  type: 'input' | 'output';
  /** All guardrail execution entries */
  guardrails: GuardrailTraceEntry[];
  /** Total execution time in ms */
  totalMs: number;
  /** Final decision */
  finalDecision: 'allowed' | 'blocked';
  /** Guardrails that blocked (if any) */
  blockedBy?: string[];
  /** Input context (optionally included) */
  inputContext?: {
    promptLength: number;
    messageCount: number;
    hasSystemMessage: boolean;
    promptPreview?: string;
  };
  /** Output context (optionally included for output guardrails) */
  outputContext?: {
    responseLength: number;
    responsePreview?: string;
  };
  /** Metadata */
  metadata?: ResultMetadata;
}

/**
 * Debug configuration options
 */
export interface DebugOptions {
  /** Enable debug mode */
  enabled: boolean;
  /** Include verbose details (full input/output previews) */
  verbose?: boolean;
  /** Maximum length for text previews */
  previewLength?: number;
  /** Callback for each trace */
  onTrace?: (trace: ExecutionTrace) => void | Promise<void>;
  /** Custom trace ID generator */
  generateTraceId?: () => string;
  /** Include full input context in trace */
  includeInputContext?: boolean;
  /** Include full output context in trace */
  includeOutputContext?: boolean;
  /** Custom logger */
  logger?: {
    debug: (msg: string, ...args: any[]) => void;
    info: (msg: string, ...args: any[]) => void;
    warn: (msg: string, ...args: any[]) => void;
  };
}

// ============================================================================
// Trace ID Generation
// ============================================================================

let traceCounter = 0;

function defaultGenerateTraceId(): string {
  traceCounter++;
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);

  return `trace-${timestamp}-${random}-${traceCounter}`;
}

// ============================================================================
// Debug Wrapper
// ============================================================================

/**
 * Creates a debug wrapper for guardrails that captures detailed execution traces.
 *
 * @example Basic debugging
 * ```typescript
 * const debug = createDebugWrapper({
 *   enabled: true,
 *   verbose: true,
 *   onTrace: (trace) => console.log(JSON.stringify(trace, null, 2))
 * });
 *
 * const debuggedGuardrails = myGuardrails.map(g => debug.wrap(g));
 *
 * const model = withGuardrails({ model: baseModel,
 *   inputGuardrails: debuggedGuardrails,
 * });
 * ```
 *
 * @example With external logging
 * ```typescript
 * const debug = createDebugWrapper({
 *   enabled: process.env.DEBUG_GUARDRAILS === 'true',
 *   onTrace: async (trace) => {
 *     if (trace.finalDecision === 'blocked') {
 *       await logger.warn('Request blocked by guardrails', {
 *         traceId: trace.traceId,
 *         blockedBy: trace.blockedBy,
 *         duration: trace.totalMs
 *       });
 *     }
 *   }
 * });
 * ```
 */
export function createDebugWrapper(options: DebugOptions) {
  const {
    enabled,
    verbose = false,
    previewLength = 200,
    onTrace,
    generateTraceId = defaultGenerateTraceId,
    includeInputContext = true,
    includeOutputContext = true,
    logger = console,
  } = options;

  let currentTrace: ExecutionTrace | null = null;
  let traceStartTime: number = 0;

  /**
   * Starts a new trace
   */
  function startTrace(type: 'input' | 'output'): string {
    const traceId = generateTraceId();
    traceStartTime = Date.now();

    currentTrace = {
      traceId,
      timestamp: new Date(),
      type,
      guardrails: [],
      totalMs: 0,
      finalDecision: 'allowed',
    };

    if (verbose) {
      logger.debug(`[${traceId}] Starting ${type} guardrail trace`);
    }

    return traceId;
  }

  /**
   * Adds a guardrail entry to the current trace
   */
  function addEntry(entry: GuardrailTraceEntry): void {
    if (!currentTrace) return;

    currentTrace.guardrails?.push(entry);

    if (verbose) {
      const status = entry.triggered ? `BLOCKED (${entry.severity})` : 'PASSED';
      logger.debug(
        `[${currentTrace.traceId}] ${entry.guardrailName}: ${status} (${entry.durationMs}ms)`,
      );
    }
  }

  /**
   * Completes and emits the current trace
   */
  async function completeTrace(
    inputContext?: NormalizedGuardrailContext,
    outputContext?: { text?: string },
  ): Promise<ExecutionTrace | null> {
    if (!currentTrace) return null;

    const endTime = Date.now();
    currentTrace.totalMs = endTime - traceStartTime;

    const blockedEntries =
      currentTrace.guardrails?.filter((e) => e.triggered) || [];

    if (blockedEntries.length > 0) {
      currentTrace.finalDecision = 'blocked';
      currentTrace.blockedBy = blockedEntries.map((e) => e.guardrailName);
    }

    if (includeInputContext && inputContext) {
      currentTrace.inputContext = {
        promptLength: inputContext.prompt?.length || 0,
        messageCount: inputContext.messages?.length || 0,
        hasSystemMessage: !!inputContext.system,
      };

      if (verbose && inputContext.prompt) {
        currentTrace.inputContext.promptPreview =
          inputContext.prompt.length > previewLength
            ? inputContext.prompt.slice(0, previewLength) + '...'
            : inputContext.prompt;
      }
    }

    if (includeOutputContext && outputContext?.text) {
      currentTrace.outputContext = {
        responseLength: outputContext.text.length,
      };

      if (verbose) {
        currentTrace.outputContext.responsePreview =
          outputContext.text.length > previewLength
            ? outputContext.text.slice(0, previewLength) + '...'
            : outputContext.text;
      }
    }

    const finalTrace = currentTrace;

    if (onTrace) {
      try {
        await onTrace(finalTrace);
      } catch (error) {
        logger.warn('Error in trace callback:', error);
      }
    }

    if (verbose) {
      const status =
        finalTrace.finalDecision === 'blocked' ? 'BLOCKED' : 'ALLOWED';

      logger.info(
        `[${finalTrace.traceId}] Trace complete: ${status} | ` +
          `${finalTrace.guardrails.length} guardrails | ${finalTrace.totalMs}ms`,
      );
    }

    currentTrace = null;

    return finalTrace;
  }

  /**
   * Wraps a guardrail with debug tracing
   */
  function wrap<M extends GuardrailMetadata>(
    guardrail: InputGuardrail<M>,
  ): InputGuardrail<M>;
  function wrap<M extends GuardrailMetadata>(
    guardrail: OutputGuardrail<M>,
  ): OutputGuardrail<M>;
  function wrap<M extends GuardrailMetadata>(
    guardrail: InputGuardrail<M> | OutputGuardrail<M>,
  ): InputGuardrail<M> | OutputGuardrail<M> {
    if (!enabled) {
      return guardrail;
    }

    // SAFETY: the wrapper keeps every field of `guardrail` and its `execute`
    // forwards the caller's arguments unchanged, so it has the same signature
    // as the input or output guardrail it wraps.
    return {
      ...guardrail,
      execute: async (context: any, ...rest: any[]) => {
        const startTime = Date.now();
        const relativeStart = traceStartTime ? startTime - traceStartTime : 0;

        let result: GuardrailResult<M>;
        let error: Error | null = null;

        try {
          // SAFETY: these are the arguments the runtime passed to this wrapper,
          // which match the wrapped guardrail's own `execute` signature.
          result = await (guardrail as any).execute(context, ...rest);
        } catch (e) {
          error = e instanceof Error ? e : new Error(String(e));

          const errorMetadata: ResultMetadata = {
            error: error.message,
            stack: error.stack,
          };

          result = {
            tripwireTriggered: true,
            message: `Execution error: ${error.message}`,
            severity: 'critical',
            // SAFETY: M describes success metadata; a thrown guardrail always
            // reports `{ error, stack }`, and the error is rethrown below.
            metadata: errorMetadata as M,
          };
        }

        const endTime = Date.now();
        const relativeEnd = traceStartTime ? endTime - traceStartTime : 0;

        const entry: GuardrailTraceEntry = {
          guardrailName: guardrail.name,
          guardrailVersion: guardrail.version,
          startMs: relativeStart,
          endMs: relativeEnd,
          durationMs: endTime - startTime,
          result: error ? 'error' : result.tripwireTriggered ? 'block' : 'pass',
          triggered: result.tripwireTriggered,
          severity: result.severity,
          message: result.message,
          decision: result,
        };

        if (result.metadata) {
          const metadata = result.metadata;
          const patterns = metadata.patterns || metadata.matchedPatterns;

          if (patterns) {
            // SAFETY: by convention guardrails report `patterns` and
            // `matchedPatterns` as string arrays; the trace only displays them.
            entry.matchedPatterns = patterns as string[];
          }

          const confidence = z.number().safeParse(metadata.confidence);

          if (confidence.success) {
            entry.confidence = confidence.data;
          }

          entry.debugInfo = metadata;
        }

        addEntry(entry);

        if (error) {
          throw error;
        }

        return result;
      },
    } as any;
  }

  /**
   * Wraps multiple guardrails
   */
  function wrapAll<M extends GuardrailMetadata>(
    guardrails: InputGuardrail<M>[],
  ): InputGuardrail<M>[];
  function wrapAll<M extends GuardrailMetadata>(
    guardrails: OutputGuardrail<M>[],
  ): OutputGuardrail<M>[];
  function wrapAll<M extends GuardrailMetadata>(
    guardrails: Array<InputGuardrail<M> | OutputGuardrail<M>>,
  ): Array<InputGuardrail<M> | OutputGuardrail<M>> {
    // SAFETY: `wrap` handles input and output guardrails identically; the
    // overloads exist only to give callers a precise return type.
    return guardrails.map((g) => wrap(g as any));
  }

  return {
    /** Wrap a single guardrail with debugging */
    wrap,
    /** Wrap multiple guardrails */
    wrapAll,
    /** Start a new trace (call before executing guardrails) */
    startTrace,
    /** Complete and emit the current trace */
    completeTrace,
    /** Get the current trace ID */
    getCurrentTraceId: () => currentTrace?.traceId,
    /** Check if debugging is enabled */
    isEnabled: () => enabled,
  };
}

// ============================================================================
// Trace Formatters
// ============================================================================

/**
 * Formats a trace for console output
 */
export function formatTraceForConsole(trace: ExecutionTrace): string {
  const lines: string[] = [];

  lines.push(
    `\n╔═══════════════════════════════════════════════════════════════╗`,
  );
  lines.push(
    `║ GUARDRAIL EXECUTION TRACE                                     ║`,
  );
  lines.push(
    `╠═══════════════════════════════════════════════════════════════╣`,
  );
  lines.push(`║ Trace ID:   ${trace.traceId.padEnd(50)}║`);
  lines.push(`║ Timestamp:  ${trace.timestamp.toISOString().padEnd(50)}║`);
  lines.push(`║ Type:       ${trace.type.padEnd(50)}║`);
  lines.push(`║ Duration:   ${(trace.totalMs + 'ms').padEnd(50)}║`);
  lines.push(`║ Decision:   ${trace.finalDecision.toUpperCase().padEnd(50)}║`);
  lines.push(
    `╠═══════════════════════════════════════════════════════════════╣`,
  );
  lines.push(
    `║ GUARDRAILS EXECUTED                                           ║`,
  );
  lines.push(
    `╟───────────────────────────────────────────────────────────────╢`,
  );

  for (const entry of trace.guardrails) {
    const status = entry.triggered
      ? `BLOCK [${entry.severity || 'medium'}]`
      : 'PASS';

    const statusStr = status.padEnd(15);
    const name = entry.guardrailName.slice(0, 25).padEnd(25);
    const time = (entry.durationMs + 'ms').padEnd(8);

    lines.push(`║ ${statusStr} ${name} ${time}     ║`);

    if (entry.triggered && entry.message) {
      const msg = entry.message.slice(0, 55).padEnd(55);
      lines.push(`║   └─ ${msg}      ║`);
    }
  }

  if (trace.blockedBy && trace.blockedBy.length > 0) {
    lines.push(
      `╠═══════════════════════════════════════════════════════════════╣`,
    );
    lines.push(
      `║ BLOCKED BY: ${trace.blockedBy.join(', ').slice(0, 48).padEnd(48)}  ║`,
    );
  }

  lines.push(
    `╚═══════════════════════════════════════════════════════════════╝\n`,
  );

  return lines.join('\n');
}

/**
 * Formats a trace as JSON (for structured logging)
 */
export function formatTraceAsJSON(trace: ExecutionTrace): string {
  return JSON.stringify(trace, null, 2);
}

/**
 * Creates a compact trace summary for logging
 */
export function formatTraceSummary(trace: ExecutionTrace): string {
  const blocked = trace.guardrails.filter((g) => g.triggered);
  const passed = trace.guardrails.filter((g) => !g.triggered);

  return (
    `[${trace.traceId}] ${trace.type.toUpperCase()} | ` +
    `${trace.finalDecision.toUpperCase()} | ` +
    `${trace.guardrails.length} guardrails (${passed.length} passed, ${blocked.length} blocked) | ` +
    `${trace.totalMs}ms` +
    (trace.blockedBy ? ` | blocked by: ${trace.blockedBy.join(', ')}` : '')
  );
}

// ============================================================================
// Quick Debug Utilities
// ============================================================================

/**
 * Creates a simple console logger for debugging
 */
export function createConsoleDebugger(
  options: {
    verbose?: boolean;
    format?: 'console' | 'json' | 'summary';
  } = {},
): DebugOptions {
  const { verbose = false, format = 'summary' } = options;

  return {
    enabled: true,
    verbose,
    onTrace: (trace) => {
      switch (format) {
        case 'console':
          console.log(formatTraceForConsole(trace));
          break;
        case 'json':
          console.log(formatTraceAsJSON(trace));
          break;
        case 'summary':
        default:
          console.log(formatTraceSummary(trace));
      }
    },
  };
}

/**
 * Environment-based debug mode (checks GUARDRAILS_DEBUG env var)
 */
export function envDebugMode(): DebugOptions {
  const debugEnabled =
    process.env.GUARDRAILS_DEBUG === 'true' ||
    process.env.GUARDRAILS_DEBUG === '1';

  const verbose = process.env.GUARDRAILS_DEBUG_VERBOSE === 'true';

  return {
    enabled: debugEnabled,
    verbose,
    onTrace: debugEnabled
      ? (trace) => {
          console.log(formatTraceSummary(trace));

          if (verbose && trace.finalDecision === 'blocked') {
            console.log(formatTraceForConsole(trace));
          }
        }
      : undefined,
  };
}
