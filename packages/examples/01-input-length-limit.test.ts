/**
 * Input Length Limit Example - Test
 *
 * Demonstrates how to limit the length of input prompts to prevent
 * excessive token usage or prompt injection attacks.
 *
 * Note: These tests use real LLM models and may be flaky.
 * They're designed for manual verification, not CI/CD.
 */

import { describe, it, expect } from 'vitest';
import { generateText } from 'ai';
import { model } from './model';
import { defineInputGuardrail, withGuardrails } from 'ai-sdk-guardrails';
import { extractTextContent } from 'ai-sdk-guardrails/guardrails/input';

// Define a guardrail that limits input length
const lengthLimitGuardrail = defineInputGuardrail({
  name: 'input-length-limit',
  description: 'Limits input prompt length to prevent excessive usage',
  execute: async (params) => {
    const { prompt } = extractTextContent(params);
    const maxLength = 100;

    if (prompt.length > maxLength) {
      return {
        tripwireTriggered: true,
        message: `Input too long: ${prompt.length} characters (max: ${maxLength})`,
        severity: 'medium',
        metadata: {
          currentLength: prompt.length,
          maxLength,
          exceeded: prompt.length - maxLength,
        },
      };
    }

    return { tripwireTriggered: false };
  },
});

describe('Input Length Limit Example', () => {
  it('should allow short input to pass', async () => {
    const protectedModel = withGuardrails(model, {
      inputGuardrails: [lengthLimitGuardrail],
      throwOnBlocked: true,
    });

    const result = await generateText({
      model: protectedModel,
      prompt: 'What is AI?',
    });

    expect(result.text).toBeDefined();
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('should block input that exceeds length limit', async () => {
    const protectedModel = withGuardrails(model, {
      inputGuardrails: [lengthLimitGuardrail],
      throwOnBlocked: true,
    });

    const longPrompt =
      'Please explain in great detail ' +
      'the complete history of artificial intelligence, including all major milestones, ' +
      'key researchers, breakthrough papers, and future implications for society.';

    await expect(
      generateText({
        model: protectedModel,
        prompt: longPrompt,
      }),
    ).rejects.toThrow(/Input blocked by guardrail/);
  });

  it('should allow long input in warning mode without throwing', async () => {
    let blockedMessage: string | undefined;

    const warningModel = withGuardrails(model, {
      inputGuardrails: [lengthLimitGuardrail],
      throwOnBlocked: false, // Warning mode
      onInputBlocked: (executionSummary) => {
        blockedMessage = executionSummary.blockedResults[0]?.message;
      },
    });

    const longPrompt =
      'Please explain in great detail ' +
      'the complete history of artificial intelligence, including all major milestones, ' +
      'key researchers, breakthrough papers, and future implications for society.';

    // Should not throw, but should log warning
    const result = await generateText({
      model: warningModel,
      prompt: longPrompt,
    });

    // Verify warning was triggered
    expect(blockedMessage).toBeDefined();
    expect(blockedMessage).toContain('Input too long');

    // In warning mode, the request still proceeds but with a blocked result
    // The result text will contain the blocking message
    expect(result.text).toBeDefined();
  });

  it('should provide correct metadata when blocking', async () => {
    const protectedModel = withGuardrails(model, {
      inputGuardrails: [lengthLimitGuardrail],
      throwOnBlocked: true,
    });

    const longPrompt =
      'Please explain in great detail ' +
      'the complete history of artificial intelligence, including all major milestones, ' +
      'key researchers, breakthrough papers, and future implications for society.';

    try {
      await generateText({
        model: protectedModel,
        prompt: longPrompt,
      });
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeDefined();
      // The error should indicate the guardrail blocked it
      expect(String(error)).toContain('input-length-limit');
    }
  });
});

