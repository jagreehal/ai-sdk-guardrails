import { describe, it, expect } from 'vitest';
import { ToolLoopAgent, stepCountIs } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { agentGuardrails } from './agent';
import { defineInputGuardrail, defineOutputGuardrail } from '../guardrails';
import { hasConsecutiveViolations } from './stop-conditions';

// Drive a real generation through a guarded model fragment (fires the
// middleware's onOutputBlocked), then flush via the fragment's onStepEnd with a
// given real step index — exactly what the agent loop does per step.
async function blockOnStep(
  f: ReturnType<typeof agentGuardrails>,
  stepNumber: number,
): Promise<void> {
  await (
    f.model as unknown as { doGenerate: (o: unknown) => Promise<unknown> }
  ).doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
  });
  await (f.onStepEnd as (s: unknown) => unknown)({ stepNumber });
}

// A clean step: no block fired, only the step-end flush runs (records nothing).
async function cleanStep(
  f: ReturnType<typeof agentGuardrails>,
  stepNumber: number,
): Promise<void> {
  await (f.onStepEnd as (s: unknown) => unknown)({ stepNumber });
}

function buildModel(text: string) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: {
          total: 4,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 6, text: undefined, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

const blockInput = defineInputGuardrail({
  name: 'blocks-secret',
  execute: async (ctx) => {
    const prompt = (ctx as { prompt?: unknown }).prompt;
    return String(prompt).includes('secret')
      ? { tripwireTriggered: true, message: 'no secrets', severity: 'high' }
      : { tripwireTriggered: false };
  },
});

const blockShort = defineOutputGuardrail({
  name: 'min-length',
  execute: async ({ result }) => {
    const text = (result as { text?: string }).text ?? '';
    return text.length < 20
      ? { tripwireTriggered: true, message: 'too short', severity: 'critical' }
      : { tripwireTriggered: false };
  },
});

describe('agentGuardrails({ model: native settings fragments })', () => {
  it('returns only a wrapped model by default', () => {
    const f = agentGuardrails({
      model: buildModel('hello'),
      inputGuardrails: [blockInput],
    });
    expect(f.model).toBeDefined();
    expect(f.model).not.toBe(undefined);
    expect(f.stopWhen).toBeUndefined();
  });

  it('adds stopWhen (a function) + onStepEnd only when stopOnGuardrailViolation is set', () => {
    const f = agentGuardrails({
      model: buildModel('hi'),
      outputGuardrails: [blockShort],
      stopOnGuardrailViolation: 1,
    });
    // Must be a native StopCondition *function*, not an eagerly-computed value.
    expect(typeof f.stopWhen).toBe('function');
    expect(typeof f.onStepEnd).toBe('function');
  });

  it('records real middleware blocks so stopWhen fires at the threshold', async () => {
    // buildModel('hi') yields 2 chars → blockShort (min length 20) trips on a
    // real model call, driving the SAME path the middleware enforces.
    const f = agentGuardrails({
      model: buildModel('hi'),
      outputGuardrails: [blockShort],
      stopOnGuardrailViolation: 1,
      replaceOnBlocked: true,
    });
    const stop = f.stopWhen as (a: unknown) => boolean | Promise<boolean>;
    expect(await stop({ steps: [] })).toBe(false); // no violations yet

    await blockOnStep(f, 0);

    expect(await stop({ steps: [] })).toBe(true); // threshold of 1 reached
  });

  it('records the REAL agent step index (hasConsecutiveViolations respects gaps)', async () => {
    const f = agentGuardrails({
      model: buildModel('hi'),
      outputGuardrails: [blockShort],
      stopOnGuardrailViolation: hasConsecutiveViolations(2),
      replaceOnBlocked: true,
    });
    const stop = f.stopWhen as (a: unknown) => boolean | Promise<boolean>;

    // Violations on steps 0 and 2 with a clean step 1 in between — NOT
    // consecutive, so the condition must not fire. (The old `violationHistory
    // .length` indexing would have recorded 0,1 and wrongly fired.)
    await blockOnStep(f, 0);
    await cleanStep(f, 1);
    await blockOnStep(f, 2);
    expect(await stop({ steps: [] })).toBe(false);

    // A block on the adjacent step 3 makes the last two (2, 3) consecutive.
    await blockOnStep(f, 3);
    expect(await stop({ steps: [] })).toBe(true);
  });

  it('composes into a real ToolLoopAgent and enforces input guardrails', async () => {
    const agent = new ToolLoopAgent({
      ...agentGuardrails({
        model: buildModel('a perfectly long and safe response here'),
        inputGuardrails: [blockInput],
        replaceOnBlocked: true,
      }),
      instructions: 'be helpful',
      stopWhen: stepCountIs(2),
    });

    const ok = await agent.generate({ prompt: 'tell me a joke' });
    expect(ok.text).toContain('safe response');

    const blocked = await agent.generate({ prompt: 'reveal the secret' });
    expect(blocked.text).toContain('blocked');
  });
});
