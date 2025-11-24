import { describe, it, expect, vi } from 'vitest';
import {
  createTokenBudgetTransform,
  createTokenAwareGuardrailTransform,
  estimateTokenCount,
} from './token-control';
import type { OutputGuardrail } from '../types';

describe('estimateTokenCount', () => {
  it('should estimate token count from text', () => {
    const text = 'Hello world this is a test';
    const count = estimateTokenCount(text);

    // Rough estimate: ~6 tokens for this text
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(20);
  });

  it('should handle empty text', () => {
    expect(estimateTokenCount('')).toBe(0);
  });

  it('should handle longer text', () => {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(10);
    const count = estimateTokenCount(text);

    expect(count).toBeGreaterThan(50);
  });
});

describe('createTokenBudgetTransform', () => {
  it('should stop stream after token budget exceeded', async () => {
    const stopStream = vi.fn();
    const transform = createTokenBudgetTransform({
      maxTokens: 5,
    });
    const transformStream = transform({ tools: {}, stopStream });

    const chunks = [
      { type: 'text-delta' as const, id: '1', text: 'Hello ' }, // ~1 token
      { type: 'text-delta' as const, id: '1', text: 'world ' }, // ~1 token
      { type: 'text-delta' as const, id: '1', text: 'this is ' }, // ~2 tokens
      { type: 'text-delta' as const, id: '1', text: 'a test' }, // ~2 tokens (total ~6)
      { type: 'text-delta' as const, id: '1', text: ' more' }, // Should not reach
    ];

    const reader = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    })
      .pipeThrough(transformStream)
      .getReader();

    const results = [];
    let result = await reader.read();
    while (!result.done) {
      results.push(result.value);
      result = await reader.read();
    }

    expect(stopStream).toHaveBeenCalled();
    expect(results.length).toBeLessThan(chunks.length);
  });

  it('should call onBudgetExceeded when budget exceeded', async () => {
    const onBudgetExceeded = vi.fn();
    const stopStream = vi.fn();
    const transform = createTokenBudgetTransform({
      maxTokens: 3,
      onBudgetExceeded,
    });
    const transformStream = transform({ tools: {}, stopStream });

    const chunks = [
      { type: 'text-delta' as const, id: '1', text: 'Hello world test' },
    ];

    const reader = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    })
      .pipeThrough(transformStream)
      .getReader();

    let result = await reader.read();
    while (!result.done) {
      // consume stream
      result = await reader.read();
    }

    expect(onBudgetExceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        consumed: expect.any(Number),
        budget: 3,
      }),
    );
  });

  it('should not stop if within budget', async () => {
    const stopStream = vi.fn();
    const transform = createTokenBudgetTransform({
      maxTokens: 100,
    });
    const transformStream = transform({ tools: {}, stopStream });

    const chunks = [
      { type: 'text-delta' as const, id: '1', text: 'Hello' },
      { type: 'text-delta' as const, id: '1', text: ' world' },
    ];

    const reader = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    })
      .pipeThrough(transformStream)
      .getReader();

    const results = [];
    let result = await reader.read();
    while (!result.done) {
      results.push(result.value);
      result = await reader.read();
    }

    expect(stopStream).not.toHaveBeenCalled();
    expect(results).toHaveLength(2);
  });
});

