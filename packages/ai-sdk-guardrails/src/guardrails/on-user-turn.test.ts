import { describe, expect, it } from 'vitest';
import { defineInputGuardrail } from '../guardrails';
import { onUserTurn } from './on-user-turn';

function counting() {
  let calls = 0;
  const guardrail = onUserTurn(
    defineInputGuardrail({
      name: 'counts',
      execute: async () => {
        calls += 1;
        return { tripwireTriggered: true, message: 'ran' };
      },
    }),
  );
  return { guardrail, calls: () => calls };
}

const user = (text: string) => ({
  role: 'user',
  content: [{ type: 'text', text }],
});
const tool = () => ({
  role: 'tool',
  content: [
    {
      type: 'tool-result',
      toolCallId: '1',
      toolName: 'x',
      output: { type: 'json', value: {} },
    },
  ],
});

describe('onUserTurn', () => {
  it('runs when the newest message is from the user', async () => {
    const { guardrail, calls } = counting();
    const r = await guardrail.execute({ prompt: [user('hi')] } as never);
    expect(r.tripwireTriggered).toBe(true);
    expect(calls()).toBe(1);
  });

  it('skips the tool-loop steps that follow', async () => {
    const { guardrail, calls } = counting();
    const r = await guardrail.execute({
      prompt: [user('hi'), { role: 'assistant', content: [] }, tool()],
    } as never);
    expect(r.tripwireTriggered).toBe(false);
    expect(calls()).toBe(0);
  });

  it('runs again on the next user turn of a conversation', async () => {
    const { guardrail, calls } = counting();
    await guardrail.execute({
      prompt: [user('hi'), tool(), user('and again?')],
    } as never);
    expect(calls()).toBe(1);
  });
});

describe('onUserTurn forwards execution options', () => {
  it('passes the abort signal through to the wrapped guardrail', async () => {
    let seen: AbortSignal | undefined;
    const guardrail = onUserTurn(
      defineInputGuardrail({
        name: 'signal',
        execute: async (_ctx, options) => {
          seen = options?.signal;
          return { tripwireTriggered: false };
        },
      }),
    );
    const controller = new AbortController();
    await guardrail.execute({ prompt: [user('hi')] } as never, {
      signal: controller.signal,
    });
    expect(seen).toBe(controller.signal);
  });
});
