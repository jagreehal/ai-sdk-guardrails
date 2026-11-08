/**
 * Pure SAIF policy mappers: the guardrail-result to policy-decision mapping.
 * No I/O and no optional-peer lifecycle; data shape transforms over
 * {@link ../types.GuardrailResult} and the peer type vocabulary.
 */

import { z } from 'zod';
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
  if (result.confidence !== undefined) return result.confidence;

  if (result.severity) return severityToRisk(result.severity);

  return undefined;
}

/** Best-available human name for the guardrail that produced a result. */
export function guardrailNameOf(result: GuardrailResult): string {
  return (
    result.context?.guardrailName || result.info?.guardrailName || 'guardrail'
  );
}

const observedToolsSchema = z.array(z.unknown());

const toolNameSchema = z.string();

/** Pull observed tool names from a guardrail result's metadata/info, if any. */
export function observedToolsOf(result: GuardrailResult): string[] {
  const fromMeta = observedToolsSchema.safeParse(
    result.metadata?.observedTools,
  );

  const fromInfo = observedToolsSchema.safeParse(result.info?.observedTools);

  const tools = fromMeta.success
    ? fromMeta.data
    : fromInfo.success
      ? fromInfo.data
      : [];

  return tools.flatMap((tool) => {
    const parsed = toolNameSchema.safeParse(tool);

    return parsed.success ? [parsed.data] : [];
  });
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
