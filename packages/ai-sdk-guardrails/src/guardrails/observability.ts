/**
 * Observability & Metrics
 *
 * Provides metrics collection, violation analytics, and performance tracking
 * for guardrail execution.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable unicorn/numeric-separators-style */
/* eslint-disable unicorn/no-zero-fractions */
/* eslint-disable unicorn/no-array-sort */
/* eslint-disable unicorn/prefer-at */

import type {
  InputGuardrail,
  OutputGuardrail,
  GuardrailResult,
  GuardrailExecutionSummary,
} from '../types';

// ============================================================================
// Types
// ============================================================================

/**
 * Metrics for a single guardrail
 */
export interface GuardrailMetrics {
  /** Guardrail name */
  guardrailName: string;
  /** Total number of executions */
  executionCount: number;
  /** Number of times the guardrail blocked */
  blockCount: number;
  /** Number of execution errors */
  errorCount: number;
  /** Average execution time in ms */
  avgExecutionMs: number;
  /** 95th percentile execution time */
  p95ExecutionMs: number;
  /** 99th percentile execution time */
  p99ExecutionMs: number;
  /** Min execution time */
  minExecutionMs: number;
  /** Max execution time */
  maxExecutionMs: number;
  /** Block rate (0-1) */
  blockRate: number;
  /** Last violation timestamp */
  lastViolation?: Date;
  /** Violations by severity */
  violationsBySeverity: Record<string, number>;
  /** First seen timestamp */
  firstSeen: Date;
  /** Last seen timestamp */
  lastSeen: Date;
}

/**
 * Aggregated metrics across all guardrails
 */
export interface AggregatedMetrics {
  /** Total executions across all guardrails */
  totalExecutions: number;
  /** Total blocks across all guardrails */
  totalBlocks: number;
  /** Total errors across all guardrails */
  totalErrors: number;
  /** Overall block rate */
  overallBlockRate: number;
  /** Average execution time across all guardrails */
  avgExecutionMs: number;
  /** Per-guardrail metrics */
  byGuardrail: Map<string, GuardrailMetrics>;
  /** Metrics collection period start */
  periodStart: Date;
  /** Metrics collection period end */
  periodEnd: Date;
}

/**
 * Options for the metrics collector
 */
export interface MetricsCollectorOptions {
  /** Callback when metrics are flushed */
  onFlush?: (metrics: AggregatedMetrics) => void | Promise<void>;
  /** Flush interval in ms (default: 60000 - 1 minute) */
  flushIntervalMs?: number;
  /** Sampling rate 0-1 (default: 1.0 - collect all) */
  sampling?: number;
  /** Maximum number of execution times to track per guardrail (for percentiles) */
  maxExecutionTimeSamples?: number;
  /** Whether to auto-start flushing */
  autoStart?: boolean;
  /** Custom logger */
  logger?: {
    info: (msg: string, ...args: any[]) => void;
    warn: (msg: string, ...args: any[]) => void;
    error: (msg: string, ...args: any[]) => void;
  };
}

// ============================================================================
// Internal State
// ============================================================================

interface InternalMetrics {
  executionCount: number;
  blockCount: number;
  errorCount: number;
  executionTimes: number[];
  lastViolation?: Date;
  violationsBySeverity: Record<string, number>;
  firstSeen: Date;
  lastSeen: Date;
}

// ============================================================================
// Metrics Collector
// ============================================================================

/**
 * Creates a metrics collector for guardrail execution tracking.
 *
 * @example Basic usage
 * ```typescript
 * const collector = createMetricsCollector({
 *   onFlush: (metrics) => {
 *     console.log('Metrics:', {
 *       totalExecutions: metrics.totalExecutions,
 *       blockRate: metrics.overallBlockRate,
 *     });
 *   },
 *   flushIntervalMs: 60000, // Every minute
 * });
 *
 * // Wrap guardrails with metrics
 * const trackedGuardrail = collector.track(myGuardrail);
 *
 * // Use in config
 * const model = withGuardrails(baseModel, {
 *   inputGuardrails: [trackedGuardrail],
 * });
 *
 * // Get current metrics
 * const currentMetrics = collector.getMetrics();
 *
 * // Clean up
 * collector.stop();
 * ```
 *
 * @example With sampling and external metrics system
 * ```typescript
 * const collector = createMetricsCollector({
 *   sampling: 0.1, // Sample 10% of requests
 *   onFlush: async (metrics) => {
 *     await datadog.gauge('guardrails.block_rate', metrics.overallBlockRate);
 *     await datadog.histogram('guardrails.execution_time', metrics.avgExecutionMs);
 *
 *     for (const [name, guardrailMetrics] of metrics.byGuardrail) {
 *       await datadog.gauge(`guardrails.${name}.block_rate`, guardrailMetrics.blockRate);
 *     }
 *   },
 * });
 * ```
 */
