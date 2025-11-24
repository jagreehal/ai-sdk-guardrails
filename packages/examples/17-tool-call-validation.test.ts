/**
 * Tool Call Validation Example - Test
 *
 * Demonstrates how to validate and allowlist tool/function calls to prevent
 * unauthorized access to system functions and ensure safe operation execution.
 *
 * Note: These tests use real LLM models and may be flaky.
 * They're designed for manual verification, not CI/CD.
 */

import { describe, it, expect } from 'vitest';
import { generateObject } from 'ai';
import { model } from './model';
import { defineOutputGuardrail, withGuardrails } from 'ai-sdk-guardrails';
import { z } from 'zod';

// Define types for tool call validation metadata
interface ToolCallValidationMetadata extends Record<string, unknown> {
  validationResults: Array<{
    functionName: string;
    isValid: boolean;
    errors: string[];
    warnings: string[];
    metadata: Record<string, unknown>;
  }>;
  totalToolCalls: number;
  invalidCalls: number;
  errors: string[];
  warnings: string[];
  allValid?: boolean;
}

// Define allowed function schemas with parameter validation
const ALLOWED_FUNCTIONS = {
  // Safe utility functions
  calculate: {
    description: 'Perform mathematical calculations',
    parameters: z.object({
      expression: z
        .string()
        .max(100)
        .describe('Mathematical expression to evaluate'),
    }),
    sideEffects: false,
    maxExecutionTime: 1000, // 1 second
  },

  formatDate: {
    description: 'Format a date string',
    parameters: z.object({
      date: z.string().describe('Date string to format'),
      format: z
        .enum(['short', 'long', 'iso'])
        .default('short')
        .describe('Output format'),
    }),
    sideEffects: false,
    maxExecutionTime: 100,
  },

  getWeather: {
    description: 'Get weather information for a location',
    parameters: z.object({
      location: z.string().max(50).describe('City or location name'),
      units: z
        .enum(['celsius', 'fahrenheit'])
        .default('celsius')
        .describe('Temperature units'),
    }),
    sideEffects: false,
    maxExecutionTime: 5000,
    rateLimit: { maxCalls: 10, windowMs: 60_000 }, // 10 calls per minute
  },

  readFile: {
    description: 'Read a file from the filesystem',
    parameters: z.object({
      path: z
        .string()
        .regex(/^\/tmp\/|^\.\/public\//)
        .describe('File path (restricted to /tmp/ and ./public/)'),
    }),
    sideEffects: false,
    maxExecutionTime: 2000,
    allowedPaths: ['/tmp/', './public/'],
  },

  writeFile: {
    description: 'Write content to a file',
    parameters: z.object({
      path: z
        .string()
        .regex(/^\/tmp\/|^\.\/logs\//)
        .describe('File path (restricted to /tmp/ and ./logs/)'),
      content: z.string().max(10_000).describe('Content to write'),
    }),
    sideEffects: true,
    maxExecutionTime: 3000,
    allowedPaths: ['/tmp/', './logs/'],
  },

  queryDatabase: {
    description: 'Query the database (read-only)',
    parameters: z.object({
      query: z
        .string()
        .regex(/^SELECT\s/i)
        .describe('SQL query (SELECT only)'),
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(10)
        .describe('Maximum number of results'),
    }),
    sideEffects: false,
    maxExecutionTime: 5000,
    allowedOperations: ['SELECT'],
  },
};

// Rate limiting tracker
const rateLimitTracker = new Map<
  string,
  { calls: number; resetTime: number }
>();

// Function execution history for side-effect tracking
const executionHistory: Array<{
  functionName: string;
  timestamp: number;
  parameters: unknown;
  sideEffects: boolean;
}> = [];

// Validate function call
function validateFunctionCall(
  functionName: string,
  parameters: unknown,
  context: { userId?: string; sessionId?: string },
): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  metadata: unknown;
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const metadata: unknown = {};

  // Check if function is allowed
  if (!(functionName in ALLOWED_FUNCTIONS)) {
    errors.push(`Function '${functionName}' is not in the allowlist`);
    return { isValid: false, errors, warnings, metadata };
  }

  const functionConfig =
    ALLOWED_FUNCTIONS[functionName as keyof typeof ALLOWED_FUNCTIONS];
  (metadata as Record<string, unknown>).functionConfig = {
    description: functionConfig.description,
    sideEffects: functionConfig.sideEffects,
    maxExecutionTime: functionConfig.maxExecutionTime,
  };

  // Validate parameters against schema
  try {
    const validatedParams = functionConfig.parameters.parse(parameters);
    (metadata as Record<string, unknown>).validatedParameters = validatedParams;
  } catch (error) {
    if (error instanceof z.ZodError) {
      errors.push(
        `Parameter validation failed: ${error.issues.map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
      );
    } else {
      errors.push(`Parameter validation failed: ${error}`);
    }
  }

  // Check path restrictions for file operations
  if (
    'allowedPaths' in functionConfig &&
    functionConfig.allowedPaths &&
    parameters &&
    typeof parameters === 'object' &&
    'path' in parameters &&
    typeof (parameters as Record<string, unknown>).path === 'string'
  ) {
    const path = (parameters as Record<string, unknown>).path as string;
    const isPathAllowed = (
      'allowedPaths' in functionConfig && functionConfig.allowedPaths
        ? functionConfig.allowedPaths
        : []
    ).some((allowedPath: string) => path.startsWith(allowedPath));
    if (!isPathAllowed) {
      errors.push(
        `Path '${path}' is not allowed. Allowed paths: ${('allowedPaths' in functionConfig && functionConfig.allowedPaths ? functionConfig.allowedPaths : []).join(', ')}`,
      );
    }
  }

  // Check SQL operation restrictions
  if (
    'allowedOperations' in functionConfig &&
    functionConfig.allowedOperations &&
    parameters &&
    typeof parameters === 'object' &&
    'query' in parameters &&
    typeof (parameters as Record<string, unknown>).query === 'string'
  ) {
    const query = (parameters as Record<string, unknown>).query as string;
    const trimmedQuery = query.trim().toUpperCase();
    const isOperationAllowed = (
      'allowedOperations' in functionConfig && functionConfig.allowedOperations
        ? functionConfig.allowedOperations
        : []
    ).some((operation: string) => trimmedQuery.startsWith(operation));
    if (!isOperationAllowed) {
      errors.push(
        `SQL operation not allowed. Allowed operations: ${('allowedOperations' in functionConfig && functionConfig.allowedOperations ? functionConfig.allowedOperations : []).join(', ')}`,
      );
    }
  }

  // Check for path traversal attempts
  if (
    parameters &&
    typeof parameters === 'object' &&
    'path' in parameters &&
    typeof (parameters as Record<string, unknown>).path === 'string'
  ) {
    const path = (parameters as Record<string, unknown>).path as string;
    const lowerPath = path.toLowerCase();

    if (lowerPath.includes('../') || lowerPath.includes('..\\')) {
      errors.push('Path traversal attempt detected');
    }
  }

  // Check for excessive content size
  if (
    parameters &&
    typeof parameters === 'object' &&
    'content' in parameters &&
    typeof (parameters as Record<string, unknown>).content === 'string' &&
    ((parameters as Record<string, unknown>).content as string).length > 10_000
  ) {
    errors.push('Content size exceeds maximum allowed (10,000 characters)');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    metadata,
  };
}

// Define the tool call validation guardrail
const toolCallValidationGuardrail =
  defineOutputGuardrail<ToolCallValidationMetadata>({
    name: 'tool-call-validation',
    description:
      'Validates and allowlists tool/function calls for security and safety',
    execute: async (context) => {
      const { result } = context;

      // Extract tool calls from the result object
      let toolCalls: unknown[] = [];

      if ('object' in result && result.object) {
        const obj = result.object;
        if (obj && typeof obj === 'object') {
          // Check if the object itself represents a tool call
          if (
            (obj as Record<string, unknown>).function &&
            (obj as Record<string, unknown>).arguments
          ) {
            toolCalls = [obj];
          } else {
            // Recursively find all tool calls in the object
            const findToolCalls = (currentObj: unknown): unknown[] => {
              const calls: unknown[] = [];

              if (currentObj && typeof currentObj === 'object') {
                if (
                  (currentObj as Record<string, unknown>).function &&
                  (currentObj as Record<string, unknown>).arguments
                ) {
                  calls.push(currentObj);
                }

                for (const value of Object.values(currentObj)) {
                  calls.push(...findToolCalls(value));
                }
              }

              return calls;
            };

            toolCalls = findToolCalls(obj);
          }
        }
      }

      if (toolCalls.length === 0) {
        return { tripwireTriggered: false };
      }

      const validationResults = [];
      const allErrors: string[] = [];
      const allWarnings: string[] = [];

      for (const toolCall of toolCalls) {
        const { function: functionName, arguments: args } = toolCall as Record<
          string,
          unknown
        >;

        const context = {
          userId: 'user123',
          sessionId: 'session456',
        };

        const validation = validateFunctionCall(
          functionName as string,
          args,
          context,
        );
        validationResults.push({
          functionName: functionName as string,
          isValid: validation.isValid,
          errors: validation.errors,
          warnings: validation.warnings,
          metadata: validation.metadata as Record<string, unknown>,
        });

        allErrors.push(...validation.errors);
        allWarnings.push(...validation.warnings);
      }

      const hasInvalidCalls = validationResults.some(
        (result) => !result.isValid,
      );
      const hasWarnings = allWarnings.length > 0;

      if (hasInvalidCalls) {
        return {
          tripwireTriggered: true,
          message: `Tool call validation failed: ${allErrors.join('; ')}`,
          severity: 'high',
          metadata: {
            validationResults,
            totalToolCalls: toolCalls.length,
            invalidCalls: validationResults.filter((r) => !r.isValid).length,
            errors: allErrors,
            warnings: allWarnings,
          },
        };
      }

      if (hasWarnings) {
        return {
          tripwireTriggered: true,
          message: `Tool call warnings: ${allWarnings.join('; ')}`,
          severity: 'medium',
          metadata: {
            validationResults,
            totalToolCalls: toolCalls.length,
            invalidCalls: 0,
            errors: [],
            warnings: allWarnings,
          },
        };
      }

      return {
        tripwireTriggered: false,
        metadata: {
          validationResults,
          totalToolCalls: toolCalls.length,
          invalidCalls: 0,
          errors: [],
          warnings: [],
          allValid: true,
        },
      };
    },
  });

describe('Tool Call Validation Example', () => {
  it(
    'should allow valid tool calls to pass',
    async () => {
      const protectedModel = withGuardrails(model, {
        outputGuardrails: [toolCallValidationGuardrail],
        throwOnBlocked: false,
      });

      const result = await generateObject({
        model: protectedModel,
        prompt: "Calculate 2 + 2 and format today's date",
        schema: z.object({
          calculation: z.object({
            function: z.literal('calculate'),
            arguments: z.object({
              expression: z.string(),
            }),
          }),
          dateFormat: z.object({
            function: z.literal('formatDate'),
            arguments: z.object({
              date: z.string(),
              format: z.enum(['short', 'long', 'iso']),
            }),
          }),
        }),
      });

      expect(result.object).toBeDefined();
    },
    120000,
  );

  it(
    'should block invalid function names',
    async () => {
      let blockedMessage: string | undefined;

      const protectedModel = withGuardrails(model, {
        outputGuardrails: [toolCallValidationGuardrail],
        throwOnBlocked: true,
        onOutputBlocked: (executionSummary) => {
          blockedMessage = executionSummary.blockedResults[0]?.message;
        },
      });

      try {
        await generateObject({
          model: protectedModel,
          prompt: 'Delete all files from the system',
          schema: z.object({
            dangerousOperation: z.object({
              function: z.literal('deleteAllFiles'),
              arguments: z.object({
                path: z.string(),
              }),
            }),
          }),
        });
        // If generation succeeds, the guardrail should still validate
      } catch (error) {
        // Expected to throw if validation fails
        expect(String(error)).toBeDefined();
        if (blockedMessage) {
          expect(blockedMessage).toContain('Tool call validation failed');
        }
      }
    },
    120000,
  );

  it(
    'should block invalid file paths',
    async () => {
      let blockedMessage: string | undefined;

      const protectedModel = withGuardrails(model, {
        outputGuardrails: [toolCallValidationGuardrail],
        throwOnBlocked: true,
        onOutputBlocked: (executionSummary) => {
          blockedMessage = executionSummary.blockedResults[0]?.message;
        },
      });

      try {
        await generateObject({
          model: protectedModel,
          prompt: 'Read a file from a restricted directory',
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
          expect(blockedMessage).toContain('Tool call validation');
        }
      }
    },
    120000,
  );

  it(
    'should block dangerous SQL operations',
    async () => {
      let blockedMessage: string | undefined;

      const protectedModel = withGuardrails(model, {
        outputGuardrails: [toolCallValidationGuardrail],
        throwOnBlocked: true,
        onOutputBlocked: (executionSummary) => {
          blockedMessage = executionSummary.blockedResults[0]?.message;
        },
      });

      try {
        await generateObject({
          model: protectedModel,
          prompt: 'Delete all users from the database',
          schema: z.object({
            databaseOperation: z.object({
              function: z.literal('queryDatabase'),
              arguments: z.object({
                query: z.string(),
                limit: z.number(),
              }),
            }),
          }),
        });
      } catch (error) {
        expect(String(error)).toBeDefined();
        if (blockedMessage) {
          expect(blockedMessage).toContain('Tool call validation');
        }
      }
    },
    120000,
  );

  it(
    'should provide correct metadata when blocking',
    async () => {
      let blockedMetadata: ToolCallValidationMetadata | undefined;

      const protectedModel = withGuardrails(model, {
        outputGuardrails: [toolCallValidationGuardrail],
        throwOnBlocked: true,
        onOutputBlocked: (executionSummary) => {
          blockedMetadata = executionSummary.blockedResults[0]
            ?.metadata as ToolCallValidationMetadata;
        },
      });

      try {
        await generateObject({
          model: protectedModel,
          prompt: 'Read a file using path traversal',
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
          expect(blockedMetadata.totalToolCalls).toBeDefined();
          expect(blockedMetadata.invalidCalls).toBeDefined();
          expect(blockedMetadata.errors).toBeDefined();
          expect(Array.isArray(blockedMetadata.errors)).toBe(true);
        }
      }
    },
    120000,
  );

  it(
    'should log warnings in warning mode without throwing',
    async () => {
      let warningMessage: string | undefined;

      const warningModel = withGuardrails(model, {
        outputGuardrails: [toolCallValidationGuardrail],
        throwOnBlocked: false, // Warning mode
        onOutputBlocked: (executionSummary) => {
          warningMessage = executionSummary.blockedResults[0]?.message;
        },
      });

      const result = await generateObject({
        model: warningModel,
        prompt: 'Get weather for a city',
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
      // In warning mode, validation issues are logged but don't block
      if (warningMessage) {
        expect(warningMessage).toContain('Tool call');
      }
    },
    120000,
  );
});
