---
'ai-sdk-guardrails': minor
---

Add Eval Sandbox, evaluation-scope and tool-egress guardrails, plus stateful plan risk sessions.

- `evaluationScopeGuardrail` — constrains what an evaluation run is allowed to touch, with
  `EvaluationScopeGuardrailOptions` and `EvaluationScopeMetadata` exported alongside it.
- `createPlanRiskSession` — carries plan-risk state across turns instead of scoring each plan in
  isolation, so risk accumulated earlier in a session still counts. Exported with its
  `PlanRiskSession` type.
- Tool-call/egress policy now scans tool-call arguments for URLs, catching structured egress that
  text-only scanning missed.

All additions are new exports; no existing API changed.
