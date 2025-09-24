/**
 * Combined Protection Example
 *
 * Demonstrates how to layer multiple input and output guardrails
 * for comprehensive protection.
 */

import { generateText } from 'ai';
import { model } from './model';
import {
  defineInputGuardrail,
  defineOutputGuardrail,
  withGuardrails,
} from '../src/index';
import { extractTextContent } from '../src/guardrails/input';
import { extractContent } from '../src/guardrails/output';

// Unified metadata types so multiple guardrails can be composed safely
interface CombinedInputMetadata extends Record<string, unknown> {
  length?: number;
  limit?: number;
  blockedTerm?: string;
  hasEmail?: boolean;
  hasPhone?: boolean;
}

interface CombinedOutputMetadata extends Record<string, unknown> {
  length?: number;
  responseType?: string;
  dataType?: string;
}

// Input Guardrail 1: Length limit
const lengthLimitGuardrail = defineInputGuardrail<CombinedInputMetadata>({
  name: 'length-limit',
  description: 'Limits input length',
  execute: async (params) => {
    const { prompt } = extractTextContent(params);
    const maxLength = 500;

    if (prompt.length > maxLength) {
      return {
        tripwireTriggered: true,
        message: `Input exceeds ${maxLength} character limit`,
        severity: 'medium',
        metadata: { length: prompt.length, limit: maxLength },
      };
    }
    return { tripwireTriggered: false };
  },
});

// Input Guardrail 2: Content filter
const contentFilterGuardrail = defineInputGuardrail<CombinedInputMetadata>({
  name: 'content-filter',
  description: 'Filters inappropriate content',
  execute: async (params) => {
    const { prompt } = extractTextContent(params);
    const blockedTerms = ['hack', 'exploit', 'malicious'];

    const found = blockedTerms.find((term) =>
      prompt.toLowerCase().includes(term),
    );

    if (found) {
      return {
        tripwireTriggered: true,
        message: `Blocked term detected: ${found}`,
        severity: 'high',
        metadata: { blockedTerm: found },
      };
    }
    return { tripwireTriggered: false };
  },
});

// Input Guardrail 3: PII detection
const piiDetectionGuardrail = defineInputGuardrail<CombinedInputMetadata>({
  name: 'pii-detection',
  description: 'Detects personal information',
  execute: async (params) => {
    const { prompt } = extractTextContent(params);

    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
    const phoneRegex = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/;

    if (emailRegex.test(prompt) || phoneRegex.test(prompt)) {
      return {
        tripwireTriggered: true,
        message: 'Personal information detected',
        severity: 'high',
        metadata: {
          hasEmail: emailRegex.test(prompt),
          hasPhone: phoneRegex.test(prompt),
        },
      };
    }
    return { tripwireTriggered: false };
  },
});

// Output Guardrail 1: Quality check
const qualityCheckGuardrail = defineOutputGuardrail<CombinedOutputMetadata>({
  name: 'quality-check',
  description: 'Ensures response quality',
  execute: async (params) => {
    const { text } = extractContent(params.result);

    if (text.length < 30) {
      return {
        tripwireTriggered: true,
        message: 'Response too short',
        severity: 'medium',
        metadata: {
          length: text.length,
          responseType: undefined,
          dataType: undefined,
        },
      };
    }

    const genericResponses = ["I don't know", "I can't help"];
    const isGeneric = genericResponses.some((phrase) => text.includes(phrase));

    if (isGeneric) {
      return {
        tripwireTriggered: true,
        message: 'Generic response detected',
        severity: 'low',
        metadata: {
          responseType: 'generic',
          length: undefined,
          dataType: undefined,
        },
      };
    }

    return { tripwireTriggered: false };
  },
});

// Output Guardrail 2: Sensitive data check
const sensitiveDataGuardrail = defineOutputGuardrail<CombinedOutputMetadata>({
  name: 'sensitive-data-check',
  description: 'Prevents sensitive data leakage',
  execute: async (params) => {
    const { text } = extractContent(params.result);

    const patterns = [
      { name: 'API Key', regex: /api[_-]?key[\s:=]*[a-zA-Z0-9]{20,}/i },
      { name: 'Password', regex: /password[\s:=]*[^\s]{8,}/i },
      { name: 'Token', regex: /token[\s:=]*[a-zA-Z0-9]{20,}/i },
    ];

    const found = patterns.find((p) => p.regex.test(text));

    if (found) {
      return {
        tripwireTriggered: true,
        message: `Sensitive data detected: ${found.name}`,
        severity: 'high',
        metadata: {
          dataType: found.name,
          length: undefined,
          responseType: undefined,
        },
      };
    }
    return { tripwireTriggered: false };
  },
});

