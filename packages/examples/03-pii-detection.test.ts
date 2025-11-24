/**
 * PII Detection Example - Test
 *
 * Demonstrates how to detect and block personally identifiable information
 * (PII) in prompts to protect user privacy.
 *
 * Note: These tests use real LLM models and may be flaky.
 * They're designed for manual verification, not CI/CD.
 */

import { describe, it, expect } from 'vitest';
import { generateText } from 'ai';
import { model } from './model';
import { defineInputGuardrail, withGuardrails } from 'ai-sdk-guardrails';
import { extractTextContent } from 'ai-sdk-guardrails/guardrails/input';

// Define types for PII detection metadata
interface DetectedPII {
  type: string;
  description: string;
}

interface PIIMetadata extends Record<string, unknown> {
  detectedTypes: DetectedPII[];
  count: number;
}

// Define a guardrail that detects PII
const piiDetectionGuardrail = defineInputGuardrail<PIIMetadata>({
  name: 'pii-detection',
  description: 'Detects and blocks personally identifiable information',
  execute: async (params) => {
    const { prompt } = extractTextContent(params);

    // Common PII patterns
    const patterns = [
      {
        name: 'SSN',
        regex: /\b\d{3}-\d{2}-\d{4}\b/,
        description: 'Social Security Number',
      },
      {
        name: 'Email',
        regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
        description: 'Email address',
      },
      {
        name: 'Phone',
        regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,
        description: 'Phone number',
      },
      {
        name: 'Credit Card',
        regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/,
        description: 'Credit card number',
      },
    ];

    const detectedPII = patterns.filter((pattern) =>
      pattern.regex.test(prompt),
    );

    if (detectedPII.length > 0) {
      const metadata: PIIMetadata = {
        detectedTypes: detectedPII.map((p) => ({
          type: p.name,
          description: p.description,
        })),
        count: detectedPII.length,
      };

      return {
        tripwireTriggered: true,
        message: `PII detected: ${detectedPII.map((p) => p.name).join(', ')}`,
        severity: 'high',
        metadata,
      };
    }

    return {
      tripwireTriggered: false,
      metadata: {
        detectedTypes: [],
        count: 0,
      },
    };
  },
});

describe('PII Detection Example', () => {
  it('should allow clean prompt without PII to pass', async () => {
    const protectedModel = withGuardrails(model, {
      inputGuardrails: [piiDetectionGuardrail],
      throwOnBlocked: true,
    });

    const result = await generateText({
      model: protectedModel,
      prompt: 'What are best practices for data privacy?',
    });

    expect(result.text).toBeDefined();
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('should block prompt containing email address', async () => {
    const protectedModel = withGuardrails(model, {
      inputGuardrails: [piiDetectionGuardrail],
      throwOnBlocked: true,
    });

    await expect(
      generateText({
        model: protectedModel,
        prompt: 'Send a message to john.doe@example.com about the meeting',
      }),
    ).rejects.toThrow(/Input blocked by guardrail/);
  });

  it('should block prompt containing SSN', async () => {
    const protectedModel = withGuardrails(model, {
      inputGuardrails: [piiDetectionGuardrail],
      throwOnBlocked: true,
    });

    await expect(
      generateText({
        model: protectedModel,
        prompt: 'My SSN is 123-45-6789, can you help me?',
      }),
    ).rejects.toThrow(/Input blocked by guardrail/);
  });

  it('should block prompt containing phone number', async () => {
    const protectedModel = withGuardrails(model, {
      inputGuardrails: [piiDetectionGuardrail],
      throwOnBlocked: true,
    });

    await expect(
      generateText({
        model: protectedModel,
        prompt: 'Call me at (555) 123-4567 when ready',
      }),
    ).rejects.toThrow(/Input blocked by guardrail/);
  });

  it('should detect multiple PII types in one prompt', async () => {
    const protectedModel = withGuardrails(model, {
      inputGuardrails: [piiDetectionGuardrail],
      throwOnBlocked: true,
    });

    try {
      await generateText({
        model: protectedModel,
        prompt: 'Email john@example.com or call 555-123-4567',
      });
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeDefined();
      expect(String(error)).toContain('pii-detection');
    }
  });

  it('should provide correct metadata when blocking', async () => {
    let blockedMetadata: PIIMetadata | undefined;

    const protectedModel = withGuardrails(model, {
      inputGuardrails: [piiDetectionGuardrail],
      throwOnBlocked: true,
      onInputBlocked: (executionSummary) => {
        blockedMetadata = executionSummary.blockedResults[0]
          ?.metadata as PIIMetadata;
      },
    });

    try {
      await generateText({
        model: protectedModel,
        prompt: 'Contact john@example.com or call 555-123-4567',
      });
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeDefined();
      expect(blockedMetadata).toBeDefined();
      expect(blockedMetadata?.count).toBeGreaterThan(0);
      expect(blockedMetadata?.detectedTypes.length).toBeGreaterThan(0);
      expect(blockedMetadata?.detectedTypes.some((t) => t.type === 'Email')).toBe(
        true,
      );
      expect(
        blockedMetadata?.detectedTypes.some((t) => t.type === 'Phone'),
      ).toBe(true);
    }
  });

  describe('PII Redaction Approach', () => {
    const redactionGuardrail = defineInputGuardrail<{
      redactedPrompt: string;
      originalPrompt: string;
    }>({
      name: 'pii-redaction',
      description: 'Redacts PII instead of blocking',
      execute: async (params) => {
        let { prompt } = extractTextContent(params);
        const originalPrompt = prompt;

        // Redact common PII patterns
        prompt = prompt.replaceAll(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN REDACTED]');
        prompt = prompt.replaceAll(
          /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
          '[EMAIL REDACTED]',
        );
        prompt = prompt.replaceAll(
          /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
          '[PHONE REDACTED]',
        );

        return {
          tripwireTriggered: false,
          metadata: {
            redactedPrompt: prompt,
            originalPrompt: originalPrompt,
          },
        };
      },
    });

    it('should process prompt with redaction instead of blocking', async () => {
      const redactionModel = withGuardrails(model, {
        inputGuardrails: [redactionGuardrail],
        throwOnBlocked: false,
      });

      const result = await generateText({
        model: redactionModel,
        prompt: 'Contact john@example.com or 555-123-4567',
      });

      // Should not throw and should process the request
      expect(result.text).toBeDefined();
      expect(result.text.length).toBeGreaterThan(0);
    });
  });
});
