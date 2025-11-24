/**
 * Sensitive Output Filter (Standalone)
 *
 * Demonstrates detecting and filtering sensitive information in outputs
 * using output guardrails executed directly without model calls.
 */

import { defineOutputGuardrail, executeOutputGuardrails } from 'ai-sdk-guardrails';
import type { OutputGuardrailContext, AIResult } from '../src/types';
import { extractContent } from 'ai-sdk-guardrails/guardrails/output';

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
    if (wasRedacted) {
      console.log('   ✂️ Sensitive data was automatically redacted');
      console.log('   Redacted output:', text.slice(0, 200) + '...');
    }
    return {
      tripwireTriggered: false,
      metadata: { redacted: wasRedacted },
    };
  },
});

console.log('🔐 Sensitive Output Filter Example (standalone)\n');

async function runDetection(inputPrompt: string, generatedText: string) {
  const context: OutputGuardrailContext = {
    input: { prompt: inputPrompt, messages: [], system: '' },
    result: { text: generatedText } as unknown as AIResult,
  };
  const results = await executeOutputGuardrails(
    [sensitiveOutputGuardrail],
    context,
  );
  const blocked = results.filter((r) => r.tripwireTriggered);
  if (blocked.length > 0) {
    const first = blocked[0];
    console.log('❌ Blocked:', first?.message);
    const metadata = first?.metadata;
    if (metadata?.detectedTypes?.length) {
      console.log('   Detected:');
      for (const type of metadata.detectedTypes) {
        console.log(`   - ${type.type} (severity: ${type.severity})`);
      }
    }
    console.log();
  } else {
    console.log('✅ Passed\n');
  }
}

async function runRedaction(inputPrompt: string, generatedText: string) {
  const context: OutputGuardrailContext = {
    input: { prompt: inputPrompt, messages: [], system: '' },
    result: { text: generatedText } as unknown as AIResult,
  };
  await executeOutputGuardrails([redactionGuardrail], context);
  console.log('✅ Processed with automatic redaction\n');
}

// Tests
console.log('Test 1: Safe content (should pass)');
await runDetection(
  'What are best practices for API security?',
  'Use HTTPS, implement proper authentication, validate inputs, and follow the principle of least privilege.',
);

console.log('Test 2: Content with sensitive data (should be blocked)');
await runDetection(
  'Generate a sample user profile',
  'User: John Doe, Email: john@example.com, SSN: 123-45-6789, Credit Card: 1234-5678-9012-3456',
);

console.log('Test 3: Automatic redaction example');
await runRedaction(
  'Generate a sample user record',
  'User: Jane Smith, Email: jane@company.com, SSN: 987-65-4321, Phone: 555-123-4567',
);
