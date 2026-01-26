/**
 * Gradual Enforcement Mode
 *
 * Provides soft-fail patterns, warning escalation, and grace periods
 * for introducing new guardrails without immediately blocking users.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable unicorn/numeric-separators-style */
/* eslint-disable unicorn/no-useless-switch-case */
/* eslint-disable unicorn/switch-case-braces */

import type {
  InputGuardrail,
  OutputGuardrail,
  GuardrailResult,
} from '../types';

// ============================================================================
// Types
// ============================================================================

/**
 * Enforcement mode for gradual rollout
 */
export type EnforcementMode = 'warn' | 'escalate' | 'enforce';

/**
 * Escalation configuration for gradual enforcement
 */
export interface EscalationConfig {
  /** Number of violations to warn about before blocking */
  warnCount: number;
  /** Number of violations after which to start blocking */
  blockAfter: number;
  /** Time window in ms to reset the counter */
  windowMs: number;
  /** Optional: only escalate for specific severities */
  severities?: Array<'low' | 'medium' | 'high' | 'critical'>;
}

/**
 * Grace period configuration
 */
export interface GracePeriodConfig {
  /** Don't block until this date */
  until: Date;
  /** Log level for grace period violations */
  logLevel?: 'debug' | 'info' | 'warn';
  /** Custom message to include in logs */
  message?: string;
}

/**
 * Options for gradual enforcement wrapper
 */
export interface GradualEnforcementOptions {
  /** Enforcement mode */
  mode: EnforcementMode;
  /** Escalation configuration (for 'escalate' mode) */
  escalation?: EscalationConfig;
  /** Grace period configuration */
  gracePeriod?: GracePeriodConfig;
  /** Callback when a violation is detected but not blocked */
  onWarn?: (result: GuardrailResult, stats: ViolationStats) => void;
  /** Callback when enforcement transitions from warn to block */
  onEscalation?: (stats: ViolationStats) => void;
  /** Storage key for persisting violation counts (optional) */
  storageKey?: string;
}

/**
 * Violation statistics
 */
export interface ViolationStats {
  /** Total violations in current window */
  count: number;
  /** Window start time */
  windowStart: Date;
  /** Whether currently in blocking mode */
  isBlocking: boolean;
  /** Violations by severity */
  bySeverity: Record<string, number>;
}

// ============================================================================
// In-Memory Storage for Violation Tracking
// ============================================================================

interface ViolationRecord {
  count: number;
  windowStart: number;
  bySeverity: Record<string, number>;
}

const violationStorage = new Map<string, ViolationRecord>();

function getViolationRecord(key: string, windowMs: number): ViolationRecord {
  const now = Date.now();
  let record = violationStorage.get(key);

  if (!record || now - record.windowStart > windowMs) {
    // Reset or create new record
    record = {
      count: 0,
      windowStart: now,
      bySeverity: {},
    };
    violationStorage.set(key, record);
  }

  return record;
}

function incrementViolation(
  key: string,
  windowMs: number,
  severity?: string,
): ViolationRecord {
  const record = getViolationRecord(key, windowMs);
  record.count++;
  if (severity) {
    record.bySeverity[severity] = (record.bySeverity[severity] || 0) + 1;
  }
  violationStorage.set(key, record);
  return record;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Wraps a guardrail with gradual enforcement behavior.
 *
 * This enables soft-fail patterns for rolling out new guardrails:
 * - 'warn': Log violations but never block
 * - 'escalate': Warn for first N violations, then start blocking
 * - 'enforce': Always block (with optional grace period)
 *
 * @example Warn-only mode (for testing new rules)
 * ```typescript
 * const warnOnlyGuardrail = withGradualEnforcement(toxicityFilter(), {
 *   mode: 'warn',
 *   onWarn: (result, stats) => {
 *     analytics.track('guardrail_would_block', {
 *       guardrail: 'toxicity',
 *       message: result.message,
 *       count: stats.count
 *     });
 *   }
 * });
 * ```
 *
 * @example Escalation mode (gradual tightening)
 * ```typescript
 * const escalatingGuardrail = withGradualEnforcement(toxicityFilter(), {
 *   mode: 'escalate',
 *   escalation: {
 *     warnCount: 3,      // Warn for first 3 violations
 *     blockAfter: 5,     // Block after 5 violations
 *     windowMs: 60000,   // Reset counter every minute
 *   },
 *   onEscalation: (stats) => {
 *     notifyModerator(`User escalated to blocking after ${stats.count} violations`);
 *   }
 * });
 * ```
 *
 * @example Grace period (for new rules)
 * ```typescript
 * const newRuleGuardrail = withGradualEnforcement(newComplianceRule(), {
 *   mode: 'enforce',
 *   gracePeriod: {
 *     until: new Date('2024-02-01'),
 *     logLevel: 'warn',
 *     message: 'New compliance rule will be enforced starting Feb 1'
 *   }
 * });
 * ```
 */
export function withGradualEnforcement<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  guardrail: InputGuardrail<M>,
  options: GradualEnforcementOptions,
): InputGuardrail<M>;