export function createMetricsCollector(options: MetricsCollectorOptions = {}) {
  const {
    onFlush,
    flushIntervalMs = 60000,
    sampling = 1.0,
    maxExecutionTimeSamples = 1000,
    autoStart = true,
    logger = console,
  } = options;

  const metricsStore = new Map<string, InternalMetrics>();
  let periodStart = new Date();
  let flushInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Records a guardrail execution
   */
  function recordExecution(
    guardrailName: string,
    result: GuardrailResult,
    executionTimeMs: number,
  ): void {
    // Apply sampling
    if (sampling < 1.0 && Math.random() > sampling) {
      return;
    }

    let metrics = metricsStore.get(guardrailName);

    if (!metrics) {
      metrics = {
        executionCount: 0,
        blockCount: 0,
        errorCount: 0,
        executionTimes: [],
        violationsBySeverity: {},
        firstSeen: new Date(),
        lastSeen: new Date(),
      };
      metricsStore.set(guardrailName, metrics);
    }

    metrics.executionCount++;
    metrics.lastSeen = new Date();

    // Track execution time (with limit)
    if (metrics.executionTimes.length < maxExecutionTimeSamples) {
      metrics.executionTimes.push(executionTimeMs);
    } else {
      // Reservoir sampling for bounded memory
      const idx = Math.floor(Math.random() * metrics.executionCount);
      if (idx < maxExecutionTimeSamples) {
        metrics.executionTimes[idx] = executionTimeMs;
      }
    }

    if (result.tripwireTriggered) {
      metrics.blockCount++;
      metrics.lastViolation = new Date();

      const severity = result.severity || 'medium';
      metrics.violationsBySeverity[severity] =
        (metrics.violationsBySeverity[severity] || 0) + 1;
    }

    if (result.severity === 'critical' && result.metadata?.error) {
      metrics.errorCount++;
    }
  }

  /**
   * Calculates percentile from sorted array
   */
  function percentile(sortedArr: number[], p: number): number {
    if (sortedArr.length === 0) return 0;
    const idx = Math.ceil(sortedArr.length * p) - 1;
    return sortedArr[Math.max(0, Math.min(idx, sortedArr.length - 1))]!;
  }

  /**
   * Computes final metrics from internal state
   */
  function computeMetrics(): AggregatedMetrics {
    const now = new Date();
    const byGuardrail = new Map<string, GuardrailMetrics>();

    let totalExecutions = 0;
    let totalBlocks = 0;
    let totalErrors = 0;
    let totalExecutionTime = 0;
    let totalExecutionCount = 0;

    for (const [name, internal] of metricsStore) {
      const sortedTimes = [...internal.executionTimes].sort((a, b) => a - b);
      const avgTime =
        sortedTimes.length > 0
          ? sortedTimes.reduce((a, b) => a + b, 0) / sortedTimes.length
          : 0;

      const guardrailMetrics: GuardrailMetrics = {
        guardrailName: name,
        executionCount: internal.executionCount,
        blockCount: internal.blockCount,
        errorCount: internal.errorCount,
        avgExecutionMs: avgTime,
        p95ExecutionMs: percentile(sortedTimes, 0.95),
        p99ExecutionMs: percentile(sortedTimes, 0.99),
        minExecutionMs: sortedTimes[0] || 0,
        maxExecutionMs: sortedTimes[sortedTimes.length - 1] || 0,
        blockRate:
          internal.executionCount > 0
            ? internal.blockCount / internal.executionCount
            : 0,
        lastViolation: internal.lastViolation,
        violationsBySeverity: { ...internal.violationsBySeverity },
        firstSeen: internal.firstSeen,
        lastSeen: internal.lastSeen,
      };

      byGuardrail.set(name, guardrailMetrics);

      totalExecutions += internal.executionCount;
      totalBlocks += internal.blockCount;
      totalErrors += internal.errorCount;
      totalExecutionTime += avgTime * internal.executionCount;
      totalExecutionCount += internal.executionCount;
    }

    return {
      totalExecutions,
      totalBlocks,
      totalErrors,
      overallBlockRate: totalExecutions > 0 ? totalBlocks / totalExecutions : 0,
      avgExecutionMs:
        totalExecutionCount > 0 ? totalExecutionTime / totalExecutionCount : 0,
      byGuardrail,
      periodStart,
      periodEnd: now,
    };
  }

  /**
   * Flushes metrics and optionally calls the flush callback
   */
  async function flush(): Promise<AggregatedMetrics> {
    const metrics = computeMetrics();

    if (onFlush) {
      try {
        await onFlush(metrics);
      } catch (error) {
        logger.error('Error in metrics flush callback:', error);
      }
    }

    return metrics;
  }

  /**
   * Resets all metrics
   */
  function reset(): void {
    metricsStore.clear();
    periodStart = new Date();
  }

  /**
   * Starts the automatic flush interval
   */
  function start(): void {
    if (flushInterval) return;

    flushInterval = setInterval(async () => {
      await flush();
    }, flushIntervalMs);

    // Prevent interval from keeping Node.js process alive
    if (flushInterval.unref) {
      flushInterval.unref();
    }
  }

  /**
   * Stops the automatic flush interval
   */
  function stop(): void {
    if (flushInterval) {
      clearInterval(flushInterval);
      flushInterval = null;
    }
  }

  /**
   * Wraps a guardrail with metrics tracking
   */
  function track<M extends Record<string, unknown>>(
    guardrail: InputGuardrail<M>,
  ): InputGuardrail<M>;
  function track<M extends Record<string, unknown>>(
    guardrail: OutputGuardrail<M>,
  ): OutputGuardrail<M>;
  function track<M extends Record<string, unknown>>(
    guardrail: InputGuardrail<M> | OutputGuardrail<M>,
  ): InputGuardrail<M> | OutputGuardrail<M> {
    return {
      ...guardrail,
      execute: async (context: any, ...rest: any[]) => {
        const startTime = Date.now();

        try {
          const result = await (guardrail as any).execute(context, ...rest);
          const executionTime = Date.now() - startTime;

          recordExecution(guardrail.name, result, executionTime);

          return result;
        } catch (error) {
          const executionTime = Date.now() - startTime;

          const errorResult: GuardrailResult<M> = {
            tripwireTriggered: true,
            message: `Execution error: ${error instanceof Error ? error.message : 'Unknown'}`,
            severity: 'critical',
            metadata: { error: String(error) } as unknown as M,
          };

          recordExecution(guardrail.name, errorResult, executionTime);

          throw error;
        }
      },
    } as any;
  }

  /**
   * Tracks multiple guardrails at once
   */
  function trackAll<M extends Record<string, unknown>>(
    guardrails: InputGuardrail<M>[],
  ): InputGuardrail<M>[];
  function trackAll<M extends Record<string, unknown>>(
    guardrails: OutputGuardrail<M>[],
  ): OutputGuardrail<M>[];
  function trackAll<M extends Record<string, unknown>>(
    guardrails: Array<InputGuardrail<M> | OutputGuardrail<M>>,
  ): Array<InputGuardrail<M> | OutputGuardrail<M>> {
    return guardrails.map((g) => track(g as any));
  }

  // Auto-start if configured
  if (autoStart) {
    start();
  }

  return {
    /** Track a single guardrail */
    track,
    /** Track multiple guardrails */
    trackAll,
    /** Get current metrics without flushing */
    getMetrics: computeMetrics,
    /** Manually flush metrics */
    flush,
    /** Reset all metrics */
    reset,
    /** Start automatic flushing */
    start,
    /** Stop automatic flushing */
    stop,
    /** Record an execution manually */
    recordExecution,
  };
}