console.log('🛡️  Combined Protection Example\n');
console.log(
  'This example demonstrates layered protection with multiple guardrails.\n',
);

// Create a fully protected model
const protectedModel = withGuardrails<
  CombinedInputMetadata,
  CombinedOutputMetadata
>(model, {
  inputGuardrails: [
    lengthLimitGuardrail,
    contentFilterGuardrail,
    piiDetectionGuardrail,
  ],
  outputGuardrails: [qualityCheckGuardrail, sensitiveDataGuardrail],
  throwOnBlocked: false, // Use warning mode to see all issues
  onInputBlocked: (executionSummary) => {
    console.log('📥 Input Guardrails Triggered:');
    for (const result of executionSummary.blockedResults) {
      const icon =
        result.severity === 'high'
          ? '🚨'
          : result.severity === 'medium'
            ? '⚠️'
            : 'ℹ️';
      console.log(
        `   ${icon} [${result.context?.guardrailName}] ${result.message}`,
      );
    }
  },
  onOutputBlocked: (executionSummary) => {
    console.log('📤 Output Guardrails Triggered:');
    for (const result of executionSummary.blockedResults) {
      const icon =
        result.severity === 'high'
          ? '🚨'
          : result.severity === 'medium'
            ? '⚠️'
            : 'ℹ️';
      console.log(
        `   ${icon} [${result.context?.guardrailName}] ${result.message}`,
      );
    }
  },
});

// Test 1: Clean request
console.log('Test 1: Clean request (should pass all guardrails)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Explain the benefits of cloud computing',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 2: Request with blocked content
console.log('Test 2: Request with blocked content');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'How to hack into systems',
  });
  console.log(
    '✅ Processed (check warnings above):',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 3: Request with PII
console.log('Test 3: Request with personal information');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Email john@example.com about the project',
  });
  console.log(
    '✅ Processed (check warnings above):',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 4: Very long input
console.log('Test 4: Very long input');
const longPrompt =
  'Please provide a comprehensive analysis of ' +
  'a'.repeat(450) +
  ' and explain everything in detail';
try {
  const result = await generateText({
    model: protectedModel,
    prompt: longPrompt,
  });
  console.log(
    '✅ Processed (check warnings above):',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 5: Blocking mode example
console.log('Test 5: Blocking mode (throws on violations)');

const strictModel = withGuardrails<
  CombinedInputMetadata,
  CombinedOutputMetadata
>(model, {
  inputGuardrails: [contentFilterGuardrail],
  outputGuardrails: [sensitiveDataGuardrail],
  throwOnBlocked: true, // Strict mode
  onInputBlocked: (executionSummary) => {
    console.log(
      '🚫 Input blocked:',
      executionSummary.blockedResults[0]?.message,
    );
  },
  onOutputBlocked: (executionSummary) => {
    console.log(
      '🚫 Output blocked:',
      executionSummary.blockedResults[0]?.message,
    );
  },
});

try {
  const result = await generateText({
    model: strictModel,
    prompt: 'How to exploit vulnerabilities',
  });
  console.log('✅ Success:', result.text + '\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 6: Statistics tracking
console.log('Test 6: Guardrail statistics tracking');

let inputBlockCount = 0;
let outputBlockCount = 0;

const statsModel = withGuardrails<
  CombinedInputMetadata,
  CombinedOutputMetadata
>(model, {
  inputGuardrails: [
    lengthLimitGuardrail,
    contentFilterGuardrail,
    piiDetectionGuardrail,
  ],
  outputGuardrails: [qualityCheckGuardrail, sensitiveDataGuardrail],
  throwOnBlocked: false,
  onInputBlocked: (executionSummary) => {
    inputBlockCount += executionSummary.blockedResults.length;
  },
  onOutputBlocked: (executionSummary) => {
    outputBlockCount += executionSummary.blockedResults.length;
  },
});

const testPrompts = [
  'What is AI?',
  'Email test@example.com',
  'How to hack systems',
  'Explain cloud computing',
];

console.log('Running multiple requests...');
for (const prompt of testPrompts) {
  try {
    await generateText({
      model: statsModel,
      prompt,
    });
  } catch {
    // Ignore errors for stats collection
  }
}

console.log('\n📊 Guardrail Statistics:');
console.log(`   Total requests: ${testPrompts.length}`);
console.log(`   Input violations: ${inputBlockCount}`);
console.log(`   Output violations: ${outputBlockCount}`);
console.log(`   Total violations: ${inputBlockCount + outputBlockCount}\n`);
