/**
 * `ai-sdk-guardrails/governance` — bridge guardrail outcomes into
 * **autotel-genai**'s agent-governance signals, structured around Google's
 * *Secure AI Agents* (SAIF) three principles:
 *
 * 1. **Well-defined human controllers** — records the controlling user
 *    (`recordControllerId`), the provenance of untrusted input
 *    (`recordInputProvenance`), and human-in-the-loop approval outcomes
 *    (`recordHumanApproval`).
 * 2. **Limited powers** — every block is emitted as a deterministic policy
 *    decision (`recordPolicyDecision` with `decision: 'deny'`), the canonical
 *    record of a runtime policy engine refusing an action.
 * 3. **Observable actions** — all of the above land on the active OpenTelemetry
 *    GenAI span, so guardrail decisions live in the *same* trace tree as the
 *    model calls they guard.
 *
 * `autotel-genai` is an **optional peer**: the {@link ./peer} layer lazily
 * imports it and silently no-ops when it (or an active trace context) is absent.
 * Observability must never crash the call it observes, so every emit is
 * best-effort.
 *
 * This module is the barrel + the four product factories. The shared substrate
 * lives in {@link ./peer} (optional-peer types + lifecycle) and the pure SAIF
 * mapping in {@link ./mappers}.
 *
 * ```ts
 * import { withGuardrails, promptInjectionDetector, sensitiveDataFilter } from 'ai-sdk-guardrails';
 * import { guardrailGovernance } from 'ai-sdk-guardrails/governance';
 *
 * const gov = guardrailGovernance({
 *   agent: { id: 'support-agent', model: 'gpt-4o' },
 *   controllerId: user.id,
 * });
 *
 * const model = withGuardrails({ model: baseModel,
 *   inputGuardrails: [promptInjectionDetector()],
 *   outputGuardrails: [sensitiveDataFilter()],
 *   onInputBlocked: gov.onInputBlocked,
 *   onOutputBlocked: gov.onOutputBlocked,
 * });
 * ```
 */

import type { Telemetry } from 'ai';
import type { GuardrailExecutionSummary, GuardrailResult } from '../types';
import { withAgent, tryEmit } from './peer';
import type {
  AgentActionRiskClass,
  GovernanceAgentIdentity,
  GovernanceDelegationContext,
  GuardrailGovernanceOptions,
  PlanRiskAssessment,
} from './peer';
import {
  approvalStatusToPolicyDecision,
  observedToolsOf,
  policyDecision,
  riskScoreOf,
  toPolicyDecisionMetadata,
} from './mappers';

// ── Re-exports: the substrate + pure mappers are part of this module's surface.
export { __setAutotelAgentModule } from './peer';
export type {
  PolicyDecision,
  AgentInputProvenance,
  AgentActionRiskClass,
  GovernanceAgentIdentity,
  PlanRiskAssessment,
  GovernanceDelegationContext,
  PolicyDecisionMetadata,
  GuardrailGovernanceOptions,
} from './peer';
export {
  severityToRiskScore,
  guardrailNameOf,
  policyDecision,
  toPolicyDecisionMetadata,
  approvalStatusToPolicyDecision,
} from './mappers';

// ============================================================================
// Block-decision hooks (SAIF Principle 1/2)
// ============================================================================

