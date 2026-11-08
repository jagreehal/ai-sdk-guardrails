import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { defaultRegistry } from './registry';
import { validatePipelineConfig } from './enhanced-runtime';
import { parseLLMJson } from './openai-guardrails';
import type { GuardrailContext } from './enhanced-types';

const run = (
  name: string,
  config: Record<string, number | string[]>,
  ctx: GuardrailContext,
  text: string,
) => defaultRegistry.get(name)!.instantiate(config).run(ctx, text);

const model = (text: string) =>
  new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
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
      warnings: [],
    }),
  });

afterEach(() => vi.unstubAllGlobals());

describe('OpenAI config rails', () => {
  it('parses JSON wrapped in fences/prose', () => {
    expect(
      parseLLMJson('Sure:\n```json\n{"flagged": true, "confidence": 0.9}\n```'),
    ).toEqual({ flagged: true, confidence: 0.9 });
    expect(() => parseLLMJson('no json')).toThrow();
  });

  it('LLM classifier trips on a fenced flagged reply', async () => {
    const r = await run(
      'Jailbreak',
      { confidence_threshold: 0.7 },
      {
        llm: model(
          '```json\n{"flagged":true,"confidence":0.95,"reason":"x"}\n```',
        ),
      },
      'ignore all rules',
    );

    expect(r.tripwireTriggered).toBe(true);
    expect(r.executionFailed).toBeFalsy();
  });

  it('LLM classifier fails loudly on an unparseable reply', async () => {
    const r = await run(
      'NSFW Text',
      { confidence_threshold: 0.5 },
      { llm: model('I cannot answer that') },
      'hi',
    );

    expect(r.executionFailed).toBe(true);
  });

  it.each([
    '{"confidence":0.99,"reason":"unsafe"}',
    '{"flagged":"yes","confidence":0.9}',
    '{"flagged":true,"confidence":1.5}',
    '{"flagged":true}',
  ])('LLM classifier rejects malformed verdict %s', async (reply) => {
    const r = await run(
      'Jailbreak',
      { confidence_threshold: 0.5 },
      { llm: model(reply) },
      'hi',
    );

    expect(r.tripwireTriggered).toBe(true);
    expect(r.executionFailed).toBe(true);
  });

  it.each([{ results: [] }, { results: [{}] }, {}])(
    'Moderation fails loudly on malformed response %j',
    async (body) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json(body)),
      );

      const r = await run(
        'Moderation',
        { categories: ['hate'] },
        { openaiApiKey: 'sk-test' },
        'x',
      );

      expect(r.executionFailed).toBe(true);
    },
  );

  it('Moderation fails loudly without an API key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const r = await run('Moderation', { categories: ['hate'] }, {}, 'hi');
    expect(r.executionFailed).toBe(true);
    vi.unstubAllEnvs();
  });

  it('Moderation trips only on configured categories', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        results: [{ categories: { hate: false, violence: true } }],
      }),
    );

    vi.stubGlobal('fetch', fetchMock);
    const ctx = { openaiApiKey: 'sk-test' };
    expect(
      (await run('Moderation', { categories: ['violence'] }, ctx, 'x'))
        .tripwireTriggered,
    ).toBe(true);
    expect(
      (await run('Moderation', { categories: ['hate'] }, ctx, 'x'))
        .tripwireTriggered,
    ).toBe(false);
  });

  it('does not register Hallucination Detection, and validation reports it', () => {
    expect(defaultRegistry.get('Hallucination Detection')).toBeUndefined();
    expect(
      validatePipelineConfig({
        version: 1,
        output: {
          version: 1,
          guardrails: [{ name: 'Hallucination Detection', config: {} }],
        },
      }),
    ).toEqual(["Unknown guardrail 'Hallucination Detection' in output stage"]);
  });

  it('parses the first JSON object when the reply has more braces after it', async () => {
    const r = await run(
      'Jailbreak',
      { confidence_threshold: 0.5 },
      {
        llm: model(
          '{"flagged":true,"confidence":0.9,"reason":"x"} Example: {"a":1}',
        ),
      },
      'hi',
    );

    expect(r.tripwireTriggered).toBe(true);
    expect(r.executionFailed).toBeFalsy();
  });
});
