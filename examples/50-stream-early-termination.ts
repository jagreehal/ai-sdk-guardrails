/**
 * Example: Early Termination Across All Generation Methods
 *
 * Demonstrates how guardrails can detect violations early and stop generation
 * across streamText, generateText, generateObject, and streamObject.
 *
 * Key Features:
 * - Progressive evaluation during streaming
 * - Early termination on violation patterns
 * - Token savings by stopping bad outputs early
 * - Configurable stop conditions
 */

import { streamText } from 'ai';
import { withGuardrails, defineOutputGuardrail } from '../src/index';
import { model } from './model';

// Detect PII/Sensitive Data
const piiGuardrail = defineOutputGuardrail({
  name: 'pii-detection',
  description: 'Detects and blocks PII in output',
  priority: 'critical',
  execute: async ({ result }) => {
    const text =
      typeof result === 'object' && result && 'text' in result
        ? (result as { text: string }).text
        : JSON.stringify(result);
    const piiPatterns = [
      /\b\d{3}-\d{2}-\d{4}\b/, // SSN
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, // Email
      /\b(?:\d{4}[-\s]?){3}\d{4}\b/, // Credit card
    ];

    for (const pattern of piiPatterns) {
      if (pattern.test(text)) {
        return {
          tripwireTriggered: true,
          message: `PII detected: ${pattern.toString()}`,
          severity: 'critical' as const,
        };
      }
    }

    return { tripwireTriggered: false };
  },
});

const guardedStreamModel = withGuardrails(model, {
  outputGuardrails: [piiGuardrail],
  streamMode: 'progressive', // CRITICAL: Enable progressive evaluation
  stopOnGuardrailViolation: true, // Stop on 2 violations or any critical
  throwOnBlocked: false,
  replaceOnBlocked: true,
});

console.log('📝 Prompt: Generate text that will trigger early termination\n');

const stream = await streamText({
  model: guardedStreamModel,
  prompt:
    'Write a long story about someone sharing their email address alice@example.com and credit card 4532-1234-5678-9010',
});

console.log('📊 Streaming output:');

let chunkCount = 0;
for await (const chunk of stream.textStream) {
  chunkCount++;
  process.stdout.write(chunk);
}

console.log(`\n\n✅ Stream finished after ${chunkCount} chunks`);
console.log('💡 Notice: Stream stopped early when PII was detected!');