// ============================================================================
// Execution Summary Logging
// ============================================================================

/**
 * Logs an execution summary in a structured format
 */
export function logExecutionSummary(
  summary: GuardrailExecutionSummary,
  options: {
    logger?: {
      info: (msg: string, ...args: any[]) => void;
      warn: (msg: string, ...args: any[]) => void;
    };
    level?: 'info' | 'warn';
    includeDetails?: boolean;
  } = {},
): void {
  const { logger = console, level = 'info', includeDetails = false } = options;
  const logFn = level === 'warn' ? logger.warn : logger.info;

  const { stats, totalExecutionTime, guardrailsExecuted, blockedResults } =
    summary;

  logFn(
    `Guardrails executed: ${guardrailsExecuted} | ` +
      `Passed: ${stats.passed} | Blocked: ${stats.blocked} | ` +
      `Time: ${totalExecutionTime}ms | ` +
      `Avg: ${stats.averageExecutionTime.toFixed(1)}ms`,
  );

  if (includeDetails && blockedResults.length > 0) {
    logFn(
      'Blocked by:',
      blockedResults.map((r) => ({
        guardrail: r.context?.guardrailName || 'unknown',
        message: r.message,
        severity: r.severity,
      })),
    );
  }
}

// ============================================================================
// Health Check
// ============================================================================

