/**
 * Optional-peer substrate for the governance bridge.
 *
 * Holds the structural type-mirrors of `autotel-genai/agent` (so the generated
 * `.d.ts` carries no hard dependency on it), the lazy loader, and the two emit
 * combinators — the *only* places the peer lifecycle and the "observability must
 * never crash the call it observes" swallow are written. Everything else in this
 * folder (pure mappers, the product factories) builds on this layer.
 */

import type { GuardrailResult } from '../types';

// ============================================================================
// Optional-peer surface — declared structurally and locally so the generated
// `.d.ts` carries no hard dependency on `autotel-genai`. The real types live in
// `autotel-genai/agent`.
// ============================================================================

/** `autotel-genai` policy outcome. Mirrors its `PolicyDecision` union. */
export type PolicyDecision =
  | 'permit'
  | 'deny'
  | 'challenge'
  | 'observe'
  | 'error';

/** `autotel-genai` input-source classification. Mirrors `AgentInputProvenance`. */
export type AgentInputProvenance =
  | 'user_direct'
  | 'user_voice'
  | 'rag'
  | 'memory'
  | 'tool_result'
  | 'external_untrusted';

/**
 * Coarse risk class of a tool action (SAIF Principle 3 — characterize whether an
 * action is read-only vs state-changing vs sensitive). Mirrors `autotel-genai`'s
 * `AgentActionRiskClass`.
 */
export type AgentActionRiskClass =
  | 'read'
  | 'write'
  | 'destructive'
  | 'financial'
  | 'exfiltration_capable';

/** Distinct agent identity (SAIF Principle 1). Mirrors `AgentIdentity`. */
export interface GovernanceAgentIdentity {
  id: string;
  version?: string;
  framework?: string;
  model?: string;
  role?: string;
  sessionId?: string;
  conversationId?: string;
}

/** The subset of `autotel-genai/agent` this bridge calls. */
export interface AutotelAgentModule {
  recordPolicyDecision(
    metadata: PolicyDecisionMetadata,
    options?: EmitOptions,
  ): void;
  recordInputProvenance(input: { provenance: AgentInputProvenance }): void;
  recordControllerId(input: { controllerId: string; hashSalt?: string }): void;
  recordHumanApproval(input: {
    toolCallId?: string;
    toolName?: string;
    approved: boolean;
    required?: boolean;
    controllerId?: string;
    hashSalt?: string;
  }): void;
  recordActionRiskClass(riskClass: AgentActionRiskClass): void;
  recordPlanRiskAssessment(input: {
    assessment: PlanRiskAssessment;
    toolSequence?: string[];
    emitSecurityEvent?: boolean;
  }): void;
}

/**
 * A plan-risk verdict (SAIF Layer-2 reasoning-based defense — predict whether a
 * proposed tool plan is likely to lead to an undesirable outcome). Mirrors
 * `autotel-genai`'s `AgentPlanClassifierResult`.
 */
export interface PlanRiskAssessment {
  verdict: 'low' | 'medium' | 'high' | 'critical';
  /** 0..1 risk score from the classifier. */
  score?: number;
  categories?: string[];
  reason?: string;
}

export interface EmitOptions {
  onMissingContext?: 'warn' | 'skip' | 'throw';
}

/**
 * Delegation context for a multi-agent handoff (SAIF Principle 1/2 — distinct
 * identities + scoped authority). Mirrors autotel-genai's `DelegationContext`.
 */
export interface GovernanceDelegationContext {
  parentIdentity: string;
  scope?: string | string[];
  tokenId?: string;
  delegationId?: string;
}

/** Shape passed to `recordPolicyDecision` — a slice of `AgentActionMetadata`. */
export interface PolicyDecisionMetadata {
  action: string;
  resource?: string;
  agent: GovernanceAgentIdentity;
  eventKind?: 'policy_decision';
  category?: string;
  delegation?: GovernanceDelegationContext;
  policy?: {
    decision: PolicyDecision;
    policyId?: string;
    riskScore?: number;
    reason?: string;
  };
  reasoningSummary?: string;
}