async function emitBlocked(
  stage: 'input' | 'output',
  summary: GuardrailExecutionSummary,
  options: GuardrailGovernanceOptions,
): Promise<void> {
  await withAgent(options, (agent, emit) => {
    for (const result of summary.blockedResults) {
      tryEmit(() =>
        agent.recordPolicyDecision(
          toPolicyDecisionMetadata(result, options),
          emit,
        ),
      );

      // SAIF Principle 2/3: when a tool guardrail (e.g. toolEgressPolicy)
      // blocks, characterize each observed tool's action risk class.
      for (const toolName of observedToolsOf(result)) {
        const riskClass = options.toolRiskClass?.(toolName);
        if (riskClass) tryEmit(() => agent.recordActionRiskClass(riskClass));
      }
    }

    // SAIF Principle 1: on an input block, capture who the controller was and
    // that the input is untrusted.
    if (stage === 'input') {
      const { controllerId, hashSalt } = options;
      if (controllerId) {
        tryEmit(() => agent.recordControllerId({ controllerId, hashSalt }));
      }
      tryEmit(() =>
        agent.recordInputProvenance({
          provenance: options.inputProvenance ?? 'external_untrusted',
        }),
      );
    }
  });
}

export interface GuardrailGovernanceHooks {
  onInputBlocked: (summary: GuardrailExecutionSummary) => void;
  onOutputBlocked: (summary: GuardrailExecutionSummary) => void;
}

/**
 * Build `onInputBlocked` / `onOutputBlocked` hooks that emit each guardrail
 * block as an autotel-genai policy decision (plus controller + provenance on
 * input). Spread the result into a `withGuardrails` config.
 */
export function guardrailGovernance(
  options: GuardrailGovernanceOptions,
): GuardrailGovernanceHooks {
  return {
    onInputBlocked: (summary) => {
      void emitBlocked('input', summary, options);
    },
    onOutputBlocked: (summary) => {
      void emitBlocked('output', summary, options);
    },
  };
}

// ============================================================================
// Tool-approval governance (SAIF Principle 1/3)
// ============================================================================

/** Decision info handed to `guardrailApproval`'s `onDecision` hook. */
export interface ApprovalDecisionInfo {
  toolName: string;
  /** The SDK tool-call id, threaded through to `recordHumanApproval`. */
  toolCallId?: string;
  status: { type: 'approved' | 'denied' | 'user-approval' | 'not-applicable' };
  guardrail?: string;
  result?: GuardrailResult;
}

/**
 * Build an `onDecision` callback for {@link guardrailApproval}, recording each
 * tool-approval outcome as a policy decision and — for human-in-the-loop
 * (`user-approval`) and `denied` — a `recordHumanApproval` signal (SAIF
 * Principle 1). When {@link GuardrailGovernanceOptions.toolRiskClass} is set, the
 * gated tool's action risk class is recorded too (SAIF Principle 3), for every
 * tool — including those no guardrail governs. The recorded `approved` reflects
 * the decision *at gate time*: `denied`/`user-approval` halt the call, so
 * `approved` is `false`.
 */
export function guardrailGovernanceApproval(
  options: GuardrailGovernanceOptions,
): (info: ApprovalDecisionInfo) => void {
  return (info) => {
    void withAgent(options, (agent, emit) => {
      // SAIF Principle 3: characterize the action's risk class for every gated
      // tool, governed or not — so it is recorded even when the decision is
      // `not-applicable` below.
      const riskClass = options.toolRiskClass?.(info.toolName);
      if (riskClass) tryEmit(() => agent.recordActionRiskClass(riskClass));

      const decision = approvalStatusToPolicyDecision(info.status.type);
      if (!decision) return; // not-applicable → no opinion

      tryEmit(() =>
        agent.recordPolicyDecision(
          policyDecision({
            action: info.guardrail ?? info.toolName,
            agent: options.agent,
            decision,
            riskScore: info.result
              ? riskScoreOf(info.result, options)
              : undefined,
            reason: info.result?.message,
            category: info.result?.severity,
          }),
          emit,
        ),
      );

      if (
        info.status.type === 'denied' ||
        info.status.type === 'user-approval'
      ) {
        tryEmit(() =>
          agent.recordHumanApproval({
            // The real SDK tool-call id when threaded; omitted otherwise rather
            // than forged from the tool name.
            toolCallId: info.toolCallId,
            toolName: info.toolName,
            approved: false,
            required: info.status.type === 'user-approval',
            controllerId: options.controllerId,
            hashSalt: options.hashSalt,
          }),
        );
      }
    });
  };
}

