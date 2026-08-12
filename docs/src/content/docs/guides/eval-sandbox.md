---
title: Eval Sandbox Defense
description: Guardrails and OTEL patterns for AI evaluation sandboxes
---

Eval agents that share infrastructure (package managers, registries, networked sandboxes) can scope-creep into external infrastructure or coordinate via shared storage — the pattern behind the OpenAI/HuggingFace incident.

This guide maps **Layer-1** (`ai-sdk-guardrails`) and **Layer-2** (`autotel-genai`) defenses for eval sandboxes.

## Layer 1 — Prevent

### Evaluation scope guardrail

Blocks external hosts, suspicious registry writes, and coordination filenames:

```ts
import { evaluationScopeGuardrail, withGuardrails } from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: baseModel,
  outputGuardrails: [
    evaluationScopeGuardrail({
      sharedStoreId: 'artifactory-eval-1',
      denyRegistryWrites: true, // read-only registry
      denySuspiciousFilenames: true,
    }),
  ],
  throwOnBlocked: true,
});
```

### Step-aware plan risk

Agent loops emit one tool per step. Pass a session so plan-risk sees the **running** chain:

```ts
import {
  createPlanRiskSession,
  planRiskGuardrail,
  withGuardrails,
} from 'ai-sdk-guardrails';

const session = createPlanRiskSession();

const model = withGuardrails({
  model: baseModel,
  outputGuardrails: [
    planRiskGuardrail({ session, blockAtOrAbove: 'high' }),
  ],
});
```

Flags chains like `artifactoryList → artifactoryUpload → artifactoryFetch` across turns.

### Governance + signed audit

```ts
import { guardrailGovernance } from 'ai-sdk-guardrails/governance';

const gov = guardrailGovernance({
  agent: { id: 'eval-agent', model: 'internal' },
  controllerId: 'security-oncall',
  signBlockedEvents: true,
});
```

## Layer 2 — Detect

Wire `autotelTelemetry()` and eval-run identity:

```ts
import { autotelTelemetry } from 'autotel-genai/observer';
import {
  recordEvalRunIdentity,
  CrossAgentMonitor,
  querySpansForEvalIncident,
} from 'autotel-genai/agent';

recordEvalRunIdentity({ runId: 'eval-may-08', sandboxId: 'artifactory-prod' });

const monitor = new CrossAgentMonitor({ minAgents: 2 });
monitor.record({ agentId: 'eval-a', resource: 'artifactory:/notes' });
```

After an incident, run `querySpansForEvalIncident(finishedSpans)` for policy denials, plan-risk, exfil actions, and cross-agent alerts.

## Runnable demo

See the standalone repo **`agent-eval-sandbox-demo`** (sibling to this monorepo):

```bash
cd ../agent-eval-sandbox-demo
pnpm install
pnpm demo
```

## Honest limits

Read [Eval sandbox — what we would and would not stop](/guides/eval-sandbox-limits/) for infrastructure gaps (zero-days, K8s misconfig) that guardrails and OTEL alone cannot fix.

## Related

- [Security guide](/guides/security/)
- [Built-in guardrails — evaluation scope](/reference/built-in-guardrails/#evaluation-scope-guardrail)
- [Example 56 — eval sandbox incident pointer](/examples/56-eval-sandbox-incident/)
