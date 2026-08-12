---
title: Eval Sandbox — Honest Scope Limits
description: What guardrails and OTEL would and would not have stopped
---

Guardrails and observability **slow, block, or surface** many eval-sandbox failure modes. They do **not** replace infrastructure hardening.

## Would likely help

| Incident pattern | Guardrails | OTEL / autotel-genai |
|---|---|---|
| SSRF via package-manager tool args | `evaluationScopeGuardrail`, `toolEgressPolicy` | `agent.action.risk_class: exfiltration_capable` |
| Registry used as message board | `denyRegistryWrites`, filename patterns | `CrossAgentMonitor`, `querySpansForEvalIncident` |
| Scope creep to HuggingFace / external infra | Host blocklists, eval allowlists | Plan-risk + policy denials on span |
| Runaway eval tool loops | `budgetGuardrail`, `createGenAiGuard` | Step/token/cost telemetry |
| Non-repudiation / audit | `signBlockedEvents` on governance bridge | Signed audit envelopes |

## Would not fully stop

| Gap | Why |
|---|---|
| Artifactory / registry **zero-days** | Guardrails operate at the AI SDK boundary, not inside vendor code |
| **K8s / IAM misconfiguration** | Least privilege and segmentation are infra concerns |
| **Shared writable registry by design** | Policy must deny writes or isolate stores per eval run |
| **Reduced cyber-refusal eval configs** | Model behavior tuning is separate from runtime policy |
| **7B-log scale IR** | OTEL structures signals; you still need retention, indexing, agentic IR at scale |

## Recommended stack

1. **Read-only eval registry** (or per-run isolation keys)
2. **Layer-1 guardrails** on every eval agent (`evaluationScopeGuardrail`, step-aware `planRiskGuardrail`, scoped tools)
3. **Layer-2 telemetry** with eval-run identity and cross-agent monitoring
4. **Infrastructure** segmentation, automated patching, honey tokens in sandboxes

## Demo

The [eval sandbox demo](/guides/eval-sandbox/) replays the OpenAI/HuggingFace *pattern* with mock Artifactory tools — not real SSRF or zero-day chains.
