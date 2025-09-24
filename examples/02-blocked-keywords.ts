/**
 * Blocked Keywords Example
 *
 * Demonstrates how to block prompts containing specific keywords
 * to prevent harmful or inappropriate content.
 */

import { generateText } from 'ai-sdk-ollama';
import { llama3_2 as model } from './model';
import { defineInputGuardrail, withGuardrails } from '../src/index';
import { extractTextContent } from '../src/guardrails/input';

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

console.log('🚫 Blocked Keywords Example\n');

// Create a protected model with keyword blocking
const protectedModel = withGuardrails(model, {
  inputGuardrails: [blockedKeywordsGuardrail],
  throwOnBlocked: true,
  onInputBlocked: (executionSummary) => {
    console.log('🛡️ Blocked:', executionSummary.blockedResults[0]?.message);
    if (executionSummary.blockedResults[0]?.metadata) {
      console.log(
        '   Keywords checked:',
        executionSummary.blockedResults[0].metadata.blockedKeywords,
      );
    }
  },
});

// Test 1: Clean prompt
console.log('Test 1: Clean prompt (should pass)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Explain the benefits of cybersecurity best practices',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 2: Prompt with blocked keyword
console.log('Test 2: Prompt with blocked keyword (should be blocked)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'How do I hack into a computer system?',
  });
  console.log('✅ Success:', result.text + '\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 3: Case-insensitive detection
console.log('Test 3: Case-insensitive keyword detection');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Tell me about computer VIRUS protection',
  });
  console.log('✅ Success:', result.text + '\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}
