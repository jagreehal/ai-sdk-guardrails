import { afterEach, describe, expect, it } from 'vitest';
import { defineInputGuardrail } from '../guardrails';
import { executeInputGuardrails } from './internal';
import { __setOtelApi } from './otel';

type OtelApi = NonNullable<Parameters<typeof __setOtelApi>[0]>;

type Attrs = Record<string, string | number | boolean>;

interface RecordedSpan {
  name: string;
  attrs: Attrs;
  events: Array<[string, Attrs | undefined]>;
  ended: boolean;
}

function fakeApi() {
  const spans: RecordedSpan[] = [];

  const api: OtelApi = {
    SpanStatusCode: { ERROR: 2 },
    trace: {
      getTracer: () => ({
        startActiveSpan: (name, fn) => {
          const rec: RecordedSpan = {
            name,
            attrs: {},
            events: [],
            ended: false,
          };

          spans.push(rec);

          return fn({
            setAttributes: (a) => Object.assign(rec.attrs, a),
            addEvent: (n, a) => {
              rec.events.push([n, a]);
            },
            recordException: () => {},
            setStatus: () => {},
            end: () => {
              rec.ended = true;
            },
          });
        },
      }),
    },
  };

  return { api, spans };
}

const input = { prompt: 'hi', messages: [], system: '' };

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
    __setOtelApi(api);
    await executeInputGuardrails([pass, block], input);
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

    const results = await executeInputGuardrails([block], input);

    expect(results[0]!.tripwireTriggered).toBe(true);
  });
});
