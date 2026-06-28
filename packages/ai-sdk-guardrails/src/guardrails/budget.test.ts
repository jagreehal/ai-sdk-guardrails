import { describe, expect, it, vi } from 'vitest';
import type { AIResult, OutputGuardrailContext } from '../types';
import {
  budgetGuardrail,
  createGuardrailBudget,
  type GuardrailBudget,
} from './budget';

/** Output context carrying V3-style usage. */
function contextWithUsage(
  inputTokens: number,
  outputTokens: number,
): OutputGuardrailContext {
  const result = {
    content: [{ type: 'text', text: 'ok' }],
    usage: {
      inputTokens: { total: inputTokens },
      outputTokens: { total: outputTokens },
    },
  } as unknown as AIResult;
  return { result } as OutputGuardrailContext;
}

describe('createGuardrailBudget', () => {
  it('accumulates usage across steps and stops at the cost ceiling', () => {
    const budget = createGuardrailBudget({ maxCostUsd: 1 });
    budget.record({ kind: 'llm', usage: { costUsd: 0.6 } });
    expect(budget.stopped).toBe(false);
    budget.record({ kind: 'llm', usage: { costUsd: 0.6 } });
    expect(budget.stopped).toBe(true);
    expect(budget.state.costUsd).toBeCloseTo(1.2);
    expect(budget.state.stepCount).toBe(2);
  });

  it('stops at the token ceiling and counts tool calls', () => {
    const budget = createGuardrailBudget({ maxTokens: 100, maxToolCalls: 1 });
    budget.record({
      kind: 'llm',
      usage: { inputTokens: 60, outputTokens: 30 },
    });
    expect(budget.stopped).toBe(false);
    budget.record({ kind: 'tool', name: 'search' });
    budget.record({ kind: 'tool', name: 'search' });
    expect(budget.state.toolCallCount).toBe(2);
    expect(budget.stopped).toBe(true);
  });
});

describe('budgetGuardrail', () => {
  it('feeds usage into the budget and trips once it stops', async () => {
    const budget = createGuardrailBudget({ maxTokens: 100 });
    const guardrail = budgetGuardrail({ budget });

    const first = await guardrail.execute(contextWithUsage(40, 20));
    expect(first.tripwireTriggered).toBe(false);
    expect(budget.state.inputTokens).toBe(40);

    const second = await guardrail.execute(contextWithUsage(40, 30));
    expect(second.tripwireTriggered).toBe(true);
    expect(second.severity).toBe('high');
    expect(second.metadata?.stopped).toBe(true);
  });

  it('uses estimateCost to accumulate spend', async () => {
    const budget = createGuardrailBudget({ maxCostUsd: 0.01 });
    const guardrail = budgetGuardrail({
      budget,
      estimateCost: ({ inputTokens = 0, outputTokens = 0 }) =>
        (inputTokens + outputTokens) * 0.0001,
    });

    const res = await guardrail.execute(contextWithUsage(80, 80)); // 160 * 0.0001 = 0.016 > 0.01
    expect(res.tripwireTriggered).toBe(true);
    expect(budget.state.costUsd).toBeCloseTo(0.016);
  });

  it('converts an autotel-style throwing budget into a block', async () => {
    // Mimics a GenAiGuard with onStop:'throw' — record() throws once stopped.
    let stopped = false;
    const throwingBudget: GuardrailBudget = {
      record() {
        stopped = true;
        throw new Error('GEN_AI_GUARD_STOP');
      },
      get stopped() {
        return stopped;
      },
      state: {
        costUsd: 9,
        inputTokens: 0,
        outputTokens: 0,
        stepCount: 1,
        toolCallCount: 0,
        errorCount: 0,
      },
    };
    const guardrail = budgetGuardrail({ budget: throwingBudget });
    const res = await guardrail.execute(contextWithUsage(1, 1));
    expect(res.tripwireTriggered).toBe(true);
  });

  it('does not block when blockOnStop is false', async () => {
    const budget = createGuardrailBudget({ maxTokens: 1 });
    const spy = vi.spyOn(budget, 'record');
    const guardrail = budgetGuardrail({ budget, blockOnStop: false });
    const res = await guardrail.execute(contextWithUsage(50, 50));
    expect(res.tripwireTriggered).toBe(false);
    expect(spy).toHaveBeenCalled();
  });
});
