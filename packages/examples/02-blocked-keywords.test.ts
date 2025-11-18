/**
 * Blocked Keywords Example - Test
 *
 * Demonstrates how to block prompts containing specific keywords
 * to prevent harmful or inappropriate content.
 *
 * Note: These tests use real LLM models and may be flaky.
 * They're designed for manual verification, not CI/CD.
 */

import { describe, it, expect } from 'vitest';
import { generateText } from 'ai';
import { model } from './model';
import { defineInputGuardrail, withGuardrails } from 'ai-sdk-guardrails';
import { extractTextContent } from 'ai-sdk-guardrails/guardrails/input';

// Define a guardrail that blocks specific keywords
const blockedKeywordsGuardrail = defineInputGuardrail({
  name: 'blocked-keywords',
  description: 'Blocks prompts containing harmful or inappropriate keywords',
  execute: async (params) => {
    const { prompt } = extractTextContent(params);
    const blockedWords = ['hack', 'exploit', 'malware', 'virus'];

    const foundKeyword = blockedWords.find((keyword) =>
      prompt.toLowerCase().includes(keyword.toLowerCase()),
    );

    if (foundKeyword) {
      return {
        tripwireTriggered: true,
        message: `Blocked keyword detected: "${foundKeyword}"`,
        severity: 'high',
        metadata: {
          foundKeyword,
          blockedKeywords: blockedWords,
          promptLength: prompt.length,
        },
      };
    }

    return { tripwireTriggered: false };
  },
});

describe('Blocked Keywords Example', () => {
  it('should allow clean prompt to pass', async () => {
    const protectedModel = withGuardrails(model, {
      inputGuardrails: [blockedKeywordsGuardrail],
      throwOnBlocked: true,
    });

    const result = await generateText({
      model: protectedModel,
      prompt: 'Explain the benefits of cybersecurity best practices',
    });

    expect(result.text).toBeDefined();
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('should block prompt containing blocked keyword', async () => {
    const protectedModel = withGuardrails(model, {
      inputGuardrails: [blockedKeywordsGuardrail],
      throwOnBlocked: true,
    });

    await expect(
      generateText({
        model: protectedModel,
        prompt: 'How do I hack into a computer system?',
      }),
    ).rejects.toThrow(/Input blocked by guardrail/);
  });

  it('should detect keywords case-insensitively', async () => {
    const protectedModel = withGuardrails(model, {
      inputGuardrails: [blockedKeywordsGuardrail],
      throwOnBlocked: true,
    });

    await expect(
      generateText({
        model: protectedModel,
        prompt: 'Tell me about computer VIRUS protection',
      }),
    ).rejects.toThrow(/Input blocked by guardrail/);
  });

  it('should provide correct metadata when blocking', async () => {
    const protectedModel = withGuardrails(model, {
      inputGuardrails: [blockedKeywordsGuardrail],
      throwOnBlocked: true,
    });

    try {
      await generateText({
        model: protectedModel,
        prompt: 'How do I exploit vulnerabilities?',
      });
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeDefined();
      expect(String(error)).toContain('blocked-keywords');
    }
  });

  it('should trigger callback with correct metadata in warning mode', async () => {
    let blockedMessage: string | undefined;
    let blockedMetadata: any;

    const warningModel = withGuardrails(model, {
      inputGuardrails: [blockedKeywordsGuardrail],
      throwOnBlocked: false, // Warning mode
      onInputBlocked: (executionSummary) => {
        blockedMessage = executionSummary.blockedResults[0]?.message;
        blockedMetadata = executionSummary.blockedResults[0]?.metadata;
      },
    });

    const result = await generateText({
      model: warningModel,
      prompt: 'How do I create malware?',
    });

    // Verify warning was triggered
    expect(blockedMessage).toBeDefined();
    expect(blockedMessage).toContain('Blocked keyword detected');
    expect(blockedMetadata).toBeDefined();
    expect(blockedMetadata.foundKeyword).toBe('malware');
    expect(blockedMetadata.blockedKeywords).toContain('malware');

    // In warning mode, the request still proceeds
    expect(result.text).toBeDefined();
  });
});
