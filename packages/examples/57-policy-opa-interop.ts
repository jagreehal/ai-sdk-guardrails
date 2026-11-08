/**
 * Example 56 — Compose guardrails with the SDK-native policy helpers
 *
 * `guardrailApproval()` returns a value of the AI SDK's own
 * `ToolApprovalConfiguration` type. That means it drops straight into the
 * first-party `@ai-sdk/policy-opa` helpers — no adapter, no coupling:
 *
 *   - `shadow(gate, { enforce })`   — shadow-mode rollout: evaluate the gate and
 *                                     report what it WOULD do, but let every call
 *                                     through until you flip `enforce: true`.
 *   - `wrapMcpTools(tools, gate)`   — make the gate total over a discovered tool
 *                                     set: anything it does not govern falls back
 *                                     to a default (here, human approval) instead
 *                                     of being silently allowed.
 *
 * Neither helper needs an OPA backend — only `opaPolicy()` does. The guardrails
 * layer no longer needs its own shadow-mode or MCP-fallback machinery; reach for
 * these SDK-native primitives instead.
 *
 * Uses a mock model so it runs with no API keys. `pnpm add @ai-sdk/policy-opa`.
 */

import { ToolLoopAgent, tool, stepCountIs } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { shadow, wrapMcpTools } from '@ai-sdk/policy-opa';
import { z } from 'zod';
import { guardrailApproval, sqlInjectionGuardrail } from 'ai-sdk-guardrails';

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

export async function runShadowedAgent(options: {
  query: string;
  enforce: boolean;
}) {
  let executed = false;

  const tools = {
    executeSQL: tool({
      description: 'Execute a SQL query against the production database',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        executed = true;
        return `rows for: ${query}`;
      },
    }),
  };

  // The guardrail gate — a native ToolApprovalConfiguration.
  const gate = guardrailApproval([
    sqlInjectionGuardrail({ toolName: 'executeSQL' }),
  ]);

  const decisions: Array<{
    tool: string;
    decision: string;
    enforced: boolean;
  }> = [];

  // Shadow-wrap it: when `enforce` is false the SQL-injection call is reported
  // but still allowed (so you can measure impact before turning enforcement on);
  // when true, the gate's `denied` actually blocks the tool.
  const toolApproval = shadow(gate, {
    enforce: options.enforce,
    onDecision: (e) =>
      decisions.push({
        tool: e.toolCall.toolName,
        decision: e.decision.type,
        enforced: e.enforced,
      }),
  });

  const agent = new ToolLoopAgent({
    model: buildModel(options.query),
    instructions: 'Run the requested query and report what happened.',
    tools,
    toolApproval,
    stopWhen: stepCountIs(3),
  });

  const result = await agent.generate({ prompt: 'Handle the request.' });
  return { executed, decisions, finalText: result.text };
}

async function main() {
  const injection = "'; DROP TABLE users; --";

  const observe = await runShadowedAgent({ query: injection, enforce: false });
  console.log(
    `shadow (enforce=false): executed=${observe.executed} — the gate flagged ` +
      `${observe.decisions[0]?.decision} but let it through.`,
  );

  const enforce = await runShadowedAgent({ query: injection, enforce: true });
  console.log(
    `enforce=true: executed=${enforce.executed} — same gate now blocks the ` +
      `injection.`,
  );

  // `wrapMcpTools` makes a gate total: any tool it does not govern needs a human.
  const gate = guardrailApproval([
    sqlInjectionGuardrail({ toolName: 'executeSQL' }),
  ]);
  const { toolApproval } = wrapMcpTools(
    {
      executeSQL: tool({
        description: 'run sql',
        inputSchema: z.object({ query: z.string() }),
        execute: async () => '',
      }),
      sendEmail: tool({
        description: 'send email',
        inputSchema: z.object({ to: z.string() }),
        execute: async () => '',
      }),
    },
    gate,
    { default: 'user-approval' },
  );
  void toolApproval; // `sendEmail` (ungoverned) now requires approval, not silent allow.
  console.log('wrapMcpTools: ungoverned tools fall back to user-approval.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
