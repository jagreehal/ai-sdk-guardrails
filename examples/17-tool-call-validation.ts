/**
 * Tool Call Validation Example
 *
 * Demonstrates how to validate and allowlist tool/function calls to prevent
 * unauthorized access to system functions and ensure safe operation execution.
 * This is critical for AI agents that can call external tools and APIs.
 */

import { generateObject } from 'ai';
import { model } from './model';
import { defineOutputGuardrail, withGuardrails } from '../src/index';
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

  searchWeb: {
    description: 'Search the web for information',
    parameters: z.object({
      query: z.string().max(200).describe('Search query'),
      maxResults: z
        .number()
        .min(1)
        .max(10)
        .default(5)
        .describe('Maximum number of results'),
    }),
    sideEffects: false,
    maxExecutionTime: 10_000,
    rateLimit: { maxCalls: 5, windowMs: 60_000 }, // 5 calls per minute
  },

  // File operations (restricted)
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

  // Database operations (highly restricted)
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

  // Check rate limiting
  if ('rateLimit' in functionConfig && functionConfig.rateLimit) {
    const key = `${context.userId || 'anonymous'}:${functionName}`;
    const now = Date.now();
    const tracker = rateLimitTracker.get(key);

    if (tracker && now < tracker.resetTime) {
      if (
        'rateLimit' in functionConfig &&
        functionConfig.rateLimit &&
        tracker.calls >= functionConfig.rateLimit.maxCalls
      ) {
        errors.push(
          `Rate limit exceeded for function '${functionName}': ${'rateLimit' in functionConfig && functionConfig.rateLimit ? functionConfig.rateLimit.maxCalls : 'unknown'} calls per ${'rateLimit' in functionConfig && functionConfig.rateLimit ? functionConfig.rateLimit.windowMs : 'unknown'}ms`,
        );
      }
    } else {
      // Reset or initialize tracker
      rateLimitTracker.set(key, {
        calls: 1,
        resetTime:
          now +
          ('rateLimit' in functionConfig && functionConfig.rateLimit
            ? functionConfig.rateLimit.windowMs
            : 60_000),
      });
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

  // Check for potential security issues
  if (
    parameters &&
    typeof parameters === 'object' &&
    'query' in parameters &&
    typeof (parameters as Record<string, unknown>).query === 'string'
  ) {
    const query = (parameters as Record<string, unknown>).query as string;
    const lowerQuery = query.toLowerCase();

    // Check for SQL injection patterns
    if (
      lowerQuery.includes('drop') ||
      lowerQuery.includes('delete') ||
      lowerQuery.includes('truncate')
    ) {
      errors.push('Potentially dangerous SQL operation detected');
    }

    // Check for path traversal attempts
    if (lowerQuery.includes('../') || lowerQuery.includes('..\\')) {
      errors.push('Path traversal attempt detected');
    }
  }

  // Check for suspicious patterns in file paths
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

    if (
      lowerPath.includes('/etc/') ||
      lowerPath.includes('/var/') ||
      lowerPath.includes('c:\\windows\\')
    ) {
      errors.push('Access to system directories not allowed');
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

  // Track execution for side-effect analysis
  if (functionConfig.sideEffects) {
    executionHistory.push({
      functionName,
      timestamp: Date.now(),
      parameters,
      sideEffects: true,
    });

    // Check for rapid side-effect operations
    const recentSideEffects = executionHistory.filter(
      (entry) =>
        entry.sideEffects &&
        entry.timestamp > Date.now() - 60_000 && // Last minute
        entry.functionName === functionName,
    );

    if (recentSideEffects.length > 5) {
      warnings.push(
        `High frequency of side-effect operations detected for function '${functionName}'`,
      );
    }
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

      // Extract content from the result
      let toolCalls: unknown[] = [];

      // Check if the result has a content array (newer AI SDK format)
      if ('content' in result && Array.isArray(result.content)) {
        toolCalls = result.content.filter(
          (item: unknown) =>
            (item as Record<string, unknown>).type === 'tool-call',
        );
      }
      // Check if the result has an object with tool calls
      else if ('object' in result && result.object) {
        const obj = result.object;
        // Look for tool calls in the object structure
        if (obj && typeof obj === 'object') {
          // Check if the object itself is a tool call
          if (
            (obj as Record<string, unknown>).function &&
            (obj as Record<string, unknown>).arguments
          ) {
            toolCalls = [obj];
          }
          // Check if the object contains tool calls as properties
          else {
            // Recursively find all tool calls in the object
            const findToolCalls = (currentObj: unknown): unknown[] => {
              const calls: unknown[] = [];

              if (currentObj && typeof currentObj === 'object') {
                // Check if this object is a tool call
                if (
                  (currentObj as Record<string, unknown>).function &&
                  (currentObj as Record<string, unknown>).arguments
                ) {
                  calls.push(currentObj);
                }

                // Recursively check all properties
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
        const { functionName, arguments: args } = toolCall as Record<
          string,
          unknown
        >;

        // Extract context (in a real app, this would come from the request context)
        const context = {
          userId: 'user123', // This would come from the actual request
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

      // Determine if any tool calls are invalid
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

console.log('🛡️  Tool Call Validation Example\n');

// Create a protected model with tool call validation
const protectedModel = withGuardrails(model, {
  outputGuardrails: [toolCallValidationGuardrail],
  throwOnBlocked: true,
  onOutputBlocked: (executionSummary) => {
    const result = executionSummary.blockedResults[0];
    console.log('❌ Tool call blocked:', result?.message);
    if (result?.metadata) {
      console.log('   Total tool calls:', result.metadata.totalToolCalls);
      console.log('   Invalid calls:', result.metadata.invalidCalls);
      if (result.metadata.errors) {
        console.log('   Errors:', result.metadata.errors);
      }
      if (result.metadata.warnings) {
        console.log('   Warnings:', result.metadata.warnings);
      }
    }
  },
});

// Test 1: Valid tool call
console.log('Test 1: Valid tool call (should pass)');
try {
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
  console.log('✅ Success:', JSON.stringify(result, null, 2) + '\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
  throw error;
}

// Test 2: Invalid function name
console.log('Test 2: Invalid function name (should be blocked)');
try {
  const result = await generateObject({
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
  console.log('✅ Success:', JSON.stringify(result, null, 2) + '\n');
  throw new Error('Expected guardrail to block but the operation succeeded.');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 3: Invalid parameters
console.log('Test 3: Invalid parameters (should be blocked)');
try {
  const result = await generateObject({
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
  console.log('✅ Success:', JSON.stringify(result, null, 2) + '\n');
  throw new Error('Expected guardrail to block but the operation succeeded.');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 4: Dangerous SQL operation
console.log('Test 4: Dangerous SQL operation (should be blocked)');
try {
  const result = await generateObject({
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
  console.log('✅ Success:', JSON.stringify(result, null, 2) + '\n');
  throw new Error('Expected guardrail to block but the operation succeeded.');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 5: Path traversal attempt
console.log('Test 5: Path traversal attempt (should be blocked)');
try {
  const result = await generateObject({
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
  console.log('✅ Success:', JSON.stringify(result, null, 2) + '\n');
  throw new Error('Expected guardrail to block but the operation succeeded.');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 6: Excessive content size
console.log('Test 6: Excessive content size (should be blocked)');
try {
  const result = await generateObject({
    model: protectedModel,
    prompt: 'Write a very large file',
    schema: z.object({
      fileWrite: z.object({
        function: z.literal('writeFile'),
        arguments: z.object({
          path: z.string(),
          content: z.string(),
        }),
      }),
    }),
  });
  console.log('✅ Success:', JSON.stringify(result, null, 2) + '\n');
  throw new Error('Expected guardrail to block but the operation succeeded.');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 7: Warning mode (doesn't throw, just logs)
console.log('Test 7: Valid tool calls with warning mode');
const warningModel = withGuardrails(model, {
  outputGuardrails: [toolCallValidationGuardrail],
  throwOnBlocked: false, // Warning mode
  onOutputBlocked: (executionSummary) => {
    const result = executionSummary.blockedResults[0];
    console.log('⚠️  Warning:', result?.message);
    if (result?.metadata?.warnings) {
      console.log('   Warnings:', result.metadata.warnings);
    }
  },
});

try {
  const result = await generateObject({
    model: warningModel,
    prompt: 'Get weather for multiple cities',
    schema: z.object({
      weather1: z.object({
        function: z.literal('getWeather'),
        arguments: z.object({
          location: z.string(),
          units: z.enum(['celsius', 'fahrenheit']),
        }),
      }),
      weather2: z.object({
        function: z.literal('getWeather'),
        arguments: z.object({
          location: z.string(),
          units: z.enum(['celsius', 'fahrenheit']),
        }),
      }),
    }),
  });
  console.log(
    '✅ Proceeded with warnings:',
    JSON.stringify(result, null, 2) + '\n',
  );
} catch (error) {
  console.log('❌ Unexpected error:', (error as Error).message + '\n');
  throw error;
}

console.log('🎯 Tool call validation guardrail demonstration complete!');
console.log('\nKey Features:');
console.log('• Function name allowlisting');
console.log('• Parameter schema validation with Zod');
console.log('• Side-effect detection and tracking');
console.log('• Rate limiting per function');
console.log('• Path restrictions for file operations');
console.log('• SQL operation restrictions');
console.log('• Security pattern detection');
console.log('• Content size validation');
console.log('• Execution history tracking');
console.log('• Configurable severity levels');
