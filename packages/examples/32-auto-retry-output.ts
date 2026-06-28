/**
 * Auto Retry Output Example
 *
 * Demonstrates DX-first auto-retry on output guardrail block (too short),
 * using the built-in middleware option `retry`.
 */

import { generateText } from 'ai';
import { model } from './model';
import { defineOutputGuardrail, withGuardrails } from 'ai-sdk-guardrails';
import { extractContent } from 'ai-sdk-guardrails/guardrails/output';

// Simple output guardrail: flag answers shorter than minChars (dynamically set to output length + 1)
const minLengthGuardrail = defineOutputGuardrail<{ minChars: number }>({
  name: 'min-output-length',
  description: 'Requires at least N characters in the final answer',
  execute: async ({ result }) => {
    // Use type-safe content extraction
    const { text } = extractContent(result);
    const minChars = text.length + 1; // Always one more than what was generated
    console.log(
      `🔍 Checking output length: ${text.length} chars (need ${minChars})`,
    );
    if (text.length < minChars) {
      console.log(`❌ Output too short, will trigger retry`);
      return {
        tripwireTriggered: true,
        severity: 'medium',
        message: `Answer too short: ${text.length} < ${minChars}`,
        metadata: { minChars },
      };
    }
    console.log(`✅ Output length OK, passing through`);
    return { tripwireTriggered: false };
  },
});

console.log('🛡️  Auto Retry Output Example\n');

// Create a model with output guardrail and auto-retry enabled
const guarded = withGuardrails({
  model,
  outputGuardrails: [minLengthGuardrail],
  replaceOnBlocked: false, // let retry work first, then fallback if needed
  retry: {
    maxRetries: 1,
    buildRetryParams: ({ summary, lastParams }) => {
      const blockedMsg =
        summary.blockedResults[0]?.message ?? 'failed a guardrail';
      console.log(`🔄 Retry triggered! Reason: ${blockedMsg}`);
      console.log(`📝 Enhancing parameters for retry...`);
      return {
        ...lastParams,
        maxOutputTokens: Math.max(
          800,
          (lastParams.maxOutputTokens ?? 400) + 300,
        ),
        prompt: [
          ...(Array.isArray(lastParams.prompt) ? lastParams.prompt : []),
          {
            role: 'user' as const,
            content: [
              {
                type: 'text' as const,
                text: `Note: The previous answer ${blockedMsg}. Provide a comprehensive, detailed answer with examples and specifics.`,
              },
            ],
          },
        ],
      };
    },
  },
});

// Try a question that often yields short initial answers
const { text } = await generateText({
  model: guarded,
  prompt:
    'Explain the significance of the Turing Test in AI history. Be concise.',
});

console.log('✅ Final:', text.slice(0, 200) + '...');
console.log(`📊 Length: ${text.length} characters`);
