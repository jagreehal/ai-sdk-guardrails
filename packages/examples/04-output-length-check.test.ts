/**
 * Output Length Check Example - Test
 *
 * Demonstrates checking output length using an output guardrail executed
 * directly without calling a model.
 *
 * Note: These tests use real LLM models and may be flaky.
 * They're designed for manual verification, not CI/CD.
 */

import { describe, it, expect } from 'vitest';
import { defineOutputGuardrail, executeOutputGuardrails } from 'ai-sdk-guardrails';
import { extractContent } from 'ai-sdk-guardrails/guardrails/output';

// Define types for the context (these may need to be imported from the package)
interface OutputGuardrailContext {
  input: {
    prompt: string;
    messages: any[];
    system: string;
  };
  result: {
    text: string;
  };
}

// Simple output length guardrail (min length)
const outputLengthGuardrail = defineOutputGuardrail({
  name: 'output-length-check',
  description: 'Ensures output meets minimum length requirements',
  execute: async (params) => {
    const { text } = extractContent(params.result);
    const minLength = 50;
    if (text.length < minLength) {
      return {
        tripwireTriggered: true,
        message: `Output too short: ${text.length} characters (min: ${minLength})`,
        severity: 'medium',
        metadata: {
          currentLength: text.length,
          minLength,
          deficit: minLength - text.length,
        },
      };
    }
    return { tripwireTriggered: false };
  },
});

describe('Output Length Check Example', () => {
  async function runGuardrailOnText(
    inputPrompt: string,
    generatedText: string,
  ) {
    const context: OutputGuardrailContext = {
      input: { prompt: inputPrompt, messages: [], system: '' },
      result: { text: generatedText },
    };
    return await executeOutputGuardrails([outputLengthGuardrail], context);
  }

  it('should allow adequate output length to pass', async () => {
    const results = await runGuardrailOnText(
      'Explain the benefits of renewable energy',
      'Renewable energy offers significant environmental and economic benefits. By reducing reliance on fossil fuels, it lowers greenhouse gas emissions, enhances energy security, and can create local jobs while stabilizing energy prices over time.',
    );

    const blocked = results.filter((r) => r.tripwireTriggered);
    expect(blocked.length).toBe(0);
  });

  it('should block output that is too short', async () => {
    const results = await runGuardrailOnText('Is the sky blue?', 'Yes.');

    const blocked = results.filter((r) => r.tripwireTriggered);
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0]?.message).toContain('Output too short');
    expect(blocked[0]?.metadata).toBeDefined();
    expect(blocked[0]?.metadata?.currentLength).toBeLessThan(50);
    expect(blocked[0]?.metadata?.minLength).toBe(50);
  });

  it('should provide correct metadata when blocking', async () => {
    const results = await runGuardrailOnText('Short answer?', 'No.');

    const blocked = results.filter((r) => r.tripwireTriggered);
    expect(blocked.length).toBeGreaterThan(0);
    const metadata = blocked[0]?.metadata;
    expect(metadata).toBeDefined();
    expect(metadata?.currentLength).toBe(3); // "No."
    expect(metadata?.minLength).toBe(50);
    expect(metadata?.deficit).toBe(47); // 50 - 3
  });

  it('should allow output exactly at minimum length', async () => {
    // Create a string exactly 50 characters long
    const exactly50Chars = 'A'.repeat(50);
    const results = await runGuardrailOnText('Test prompt', exactly50Chars);

    const blocked = results.filter((r) => r.tripwireTriggered);
    expect(blocked.length).toBe(0);
  });

  it('should block output just below minimum length', async () => {
    // Create a string 49 characters long (1 below minimum)
    const justBelow50Chars = 'A'.repeat(49);
    const results = await runGuardrailOnText('Test prompt', justBelow50Chars);

    const blocked = results.filter((r) => r.tripwireTriggered);
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0]?.metadata?.currentLength).toBe(49);
    expect(blocked[0]?.metadata?.deficit).toBe(1);
  });
});
