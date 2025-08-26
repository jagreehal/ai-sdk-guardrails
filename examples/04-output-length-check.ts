/**
 * Output Length Check (Standalone)
 *
 * Demonstrates checking output length using an output guardrail executed
 * directly without calling a model.
 */

import {
  defineOutputGuardrail,
  executeOutputGuardrails,
} from '../src/guardrails';
import type { OutputGuardrailContext, AIResult } from '../src/types';
import { extractContent } from '../src/guardrails/output';

// Simple output length guardrail (min length)
const outputLengthGuardrail = defineOutputGuardrail({
  name: 'output-length-check',
  description: 'Ensures output meets minimum length requirements',
  execute: async (params) => {
    const { text } = extractContent(params.result);
    const minLength = 50;
    if (text.length < minLength) {
      return {
        tripwireTriggered: true,
        message: `Output too short: ${text.length} characters (min: ${minLength})`,
        severity: 'medium',
        metadata: {
          currentLength: text.length,
          minLength,
          deficit: minLength - text.length,
        },
      };
    }
    return { tripwireTriggered: false };
  },
});

console.log('📏 Output Length Check Example (standalone)\n');

async function runGuardrailOnText(inputPrompt: string, generatedText: string) {
  const context: OutputGuardrailContext = {
    input: { prompt: inputPrompt, messages: [], system: '' },
    result: { text: generatedText } as unknown as AIResult,
  };
  const results = await executeOutputGuardrails(
    [outputLengthGuardrail],
    context,
  );
  const blocked = results.filter((r) => r.tripwireTriggered);
  if (blocked.length > 0) {
    console.log('❌ Blocked:', blocked[0]?.message, '\n');
  } else {
    console.log('✅ Passed\n');
  }
}

// Test 1: Adequate output
console.log('Test 1: Detailed explanation (should pass)');
await runGuardrailOnText(
  'Explain the benefits of renewable energy',
  'Renewable energy offers significant environmental and economic benefits. By reducing reliance on fossil fuels, it lowers greenhouse gas emissions, enhances energy security, and can create local jobs while stabilizing energy prices over time.',
);

// Test 2: Very short output
console.log('Test 2: Very short output (should be blocked)');
await runGuardrailOnText('Is the sky blue?', 'Yes.');