/**
 * Guardrail health status
 */
export interface GuardrailHealthStatus {
  /** Overall health status */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Per-guardrail health */
  guardrails: Array<{
    name: string;
    status: 'healthy' | 'degraded' | 'unhealthy';
    reason?: string;
  }>;
  /** Timestamp of health check */
  timestamp: Date;
}

/**
 * Creates a health check function for guardrails
 */
export function createHealthCheck(
  guardrails: Array<InputGuardrail | OutputGuardrail>,
  options: {
    /** Error rate threshold for unhealthy (default: 0.1 = 10%) */
    errorRateThreshold?: number;
    /** Block rate threshold for degraded (default: 0.5 = 50%) */
    blockRateThreshold?: number;
    /** Metrics collector to get stats from */
    metricsCollector?: ReturnType<typeof createMetricsCollector>;
  } = {},
): () => GuardrailHealthStatus {
  const {
    errorRateThreshold = 0.1,
    blockRateThreshold = 0.5,
    metricsCollector,
  } = options;

  return () => {
    const guardrailStatuses: GuardrailHealthStatus['guardrails'] = [];
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (metricsCollector) {
      const metrics = metricsCollector.getMetrics();

      for (const guardrail of guardrails) {
        const guardrailMetrics = metrics.byGuardrail.get(guardrail.name);

        if (!guardrailMetrics || guardrailMetrics.executionCount === 0) {
          guardrailStatuses.push({
            name: guardrail.name,
            status: 'healthy',
            reason: 'No executions yet',
          });
          continue;
        }

        const errorRate =
          guardrailMetrics.errorCount / guardrailMetrics.executionCount;
        const blockRate = guardrailMetrics.blockRate;

        if (errorRate > errorRateThreshold) {
          guardrailStatuses.push({
            name: guardrail.name,
            status: 'unhealthy',
            reason: `High error rate: ${(errorRate * 100).toFixed(1)}%`,
          });
          overallStatus = 'unhealthy';
        } else if (blockRate > blockRateThreshold) {
          guardrailStatuses.push({
            name: guardrail.name,
            status: 'degraded',
            reason: `High block rate: ${(blockRate * 100).toFixed(1)}%`,
          });
          if (overallStatus === 'healthy') {
            overallStatus = 'degraded';
          }
        } else {
          guardrailStatuses.push({
            name: guardrail.name,
            status: 'healthy',
          });
        }
      }
    } else {
      // No metrics collector, just check if guardrails are configured
      for (const guardrail of guardrails) {
        guardrailStatuses.push({
          name: guardrail.name,
          status: guardrail.enabled === false ? 'degraded' : 'healthy',
          reason:
            guardrail.enabled === false ? 'Guardrail disabled' : undefined,
        });
      }
    }

    return {
      status: overallStatus,
      guardrails: guardrailStatuses,
      timestamp: new Date(),
    };
  };
}
