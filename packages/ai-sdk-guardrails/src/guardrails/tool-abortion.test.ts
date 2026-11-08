import { describe, it, expect, vi } from 'vitest';
import {
  wrapToolWithAbortion,
  createToolAbortionController,
} from './tool-abortion';
import type {
  AIResult,
  OutputGuardrail,
  OutputGuardrailContext,
} from '../types';

type ToolInput = Record<string, string>;

function outputContext(): OutputGuardrailContext {
  // SAFETY: the guardrails under test never read the result; it carries only
  // `text` so the context has the shape of a generate result.
  const result = { text: 'test output' } as AIResult;

  return { input: { prompt: 'test', messages: [], system: '' }, result };
}

describe('createToolAbortionController', () => {
  it('should create controller with abort signal', () => {
    const controller = createToolAbortionController();

    expect(controller.signal).toBeDefined();
    expect(controller.signal.aborted).toBe(false);
  });

  it('should abort on guardrail violation', async () => {
    const controller = createToolAbortionController();

    const guardrails: OutputGuardrail[] = [
      {
        name: 'test-guardrail',
        execute: async () => ({
          tripwireTriggered: true,
          message: 'Violation',
          severity: 'critical' as const,
          info: {
            guardrailName: 'test-guardrail',
          },
        }),
      },
    ];

    await controller.checkAndAbort(guardrails, outputContext());

    expect(controller.signal.aborted).toBe(true);
  });

  it('should not abort when no violations', async () => {
    const controller = createToolAbortionController();

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

    await controller.checkAndAbort(guardrails, outputContext());

    expect(controller.signal.aborted).toBe(false);
  });

  it('should respect severity threshold', async () => {
    const controller = createToolAbortionController({
      minSeverity: 'critical',
    });

    const guardrails: OutputGuardrail[] = [
      {
        name: 'test-guardrail',
        execute: async () => ({
          tripwireTriggered: true,
          message: 'High severity',
          severity: 'high' as const,
          info: {
            guardrailName: 'test-guardrail',
          },
        }),
      },
    ];

    await controller.checkAndAbort(guardrails, outputContext());

    expect(controller.signal.aborted).toBe(false);
  });
});

