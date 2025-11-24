import { describe, it, expect, vi } from 'vitest';
import { createGuardrailStreamTransform } from './streaming';
import type { OutputGuardrail } from '../types';

describe('createGuardrailStreamTransform', () => {
  it('should create a transform function', () => {
    const guardrails: OutputGuardrail[] = [];
    const transform = createGuardrailStreamTransform(guardrails);

    expect(typeof transform).toBe('function');
  });

  it('should pass through chunks when no violations', async () => {
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
    const transform = createGuardrailStreamTransform(guardrails);
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

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(chunks[0]);
    expect(results[1]).toEqual(chunks[1]);
    expect(stopStream).not.toHaveBeenCalled();
  });

  it('should stop stream on critical violation', async () => {
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
              message: 'Toxic content detected',
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
    const transform = createGuardrailStreamTransform(guardrails, {
      stopOnSeverity: 'critical',
    });
    const transformStream = transform({ tools: {}, stopStream });

    const chunks = [
      { type: 'text-delta' as const, id: '1', text: 'Hello' },
      { type: 'text-delta' as const, id: '1', text: ' toxic' },
      { type: 'text-delta' as const, id: '1', text: ' content' },
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

    // Should stop after detecting violation
    expect(stopStream).toHaveBeenCalled();
    expect(results.length).toBeLessThan(chunks.length);
    expect(results.some((r) => r.type === 'error')).toBe(true);
  });

  it('should call onViolation callback when violation detected', async () => {
    const onViolation = vi.fn();
    const guardrails: OutputGuardrail[] = [
      {
        name: 'test-guardrail',
        execute: async () => ({
          tripwireTriggered: true,
          message: 'Violation',
          severity: 'high' as const,
          info: {
            guardrailName: 'test-guardrail',
          },
        }),
      },
    ];

    const stopStream = vi.fn();
    const transform = createGuardrailStreamTransform(guardrails, {
      stopOnSeverity: 'high',
      onViolation,
    });
    const transformStream = transform({ tools: {}, stopStream });

    const chunks = [{ type: 'text-delta' as const, id: '1', text: 'Test' }];

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

    expect(onViolation).toHaveBeenCalled();
    const firstCall = onViolation.mock.calls[0];
    expect(firstCall?.[0]).toMatchObject({
      blockedResults: expect.arrayContaining([
        expect.objectContaining({
          tripwireTriggered: true,
          message: 'Violation',
        }),
      ]),
    });
  });

  it('should check guardrails at specified intervals', async () => {
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
    const transform = createGuardrailStreamTransform(guardrails, {
      checkInterval: 2, // Check every 2 chunks
    });
    const transformStream = transform({ tools: {}, stopStream });

    const chunks = [
      { type: 'text-delta' as const, id: '1', text: 'A' },
      { type: 'text-delta' as const, id: '1', text: 'B' },
      { type: 'text-delta' as const, id: '1', text: 'C' },
      { type: 'text-delta' as const, id: '1', text: 'D' },
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

    // Should only check on chunks 2 and 4
    expect(executeFn).toHaveBeenCalledTimes(2);
  });

  it('should pass through non-text chunks without checking', async () => {
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
    const transform = createGuardrailStreamTransform(guardrails);
    const transformStream = transform({ tools: {}, stopStream });

    const chunks = [
      { type: 'tool-call' as const, toolCallId: '1', toolName: 'test' },
      { type: 'text-delta' as const, id: '1', text: 'Test' },
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

    expect(results).toHaveLength(2);
    expect(executeFn).toHaveBeenCalledTimes(1); // Only for text chunk
  });

  it('should handle custom stop condition', async () => {
    const guardrails: OutputGuardrail[] = [
      {
        name: 'test-guardrail',
        execute: async () => ({
          tripwireTriggered: true,
          message: 'Low severity',
          severity: 'low' as const,
          info: {
            guardrailName: 'test-guardrail',
          },
        }),
      },
    ];

    const stopStream = vi.fn();
    const transform = createGuardrailStreamTransform(guardrails, {
      stopCondition: (summary) => summary.blockedResults.length > 0,
    });
    const transformStream = transform({ tools: {}, stopStream });

    const chunks = [{ type: 'text-delta' as const, id: '1', text: 'Test' }];

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

  it('should not stop when stopOnSeverity is not met', async () => {
    const guardrails: OutputGuardrail[] = [
      {
        name: 'test-guardrail',
        execute: async () => ({
          tripwireTriggered: true,
          message: 'Low severity',
          severity: 'low' as const,
          info: {
            guardrailName: 'test-guardrail',
          },
        }),
      },
    ];

    const stopStream = vi.fn();
    const transform = createGuardrailStreamTransform(guardrails, {
      stopOnSeverity: 'critical',
    });
    const transformStream = transform({ tools: {}, stopStream });

    const chunks = [{ type: 'text-delta' as const, id: '1', text: 'Test' }];

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
    expect(results).toHaveLength(1);
  });
});
