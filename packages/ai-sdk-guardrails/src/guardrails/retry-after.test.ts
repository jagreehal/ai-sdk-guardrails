import { describe, expect, it } from 'vitest';
import { generateText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { withGuardrails } from '../guardrails';
import type { AIResult } from '../types';
import { parseRetryAfterMs, retryAfterIntegration } from './output';

const context = (headers?: Record<string, string>) => ({
  input: { prompt: 'x', messages: [], system: '' },
  // SAFETY: retryAfterIntegration reads only `response.headers` from the result.
  result: { text: 'ok', response: { headers } } as AIResult,
});

const run = (headers?: Record<string, string>) =>
  retryAfterIntegration({ jitterFactor: 0 }).execute(context(headers));

describe('parseRetryAfterMs', () => {
  it.each([
    ['2', 2000],
    ['0.5', 500],
    ['1s', 1000],
    ['6m0s', 360_000],
    ['250ms', 250],
    ['1h2m3s', 3_723_000],
    [undefined, undefined],
    ['soon', undefined],
  ])('%s → %s', (value, ms) => {
    expect(parseRetryAfterMs(value)).toBe(ms);
  });

  it('parses an HTTP-date relative to now', () => {
    const now = Date.parse('2026-11-08T12:00:00Z');
    expect(parseRetryAfterMs('Sun, 08 Nov 2026 12:00:30 GMT', now)).toBe(
      30_000,
    );
  });
});

describe('retryAfterIntegration', () => {
  it('passes with no rate-limit headers (and no longer trips on slow/large responses)', async () => {
    expect((await run()).tripwireTriggered).toBe(false);
    expect((await run({ 'content-type': 'json' })).tripwireTriggered).toBe(
      false,
    );
  });

  it('trips on retry-after and recommends that delay', async () => {
    const r = await run({ 'Retry-After': '3' });
    expect(r.tripwireTriggered).toBe(true);
    expect(r.metadata?.recommendedBackoffMs).toBe(3000);
  });

  it('prefers retry-after-ms', async () => {
    const r = await run({ 'retry-after-ms': '750', 'retry-after': '9' });
    expect(r.metadata?.recommendedBackoffMs).toBe(750);
  });

  it('trips when remaining quota is exhausted, using the reset header', async () => {
    const r = await run({
      'x-ratelimit-remaining-requests': '0',
      'x-ratelimit-reset-requests': '2s',
      'x-ratelimit-remaining-tokens': '5000',
    });

    expect(r.tripwireTriggered).toBe(true);
    expect(r.metadata?.recommendedBackoffMs).toBe(2000);
  });

  it('caps the backoff at maxRetryDelayMs', async () => {
    const r = await retryAfterIntegration({
      jitterFactor: 0,
      maxRetryDelayMs: 1000,
    }).execute(context({ 'retry-after': '60' }));

    expect(r.metadata?.recommendedBackoffMs).toBe(1000);
  });

  it('sees real provider headers through withGuardrails', async () => {
    let blocked: unknown;

    const model = withGuardrails({
      model: new MockLanguageModelV4({
        doGenerate: async () => ({
          content: [{ type: 'text', text: 'ok' }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: {
            inputTokens: {
              total: 1,
              noCache: undefined,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 1, text: undefined, reasoning: undefined },
          },
          response: { headers: { 'retry-after': '1' } },
          warnings: [],
        }),
      }),
      outputGuardrails: [retryAfterIntegration({ jitterFactor: 0 })],
      replaceOnBlocked: false,
      onOutputBlocked: (summary) => {
        blocked = summary.blockedResults[0]?.metadata?.recommendedBackoffMs;
      },
    });

    await generateText({ model, prompt: 'hi' });
    expect(blocked).toBe(1000);
  });
});