export function withGradualEnforcement<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  guardrail: OutputGuardrail<M>,
  options: GradualEnforcementOptions,
): OutputGuardrail<M>;

export function withGradualEnforcement<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  guardrail: InputGuardrail<M> | OutputGuardrail<M>,
  options: GradualEnforcementOptions,
): InputGuardrail<M> | OutputGuardrail<M> {
  const {
    mode,
    escalation,
    gracePeriod,
    onWarn,
    onEscalation,
    storageKey = guardrail.name,
  } = options;

  return {
    ...guardrail,
    name: `gradual(${guardrail.name})`,
    description: `${guardrail.description || guardrail.name} [mode: ${mode}]`,
    execute: async (context: any, ...rest: any[]) => {
      // Execute the underlying guardrail
      const result = await (guardrail as any).execute(context, ...rest);

      // If guardrail didn't trigger, pass through
      if (!result.tripwireTriggered) {
        return result;
      }

      // Check grace period
      if (gracePeriod && new Date() < gracePeriod.until) {
        const logFn =
          gracePeriod.logLevel === 'debug'
            ? console.debug
            : gracePeriod.logLevel === 'info'
              ? console.info
              : console.warn;

        logFn(
          `[Grace Period] ${guardrail.name}: ${result.message}`,
          gracePeriod.message ||
            `Enforcement begins ${gracePeriod.until.toISOString()}`,
        );

        return {
          ...result,
          tripwireTriggered: false,
          metadata: {
            ...result.metadata,
            gradualEnforcement: {
              mode: 'grace-period',
              wouldBlock: true,
              gracePeriodUntil: gracePeriod.until.toISOString(),
            },
          } as M,
        };
      }

      // Handle based on mode
      switch (mode) {
        case 'warn': {
          const record = incrementViolation(
            storageKey,
            escalation?.windowMs || 60000,
            result.severity,
          );

          const stats: ViolationStats = {
            count: record.count,
            windowStart: new Date(record.windowStart),
            isBlocking: false,
            bySeverity: record.bySeverity,
          };

          if (onWarn) {
            onWarn(result, stats);
          }

          console.warn(
            `[Warn Mode] ${guardrail.name}: ${result.message} (violation #${record.count})`,
          );

          return {
            ...result,
            tripwireTriggered: false,
            metadata: {
              ...result.metadata,
              gradualEnforcement: {
                mode: 'warn',
                wouldBlock: true,
                violationCount: record.count,
              },
            } as M,
          };
        }

        case 'escalate': {
          if (!escalation) {
            throw new Error('Escalation config required for escalate mode');
          }

          const record = incrementViolation(
            storageKey,
            escalation.windowMs,
            result.severity,
          );

          const stats: ViolationStats = {
            count: record.count,
            windowStart: new Date(record.windowStart),
            isBlocking: record.count > escalation.blockAfter,
            bySeverity: record.bySeverity,
          };

          // Check if we should escalate based on severity filter
          const shouldCheckSeverity =
            escalation.severities && escalation.severities.length > 0;
          const matchesSeverity =
            !shouldCheckSeverity ||
            (result.severity &&
              escalation.severities!.includes(result.severity));

          if (!matchesSeverity) {
            // Severity doesn't match escalation filter, treat as warn
            if (onWarn) {
              onWarn(result, stats);
            }
            return {
              ...result,
              tripwireTriggered: false,
              metadata: {
                ...result.metadata,
                gradualEnforcement: {
                  mode: 'escalate',
                  phase: 'warn',
                  wouldBlock: true,
                  violationCount: record.count,
                  severityFiltered: true,
                },
              } as M,
            };
          }

          if (record.count <= escalation.warnCount) {
            // Still in warning phase
            if (onWarn) {
              onWarn(result, stats);
            }

            console.warn(
              `[Escalate: Warning] ${guardrail.name}: ${result.message} ` +
                `(${record.count}/${escalation.warnCount} before blocking)`,
            );

            return {
              ...result,
              tripwireTriggered: false,
              metadata: {
                ...result.metadata,
                gradualEnforcement: {
                  mode: 'escalate',
                  phase: 'warn',
                  wouldBlock: true,
                  violationCount: record.count,
                  warnThreshold: escalation.warnCount,
                  blockThreshold: escalation.blockAfter,
                },
              } as M,
            };
          }

          if (record.count > escalation.blockAfter) {
            // Blocking phase
            if (record.count === escalation.blockAfter + 1 && onEscalation) {
              onEscalation(stats);
            }

            console.error(
              `[Escalate: Blocking] ${guardrail.name}: ${result.message} ` +
                `(${record.count} violations, blocking enabled)`,
            );

            return {
              ...result,
              tripwireTriggered: true,
              metadata: {
                ...result.metadata,
                gradualEnforcement: {
                  mode: 'escalate',
                  phase: 'block',
                  violationCount: record.count,
                  blockThreshold: escalation.blockAfter,
                },
              } as M,
            };
          }

          // Between warn and block thresholds - still warning
          if (onWarn) {
            onWarn(result, stats);
          }

          return {
            ...result,
            tripwireTriggered: false,
            metadata: {
              ...result.metadata,
              gradualEnforcement: {
                mode: 'escalate',
                phase: 'warn-elevated',
                wouldBlock: true,
                violationCount: record.count,
                remainingBeforeBlock: escalation.blockAfter - record.count,
              },
            } as M,
          };
        }

        case 'enforce':
        default:
          // Full enforcement, just pass through the result
          return result;
      }
    },
  } as any;
}

