import { describe, expect, it } from 'vitest';
import type { AIResult, OutputGuardrailContext } from '../types';
import {
  builtinPlanRiskClassifier,
  planRiskGuardrail,
  type PlanRiskClassifier,
} from './plan-risk';

/** Minimal output-guardrail context carrying tool calls in the AI SDK shape. */
function contextWithTools(toolNames: string[]): OutputGuardrailContext {
  const result = {
    content: toolNames.map((toolName) => ({ type: 'tool-call', toolName })),
  } as unknown as AIResult;
  return { result } as OutputGuardrailContext;
}

describe('builtinPlanRiskClassifier', () => {
  const classify = builtinPlanRiskClassifier();

  it('flags untrusted-read → destructive chains as high', async () => {
    expect(
      await classify({ toolSequence: ['fetchEmail', 'sendPayment'] }),
    ).toMatchObject({
      verdict: 'high',
      categories: ['untrusted_to_destructive_chain'],
    });
  });

  it('flags long tool chains as medium', async () => {
    const seq = Array.from({ length: 8 }, (_, i) => `step_${i}`);
    expect(await classify({ toolSequence: seq })).toMatchObject({
      verdict: 'medium',
    });
  });

  it('treats benign and empty plans as low', async () => {
    expect(await classify({ toolSequence: ['calculate'] })).toMatchObject({
      verdict: 'low',
    });
    expect(await classify({ toolSequence: [] })).toMatchObject({
      verdict: 'low',
    });
  });
});

describe('planRiskGuardrail', () => {
  it('trips when the verdict reaches the threshold (default high)', async () => {
    const guardrail = planRiskGuardrail();
    const res = await guardrail.execute(
      contextWithTools(['readInbox', 'transferFunds']),
    );
    expect(res.tripwireTriggered).toBe(true);
    expect(res.severity).toBe('high');
    expect(res.metadata?.verdict).toBe('high');
    expect(res.metadata?.toolSequence).toEqual(['readInbox', 'transferFunds']);
  });

  it('passes a benign plan', async () => {
    const guardrail = planRiskGuardrail();
    const res = await guardrail.execute(contextWithTools(['calculate']));
    expect(res.tripwireTriggered).toBe(false);
    expect(res.metadata?.verdict).toBe('low');
  });

  it('respects a lower blockAtOrAbove threshold', async () => {
    const guardrail = planRiskGuardrail({ blockAtOrAbove: 'medium' });
    const longChain = Array.from({ length: 8 }, (_, i) => `step_${i}`);
    const res = await guardrail.execute(contextWithTools(longChain));
    expect(res.tripwireTriggered).toBe(true);
    expect(res.severity).toBe('medium');
  });

  it('uses a custom classifier and abstains on undefined', async () => {
    const always: PlanRiskClassifier = () => ({
      verdict: 'critical',
      reason: 'nope',
    });
    const tripped = await planRiskGuardrail({ classifier: always }).execute(
      contextWithTools(['anything']),
    );
    expect(tripped.tripwireTriggered).toBe(true);
    expect(tripped.severity).toBe('critical');

    // eslint-disable-next-line unicorn/no-useless-undefined -- the type requires an explicit return to model abstention
    const abstain: PlanRiskClassifier = () => undefined;
    const passed = await planRiskGuardrail({ classifier: abstain }).execute(
      contextWithTools(['readInbox', 'transferFunds']),
    );
    expect(passed.tripwireTriggered).toBe(false);
  });
});
