import { describe, expect, it } from 'vitest';
import { simulateReadableStream, streamText } from 'ai';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';
import {
  createContentFilterTransform,
  createPIIRedactionTransform,
} from './stream-transform';
import {
  createGuardrailStreamTransform,
  createGuardrailStreamTransformBuffered,
} from './streaming';
import { createTokenBudgetTransform } from './token-control';
import { defineOutputGuardrail } from '../guardrails';
import { extractContent } from './output';

const blockSecret = defineOutputGuardrail({
  name: 'no-secret',
  execute: async ({ result }) => ({
    tripwireTriggered: /SECRET/.test(extractContent(result).text),
    message: 'secret leaked',
    severity: 'critical',
  }),
});

const usage = {
  inputTokens: {
    total: 1,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: undefined, reasoning: undefined },
};

// Chunks arrive with a delay, like a real provider still streaming when a
// transform calls stopStream().
function streamingModel(deltas: string[]) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream<LanguageModelV4StreamPart>({
        chunkDelayInMs: 5,
        chunks: [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't' },
          ...deltas.map((delta) => ({
            type: 'text-delta' as const,
            id: 't',
            delta,
          })),
          { type: 'text-end', id: 't' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: undefined },
            usage,
          },
        ],
      }),
    }),
  });
}

describe('stream transforms via streamText experimental_transform', () => {
  it('redacts PII in text-delta parts', async () => {
    const result = streamText({
      model: streamingModel(['Mail me at ', 'jane@example.com', ' today']),
      prompt: 'hi',
      experimental_transform: createPIIRedactionTransform(),
    });

    expect(await result.text).toBe('Mail me at [REDACTED] today');
  });

  it('stops the stream and emits the blocked notice', async () => {
    const result = streamText({
      model: streamingModel(['public ', 'SECRET ', 'more']),
      prompt: 'hi',
      experimental_transform: createContentFilterTransform({
        blockedKeywords: ['secret'],
      }),
    });

    expect(await result.text).toBe(
      'public \n[Content blocked: prohibited content detected]',
    );
  });

  it('stops on a guardrail violation and settles the result', async () => {
    const errors: unknown[] = [];

    const result = streamText({
      model: streamingModel(['public ', 'SECRET ', 'more']),
      prompt: 'hi',
      experimental_transform: createGuardrailStreamTransform([blockSecret]),
      onError: ({ error }) => {
        errors.push(error);
      },
    });

    expect(await result.text).toBe('public ');
    expect(await result.finishReason).toBe('content-filter');
    expect(errors).toEqual(['Guardrail violation: secret leaked']);
  });

  it('buffered variant drops all text on a violation', async () => {
    const result = streamText({
      model: streamingModel(['public ', 'SECRET']),
      prompt: 'hi',
      experimental_transform: createGuardrailStreamTransformBuffered([
        blockSecret,
      ]),
      onError: () => {},
    });

    expect(await result.text).toBe('');
    expect(await result.finishReason).toBe('content-filter');
  });

  it('stops at the token budget', async () => {
    const result = streamText({
      model: streamingModel(['one ', 'two ', 'three ', 'four ']),
      prompt: 'hi',
      experimental_transform: createTokenBudgetTransform({ maxTokens: 3 }),
      onError: () => {},
    });

    expect(await result.text).toBe('one two ');
  });
});
