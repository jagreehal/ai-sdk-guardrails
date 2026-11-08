// Compile-time checks: `pnpm type-check` fails if these assignments regress.
import { describe, expect, it } from 'vitest';
import {
  generateText,
  tool,
  ToolLoopAgent,
  type LanguageModel,
  type ToolSet,
} from 'ai';
import { z } from 'zod';
import {
  agentGuardrails,
  expectedToolUse,
  retry,
  retryHelpers,
  sensitiveDataFilter,
  sqlInjectionGuardrail,
  systemPromptLeakDetector,
  toolEgressPolicy,
  withGuardrails,
} from './index';
import {
  createGuardrailPrepareStep,
  withToolParameterGuardrails,
  wrapToolWithAbortion,
} from './advanced';

declare const model: LanguageModel;

const typedTool = tool({
  inputSchema: z.object({ query: z.string() }),
  execute: async ({ query }) => query,
});

// Never called: the bodies only have to type-check.
const checks = {
  outputGuardrailVariance() {
    withGuardrails({
      model,
      outputGuardrails: [systemPromptLeakDetector(), sensitiveDataFilter()],
    });
    withGuardrails({
      model,
      outputGuardrails: [
        expectedToolUse({ tools: 'search' }),
        toolEgressPolicy({ allowedHosts: ['api.company.com'] }),
      ],
    });
    agentGuardrails({
      model,
      outputGuardrails: [systemPromptLeakDetector(), sensitiveDataFilter()],
    });
  },
  typedToolParameterGuardrails() {
    withToolParameterGuardrails({ executeSQL: typedTool }, [
      sqlInjectionGuardrail({ toolName: 'executeSQL' }),
    ]);
  },
  retryHelpersAssignable() {
    return retry({
      generate: (params: Parameters<typeof generateText>[0]) =>
        generateText(params),
      params: { model, prompt: 'x', maxOutputTokens: 200 },
      validate: (r) => ({ blocked: r.text.length < 10 }),
      buildRetryParams: retryHelpers.increaseTokens(200),
    });
  },
  prepareStepAssignable() {
    const prepareStep = createGuardrailPrepareStep([]);
    void generateText({ model, prompt: 'x', prepareStep });
    void new ToolLoopAgent({ model, tools: { typedTool }, prepareStep });
  },
  wrapTypedTool() {
    const tools: ToolSet = { safe: wrapToolWithAbortion(typedTool, []) };

    return tools;
  },
};

describe('public type compatibility', () => {
  it('compiles', () => {
    expect(Object.keys(checks)).toHaveLength(5);
  });
});