// ============================================================================
// Native AI SDK Telemetry integration (SAIF Principle 3)
// ============================================================================

/**
 * Build a **native AI SDK `Telemetry` integration** that records SAIF
 * agent-governance signals on the SDK's own tool-execution lifecycle. Drop it
 * into the v7 `telemetry.integrations` slot — the single, SDK-canonical place
 * for observability — instead of the library's bespoke injected-`Tracer` path:
 *
 * ```ts
 * import { ToolLoopAgent } from 'ai';
 * import { OpenTelemetry } from '@ai-sdk/otel';
 * import { guardrailTelemetry } from 'ai-sdk-guardrails/governance';
 *
 * const agent = new ToolLoopAgent({
 *   model,
 *   tools,
 *   telemetry: {
 *     integrations: [
 *       new OpenTelemetry({ tracer }),   // creates the GenAI span tree
 *       guardrailTelemetry({             // rides it: SAIF signals per action
 *         agent: { id: 'support-agent', model: 'gpt-4o' },
 *         toolRiskClass: (t) => (t === 'executeSQL' ? 'destructive' : undefined),
 *       }),
 *     ],
 *   },
 * });
 * ```
 *
 * For every tool the agent actually executes it records the action's risk class
 * (SAIF Principle 3) and an `observe` policy decision, attributed to the agent
 * identity, onto the active GenAI span. Because it implements `ai`'s `Telemetry`
 * interface, no adapter is needed — and it composes with any other integration
 * (e.g. `@ai-sdk/otel`'s `OpenTelemetry`) registered alongside it.
 *
 * Best-effort: no-ops when the `autotel-genai` optional peer (or an active span)
 * is absent. Pair it with explicit `guardrailGovernance(...).onInputBlocked` /
 * `.onOutputBlocked` hooks on `withGuardrails` to emit the block decisions the
 * SDK lifecycle cannot see.
 */
export function guardrailTelemetry(
  options: GuardrailGovernanceOptions,
): Telemetry {
  const observeTool = (toolName: string): void => {
    void withAgent(options, (agent, emit) => {
      // SAIF Principle 3: characterize what the agent actually reached for.
      const riskClass = options.toolRiskClass?.(toolName);
      if (riskClass) tryEmit(() => agent.recordActionRiskClass(riskClass));

      // The action ran (it passed any approval gate): record it as observed.
      tryEmit(() =>
        agent.recordPolicyDecision(
          policyDecision({
            action: `tool.${toolName}`,
            resource: toolName,
            agent: options.agent,
            decision: 'observe',
          }),
          emit,
        ),
      );
    });
  };

  return {
    onToolExecutionStart: ({ toolCall }) => {
      observeTool(toolCall.toolName);
    },
  };
}

/**
 * Record a plan-risk assessment on the active span (SAIF Layer-2). Best-effort:
 * no-ops when the optional peer or an active span is absent. Used by the
 * `planRiskGuardrail` to land `agent.plan.risk.*` attributes alongside the model
 * call. Set `emitSecurityEvent` to also emit `llm.plan.risk.elevated` for
 * non-`low` verdicts.
 */
export function recordPlanRisk(
  assessment: PlanRiskAssessment,
  toolSequence: string[],
  options: { emitSecurityEvent?: boolean } = {},
): void {
  void withAgent({}, (agent) => {
    tryEmit(() =>
      agent.recordPlanRiskAssessment({
        assessment,
        toolSequence,
        emitSecurityEvent: options.emitSecurityEvent,
      }),
    );
  });
}

// ============================================================================
// Limited powers — least-privilege tool wrapper (SAIF Principle 2)
// ============================================================================

