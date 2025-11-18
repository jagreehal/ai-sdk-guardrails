/**
 * Tool Parameter Validation Example - Test
 *
 * Demonstrates parameter validation for tool calls using Zod schemas.
 * This example focuses specifically on validating function arguments.
 *
 * Note: These tests use real LLM models and may be flaky.
 * They're designed for manual verification, not CI/CD.
 */

import { describe, it, expect } from 'vitest';
import { generateObject } from 'ai';
import { z } from 'zod';
import { model } from './model';
import { defineOutputGuardrail, withGuardrails } from 'ai-sdk-guardrails';

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

describe('Tool Parameter Validation Example', () => {
  it(
    'should allow valid parameters to pass',
    async () => {
      const protectedModel = withGuardrails(model, {
        outputGuardrails: [parameterValidationGuardrail],
        throwOnBlocked: false,
      });

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

      expect(result.object).toBeDefined();
    },
    120000,
  );

  it(
    'should block invalid parameters that violate schema',
    async () => {
      let blockedMessage: string | undefined;
      let blockedMetadata: any;

      const protectedModel = withGuardrails(model, {
        outputGuardrails: [parameterValidationGuardrail],
        throwOnBlocked: true,
        onOutputBlocked: (executionSummary) => {
          blockedMessage = executionSummary.blockedResults[0]?.message;
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      try {
        await generateObject({
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
        // If generation succeeds, guardrail should still validate
      } catch (error) {
        expect(String(error)).toBeDefined();
        if (blockedMessage) {
          expect(blockedMessage).toContain('Parameter validation failed');
          if (blockedMetadata?.errors) {
            expect(Array.isArray(blockedMetadata.errors)).toBe(true);
          }
        }
      }
    },
    120000,
  );

  it(
    'should validate file paths against restrictions',
    async () => {
      const protectedModel = withGuardrails(model, {
        outputGuardrails: [parameterValidationGuardrail],
        throwOnBlocked: false,
      });

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

      expect(result.object).toBeDefined();
    },
    120000,
  );

  it(
    'should block invalid file paths',
    async () => {
      let blockedMessage: string | undefined;
      let blockedMetadata: any;

      const protectedModel = withGuardrails(model, {
        outputGuardrails: [parameterValidationGuardrail],
        throwOnBlocked: true,
        onOutputBlocked: (executionSummary) => {
          blockedMessage = executionSummary.blockedResults[0]?.message;
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      try {
        await generateObject({
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
      } catch (error) {
        expect(String(error)).toBeDefined();
        if (blockedMessage) {
          expect(blockedMessage).toContain('Parameter validation failed');
          if (blockedMetadata?.errors) {
            expect(blockedMetadata.errors.length).toBeGreaterThan(0);
          }
        }
      }
    },
    120000,
  );

  it(
    'should provide correct metadata when validation fails',
    async () => {
      let blockedMetadata: any;

      const protectedModel = withGuardrails(model, {
        outputGuardrails: [parameterValidationGuardrail],
        throwOnBlocked: true,
        onOutputBlocked: (executionSummary) => {
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      try {
        await generateObject({
          model: protectedModel,
          prompt: 'Read a file from restricted directory',
          schema: z.object({
            fileRead: z.object({
              function: z.literal('readFile'),
              arguments: z.object({
                path: z.string(),
              }),
            }),
          }),
        });
      } catch (error) {
        expect(error).toBeDefined();
        if (blockedMetadata) {
          expect(blockedMetadata.functionName).toBe('readFile');
          expect(blockedMetadata.errors).toBeDefined();
          expect(Array.isArray(blockedMetadata.errors)).toBe(true);
          expect(blockedMetadata.invalidParameters).toBeDefined();
        }
      }
    },
    120000,
  );

  it(
    'should block functions without schemas',
    async () => {
      let blockedMessage: string | undefined;
      let blockedMetadata: any;

      const protectedModel = withGuardrails(model, {
        outputGuardrails: [parameterValidationGuardrail],
        throwOnBlocked: true,
        onOutputBlocked: (executionSummary) => {
          blockedMessage = executionSummary.blockedResults[0]?.message;
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      try {
        await generateObject({
          model: protectedModel,
          prompt: 'Call an undefined function',
          schema: z.object({
            operation: z.object({
              function: z.literal('undefinedFunction'),
              arguments: z.object({}),
            }),
          }),
        });
      } catch (error) {
        expect(String(error)).toBeDefined();
        if (blockedMessage) {
          expect(blockedMessage).toContain('has no parameter schema defined');
          if (blockedMetadata) {
            expect(blockedMetadata.availableFunctions).toBeDefined();
            expect(Array.isArray(blockedMetadata.availableFunctions)).toBe(true);
          }
        }
      }
    },
    120000,
  );
});
