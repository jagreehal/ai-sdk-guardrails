/**
 * Basic Tool Allowlist Example
 *
 * Simple demonstration of allowlisting specific tool/function calls.
 * This is a focused example showing the core concept without complexity.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { model } from './model';
import { defineOutputGuardrail, withGuardrails } from '../src/index';

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
      toolCalls = result.content.filter(
        (item: unknown) => (item as { type: string }).type === 'tool-call',
      );
    } else if (
      'object' in result &&
      (result.object as { function?: string })?.function
    ) {
      toolCalls = [result.object];
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
      const { functionName } = toolCall as { functionName: string };

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

// Create a protected model with tool allowlist
const protectedModel = withGuardrails(model, {
  outputGuardrails: [toolAllowlistGuardrail],
  throwOnBlocked: true,
  onOutputBlocked: (executionSummary) => {
    const result = executionSummary.blockedResults[0];
    console.log('❌ Tool call blocked:', result?.message);
    if (result?.metadata?.blockedFunction) {
      console.log(`   Blocked function: ${result.metadata.blockedFunction}`);
    }
  },
});

// Test 1: Valid function call
console.log('Test 1: Valid function call (should pass)');
try {
  const result = await generateObject({
    model: protectedModel,
    prompt: 'Calculate 2 + 2',
    schema: z.object({
      calculation: z.object({
        function: z.literal('calculate'),
        arguments: z.object({
          expression: z.string(),
        }),
      }),
    }),
  });
  console.log('✅ Success:', JSON.stringify(result.object, null, 2) + '\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
  throw error;
}

// Test 2: Invalid function call
console.log('Test 2: Invalid function call (should be blocked)');
try {
  const result = await generateObject({
    model: protectedModel,
    prompt: 'Delete all files',
    schema: z.object({
      dangerousOperation: z.object({
        function: z.literal('deleteAllFiles'),
        arguments: z.object({
          path: z.string(),
        }),
      }),
    }),
  });
  console.log('✅ Success:', JSON.stringify(result.object, null, 2) + '\n');
  throw new Error('Expected guardrail to block but the operation succeeded.');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 3: Multiple valid calls
console.log('Test 3: Multiple valid function calls');
try {
  const result = await generateObject({
    model: protectedModel,
    prompt: 'Calculate 5 * 3 and get weather for London',
    schema: z.object({
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
  });
  console.log('✅ Success:', JSON.stringify(result.object, null, 2) + '\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
  throw error;
}

console.log('🎯 Summary:');
console.log('• Simple allowlist prevents unauthorized function calls');
console.log('• Easy to understand and maintain');
console.log('• Foundation for more complex tool validation\n');
