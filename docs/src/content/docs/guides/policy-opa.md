---
title: OPA & Policy Interop
description: Compose guardrailApproval with the AI SDK's @ai-sdk/policy-opa helpers for shadow-mode rollout and total MCP coverage
---

`guardrailApproval()` returns a plain AI SDK `toolApproval` function. Because of that, it works with the first-party [`@ai-sdk/policy-opa`](https://www.npmjs.com/package/@ai-sdk/policy-opa) helpers without an adapter:

| Helper                            | What it adds                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `shadow(gate, { enforce })`       | Shadow-mode rollout: evaluate the gate and report each decision, but approve every call until `enforce: true` |
| `wrapMcpTools(tools, gate, opts)` | Total coverage over a discovered tool set: tools the gate returns `not-applicable` for fall back to a default |

Neither helper needs an OPA server. Only `opaPolicy()` does. This library does not ship its own shadow mode or MCP fallback, so use these helpers.

```bash
npm install @ai-sdk/policy-opa
```

## The gate

Start with a guardrail gate built from tool-parameter guardrails:

```ts
import { guardrailApproval, sqlInjectionGuardrail } from 'ai-sdk-guardrails';

const gate = guardrailApproval([
  sqlInjectionGuardrail({ toolName: 'executeSQL' }),
]);
```

Decision mapping, where the first failing guardrail wins:

| Guardrail result                                            | Decision         |
| ----------------------------------------------------------- | ---------------- |
| `valid: true`                                               | `approved`       |
| `valid: false`, severity ≥ `denyAtOrAbove` (default `high`) | `denied`         |
| `valid: false`, severity below the threshold                | `user-approval`  |
| No guardrail matches the tool                               | `not-applicable` |

`onBlock: 'deny' | 'user-approval'` forces one outcome regardless of severity. `requestContext` is passed to each guardrail, which is how `toolRBACGuardrail` reads `permissions`. `onDecision` fires once per tool call with the final status.

## Shadow-mode rollout

Wrap the gate with `shadow`. When `enforce` is `false` (the default), every call is approved and `onDecision` reports what the gate _would_ have done. Set `enforce: true` and the gate's decisions take effect.

```ts
import { ToolLoopAgent, stepCountIs } from 'ai';
import { shadow } from '@ai-sdk/policy-opa';

const toolApproval = shadow(gate, {
  enforce: process.env.ENFORCE === 'true',
  onDecision: (e) =>
    logger.info('guardrail.decision', {
      tool: e.toolCall.toolName,
      decision: e.decision.type, // what the gate said
      enforced: e.enforced,
    }),
});

const agent = new ToolLoopAgent({
  model,
  tools,
  toolApproval,
  stopWhen: stepCountIs(3),
});
```

Each `onDecision` event has `toolCall`, `decision` (the gate's result), `effective` (what the SDK acted on), `enforced` and `timestamp`. Events where `decision.type` is not `'approved'` are the calls enforcement would change. `shadow` runs `onDecision` as fire-and-forget and swallows its errors.

## Total coverage over MCP tools

A tool no guardrail matches gets `not-applicable`, and the SDK runs it. For a discovered MCP tool set that means unknown tools run without a check. `wrapMcpTools` replaces `not-applicable` with a default:

```ts
import { wrapMcpTools } from '@ai-sdk/policy-opa';

const { tools, toolApproval } = wrapMcpTools(await mcpClient.tools(), gate, {
  default: 'user-approval',
});

const agent = new ToolLoopAgent({ model, tools, toolApproval });
```

Now only `executeSQL` is checked by the SQL-injection guardrail. Every other tool (for example a `sendEmail` the server also exposes) needs human approval. `default` is `'user-approval'` if you omit it.

## Combining both

`shadow` and `wrapMcpTools` both take and return a `toolApproval`, so you can nest them. For example, roll out the MCP gate in shadow mode:

```ts
import { shadow, wrapMcpTools } from '@ai-sdk/policy-opa';

const { tools, toolApproval: covered } = wrapMcpTools(
  await mcpClient.tools(),
  gate,
  { default: 'user-approval' },
);

const toolApproval = shadow(covered, {
  enforce: false,
  onDecision: (e) => logger.info('guardrail.decision', e),
});
```

## Recording decisions to governance

`guardrailApproval`'s `onDecision` is separate from `shadow`'s. To record each gate decision as an autotel-genai policy decision, pass `guardrailGovernanceApproval` from [`ai-sdk-guardrails/governance`](/guides/governance/):

```ts
import { guardrailGovernanceApproval } from 'ai-sdk-guardrails/governance';

const gate = guardrailApproval(
  [sqlInjectionGuardrail({ toolName: 'executeSQL' })],
  {
    onDecision: guardrailGovernanceApproval({
      agent: { id: 'support-agent' },
    }),
  },
);
```

## Policies in OPA

To keep tool policy in Rego, served over HTTP or compiled to Wasm, use `@ai-sdk/policy-opa`'s `opaPolicy({ client, path })` with `httpPolicyClient` or `wasmPolicyClient`. It produces a `toolApproval` of the same shape and fails closed (`denied`) when the policy backend errors. See the `@ai-sdk/policy-opa` documentation for its input format.

## Full example

[`57-policy-opa-interop.ts`](https://github.com/jagreehal/ai-sdk-guardrails/blob/main/packages/examples/57-policy-opa-interop.ts) runs the same SQL-injection call with `enforce: false` (the tool runs, and the gate's `denied` is reported) and with `enforce: true` (the tool is blocked), then shows `wrapMcpTools` routing an ungoverned `sendEmail` tool to `user-approval`. It uses a mock model and needs no API keys.

## Related

- [MCP Security](/guides/mcp/)
- [Governance](/guides/governance/)
