/**
 * Expected Tool Use + Auto-Retry Example
 *
 * Demonstrates the improved retry DX for guardrails that expect tool usage.
 * Now you can simply configure retry at the guardrail level - no need to
 * write complex buildRetryParams functions!
 *
 * v5.0 Improvement:
 * - Before: 30+ lines of manual buildRetryParams with type assertions
 * - After: Just add `retry: { maxRetries: 2 }` to the guardrail options!
 */

import { generateText } from 'ai';
import { z } from 'zod';
import { model } from './model';
import { withGuardrails } from 'ai-sdk-guardrails';
import { expectedToolUse } from 'ai-sdk-guardrails/guardrails/tools';

console.log('🛠️  Expected Tool Use + Auto-Retry Example (v5.0 Simplified DX)');
console.log('');

// Define the calculator tool
const calculatorTool = {
  calculator: {
    description: 'Add two numbers together',
    inputSchema: z.object({
      a: z.number().describe('First number'),
      b: z.number().describe('Second number'),
    }),
    execute: async ({ a, b }: { a: number; b: number }) => {
      const result = a + b;
      console.log(`Calculator: ${a} + ${b} = ${result}`);
      return result;
    },
  },
};

// ============================================================================
// NEW: Simple guardrail-level retry (v5.0)
// ============================================================================
// Just add retry config directly to the guardrail - the library handles
// everything else automatically using context-aware retry instructions!

const toolGuarded = withGuardrails(model, {
  outputGuardrails: [
    expectedToolUse({
      tools: 'calculator',
      retry: { maxRetries: 2 }, // That's it! No buildRetryParams needed
    }),
  ],
  replaceOnBlocked: false,
  throwOnBlocked: false,
});

// Alternative: Configure retry at withGuardrails level (takes precedence)
// const toolGuarded = withGuardrails(model, {
//   outputGuardrails: [expectedToolUse({ tools: 'calculator' })],
//   retry: { maxRetries: 2 },
// });

const { text } = await generateText({
  model: toolGuarded,
  prompt: 'Add 17 and 29. Provide your reasoning and final answer.',
  tools: calculatorTool,
});

console.log('✅ Final (tool should be used):');
console.log(text);

// ============================================================================
// OLD WAY (v4.x) - Shown for comparison only
// ============================================================================
// Previously you had to write all this boilerplate:
//
// const toolGuarded = withGuardrails(model, {
//   outputGuardrails: [expectedToolUse({ tools: 'calculator' })],
//   retry: {
//     maxRetries: 2,
//     buildRetryParams: ({ summary, lastParams, originalParams }) => {
//       // Manual guardrail-specific parsing
//       const blocked = summary.blockedResults.find(
//         (r) => r.context?.guardrailName === 'expected-tool-use',
//       );
//       // Manual metadata casting (error-prone!)
//       const meta = blocked?.metadata as { expectedTools?: string[] } | undefined;
//       const tool = meta?.expectedTools?.[0] ?? 'calculator';
//       const instruction = `You must use the ${tool} tool...`;
//
//       return {
//         ...lastParams,
//         temperature: Math.max(0.2, (lastParams.temperature ?? 0.7) - 0.1),
//         // Complex prompt array manipulation with type assertions
//         prompt: [
//           ...(Array.isArray(lastParams.prompt)
//             ? lastParams.prompt
//             : Array.isArray(originalParams.prompt)
//               ? originalParams.prompt
//               : []),
//           {
//             role: 'user' as const,
//             content: [{ type: 'text' as const, text: instruction }],
//           },
//         ],
//       };
//     },
//   },
// });