/**
 * Clears violation history for a guardrail or all guardrails.
 * Useful for testing or manual resets.
 */
export function clearViolationHistory(guardrailName?: string): void {
  if (guardrailName) {
    violationStorage.delete(guardrailName);
  } else {
    violationStorage.clear();
  }
}

/**
 * Gets current violation stats for a guardrail
 */
export function getViolationStats(
  guardrailName: string,
  windowMs: number = 60000,
): ViolationStats | null {
  const record = violationStorage.get(guardrailName);

  if (!record) {
    return null;
  }

  const now = Date.now();
  const isExpired = now - record.windowStart > windowMs;

  if (isExpired) {
    return null;
  }

  return {
    count: record.count,
    windowStart: new Date(record.windowStart),
    isBlocking: false, // Would need escalation config to determine
    bySeverity: record.bySeverity,
  };
}

// ============================================================================
// Preset Configurations
// ============================================================================

/**
 * Creates a warn-only enforcement (for A/B testing new rules)
 */
export function warnOnly<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  guardrail: InputGuardrail<M> | OutputGuardrail<M>,
  options?: {
    onWarn?: (result: GuardrailResult, stats: ViolationStats) => void;
  },
): InputGuardrail<M> | OutputGuardrail<M> {
  return withGradualEnforcement(guardrail as any, {
    mode: 'warn',
    onWarn: options?.onWarn,
  });
}

/**
 * Creates a lenient escalation (3 warnings, block after 5)
 */
export function lenientEscalation<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  guardrail: InputGuardrail<M> | OutputGuardrail<M>,
  options?: {
    onWarn?: (result: GuardrailResult, stats: ViolationStats) => void;
    onEscalation?: (stats: ViolationStats) => void;
  },
): InputGuardrail<M> | OutputGuardrail<M> {
  return withGradualEnforcement(guardrail as any, {
    mode: 'escalate',
    escalation: {
      warnCount: 3,
      blockAfter: 5,
      windowMs: 60000, // 1 minute
    },
    onWarn: options?.onWarn,
    onEscalation: options?.onEscalation,
  });
}

/**
 * Creates a strict escalation (1 warning, block after 2)
 */
export function strictEscalation<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  guardrail: InputGuardrail<M> | OutputGuardrail<M>,
  options?: {
    onWarn?: (result: GuardrailResult, stats: ViolationStats) => void;
    onEscalation?: (stats: ViolationStats) => void;
  },
): InputGuardrail<M> | OutputGuardrail<M> {
  return withGradualEnforcement(guardrail as any, {
    mode: 'escalate',
    escalation: {
      warnCount: 1,
      blockAfter: 2,
      windowMs: 300000, // 5 minutes
    },
    onWarn: options?.onWarn,
    onEscalation: options?.onEscalation,
  });
}

/**
 * Creates enforcement with a grace period
 */
export function withGracePeriod<
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  guardrail: InputGuardrail<M> | OutputGuardrail<M>,
  until: Date,
  options?: {
    logLevel?: 'debug' | 'info' | 'warn';
    message?: string;
  },
): InputGuardrail<M> | OutputGuardrail<M> {
  return withGradualEnforcement(guardrail as any, {
    mode: 'enforce',
    gracePeriod: {
      until,
      logLevel: options?.logLevel || 'warn',
      message: options?.message,
    },
  });
}
