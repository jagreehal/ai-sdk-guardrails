/**
 * Example 55 — SAIF agent-governance bridge (autotel-genai)
 *
 * Google's *Secure AI Agents* paper frames agent security as a hybrid
 * defense-in-depth with three principles: well-defined human controllers,
 * limited powers, and observable actions. `ai-sdk-guardrails` is the
 * deterministic Layer-1 policy engine; `autotel-genai` is the observability +
 * agent-governance plane.
 *
 * `ai-sdk-guardrails/governance` wires them together: every guardrail block and
 * every tool-approval decision is emitted onto the active OpenTelemetry GenAI
 * span as a canonical policy decision (`recordPolicyDecision`), with the
 * controlling user (`recordControllerId`) and untrusted-input provenance
 * (`recordInputProvenance`) captured on input blocks.
 *
 * `autotel-genai` is an OPTIONAL peer. With nothing installed (or no active
 * span) the bridge silently no-ops — so this example runs as-is. To light up the
 * trace, install `autotel autotel-genai`, register `autotelTelemetry()` with the
 * AI SDK, and run the agent inside a `trace()` span.
 *
 * Uses a mock model so it runs with no API keys. Swap `buildModel()` for e.g.
 * `openai('gpt-4o')` in production — nothing else changes.
 */

import { ToolLoopAgent, tool, stepCountIs } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';
import {
  guardrailApproval,
  sqlInjectionGuardrail,
  withGuardrails,
  promptInjectionDetector,
  sensitiveDataFilter,
  planRiskGuardrail,
  budgetGuardrail,
  createGuardrailBudget,
} from 'ai-sdk-guardrails';
import {
  guardrailGovernance,
  guardrailGovernanceApproval,
  withGuardedTool,
} from 'ai-sdk-guardrails/governance';

function buildModel(query: string) {
  let step = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      if (step++ === 0) {
        return {
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'executeSQL',
              input: JSON.stringify({ query }),
            },
          ],
          finishReason: 'tool-calls',
          usage: { inputTokens: 8, outputTokens: 8, totalTokens: 16 },
          warnings: [],
        };
      }
      return {
        content: [{ type: 'text', text: 'Finished handling the request.' }],
        finishReason: 'stop',
        usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
        warnings: [],
      };
    },
  });
}

export async function runGovernedAgent(options: {
  query: string;
  permissions: string[];
  userId: string;
}) {
  // One identity + controller, shared by the input/output policy hooks and the
  // tool-approval hook. This is the agent's distinct identity (SAIF Principle 1).
  const governance = {
    agent: { id: 'support-agent', model: 'gpt-4o', role: 'support' },
    controllerId: options.userId,
    // SAIF Principle 3: characterize each tool's action risk class so the trace
    // records whether the agent reached for a read vs a state-changing action.
    toolRiskClass: (toolName: string) =>
      toolName === 'executeSQL' ? ('destructive' as const) : undefined,
  } as const;
  const governanceHooks = guardrailGovernance(governance);

  let executed = false;

  // SAIF kill-switch (Layer-1): a single cumulative budget, fed automatically by
  // budgetGuardrail. Swap createGuardrailBudget for autotel-genai's
  // createGenAiBudget to gain the abort-signal + gen_ai.guard.* telemetry.
  const budget = createGuardrailBudget({ maxCostUsd: 1, maxTokens: 100_000 });

  // Layer-1 deterministic guards on the model itself. Explicit governance hooks
  // turn each block into an autotel-genai policy decision on the active span.
  const model = withGuardrails({
    model: buildModel(options.query),
    inputGuardrails: [promptInjectionDetector()],
    outputGuardrails: [
      sensitiveDataFilter(),
      // SAIF Layer-2: flag risky tool plans (e.g. untrusted-read → destructive).
      planRiskGuardrail({ blockAtOrAbove: 'high' }),
      // Cumulative cost/token kill-switch — one source of truth.
      budgetGuardrail({
        budget,
        estimateCost: ({ inputTokens = 0, outputTokens = 0 }) =>
          ((inputTokens + outputTokens) / 1000) * 0.005,
      }),
    ],
    onInputBlocked: governanceHooks.onInputBlocked,
    onOutputBlocked: governanceHooks.onOutputBlocked,
  });

  const agent = new ToolLoopAgent({
    model,
    instructions: 'Run the requested query and report what happened.',
    tools: {
      // SAIF Principle 2 (limited powers): least-privilege scope enforcement.
      // The tool is denied unless the agent holds `db:write` — deterministically,
      // before it runs — and the decision + risk class land on the trace.
      executeSQL: withGuardedTool(
        tool({
          description: 'Execute a SQL query against the production database',
          inputSchema: z.object({ query: z.string() }),
          execute: async ({ query }) => {
            executed = true;
            return `rows for: ${query}`;
          },
        }),
        {
          agent: governance.agent,
          toolName: 'executeSQL',
          requiredScopes: ['db:write'],
          grantedScopes: options.permissions,
          riskClass: 'destructive',
          controllerId: options.userId,
        },
      ),
    },
    // Tool-call gating (human-in-the-loop). Scope (`db:write`) is already enforced
    // deterministically by `withGuardedTool` above (SAIF Principle 2), so the
    // approval gate covers a *distinct* concern — SQL-injection in the input —
    // rather than re-checking the same scope twice. The governance approval hook
    // records each decision + human-approval requirement onto the trace.
    toolApproval: guardrailApproval(
      [sqlInjectionGuardrail({ toolName: 'executeSQL' })],
      {
        onDecision: guardrailGovernanceApproval(governance),
      },
    ),
    stopWhen: stepCountIs(3),
  });

  const result = await agent.generate({ prompt: 'Handle the request.' });
  return { executed, finalText: result.text };
}

async function main() {
  const r = await runGovernedAgent({
    query: "'; DROP TABLE users; --",
    permissions: ['db:read'],
    userId: 'user-42',
  });
  console.log(
    `executed=${r.executed} — SQL-injection tool call denied; policy decisions ` +
      `emitted to autotel-genai when telemetry is active.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
