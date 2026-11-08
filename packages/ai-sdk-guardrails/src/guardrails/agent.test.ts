import { describe, it, expect } from 'vitest';
import { ToolLoopAgent, generateText, stepCountIs } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { agentGuardrails } from './agent';
import { defineInputGuardrail, defineOutputGuardrail } from '../guardrails';
import { hasConsecutiveViolations } from './stop-conditions';
import { extractTextContent } from './input';
import { extractContent } from './output';

type Fragments = ReturnType<typeof agentGuardrails>;

// Runs a real generation through the guarded model (firing the middleware's
// onOutputBlocked), then flushes with the given step index, as the agent loop
// does per step.
async function blockOnStep(f: Fragments, stepNumber: number): Promise<void> {
  await generateText({ model: f.model, prompt: 'x' });
  await cleanStep(f, stepNumber);
}

// A clean step: only the step-end flush runs, which records nothing.
async function cleanStep(f: Fragments, stepNumber: number): Promise<void> {
  // SAFETY: agentGuardrails builds onStepEnd as a function that reads only
  // `stepNumber` from the step event, so the rest of the event is never touched.
  const onStepEnd = f.onStepEnd as
    ((step: { stepNumber: number }) => void) | undefined;

  onStepEnd?.({ stepNumber });
}

function stopCondition(f: Fragments) {
  const stop = f.stopWhen;

  if (stop === undefined || Array.isArray(stop)) {
    throw new Error('expected a single stopWhen condition');
  }

  return stop;
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
    return extractTextContent(ctx).prompt.includes('secret')
      ? { tripwireTriggered: true, message: 'no secrets', severity: 'high' }
      : { tripwireTriggered: false };
  },
});

const blockShort = defineOutputGuardrail({
  name: 'min-length',
  execute: async ({ result }) => {
    return extractContent(result).text.length < 20
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

    // Must be a native StopCondition function, not an eagerly computed value.
    expect(f.stopWhen).toBeInstanceOf(Function);
    expect(f.onStepEnd).toBeInstanceOf(Function);
  });

  it('records real middleware blocks so stopWhen fires at the threshold', async () => {
    // buildModel('hi') yields 2 chars, so blockShort (min length 20) trips on a
    // real model call through the same path the middleware enforces.
    const f = agentGuardrails({
      model: buildModel('hi'),
      outputGuardrails: [blockShort],
      stopOnGuardrailViolation: 1,
      replaceOnBlocked: true,
    });

    const stop = stopCondition(f);
    expect(await stop({ steps: [] })).toBe(false);

    await blockOnStep(f, 0);

    expect(await stop({ steps: [] })).toBe(true);
  });

  it('records the REAL agent step index (hasConsecutiveViolations respects gaps)', async () => {
    const f = agentGuardrails({
      model: buildModel('hi'),
      outputGuardrails: [blockShort],
      stopOnGuardrailViolation: hasConsecutiveViolations(2),
      replaceOnBlocked: true,
    });

    const stop = stopCondition(f);

    // Violations on steps 0 and 2 with a clean step 1 in between are not
    // consecutive, so the condition must not fire.
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
