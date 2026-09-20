import { afterEach, describe, expect, it } from 'vitest';
import { defineInputGuardrail } from '../guardrails';
import { executeInputGuardrails } from './internal';
import { __setOtelApi } from './otel';

function fakeApi() {
  const spans: Array<{
    name: string;
    attrs: Record<string, unknown>;
    events: Array<[string, unknown]>;
    ended: boolean;
  }> = [];
  const api = {
    SpanStatusCode: { ERROR: 2 },
    trace: {
      getTracer: () => ({
        startActiveSpan: <T>(name: string, fn: (span: unknown) => T): T => {
          const rec = {
            name,
            attrs: {},
            events: [] as Array<[string, unknown]>,
            ended: false,
          };
          spans.push(rec);
          return fn({
            setAttributes: (a: Record<string, unknown>) =>
              Object.assign(rec.attrs, a),
            addEvent: (n: string, a: unknown) => {
              rec.events.push([n, a]);
            },
            recordException: () => {},
            setStatus: () => {},
            end: () => (rec.ended = true),
          });
        },
      }),
    },
  };
  return { api, spans };
}

const pass = defineInputGuardrail({
  name: 'ok',
  execute: async () => ({ tripwireTriggered: false }),
});
const block = defineInputGuardrail({
  name: 'nope',
  execute: async () => ({
    tripwireTriggered: true,
    message: 'blocked it',
    severity: 'high',
  }),
});

afterEach(() => __setOtelApi(null));

describe('guardrail stage span', () => {
  it('records counts and one gen_ai.guard.stop event per block', async () => {
    const { api, spans } = fakeApi();
    __setOtelApi(api as never);
    await executeInputGuardrails([pass, block], { prompt: 'hi' } as never);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe('guardrails.input');
    expect(spans[0]!.ended).toBe(true);
    expect(spans[0]!.attrs).toMatchObject({
      'guardrails.count': 2,
      'guardrails.passed': 1,
      'guardrails.blocked': 1,
    });
    expect(spans[0]!.events).toEqual([
      [
        'gen_ai.guard.stop',
        {
          'gen_ai.guard.rule': 'nope',
          'gen_ai.guard.action': 'block',
          'gen_ai.guard.message': 'blocked it',
          'gen_ai.guard.severity': 'high',
        },
      ],
    ]);
  });

  it('runs guardrails unchanged when the API is absent', async () => {
    __setOtelApi(null);
    const results = await executeInputGuardrails([block], {
      prompt: 'hi',
    } as never);
    expect(results[0]!.tripwireTriggered).toBe(true);
  });
});
