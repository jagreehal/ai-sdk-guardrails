/**
 * Example 54 — Tool Approval Guardrails (AI SDK v7)
 *
 * AI SDK v7 added a first-class `toolApproval` hook to `generateText` /
 * `streamText` / `Agent`. `guardrailApproval()` adapts the library's existing
 * tool-parameter guardrails (RBAC, SQL-injection, path-traversal, …) into that
 * hook, so the same rules now gate tool calls *inside the agent loop* — with the
 * option to deny outright or escalate to a human (`user-approval`).
 *
 * Decision mapping (first failing guardrail wins):
 *   valid                                  -> approved
 *   invalid, severity >= denyAtOrAbove     -> denied      (tool never runs)
 *   invalid, severity <  denyAtOrAbove     -> user-approval (pause for a human)
 *   no guardrail matches the tool          -> not-applicable
 *
 * This example uses a mock model so it runs with no API keys. To use a real
 * model, swap `buildModel()` for e.g. `openai('gpt-4o')` — nothing else changes.
 */

import { ToolLoopAgent, tool, stepCountIs } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';
import {
  guardrailApproval,
  sqlInjectionGuardrail,
  toolRBACGuardrail,
} from 'ai-sdk-guardrails';

// --- A mock model that asks to run one SQL query, then summarises. -----------
// Swap this for a real provider model (e.g. `openai('gpt-4o')`) in production.
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

export interface RunResult {
  /** Whether the SQL tool actually executed. */
  executed: boolean;
  /** Decisions observed via the `onDecision` hook. */
  decisions: { toolName: string; status: unknown; guardrail?: string }[];
  finalText: string;
}

/**
 * Runs a single `generateText` turn where the model wants to call `executeSQL`,
 * guarded by `guardrailApproval`. Returns whether the tool ran.
 */
export async function runWithApproval(options: {
  query: string;
  permissions: string[];
}): Promise<RunResult> {
  let executed = false;
  const decisions: RunResult['decisions'] = [];

  // The recommended AI SDK v7 agent API. `guardrailApproval(...)` drops straight
  // into the `toolApproval` setting — the tool set is inferred, no casts.
  const agent = new ToolLoopAgent({
    model: buildModel(options.query),
    instructions: 'Run the requested query and report what happened.',
    tools: {
      executeSQL: tool({
        description: 'Execute a SQL query against the production database',
        inputSchema: z.object({ query: z.string() }),
        execute: async ({ query }) => {
          executed = true;
          return `rows for: ${query}`;
        },
      }),
    },
    // The whole point: existing guardrails, now gating tool calls.
    toolApproval: guardrailApproval(
      [
        sqlInjectionGuardrail({ toolName: 'executeSQL' }), // critical -> denied
        toolRBACGuardrail({
          toolName: 'executeSQL',
          requiredPermissions: ['db:write'],
        }), // high -> denied unless permitted
      ],
      {
        requestContext: { permissions: options.permissions },
        onDecision: ({ toolName, status, guardrail }) =>
          decisions.push({ toolName, status, guardrail }),
      },
    ),
    stopWhen: stepCountIs(3),
  });

  const result = await agent.generate({ prompt: 'Handle the request.' });

  return { executed, decisions, finalText: result.text };
}

// Run directly: `tsx 54-tool-approval-guardrails.ts`
async function main() {
  const scenarios = [
    {
      label: 'SQL injection (any role)',
      query: "'; DROP TABLE users; --",
      permissions: ['db:write'],
    },
    {
      label: 'Benign query, missing permission',
      query: 'SELECT 1',
      permissions: ['db:read'],
    },
    {
      label: 'Benign query, permitted',
      query: 'SELECT 1',
      permissions: ['db:write'],
    },
  ];

  for (const s of scenarios) {
    const r = await runWithApproval(s);
    const decision = r.decisions[0]?.status ?? { type: 'not-applicable' };
    console.log(
      `• ${s.label.padEnd(34)} executed=${r.executed}  decision=${JSON.stringify(decision)}`,
    );
  }
}

// Only run when invoked directly, not when imported by the test.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
