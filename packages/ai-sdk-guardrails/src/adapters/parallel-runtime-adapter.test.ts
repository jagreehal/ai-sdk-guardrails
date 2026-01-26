import { describe, it, expect } from 'vitest';
import { defineOutputGuardrail, executeOutputGuardrails } from '../guardrails';
import { executeOutputGuardrailsWithEnhancedRuntime } from './parallel-runtime-adapter';
import type { AIResult } from '../types';

describe('executeOutputGuardrailsWithEnhancedRuntime', () => {
  it('should forward accumulatedText to output guardrails', async () => {
    const guardrail = defineOutputGuardrail({
      name: 'accumulated-text-required',
      execute: async (_context, accumulatedText) => ({
        tripwireTriggered: accumulatedText !== 'streamed',
        message: 'Missing accumulated text',
        severity: 'high' as const,
        info: { guardrailName: 'accumulated-text-required' },
      }),
    });

    const outputContext = {
      input: {
        prompt: '',
        messages: [],
        system: '',
      },
      result: { text: '' } as unknown as AIResult,
    };

    const standardResults = await executeOutputGuardrails(
      [guardrail],
      outputContext,
      { accumulatedText: 'streamed' },
    );

    expect(standardResults[0]?.tripwireTriggered).toBe(false);

    const enhancedResults = await executeOutputGuardrailsWithEnhancedRuntime(
      [guardrail],
      outputContext,
      { parallel: true, accumulatedText: 'streamed' },
    );

    expect(enhancedResults[0]?.tripwireTriggered).toBe(false);
  });
});
