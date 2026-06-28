/**
 * Canonical ordinal severity scale, shared by guardrail results, plan-risk
 * verdicts, and tool-approval gating. One rank table and one risk mapping so the
 * ordering can't drift between subsystems.
 */

export type Severity = 'low' | 'medium' | 'high' | 'critical';

/** Ascending ordinal rank (low = 0 … critical = 3) for threshold comparisons. */
export const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/** Map a severity to a 0..1 risk score (low = 0.25 … critical = 1). */
export function severityToRisk(severity: Severity): number {
  return (SEVERITY_RANK[severity] + 1) / 4;
}