export interface GuardrailGovernanceOptions {
  /**
   * The distinct agent identity these decisions are attributed to (SAIF
   * Principle 1 — agents must have well-defined identities).
   */
  agent: GovernanceAgentIdentity;
  /**
   * The controlling human user's id. Recorded (hashed by autotel-genai) on
   * input blocks and approval decisions to satisfy SAIF Principle 1.
   */
  controllerId?: string;
  /** Stable per-deployment salt used when hashing {@link controllerId}. */
  hashSalt?: string;
  /**
   * Provenance recorded for the perception-layer input when an input guardrail
   * blocks. Defaults to `'external_untrusted'` — a tripped input guardrail means
   * the input could not be trusted as a clean user command.
   */
  inputProvenance?: AgentInputProvenance;
  /** Override the 0..1 risk score derived for each blocked result. */
  riskScore?: (result: GuardrailResult) => number | undefined;
  /**
   * Characterize a tool's action risk class (SAIF Principle 3 — read-only vs
   * state-changing vs sensitive). Used by `guardrailGovernanceApproval`:
   * for every gated tool call (governed or not) that resolves to a class, the
   * bridge records `agent.action.risk_class`. Return `undefined` to leave a tool
   * uncharacterized. `autotel-genai`'s `deriveActionRiskClass(hints)` can build
   * the value from MCP-style hints.
   */
  toolRiskClass?: (toolName: string) => AgentActionRiskClass | undefined;
  /**
   * Behaviour when no active trace context can be resolved. Defaults to
   * `'skip'` (silent) — you opted into governance, but a missing span should
   * not spam logs. Set `'warn'` to surface mis-wired telemetry.
   */
  onMissingContext?: 'warn' | 'skip' | 'throw';
}

// ============================================================================
// Lazy optional-peer loader
// ============================================================================

let cached: AutotelAgentModule | null | undefined;

/**
 * Resolve `autotel-genai/agent` once. Returns `null` (cached) when the optional
 * peer is not installed, so the bridge degrades to a no-op instead of throwing.
 */
async function loadAutotelAgent(): Promise<AutotelAgentModule | null> {
  if (cached !== undefined) return cached;
  try {
    // Non-literal specifier: keeps the optional peer out of static module
    // resolution (no TS2307 when it isn't installed) and leaves bundlers to
    // treat it as an external, lazily-required dependency.
    const specifier = 'autotel-genai/agent';
    const mod = (await import(
      /* @vite-ignore */ specifier
    )) as unknown as AutotelAgentModule;
    cached = mod;
  } catch {
    cached = null;
  }
  return cached;
}

/** Test seam: inject (or reset with `null`) the resolved agent module. */
export function __setAutotelAgentModule(mod: AutotelAgentModule | null): void {
  cached = mod;
}

// ============================================================================
// Emit combinators — the only places the optional-peer lifecycle + the
// "observability must never crash the call it observes" swallow are written.
// ============================================================================

/**
 * Resolve the optional peer once, then run `body` with the agent and resolved
 * emit options. No-ops (without throwing) when the peer is absent.
 */
export async function withAgent(
  options: { onMissingContext?: EmitOptions['onMissingContext'] },
  body: (agent: AutotelAgentModule, emit: EmitOptions) => void,
): Promise<void> {
  const agent = await loadAutotelAgent();
  if (!agent) return;
  body(agent, { onMissingContext: options.onMissingContext ?? 'skip' });
}

/**
 * Best-effort single emit. autotel-genai's setters throw when no active span is
 * present; observability must never crash the guarded call, so the throw is
 * swallowed here — the one place that swallow lives.
 */
export function tryEmit(fn: () => void): void {
  try {
    fn();
  } catch {
    /* no active span — skip */
  }
}
