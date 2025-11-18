/**
 * PII Detection Example
 *
 * Demonstrates how to detect and block personally identifiable information
 * (PII) in prompts to protect user privacy.
 */

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

console.log('🔒 PII Detection Example\n');

// Create a protected model with PII detection
const protectedModel = withGuardrails(model, {
  inputGuardrails: [piiDetectionGuardrail],
  throwOnBlocked: true,
  onInputBlocked: (executionSummary) => {
    console.log('🛡️ PII Blocked:', executionSummary.blockedResults[0]?.message);
    const metadata = executionSummary.blockedResults[0]?.metadata;
    if (metadata?.detectedTypes) {
      console.log('   Detected types:');
      for (const type of metadata.detectedTypes) {
        console.log(`   - ${type.type}: ${type.description}`);
      }
    }
  },
});

// Test 1: Clean prompt without PII
console.log('Test 1: Clean prompt (should pass)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'What are best practices for data privacy?',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
  throw error;
}

// Test 2: Prompt with email address
console.log('Test 2: Prompt with email (should be blocked)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Send a message to john.doe@example.com about the meeting',
  });
  console.log('✅ Success:', result.text + '\n');
  throw new Error('Expected guardrail to block but the operation succeeded.');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 3: Prompt with SSN
console.log('Test 3: Prompt with SSN (should be blocked)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'My SSN is 123-45-6789, can you help me?',
  });
  console.log('✅ Success:', result.text + '\n');
  throw new Error('Expected guardrail to block but the operation succeeded.');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 4: Prompt with phone number
console.log('Test 4: Prompt with phone number (should be blocked)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Call me at (555) 123-4567 when ready',
  });
  console.log('✅ Success:', result.text + '\n');
  throw new Error('Expected guardrail to block but the operation succeeded.');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 5: Multiple PII types
console.log('Test 5: Multiple PII types in one prompt');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Email john@example.com or call 555-123-4567',
  });
  console.log('✅ Success:', result.text + '\n');
  throw new Error('Expected guardrail to block but the operation succeeded.');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Demonstrate redaction approach
console.log('Test 6: PII Redaction Example');

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

    // Return modified prompt (in real implementation, you'd modify the context)
    console.log('   Redacted prompt:', prompt);

    return {
      tripwireTriggered: false,
      metadata: {
        redactedPrompt: prompt,
        originalPrompt: originalPrompt,
      },
    };
  },
});

const redactionModel = withGuardrails(model, {
  inputGuardrails: [redactionGuardrail],
  throwOnBlocked: false,
});

try {
  await generateText({
    model: redactionModel,
    prompt: 'Contact john@example.com or 555-123-4567',
  });
  console.log('✅ Processed with redaction\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
  throw error;
}
