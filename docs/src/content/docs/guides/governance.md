---
title: Governance (SAIF bridge)
description: Emit guardrail blocks and tool-approval decisions as autotel-genai agent-governance signals, structured around Google's SAIF principles
---

`ai-sdk-guardrails/governance` turns guardrail outcomes into agent-governance signals from [`autotel-genai`](https://www.npmjs.com/package/autotel-genai). The signals land on the active OpenTelemetry GenAI span, so a guardrail decision sits in the same trace as the model call it guarded.

The module follows the three principles in Google's _Secure AI Agents_ (SAIF) paper:

| SAIF principle                    | What the bridge records                                                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Well-defined human controllers | The controlling user (`recordControllerId`), untrusted-input provenance (`recordInputProvenance`), human-approval outcomes (`recordHumanApproval`) |
| 2. Limited powers                 | Every block becomes a `deny` policy decision (`recordPolicyDecision`); `withGuardedTool` enforces least-privilege scopes                           |
| 3. Observable actions             | Tool action risk classes (`recordActionRiskClass`) and `observe` decisions for executed tools                                                      |

## Optional peer

`autotel-genai` is an optional peer dependency. The bridge loads `autotel-genai/agent` lazily the first time it emits. If the package is not installed, or no span is active, every emit is a silent no-op. Observability never throws into the call it observes.

```bash
npm install autotel autotel-genai
```

Without it, everything below still runs. `withGuardedTool` still enforces scopes, because the scope check is pure. Only the telemetry is skipped.

Set `onMissingContext: 'warn'` to log when no active trace context is found. The default is `'skip'`.

## Block decisions on `withGuardrails`

`guardrailGovernance(options)` returns `onInputBlocked` / `onOutputBlocked` hooks. Pass them to `withGuardrails`:

```ts
import {
  withGuardrails,
  promptInjectionDetector,
  sensitiveDataFilter,
} from 'ai-sdk-guardrails';
import { guardrailGovernance } from 'ai-sdk-guardrails/governance';

const gov = guardrailGovernance({
  agent: { id: 'support-agent', model: 'gpt-4o' },
  controllerId: user.id,
});

const model = withGuardrails({
  model: openai('gpt-4o'),
  inputGuardrails: [promptInjectionDetector()],
  outputGuardrails: [sensitiveDataFilter()],
  onInputBlocked: gov.onInputBlocked,
  onOutputBlocked: gov.onOutputBlocked,
});
```

For each blocked result:

- A policy decision with `decision: 'deny'` is recorded. The `action` is the guardrail name, `reason` and `reasoningSummary` are the result's `message`, and `category` is its `severity`.
- `riskScore` (0..1) is the result's `confidence` if set, otherwise derived from `severity`. Override it with the `riskScore` option.
- If the result's `metadata.observedTools` (or `info.observedTools`) lists tools and `toolRiskClass` returns a class for one, that action risk class is recorded.
- With `signBlockedEvents`, a signed audit envelope is created through `createSignedEventEnvelope`, if the installed `autotel-genai` provides it.

On **input** blocks it also records the `controllerId` (hashed by autotel-genai, salted with `hashSalt`) and the input provenance. Provenance defaults to `'external_untrusted'`; override it with `inputProvenance`.

### Options

`GuardrailGovernanceOptions`:

| Option              | Type                                                                                                     | Purpose                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `agent`             | `{ id, version?, framework?, model?, role?, sessionId?, conversationId? }`                               | Agent identity decisions are attributed to (required) |
| `controllerId`      | `string`                                                                                                 | Controlling user id                                   |
| `hashSalt`          | `string`                                                                                                 | Salt used when hashing `controllerId`                 |
| `inputProvenance`   | `'user_direct' \| 'user_voice' \| 'rag' \| 'memory' \| 'tool_result' \| 'external_untrusted'`            | Provenance recorded on input blocks                   |
| `riskScore`         | `(result) => number \| undefined`                                                                        | Override the derived 0..1 risk score                  |
| `toolRiskClass`     | `(toolName) => 'read' \| 'write' \| 'destructive' \| 'financial' \| 'exfiltration_capable' \| undefined` | Characterize tool actions                             |
| `onMissingContext`  | `'warn' \| 'skip' \| 'throw'`                                                                            | Behaviour with no active span (default `'skip'`)      |
| `signBlockedEvents` | `boolean \| { signer? }`                                                                                 | Emit a signed audit envelope per block                |

## Tool-approval decisions

`guardrailGovernanceApproval(options)` takes the same `GuardrailGovernanceOptions` and returns an `onDecision` callback for [`guardrailApproval`](/guides/advanced-features/):

```ts
import { guardrailApproval, sqlInjectionGuardrail } from 'ai-sdk-guardrails';
import { guardrailGovernanceApproval } from 'ai-sdk-guardrails/governance';

const toolApproval = guardrailApproval(
  [sqlInjectionGuardrail({ toolName: 'executeSQL' })],
  {
    onDecision: guardrailGovernanceApproval({
      agent: { id: 'support-agent', model: 'gpt-4o' },
    }),
  },
);
```

Approval statuses map to policy decisions like this:

| `toolApproval` status | Policy decision | Also records                                                |
| --------------------- | --------------- | ----------------------------------------------------------- |
| `approved`            | `permit`        |                                                             |
| `denied`              | `deny`          | `recordHumanApproval({ approved: false, required: false })` |
| `user-approval`       | `challenge`     | `recordHumanApproval({ approved: false, required: true })`  |
| `not-applicable`      | none            |                                                             |

`approved: false` reflects the decision at gate time: `denied` and `user-approval` both stop the call. When `toolRiskClass` is set, the risk class is recorded for every gated tool, including `not-applicable` ones.

## Native AI SDK telemetry integration

`guardrailTelemetry(options)` returns an AI SDK `Telemetry` integration. For every tool the agent executes, it records the action risk class (if `toolRiskClass` returns one) and an `observe` policy decision with action `tool.<name>`. Register it next to `@ai-sdk/otel`:

```ts
import { ToolLoopAgent } from 'ai';
import { OpenTelemetry } from '@ai-sdk/otel';
import { guardrailTelemetry } from 'ai-sdk-guardrails/governance';

const agent = new ToolLoopAgent({
  model,
  tools,
  telemetry: {
    integrations: [
      new OpenTelemetry({ tracer }),
      guardrailTelemetry({
        agent: { id: 'support-agent', model: 'gpt-4o' },
        toolRiskClass: (t) => (t === 'executeSQL' ? 'destructive' : undefined),
      }),
    ],
  },
});
```

The SDK lifecycle does not see guardrail blocks, so pair it with the `guardrailGovernance` hooks above.

## Least-privilege tools

`withGuardedTool(tool, options)` wraps an AI SDK tool's `execute`. Before the tool runs it checks that `grantedScopes` covers every `requiredScopes` entry. If any are missing it records a `deny` decision and throws `ToolScopeDeniedError` (with `toolName` and `missingScopes`), and the tool does not run. On a permitted call it records `permit` and the `riskClass`.

```ts
import { withGuardedTool } from 'ai-sdk-guardrails/governance';

const tools = {
  transferFunds: withGuardedTool(transferFundsTool, {
    agent: { id: 'payments-agent' },
    toolName: 'transferFunds',
    requiredScopes: ['payments:write'],
    grantedScopes: session.scopes,
    riskClass: 'financial',
  }),
};
```

`GuardedToolOptions` also accepts `controllerId`, `hashSalt`, `delegation` (`{ parentIdentity, scope?, tokenId?, delegationId? }` for multi-agent handoffs) and `onMissingContext`.

## Plan risk

`planRiskGuardrail()` calls `recordPlanRisk` on every evaluation, passing or not, which puts `agent.plan.risk.*` attributes on the active span. With `emitSecurityEvent: true` it also emits `llm.plan.risk.elevated` for verdicts above `low`. You can also call `recordPlanRisk(assessment, toolSequence, { emitSecurityEvent })` directly.

## Other exports

The pure mappers are exported for testing or custom emit paths: `severityToRiskScore`, `guardrailNameOf`, `policyDecision`, `toPolicyDecisionMetadata`, `approvalStatusToPolicyDecision`.

## Full example

[`55-saif-governance.ts`](https://github.com/jagreehal/ai-sdk-guardrails/blob/main/packages/examples/55-saif-governance.ts) combines all of the above in a `ToolLoopAgent`: input/output guardrails with governance hooks, `planRiskGuardrail`, `budgetGuardrail`, a `withGuardedTool`-wrapped SQL tool, and `guardrailApproval` with `guardrailGovernanceApproval`. It uses a mock model and runs without API keys or `autotel-genai`.

## Related

- [Observability](/guides/observability/): the zero-config `guardrails.input` / `guardrails.output` spans
- [OPA & Policy Interop](/guides/policy-opa/)
- [MCP Security](/guides/mcp/)
