/**
 * Expected Tool Use + Auto-Retry Example
 *
 * Demonstrates a guardrail that expects evidence of a tool being used.
 * If the tool wasn't used, we retry and explicitly instruct the LLM to use it.
 */

import { generateText } from 'ai';
import { z } from 'zod';
import { model } from './model';
import { wrapWithOutputGuardrails } from '../src/guardrails';
import { expectedToolUse } from '../src/guardrails/tools';

// Use the new built-in guardrail for the best DX

console.log('🛠️  Expected Tool Use + Auto-Retry Example');
console.log('');

const expectedTool = 'calculator';

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
const toolGuarded = wrapWithOutputGuardrails(
  model,
  [expectedToolUse({ tools: expectedTool })],
  {
    replaceOnBlocked: false,
    throwOnBlocked: false,
    retry: {
      maxRetries: 2,
      buildRetryParams: ({ summary, lastParams, originalParams }) => {
        const blocked = summary.blockedResults.find(
          (r) => r.context?.guardrailName === 'expected-tool-use',
        );
        const meta = blocked?.metadata as
          | { expectedTools?: string[] }
          | undefined;
        const tool = meta?.expectedTools?.[0] ?? expectedTool;
        const instruction = `You must use the ${tool} tool to solve this problem. Don't just calculate manually - use the available tool.`;

        return {
          ...lastParams,
          // Encourage the model with a stronger hint on retry
          temperature: Math.max(0.2, (lastParams.temperature ?? 0.7) - 0.1),
          prompt: [
            ...(Array.isArray(lastParams.prompt)
              ? lastParams.prompt
              : Array.isArray(originalParams.prompt)
                ? originalParams.prompt
                : []),
            {
              role: 'user' as const,
              content: [{ type: 'text' as const, text: instruction }],
            },
          ],
        };
      },
    },
  },
);

const { text } = await generateText({
  model: toolGuarded,
  prompt: 'Add 17 and 29. Provide your reasoning and final answer.',
  tools: calculatorTool,
});

console.log('✅ Final (tool should be used):');
console.log(text);
