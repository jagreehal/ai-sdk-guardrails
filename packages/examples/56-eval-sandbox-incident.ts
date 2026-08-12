/**
 * Example 56 — Eval sandbox incident replay (standalone demo)
 *
 * Full runnable scenarios live in the sibling repo:
 *   ../agent-eval-sandbox-demo
 *
 * Run:
 *   cd ../agent-eval-sandbox-demo && pnpm install && pnpm demo
 *
 * This file documents the mapping; see that repo's README for talk-aligned
 * milestone tables and architecture.
 */

console.log(`
Eval sandbox incident demo — standalone repo:

  cd ../agent-eval-sandbox-demo
  pnpm install
  pnpm demo

Scenarios:
  1. Unguarded replay (message board + SSRF)
  2. Guardrails prevent (evaluationScopeGuardrail, toolEgressPolicy, planRiskGuardrail)
  3. Defense in depth (guardrailGovernance + autotelTelemetry + IR queries)
`);
