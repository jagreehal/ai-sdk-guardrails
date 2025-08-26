/**
 * Input Length Limit Example
 *
 * Demonstrates how to limit the length of input prompts to prevent
 * excessive token usage or prompt injection attacks.
 */

import { generateText } from 'ai';
import { model } from './model';
import {
  defineInputGuardrail,
  wrapWithInputGuardrails,
} from '../src/guardrails';
import { extractTextContent } from '../src/guardrails/input';

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

console.log('🛡️  Input Length Limit Example\n');

// Create a protected model with length limit
const protectedModel = wrapWithInputGuardrails(model, [lengthLimitGuardrail], {
  throwOnBlocked: true,
  onInputBlocked: (executionSummary) => {
    console.log(
      '❌ Input blocked:',
      executionSummary.blockedResults[0]?.message,
    );
  },
});

// Test 1: Valid short input
console.log('Test 1: Short input (should pass)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'What is AI?',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 2: Input that exceeds limit
console.log('Test 2: Long input (should be blocked)');
const longPrompt =
  'Please explain in great detail ' +
  'the complete history of artificial intelligence, including all major milestones, ' +
  'key researchers, breakthrough papers, and future implications for society.';

try {
  const result = await generateText({
    model: protectedModel,
    prompt: longPrompt,
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 3: Warning mode (doesn't throw, just logs)
console.log('Test 3: Long input with warning mode');
const warningModel = wrapWithInputGuardrails(model, [lengthLimitGuardrail], {
  throwOnBlocked: false, // Warning mode
  onInputBlocked: (executionSummary) => {
    console.log('⚠️  Warning:', executionSummary.blockedResults[0]?.message);
  },
});

try {
  const result = await generateText({
    model: warningModel,
    prompt: longPrompt,
  });
  console.log(
    '✅ Proceeded with warning:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Unexpected error:', (error as Error).message + '\n');
}