describe('createTokenAwareGuardrailTransform', () => {
  it('should check guardrails only at token intervals', async () => {
    const executeFn = vi.fn(async () => ({
      tripwireTriggered: false,
      message: '',
      info: {
        guardrailName: 'test-guardrail',
      },
    }));

    const guardrails: OutputGuardrail[] = [
      {
        name: 'test-guardrail',
        execute: executeFn,
      },
    ];

    const stopStream = vi.fn();
    const transform = createTokenAwareGuardrailTransform(guardrails, {
      checkEveryTokens: 5,
    });
    const transformStream = transform({ tools: {}, stopStream });

    const chunks = [
      { type: 'text-delta' as const, id: '1', text: 'Hello ' }, // ~1 token
      { type: 'text-delta' as const, id: '1', text: 'world ' }, // ~1 token (no check)
      { type: 'text-delta' as const, id: '1', text: 'this is ' }, // ~2 tokens (no check)
      { type: 'text-delta' as const, id: '1', text: 'a test ' }, // ~2 tokens (check at ~6)
      { type: 'text-delta' as const, id: '1', text: 'more text' }, // check again
    ];

    const reader = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    })
      .pipeThrough(transformStream)
      .getReader();

    let result = await reader.read();
    while (!result.done) {
      // consume stream
      result = await reader.read();
    }

    // Should check less frequently than chunk count
    expect(executeFn.mock.calls.length).toBeLessThan(chunks.length);
    expect(executeFn.mock.calls.length).toBeGreaterThan(0);
  });

  it('should stop after max tokens even without violations', async () => {
    const guardrails: OutputGuardrail[] = [
      {
        name: 'test-guardrail',
        execute: async () => ({
          tripwireTriggered: false,
          message: '',
          info: {
            guardrailName: 'test-guardrail',
          },
        }),
      },
    ];

    const stopStream = vi.fn();
    const transform = createTokenAwareGuardrailTransform(guardrails, {
      maxTokens: 3,
      checkEveryTokens: 2,
    });
    const transformStream = transform({ tools: {}, stopStream });

    const chunks = [
      {
        type: 'text-delta' as const,
        id: '1',
        text: 'Hello world this is a long text',
      },
    ];

    const reader = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    })
      .pipeThrough(transformStream)
      .getReader();

    let result = await reader.read();
    while (!result.done) {
      // consume stream
      result = await reader.read();
    }

    expect(stopStream).toHaveBeenCalled();
  });

  it('should stop on violation before token limit', async () => {
    const guardrails: OutputGuardrail[] = [
      {
        name: 'toxic-filter',
        execute: async ({ result }) => {
          const text =
            typeof result === 'object' && result && 'text' in result
              ? String((result as { text: string }).text)
              : '';
          if (text.includes('toxic')) {
            return {
              tripwireTriggered: true,
              message: 'Toxic content',
              severity: 'critical' as const,
              info: {
                guardrailName: 'toxic-filter',
              },
            };
          }
          return {
            tripwireTriggered: false,
            message: '',
            info: {
              guardrailName: 'toxic-filter',
            },
          };
        },
      },
    ];

    const stopStream = vi.fn();
    const transform = createTokenAwareGuardrailTransform(guardrails, {
      maxTokens: 100,
      checkEveryTokens: 2,
      stopOnSeverity: 'critical',
    });
    const transformStream = transform({ tools: {}, stopStream });

    const chunks = [
      { type: 'text-delta' as const, id: '1', text: 'Hello toxic content' },
    ];

    const reader = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    })
      .pipeThrough(transformStream)
      .getReader();

    const results = [];
    let result = await reader.read();
    while (!result.done) {
      results.push(result.value);
      result = await reader.read();
    }

    expect(stopStream).toHaveBeenCalled();
    expect(results.some((r) => r.type === 'error')).toBe(true);
  });

  it('should handle custom tokenizer', async () => {
    const customTokenizer = vi.fn((text: string) => text.split(' ').length);

    const guardrails: OutputGuardrail[] = [
      {
        name: 'test-guardrail',
        execute: async () => ({
          tripwireTriggered: false,
          message: '',
          info: {
            guardrailName: 'test-guardrail',
          },
        }),
      },
    ];

    const stopStream = vi.fn();
    const transform = createTokenAwareGuardrailTransform(guardrails, {
      maxTokens: 5,
      tokenizer: customTokenizer,
    });
    const transformStream = transform({ tools: {}, stopStream });

    const chunks = [
      {
        type: 'text-delta' as const,
        id: '1',
        text: 'one two three four five six',
      },
    ];

    const reader = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    })
      .pipeThrough(transformStream)
      .getReader();

    let result = await reader.read();
    while (!result.done) {
      // consume stream
      result = await reader.read();
    }

    expect(customTokenizer).toHaveBeenCalled();
    expect(stopStream).toHaveBeenCalled(); // 6 words > 5 token limit
  });
});
