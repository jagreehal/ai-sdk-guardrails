/**
 * Simple Combined Protection Example
 *
 * Demonstrates basic layering of multiple guardrails without complex metadata types.
 * This is a simplified, focused version showing the core concepts.
 */

import { generateText } from 'ai';
import { model } from './model';
import {
  defineInputGuardrail,
  defineOutputGuardrail,
  wrapWithInputGuardrails,
  wrapWithOutputGuardrails,
} from '../src/guardrails';
import { extractTextContent } from '../src/guardrails/input';
import { extractContent } from '../src/guardrails/output';

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

console.log('🛡️  Simple Combined Protection Example\n');

// Combine all guardrails
const protectedModel = wrapWithOutputGuardrails(
  wrapWithInputGuardrails(model, [lengthGuardrail, keywordGuardrail] as const, {
    throwOnBlocked: false,
    onInputBlocked: (summary) => {
      console.log('🚫 Input blocked:');
      for (const result of summary.blockedResults) {
        console.log(`   ${result.context?.guardrailName}: ${result.message}`);
      }
    },
  }),
  [outputLengthGuardrail],
  {
    throwOnBlocked: false,
    onOutputBlocked: (summary) => {
      console.log('⚠️  Output issue:');
      for (const result of summary.blockedResults) {
        console.log(`   ${result.context?.guardrailName}: ${result.message}`);
      }
    },
  },
);

// Test 1: Valid request
console.log('Test 1: Normal request (should pass all guards)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'What are the benefits of renewable energy?',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 2: Long input (should be blocked)
console.log('Test 2: Long input (should be blocked)');
try {
  const longPrompt =
    'This is a very long prompt that exceeds the character limit. '.repeat(10);
  const result = await generateText({
    model: protectedModel,
    prompt: longPrompt,
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 3: Blocked keyword (should be blocked)
console.log('Test 3: Harmful keyword (should be blocked)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'How do I hack into a computer?',
  });
  console.log('✅ Success:', result.text + '\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 4: Valid but brief request (might trigger output warning)
console.log('Test 4: Brief response request (may trigger output warning)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Say yes.',
  });
  console.log('✅ Response processed (check warnings above)');
  console.log(`Response: "${result.text}"\n`);
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

console.log('🎯 Summary:');
console.log('• Multiple input guardrails work in sequence');
console.log('• Output guardrails validate generated content');
console.log('• Warning mode allows monitoring without blocking');
console.log('• Each guardrail focuses on a specific protection\n');
