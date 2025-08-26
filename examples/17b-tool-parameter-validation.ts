/**
 * Tool Parameter Validation Example
 *
 * Demonstrates parameter validation for tool calls using Zod schemas.
 * This example focuses specifically on validating function arguments.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { model } from './model';
import {
  defineOutputGuardrail,
  wrapWithOutputGuardrails,
} from '../src/guardrails';

// Define parameter schemas for allowed functions
const FUNCTION_SCHEMAS = {
  calculate: z.object({
    expression: z.string().max(100).describe('Mathematical expression'),
  }),
  getWeather: z.object({
    location: z.string().max(50).describe('City or location name'),
    units: z.enum(['celsius', 'fahrenheit']).default('celsius'),
  }),
  readFile: z.object({
    path: z
      .string()
      .regex(
        /^\/tmp\/|^\.\/public\//,
        'Path must start with /tmp/ or ./public/',
      )
      .describe('File path (restricted directories only)'),
  }),
};

// Parameter validation guardrail
const parameterValidationGuardrail = defineOutputGuardrail<{
  functionName?: string;
  availableFunctions?: string[];
  errors?: string[];
  invalidParameters?: unknown;
  validatedCalls?: number;
  functions?: string[];
  error?: string;
}>({
  name: 'parameter-validation',
  description: 'Validates tool call parameters against schemas',
  execute: async (context) => {
    const { result } = context;

    // Extract tool calls
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
        metadata: {},
      };
    }

    // Validate each tool call's parameters
    for (const toolCall of toolCalls) {
      const { function: functionName, arguments: args } = toolCall as {
        function: string;
        arguments: unknown;
      };

      // Check if function has a schema
      const schema =
        FUNCTION_SCHEMAS[functionName as keyof typeof FUNCTION_SCHEMAS];
      if (!schema) {
        return {
          tripwireTriggered: true,
          message: `Function '${functionName}' has no parameter schema defined`,
          severity: 'high',
          metadata: {
            functionName,
            availableFunctions: Object.keys(FUNCTION_SCHEMAS),
          },
        };
      }

      // Validate parameters against schema
      try {
        schema.parse(args);
      } catch (error) {
        if (error instanceof z.ZodError) {
          const errors = error.issues.map(
            (issue) => `${issue.path.join('.')}: ${issue.message}`,
          );

          return {
            tripwireTriggered: true,
            message: `Parameter validation failed for '${functionName}': ${errors.join(', ')}`,
            severity: 'high',
            metadata: {
              functionName,
              errors,
              invalidParameters: args,
            },
          };
        }

        return {
          tripwireTriggered: true,
          message: `Validation error for '${functionName}': ${error}`,
          severity: 'high',
          metadata: { functionName, error: String(error) },
        };
      }
    }

    return {
      tripwireTriggered: false,
      metadata: {
        validatedCalls: toolCalls.length,
        functions: toolCalls.map(
          (call: unknown) => (call as { function: string }).function,
        ),
      },
    };
  },
});

console.log('📋 Tool Parameter Validation Example\n');

// Create a protected model
const protectedModel = wrapWithOutputGuardrails(
  model,
  [parameterValidationGuardrail],
  {
    throwOnBlocked: true,
    onOutputBlocked: (executionSummary) => {
      const result = executionSummary.blockedResults[0];
      console.log('❌ Parameter validation failed:', result?.message);
      if (result?.metadata?.errors) {
        console.log('   Errors:', result.metadata.errors.join(', '));
      }
    },
  },
);

// Test 1: Valid parameters
console.log('Test 1: Valid parameters (should pass)');
try {
  const result = await generateObject({
    model: protectedModel,
    prompt: 'Get weather for London in celsius',
    schema: z.object({
      weather: z.object({
        function: z.literal('getWeather'),
        arguments: z.object({
          location: z.string(),
          units: z.enum(['celsius', 'fahrenheit']),
        }),
      }),
    }),
  });
  console.log('✅ Success:', JSON.stringify(result.object, null, 2) + '\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 2: Invalid parameter (too long location)
console.log(
  'Test 2: Invalid parameter - location too long (should be blocked)',
);
try {
  const result = await generateObject({
    model: protectedModel,
    prompt: 'Get weather for a very long location name',
    schema: z.object({
      weather: z.object({
        function: z.literal('getWeather'),
        arguments: z.object({
          location: z.string(),
          units: z.enum(['celsius', 'fahrenheit']),
        }),
      }),
    }),
  });
  console.log('✅ Success:', JSON.stringify(result.object, null, 2) + '\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 3: Path validation for file operations
console.log('Test 3: File path validation');
try {
  const result = await generateObject({
    model: protectedModel,
    prompt: 'Read a file from the public directory',
    schema: z.object({
      fileRead: z.object({
        function: z.literal('readFile'),
        arguments: z.object({
          path: z.string(),
        }),
      }),
    }),
  });
  console.log('✅ Success:', JSON.stringify(result.object, null, 2) + '\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 4: Invalid file path (should be blocked)
console.log(
  'Test 4: Invalid file path - restricted directory (should be blocked)',
);
try {
  const result = await generateObject({
    model: protectedModel,
    prompt: 'Read /etc/passwd file',
    schema: z.object({
      fileRead: z.object({
        function: z.literal('readFile'),
        arguments: z.object({
          path: z.string(),
        }),
      }),
    }),
  });
  console.log('✅ Success:', JSON.stringify(result.object, null, 2) + '\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

console.log('🎯 Summary:');
console.log('• Parameter schemas ensure valid function arguments');
console.log('• Zod provides rich validation with custom rules');
console.log('• Path restrictions prevent unauthorized file access');
console.log('• Clear error messages help debug validation issues\n');