/** Thrown when a guarded tool is invoked without the scopes it requires. */
export class ToolScopeDeniedError extends Error {
  readonly toolName: string;
  readonly missingScopes: string[];
  constructor(toolName: string, missingScopes: string[]) {
    super(
      `Tool "${toolName}" denied — missing scope(s): ${missingScopes.join(', ')}`,
    );
    this.name = 'ToolScopeDeniedError';
    this.toolName = toolName;
    this.missingScopes = missingScopes;
  }
}

export interface GuardedToolOptions {
  /** The distinct agent identity invoking the tool (SAIF Principle 1). */
  agent: GovernanceAgentIdentity;
  /** Name of the tool, used as the policy `action`/`resource`. */
  toolName: string;
  /** Scopes the tool requires to run. */
  requiredScopes?: string[];
  /**
   * Scopes currently granted to the agent. Any {@link requiredScopes} not in
   * this set is a least-privilege violation → the call is denied.
   */
  grantedScopes?: string[];
  /** Action risk class recorded for the call (SAIF Principle 3). */
  riskClass?: AgentActionRiskClass;
  /** Controlling user id, recorded on a denial. */
  controllerId?: string;
  hashSalt?: string;
  /** Delegation context for a multi-agent handoff (authority lineage). */
  delegation?: GovernanceDelegationContext;
  onMissingContext?: 'warn' | 'skip' | 'throw';
}

// The execute boundary forwards opaque tool arguments; `any` keeps any AI SDK
// tool assignable without coupling to its exact `Tool` generic.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GuardedExecute = (...args: any[]) => any;

/**
 * Wrap an AI SDK tool with **deterministic least-privilege enforcement** (SAIF
 * Principle 2 — agent powers must be limited). Before the tool runs, the wrapper
 * checks that {@link GuardedToolOptions.grantedScopes} covers every
 * {@link GuardedToolOptions.requiredScopes}; if not, it records a `deny` policy
 * decision and throws {@link ToolScopeDeniedError} — the tool never executes.
 * On a permitted call it records a `permit` decision and the action risk class.
 *
 * The scope check is pure and works standalone; the canonical autotel-genai
 * emission (policy decision + risk class + delegation lineage) is best-effort and
 * no-ops when the optional peer (or an active span) is absent.
 *
 * ```ts
 * const tools = {
 *   transferFunds: withGuardedTool(transferFundsTool, {
 *     agent: { id: 'payments-agent' },
 *     toolName: 'transferFunds',
 *     requiredScopes: ['payments:write'],
 *     grantedScopes: session.scopes,
 *     riskClass: 'financial',
 *   }),
 * };
 * ```
 */
export function withGuardedTool<T extends { execute?: GuardedExecute }>(
  tool: T,
  options: GuardedToolOptions,
): T {
  if (typeof tool.execute !== 'function') return tool;

  const required = options.requiredScopes ?? [];
  const granted = new Set(options.grantedScopes);
  const original = tool.execute.bind(tool);

  const guardedExecute: GuardedExecute = async (...args) => {
    const missing = required.filter((scope) => !granted.has(scope));
    const denied = missing.length > 0;

    await withAgent(options, (agent, emit) => {
      const { riskClass, controllerId, hashSalt } = options;
      if (riskClass) tryEmit(() => agent.recordActionRiskClass(riskClass));
      tryEmit(() =>
        agent.recordPolicyDecision(
          policyDecision({
            action: `tool.${options.toolName}`,
            resource: options.toolName,
            agent: options.agent,
            delegation: options.delegation,
            decision: denied ? 'deny' : 'permit',
            reason: denied ? `missing_scope:${missing.join(',')}` : undefined,
          }),
          emit,
        ),
      );
      if (denied && controllerId) {
        tryEmit(() => agent.recordControllerId({ controllerId, hashSalt }));
      }
    });

    if (denied) {
      throw new ToolScopeDeniedError(options.toolName, missing);
    }
    return original(...args);
  };

  return { ...tool, execute: guardedExecute } as T;
}
