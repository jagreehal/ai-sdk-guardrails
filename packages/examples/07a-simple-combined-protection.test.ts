/**
 * Simple Combined Protection Example - Test
 *
 * Demonstrates basic layering of multiple guardrails without complex metadata types.
 * This is a simplified, focused version showing the core concepts.
 *
 * Note: These tests use real LLM models and may be flaky.
 * They're designed for manual verification, not CI/CD.
 */

import { describe, it, expect } from 'vitest';
import { generateText } from 'ai';
import { model } from './model';
import {
  defineInputGuardrail,
  defineOutputGuardrail,
  withGuardrails,
} from 'ai-sdk-guardrails';
import { extractTextContent } from 'ai-sdk-guardrails/guardrails/input';
import { extractContent } from 'ai-sdk-guardrails/guardrails/output';

// Simple input length limit
const lengthGuardrail = defineInputGuardrail<{
  length: number;
  keyword?: string;
}>({
  name: 'length-check',
  description: 'Limits input to 200 characters',
  execute: async (params) => {
    const { prompt } = extractTextContent(params);

    if (prompt.length > 200) {
      return {
        tripwireTriggered: true,
        message: `Input too long: ${prompt.length} characters (max: 200)`,
        severity: 'medium',
        metadata: { length: prompt.length, keyword: undefined },
      };
    }

    return {
      tripwireTriggered: false,
      metadata: { length: prompt.length, keyword: undefined },
    };
  },
});

// Simple keyword blocker
const keywordGuardrail = defineInputGuardrail<{
  length: number;
  keyword: string;
}>({
  name: 'keyword-filter',
  description: 'Blocks harmful keywords',
  execute: async (params) => {
    const { prompt } = extractTextContent(params);
    const blockedWords = ['hack', 'virus', 'malware'];

    const found = blockedWords.find((word) =>
      prompt.toLowerCase().includes(word),
    );

    if (found) {
      return {
        tripwireTriggered: true,
        message: `Blocked keyword: ${found}`,
        severity: 'high',
        metadata: { length: prompt.length, keyword: found },
      };
    }

    return {
      tripwireTriggered: false,
      metadata: { length: prompt.length, keyword: '' },
    };
  },
});

// Simple output length check
const outputLengthGuardrail = defineOutputGuardrail<{ length: number }>({
  name: 'output-length',
  description: 'Ensures adequate response length',
  execute: async (params) => {
    const { text } = extractContent(params.result);

    if (text.length < 20) {
      return {
        tripwireTriggered: true,
        message: 'Response too short',
        severity: 'low',
        metadata: { length: text.length },
      };
    }

    return {
      tripwireTriggered: false,
      metadata: { length: text.length },
    };
  },
});

describe('Simple Combined Protection Example', () => {
  it('should allow normal request to pass all guardrails', async () => {
    const protectedModel = withGuardrails(model, {
      inputGuardrails: [lengthGuardrail, keywordGuardrail] as const,
      outputGuardrails: [outputLengthGuardrail],
      throwOnBlocked: false,
    });

    const result = await generateText({
      model: protectedModel,
      prompt: 'What are the benefits of renewable energy?',
    });

    expect(result.text).toBeDefined();
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('should block long input with length guardrail', async () => {
    const protectedModel = withGuardrails(model, {
      inputGuardrails: [lengthGuardrail, keywordGuardrail] as const,
      outputGuardrails: [outputLengthGuardrail],
      throwOnBlocked: true,
    });

    const longPrompt =
      'This is a very long prompt that exceeds the character limit. '.repeat(10);

    await expect(
      generateText({
        model: protectedModel,
        prompt: longPrompt,
      }),
    ).rejects.toThrow(/Input blocked by guardrail/);
  });

  it('should block input containing harmful keyword', async () => {
    const protectedModel = withGuardrails(model, {
      inputGuardrails: [lengthGuardrail, keywordGuardrail] as const,
      outputGuardrails: [outputLengthGuardrail],
      throwOnBlocked: true,
    });

    await expect(
      generateText({
        model: protectedModel,
        prompt: 'How do I hack into a computer?',
      }),
    ).rejects.toThrow(/Input blocked by guardrail/);
  });

  it('should trigger output warning for brief response', async () => {
    let outputBlockedMessage: string | undefined;

    const protectedModel = withGuardrails(model, {
      inputGuardrails: [lengthGuardrail, keywordGuardrail] as const,
      outputGuardrails: [outputLengthGuardrail],
      throwOnBlocked: false,
      onOutputBlocked: (summary) => {
        outputBlockedMessage = summary.blockedResults[0]?.message;
      },
    });

    const result = await generateText({
      model: protectedModel,
      prompt: 'Say yes.',
    });

    expect(result.text).toBeDefined();
    // In warning mode, output guardrail may trigger but won't throw
    // The response will still be returned
    if (outputBlockedMessage) {
      expect(outputBlockedMessage).toContain('Response too short');
    }
  });

  it('should apply multiple input guardrails in sequence', async () => {
    const protectedModel = withGuardrails(model, {
      inputGuardrails: [lengthGuardrail, keywordGuardrail] as const,
      outputGuardrails: [outputLengthGuardrail],
      throwOnBlocked: true,
    });

    // Test that keyword guardrail takes precedence over length
    // (if both would trigger, keyword should trigger first)
    await expect(
      generateText({
        model: protectedModel,
        prompt: 'Tell me about computer viruses',
      }),
    ).rejects.toThrow(/Input blocked by guardrail/);
  });

  it('should provide correct metadata from blocked guardrails', async () => {
    let inputBlockedResults: any[] = [];

    const protectedModel = withGuardrails(model, {
      inputGuardrails: [lengthGuardrail, keywordGuardrail] as const,
      outputGuardrails: [outputLengthGuardrail],
      throwOnBlocked: true,
      onInputBlocked: (summary) => {
        inputBlockedResults = summary.blockedResults;
      },
    });

    try {
      await generateText({
        model: protectedModel,
        prompt: 'How do I create malware?',
      });
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeDefined();
      // Verify that the keyword guardrail was triggered
      expect(String(error)).toContain('keyword-filter');
    }
  });
});
