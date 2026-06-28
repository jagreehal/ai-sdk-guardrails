/**
 * Pure SAIF policy mappers — the guardrail-result → policy-decision mapping,
 * unit-tested in isolation. No I/O, no optional-peer lifecycle; just data shape
 * transforms over {@link ../types.GuardrailResult} and the peer type vocabulary.
 */

import type { GuardrailResult } from '../types';
import { severityToRisk } from '../severity';
import type {
  GovernanceAgentIdentity,
  GovernanceDelegationContext,
  GuardrailGovernanceOptions,
  PolicyDecision,
  PolicyDecisionMetadata,
} from './peer';

/** Map a guardrail result to a 0..1 risk score: confidence first, else severity. */
export function severityToRiskScore(
  result: GuardrailResult,
): number | undefined {
  if (typeof result.confidence === 'number') return result.confidence;
  if (result.severity) return severityToRisk(result.severity);
  return undefined;
}

/** Best-available human name for the guardrail that produced a result. */
export function guardrailNameOf(result: GuardrailResult): string {
  const fromContext = result.context?.guardrailName;
  const fromInfo = result.info?.guardrailName;
  return (
    (typeof fromContext === 'string' && fromContext) ||
    (typeof fromInfo === 'string' && fromInfo) ||
    'guardrail'
  );
}

/** Pull observed tool names from a guardrail result's metadata/info, if any. */
export function observedToolsOf(result: GuardrailResult): string[] {
  const fromMeta = (result.metadata as { observedTools?: unknown } | undefined)
    ?.observedTools;
  const fromInfo = (result.info as { observedTools?: unknown } | undefined)
    ?.observedTools;
  const tools = Array.isArray(fromMeta)
    ? fromMeta
    : Array.isArray(fromInfo)
      ? fromInfo
      : [];
  return tools.filter((t): t is string => typeof t === 'string');
}

/** Resolve a result's 0..1 risk score: the caller's override, else severity. */
export function riskScoreOf(
  result: GuardrailResult,
  options: GuardrailGovernanceOptions,
): number | undefined {
  return (options.riskScore ?? severityToRiskScore)(result);
}

/**
 * The single constructor for a `recordPolicyDecision` payload. Every emit path
 * funnels through here, so the `eventKind` constant and the `policy` sub-shape
 * live in exactly one place (and the unit test that covers it covers them all).
 */
export function policyDecision(input: {
  action: string;
  agent: GovernanceAgentIdentity;
  decision: PolicyDecision;
  resource?: string;
  riskScore?: number;
  reason?: string;
  category?: string;
  delegation?: GovernanceDelegationContext;
  reasoningSummary?: string;
}): PolicyDecisionMetadata {
  return {
    action: input.action,
    resource: input.resource,
    agent: input.agent,
    eventKind: 'policy_decision',
    category: input.category,
    delegation: input.delegation,
    policy: {
      decision: input.decision,
      riskScore: input.riskScore,
      reason: input.reason,
    },
    reasoningSummary: input.reasoningSummary,
  };
}

/**
 * Map a blocked guardrail result to a `recordPolicyDecision` payload. A block is
 * a deterministic policy-engine **deny** (SAIF Principle 2 / Layer 1).
 */
export function toPolicyDecisionMetadata(
  result: GuardrailResult,
  options: GuardrailGovernanceOptions,
): PolicyDecisionMetadata {
  return policyDecision({
    action: guardrailNameOf(result),
    agent: options.agent,
    decision: 'deny',
    riskScore: riskScoreOf(result, options),
    reason: result.message,
    category: result.severity,
    reasoningSummary: result.message,
  });
}

/** Map a v7 `toolApproval` status to a policy decision. */
export function approvalStatusToPolicyDecision(
  statusType: 'approved' | 'denied' | 'user-approval' | 'not-applicable',
): PolicyDecision | undefined {
  switch (statusType) {
    case 'approved': {
      return 'permit';
    }
    case 'denied': {
      return 'deny';
    }
    case 'user-approval': {
      return 'challenge';
    }
    case 'not-applicable': {
      return undefined;
    }
  }
}
