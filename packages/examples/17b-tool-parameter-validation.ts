/**
 * Tool Parameter Validation Example
 *
 * Demonstrates parameter validation for tool calls using Zod schemas.
 * This example focuses specifically on validating function arguments.
 */

import { generateText, Output } from 'ai';
import { z } from 'zod';
import { model } from './model';
import {
  defineOutputGuardrail,
  executeOutputGuardrails,
} from 'ai-sdk-guardrails';

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

    // 1) AI SDK "content" tool-call parts (when using actual tools)
    if ('content' in result && Array.isArray(result.content)) {
      toolCalls.push(
        ...result.content.filter(
          (item: unknown) => (item as { type: string }).type === 'tool-call',
        ),
      );
    }

    // 2) Structured output tool-call objects (when using Output.object())
    if ('output' in result && result.output) {
      const findToolCalls = (value: unknown): unknown[] => {
        const calls: unknown[] = [];
        if (!value) return calls;

        if (Array.isArray(value)) {
          for (const item of value) calls.push(...findToolCalls(item));
          return calls;
        }

        if (typeof value === 'object') {
          const obj = value as Record<string, unknown>;
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
    [parameterValidationGuardrail],
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
    throw new Error(blocked.message || 'Parameter validation blocked');
  }

  return result.output as TOutput;
}

// Test 1: Valid parameters
console.log('Test 1: Valid parameters (should pass)');
try {
  const output = await generateAndValidate(
    'Get weather for London in celsius',
    z.object({
      weather: z.object({
        function: z.literal('getWeather'),
        arguments: z.object({
          location: z.string(),
          units: z.enum(['celsius', 'fahrenheit']),
        }),
      }),
    }),
  );
  console.log('✅ Success:', JSON.stringify(output, null, 2) + '\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
  throw error;
}

// Test 2: Invalid parameter (too long location)
console.log(
  'Test 2: Invalid parameter - location too long (should be blocked)',
);
try {
  const output = await generateAndValidate(
    'Get weather for a location name longer than 60 characters (make it obviously too long)',
    z.object({
      weather: z.object({
        function: z.literal('getWeather'),
        arguments: z.object({
          // Force a long string so FUNCTION_SCHEMAS max(50) blocks deterministically.
          location: z.string().min(60),
          units: z.enum(['celsius', 'fahrenheit']),
        }),
      }),
    }),
  );
  console.log('✅ Success:', JSON.stringify(output, null, 2) + '\n');
  throw new Error('Expected guardrail to block but the operation succeeded.');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 3: Path validation for file operations
console.log('Test 3: File path validation');
try {
  const output = await generateAndValidate(
    'Read a file from the public directory',
    z.object({
      fileRead: z.object({
        function: z.literal('readFile'),
        arguments: z.object({
          // Keep this deterministic + within FUNCTION_SCHEMAS.readFile regex.
          path: z.literal('./public/file.txt'),
        }),
      }),
    }),
  );
  console.log('✅ Success:', JSON.stringify(output, null, 2) + '\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
  throw error;
}

// Test 4: Invalid file path (should be blocked)
console.log(
  'Test 4: Invalid file path - restricted directory (should be blocked)',
);
try {
  const output = await generateAndValidate(
    'Read /etc/passwd file',
    z.object({
      fileRead: z.object({
        function: z.literal('readFile'),
        arguments: z.object({
          // Force a blocked path deterministically.
          path: z.literal('/etc/passwd'),
        }),
      }),
    }),
  );
  console.log('✅ Success:', JSON.stringify(output, null, 2) + '\n');
  throw new Error('Expected guardrail to block but the operation succeeded.');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

console.log('🎯 Summary:');
console.log('• Parameter schemas ensure valid function arguments');
console.log('• Zod provides rich validation with custom rules');
console.log('• Path restrictions prevent unauthorized file access');
console.log('• Clear error messages help debug validation issues\n');
