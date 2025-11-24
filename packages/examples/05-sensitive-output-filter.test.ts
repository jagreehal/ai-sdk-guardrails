/**
 * Sensitive Output Filter Example - Test
 *
 * Demonstrates detecting and filtering sensitive information in outputs
 * using output guardrails executed directly without model calls.
 *
 * Note: These tests use real LLM models and may be flaky.
 * They're designed for manual verification, not CI/CD.
 */

import { describe, it, expect } from 'vitest';
import { defineOutputGuardrail, executeOutputGuardrails } from 'ai-sdk-guardrails';
import { extractContent } from 'ai-sdk-guardrails/guardrails/output';

// Define types for the context
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

interface DetectedSensitiveType {
  type: string;
  severity: string;
}

interface SensitiveDataMetadata extends Record<string, unknown> {
  detectedTypes: DetectedSensitiveType[];
  count: number;
}

// Guardrail that detects sensitive information in outputs
const sensitiveOutputGuardrail = defineOutputGuardrail<SensitiveDataMetadata>({
  name: 'sensitive-output-filter',
  description: 'Detects and blocks sensitive information in AI responses',
  execute: async (params) => {
    const { text } = extractContent(params.result);

    const sensitivePatterns = [
      {
        name: 'SSN',
        regex: /\b\d{3}-\d{2}-\d{4}\b/,
        severity: 'high' as const,
      },
      {
        name: 'API Key',
        regex:
          /(?:api[_-]?key|apikey|api_token)[\s:=]*['"]*([a-zA-Z0-9]{32,})/i,
        severity: 'high' as const,
      },
      {
        name: 'Credit Card',
        regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/,
        severity: 'high' as const,
      },
      {
        name: 'Email',
        regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
        severity: 'medium' as const,
      },
      {
        name: 'IP Address',
        regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
        severity: 'low' as const,
      },
    ];

    const detectedPatterns = sensitivePatterns.filter((pattern) =>
      pattern.regex.test(text),
    );

    if (detectedPatterns.length > 0) {
      const highSeverity = detectedPatterns.some((p) => p.severity === 'high');
      return {
        tripwireTriggered: true,
        message: `Sensitive information detected: ${detectedPatterns.map((p) => p.name).join(', ')}`,
        severity: highSeverity ? 'high' : 'medium',
        metadata: {
          detectedTypes: detectedPatterns.map((p) => ({
            type: p.name,
            severity: p.severity,
          })),
          count: detectedPatterns.length,
        },
      };
    }
    return { tripwireTriggered: false };
  },
});

// Guardrail that redacts sensitive information
const redactionGuardrail = defineOutputGuardrail({
  name: 'sensitive-redaction',
  description: 'Redacts sensitive information from outputs',
  execute: async (params) => {
    let { text } = extractContent(params.result);
    const original = text;

    // Redact various sensitive patterns
    text = text.replaceAll(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN REDACTED]');
    text = text.replaceAll(/\b(?:\d{4}[-\s]?){3}\d{4}\b/g, '[CARD REDACTED]');
    text = text.replaceAll(
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      '[EMAIL REDACTED]',
    );

    const wasRedacted = text !== original;
    return {
      tripwireTriggered: false,
      metadata: { redacted: wasRedacted, redactedText: text },
    };
  },
});

describe('Sensitive Output Filter Example', () => {
  async function runDetection(inputPrompt: string, generatedText: string) {
    const context: OutputGuardrailContext = {
      input: { prompt: inputPrompt, messages: [], system: '' },
      result: { text: generatedText },
    };
    return await executeOutputGuardrails([sensitiveOutputGuardrail], context);
  }

  async function runRedaction(inputPrompt: string, generatedText: string) {
    const context: OutputGuardrailContext = {
      input: { prompt: inputPrompt, messages: [], system: '' },
      result: { text: generatedText },
    };
    return await executeOutputGuardrails([redactionGuardrail], context);
  }

  it('should allow safe content to pass', async () => {
    const results = await runDetection(
      'What are best practices for API security?',
      'Use HTTPS, implement proper authentication, validate inputs, and follow the principle of least privilege.',
    );

    const blocked = results.filter((r) => r.tripwireTriggered);
    expect(blocked.length).toBe(0);
  });

  it('should block content with sensitive data', async () => {
    const results = await runDetection(
      'Generate a sample user profile',
      'User: John Doe, Email: john@example.com, SSN: 123-45-6789, Credit Card: 1234-5678-9012-3456',
    );

    const blocked = results.filter((r) => r.tripwireTriggered);
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0]?.message).toContain('Sensitive information detected');
    expect(blocked[0]?.severity).toBe('high');

    const metadata = blocked[0]?.metadata as SensitiveDataMetadata;
    expect(metadata).toBeDefined();
    expect(metadata.count).toBeGreaterThan(0);
    expect(metadata.detectedTypes.length).toBeGreaterThan(0);
    expect(metadata.detectedTypes.some((t) => t.type === 'SSN')).toBe(true);
    expect(metadata.detectedTypes.some((t) => t.type === 'Credit Card')).toBe(
      true,
    );
    expect(metadata.detectedTypes.some((t) => t.type === 'Email')).toBe(true);
  });

  it('should detect SSN in output', async () => {
    const results = await runDetection(
      'Generate user data',
      'User SSN: 987-65-4321',
    );

    const blocked = results.filter((r) => r.tripwireTriggered);
    expect(blocked.length).toBeGreaterThan(0);
    const metadata = blocked[0]?.metadata as SensitiveDataMetadata;
    expect(metadata.detectedTypes.some((t) => t.type === 'SSN')).toBe(true);
  });

  it('should detect email addresses in output', async () => {
    const results = await runDetection(
      'Generate contact info',
      'Contact: user@example.com',
    );

    const blocked = results.filter((r) => r.tripwireTriggered);
    expect(blocked.length).toBeGreaterThan(0);
    const metadata = blocked[0]?.metadata as SensitiveDataMetadata;
    expect(metadata.detectedTypes.some((t) => t.type === 'Email')).toBe(true);
  });

  it('should detect credit card numbers in output', async () => {
    const results = await runDetection(
      'Generate payment info',
      'Card: 1234-5678-9012-3456',
    );

    const blocked = results.filter((r) => r.tripwireTriggered);
    expect(blocked.length).toBeGreaterThan(0);
    const metadata = blocked[0]?.metadata as SensitiveDataMetadata;
    expect(metadata.detectedTypes.some((t) => t.type === 'Credit Card')).toBe(
      true,
    );
  });

  describe('Redaction Approach', () => {
    it('should redact sensitive information without blocking', async () => {
      const results = await runRedaction(
        'Generate a sample user record',
        'User: Jane Smith, Email: jane@company.com, SSN: 987-65-4321, Phone: 555-123-4567',
      );

      // Redaction guardrail should not trigger blocking
      const blocked = results.filter((r) => r.tripwireTriggered);
      expect(blocked.length).toBe(0);

      // Should have results from the redaction guardrail
      expect(results.length).toBeGreaterThan(0);
      const redactionResult = results[0];
      expect(redactionResult).toBeDefined();
      expect(redactionResult.metadata?.redacted).toBe(true);
      expect(redactionResult.metadata?.redactedText).toBeDefined();
      expect(redactionResult.metadata?.redactedText).toContain('[SSN REDACTED]');
      expect(redactionResult.metadata?.redactedText).toContain('[EMAIL REDACTED]');
    });

    it('should not redact when no sensitive data is present', async () => {
      const results = await runRedaction(
        'Generate safe content',
        'This is a safe message with no sensitive information.',
      );

      expect(results.length).toBeGreaterThan(0);
      const redactionResult = results[0];
      expect(redactionResult).toBeDefined();
      expect(redactionResult.metadata?.redacted).toBe(false);
    });
  });
});
