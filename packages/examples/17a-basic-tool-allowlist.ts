/**
 * Basic Tool Allowlist Example
 *
 * Simple demonstration of allowlisting specific tool/function calls.
 * This is a focused example showing the core concept without complexity.
 */

import { generateText, Output } from 'ai';
import { z } from 'zod';
import { model } from './model';
import {
  defineOutputGuardrail,
  executeOutputGuardrails,
} from 'ai-sdk-guardrails';

// Simple allowlist of safe functions
const ALLOWED_FUNCTIONS = ['calculate', 'formatDate', 'getWeather'];

// Basic tool call validation guardrail
const toolAllowlistGuardrail = defineOutputGuardrail<{
  blockedFunction?: string;
  allowedFunctions: string[];
  validatedCalls?: number;
}>({
  name: 'tool-allowlist',
  description: 'Only allows specific functions to be called',
  execute: async (context) => {
    const { result } = context;

    // Extract tool calls from the result
    let toolCalls: unknown[] = [];

    if ('content' in result && Array.isArray(result.content)) {
      toolCalls.push(
        ...result.content.filter(
          (item: unknown) => (item as { type: string }).type === 'tool-call',
        ),
      );
    }

    if ('output' in result && result.output) {
      // For generateText with Output.object(), tool calls are typically nested
      // inside the structured output (not top-level).
      const findToolCalls = (value: unknown): unknown[] => {
        const calls: unknown[] = [];
        if (!value) return calls;

        if (Array.isArray(value)) {
          for (const item of value) {
            calls.push(...findToolCalls(item));
          }
          return calls;
        }

        if (typeof value === 'object') {
          const obj = value as Record<string, unknown>;
          // Tool-call shape in these examples
          if ('function' in obj && 'arguments' in obj) {
            calls.push(obj);
          }
          for (const nested of Object.values(obj)) {
            calls.push(...findToolCalls(nested));
          }
        }
        return calls;
      };

      toolCalls.push(...findToolCalls(result.output));
    }

    if (toolCalls.length === 0) {
      return {
        tripwireTriggered: false,
        metadata: {
          allowedFunctions: ALLOWED_FUNCTIONS,
        },
      };
    }

    // Check each tool call against allowlist
    for (const toolCall of toolCalls) {
      const obj = toolCall as Record<string, unknown>;
      const functionName =
        (obj.functionName as string | undefined) ??
        (obj.function as string | undefined) ??
        (obj.name as string | undefined);

      if (!functionName) {
        return {
          tripwireTriggered: true,
          message:
            'Tool call is missing a function name. Expected shape: { function, arguments }',
          severity: 'high',
          metadata: {
            allowedFunctions: ALLOWED_FUNCTIONS,
          },
        };
      }

      if (!ALLOWED_FUNCTIONS.includes(functionName)) {
        return {
          tripwireTriggered: true,
          message: `Function '${functionName}' is not allowed. Allowed functions: ${ALLOWED_FUNCTIONS.join(', ')}`,
          severity: 'high',
          metadata: {
            blockedFunction: functionName,
            allowedFunctions: ALLOWED_FUNCTIONS,
          },
        };
      }
    }

    return {
      tripwireTriggered: false,
      metadata: {
        validatedCalls: toolCalls.length,
        allowedFunctions: ALLOWED_FUNCTIONS,
      },
    };
  },
});

console.log('🛡️  Basic Tool Allowlist Example\n');

async function generateAndValidate<TOutput>(
  prompt: string,
  outputSchema: z.ZodSchema<TOutput>,
) {
  const result = await generateText({
    model,
    prompt,
    output: Output.object({ schema: outputSchema }),
  });

  // NOTE: For generateText with Output.object(), validate post-generation for reliability.
  const summary = await executeOutputGuardrails(
    [toolAllowlistGuardrail],
    {
      input: {
        prompt,
        system: '',
        messages: [{ role: 'user', content: prompt }],
      },
      result,
    },
    { logLevel: 'none' },
  );

  const blocked = summary.find((r) => r.tripwireTriggered);
  if (blocked) {
    throw new Error(blocked.message || 'Tool call blocked');
  }

  return result.output as TOutput;
}

// Test 1: Valid function call
console.log('Test 1: Valid function call (should pass)');
try {
  const output = await generateAndValidate(
    'Calculate 2 + 2',
    z.object({
      calculation: z.object({
        function: z.literal('calculate'),
        arguments: z.object({
          expression: z.string(),
        }),
      }),
    }),
  );
  console.log('✅ Success:', JSON.stringify(output, null, 2) + '\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
  throw error;
}

// Test 2: Invalid function call
console.log('Test 2: Invalid function call (should be blocked)');
try {
  const output = await generateAndValidate(
    'Delete all files',
    z.object({
      dangerousOperation: z.object({
        function: z.literal('deleteAllFiles'),
        arguments: z.object({
          path: z.string(),
        }),
      }),
    }),
  );
  console.log('✅ Success:', JSON.stringify(output, null, 2) + '\n');
  throw new Error('Expected guardrail to block but the operation succeeded.');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 3: Multiple valid calls
console.log('Test 3: Multiple valid function calls');
try {
  const output = await generateAndValidate(
    'Calculate 5 * 3 and get weather for London',
    z.object({
      calculation: z.object({
        function: z.literal('calculate'),
        arguments: z.object({
          expression: z.string(),
        }),
      }),
      weather: z.object({
        function: z.literal('getWeather'),
        arguments: z.object({
          location: z.string(),
        }),
      }),
    }),
  );
  console.log('✅ Success:', JSON.stringify(output, null, 2) + '\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
  throw error;
}

console.log('🎯 Summary:');
console.log('• Simple allowlist prevents unauthorized function calls');
console.log('• Easy to understand and maintain');
console.log('• Foundation for more complex tool validation\n');