describe('wrapToolWithAbortion', () => {
  it('should wrap tool execute function', () => {
    const originalExecute = vi.fn(async (_input: ToolInput) => 'result');

    const tool = {
      description: 'Test tool',
      parameters: {},
      execute: originalExecute,
    };

    const wrapped = wrapToolWithAbortion(tool, []);

    expect(wrapped.execute).toBeDefined();
    expect(wrapped.execute).not.toBe(originalExecute);
  });

  it('should execute tool normally when no violations', async () => {
    const originalExecute = vi.fn(async (_input: ToolInput) => 'success');

    const tool = {
      description: 'Test tool',
      parameters: {},
      execute: originalExecute,
    };

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

    const wrapped = wrapToolWithAbortion(tool, guardrails);
    const result = await wrapped.execute({ test: 'input' });

    expect(result).toBe('success');
    expect(originalExecute).toHaveBeenCalledWith({ test: 'input' }, undefined);
  });

  it('should check guardrails before execution', async () => {
    const originalExecute = vi.fn(async (_input: ToolInput) => 'result');

    const guardrailExecute = vi.fn(async () => ({
      tripwireTriggered: false,
      message: '',
      info: {
        guardrailName: 'test-guardrail',
      },
    }));

    const tool = {
      description: 'Test tool',
      parameters: {},
      execute: originalExecute,
    };

    const guardrails: OutputGuardrail[] = [
      {
        name: 'test-guardrail',
        execute: guardrailExecute,
      },
    ];

    const wrapped = wrapToolWithAbortion(tool, guardrails, {
      checkBefore: true,
    });

    await wrapped.execute({ test: 'input' });

    expect(guardrailExecute).toHaveBeenCalled();
    expect(originalExecute).toHaveBeenCalled();
  });

  it('should abort execution on critical violation before execution', async () => {
    const originalExecute = vi.fn(async (_input: ToolInput) => 'result');

    const tool = {
      description: 'Test tool',
      parameters: {},
      execute: originalExecute,
    };

    const guardrails: OutputGuardrail[] = [
      {
        name: 'dangerous-input',
        execute: async () => ({
          tripwireTriggered: true,
          message: 'Dangerous input detected',
          severity: 'critical' as const,
          info: {
            guardrailName: 'test-guardrail',
          },
        }),
      },
    ];

    const wrapped = wrapToolWithAbortion(tool, guardrails, {
      checkBefore: true,
      abortOnSeverity: 'critical',
    });

    await expect(wrapped.execute({ dangerous: 'input' })).rejects.toThrow(
      'Tool execution aborted',
    );
    expect(originalExecute).not.toHaveBeenCalled();
  });

  it('should monitor execution with polling', async () => {
    const originalExecute = vi.fn(
      async (_input: ToolInput) =>
        new Promise((resolve) => setTimeout(() => resolve('result'), 100)),
    );

    const tool = {
      description: 'Test tool',
      parameters: {},
      execute: originalExecute,
    };

    let checkCount = 0;

    const guardrails: OutputGuardrail[] = [
      {
        name: 'monitor',
        execute: async () => {
          checkCount++;

          return {
            tripwireTriggered: false,
            message: '',
            info: {
              guardrailName: 'test-guardrail',
            },
          };
        },
      },
    ];

    const wrapped = wrapToolWithAbortion(tool, guardrails, {
      monitorDuring: true,
      monitorInterval: 20,
    });

    // Fake timers: real ones starve under coverage/parallel load and flake.
    vi.useFakeTimers();

    try {
      const run = wrapped.execute({ test: 'input' });
      await vi.advanceTimersByTimeAsync(100);
      await run;
    } finally {
      vi.useRealTimers();
    }

    expect(checkCount).toBeGreaterThan(1);
  });

  it('should abort long-running execution on violation', async () => {
    const originalExecute = vi.fn(
      async (_input: ToolInput) =>
        new Promise((resolve) => setTimeout(() => resolve('result'), 200)),
    );

    const tool = {
      description: 'Test tool',
      parameters: {},
      execute: originalExecute,
    };

    let checkCount = 0;

    const guardrails: OutputGuardrail[] = [
      {
        name: 'monitor',
        execute: async () => {
          checkCount++;

          if (checkCount > 2) {
            return {
              tripwireTriggered: true,
              message: 'Execution taking too long',
              severity: 'critical' as const,
              info: {
                guardrailName: 'test-guardrail',
              },
            };
          }

          return {
            tripwireTriggered: false,
            message: '',
            info: {
              guardrailName: 'test-guardrail',
            },
          };
        },
      },
    ];

    const wrapped = wrapToolWithAbortion(tool, guardrails, {
      monitorDuring: true,
      monitorInterval: 30,
      abortOnSeverity: 'critical',
    });

    await expect(wrapped.execute({ test: 'input' })).rejects.toThrow();
  });

  it('should use provided AbortSignal', async () => {
    const externalController = new AbortController();

    const originalExecute = vi.fn(async (input: ToolInput, { abortSignal }) => {
      expect(abortSignal).toBe(externalController.signal);

      return 'result';
    });

    const tool = {
      description: 'Test tool',
      parameters: {},
      execute: originalExecute,
    };

    const wrapped = wrapToolWithAbortion(tool, []);

    await wrapped.execute(
      { test: 'input' },
      { abortSignal: externalController.signal },
    );

    expect(originalExecute).toHaveBeenCalled();
  });

  it('should handle onInputDelta callback', async () => {
    const onInputDelta = vi.fn();

    const tool = {
      description: 'Test tool',
      parameters: {},
      execute: async () => 'result',
      onInputDelta,
    };

    const guardrails: OutputGuardrail[] = [
      {
        name: 'stream-monitor',
        execute: async ({ result }) => {
          const text = 'text' in result ? String(result.text) : '';

          if (text.includes('bad')) {
            return {
              tripwireTriggered: true,
              message: 'Bad input detected',
              severity: 'high' as const,
              info: {
                guardrailName: 'test-guardrail',
              },
            };
          }

          return {
            tripwireTriggered: false,
            message: '',
            info: {
              guardrailName: 'test-guardrail',
            },
          };
        },
      },
    ];

    const wrapped = wrapToolWithAbortion(tool, guardrails, {
      checkInputDelta: true,
    });

    expect(wrapped.onInputDelta).toBeDefined();

    await wrapped.onInputDelta?.({
      inputTextDelta: 'good',
      toolCallId: '1',
      messages: [],
    });

    expect(onInputDelta).toHaveBeenCalled();
  });
});
