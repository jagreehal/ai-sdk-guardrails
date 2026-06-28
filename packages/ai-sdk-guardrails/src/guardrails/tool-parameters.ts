/**
 * Tool Parameter Validation Guardrails
 *
 * Validates and sanitizes tool inputs BEFORE execution to prevent
 * dangerous operations like SQL injection, path traversal, etc.
 */

/* eslint-disable unicorn/numeric-separators-style */

import type { ToolSet } from 'ai';
import type { RequestContext } from '../types';

/**
 * Context provided to tool parameter validators
 */
export interface ToolValidationContext<TContext = Record<string, unknown>> {
  /** Name of the tool being called */
  toolName: string;
  /** The tool call ID */
  toolCallId?: string;
  /** Request-scoped context (user, session, permissions) */
  requestContext?: RequestContext<TContext>;
}

/**
 * Result of tool parameter validation
 */
export interface ToolValidationResult<T = unknown> {
  /** Whether the input is valid */
  valid: boolean;
  /** Optionally return sanitized/modified input */
  sanitizedInput?: T;
  /** Error/block message if invalid */
  message?: string;
  /** Whether to completely block the tool call */
  block?: boolean;
  /** Severity of the issue */
  severity?: 'low' | 'medium' | 'high' | 'critical';
  /** Additional metadata about the validation */
  metadata?: Record<string, unknown>;
}

/**
 * Tool parameter guardrail definition
 */
export interface ToolParameterGuardrail<
  TInput = unknown,
  TContext = Record<string, unknown>,
> {
  /** Unique name for this guardrail */
  name: string;
  /** Description of what this guardrail validates */
  description?: string;
  /** Tool name(s) this guardrail applies to */
  toolName: string | RegExp | string[];
  /** Validation function */
  validateInput: (
    input: TInput,
    context: ToolValidationContext<TContext>,
  ) => Promise<ToolValidationResult<TInput>> | ToolValidationResult<TInput>;
}

/**
 * Options for tool parameter guardrails wrapper
 */
export interface ToolParameterGuardrailsOptions<
  TContext = Record<string, unknown>,
> {
  /** Request-scoped context */
  requestContext?: RequestContext<TContext>;
  /** Whether to throw on validation failure (default: true) */
  throwOnInvalid?: boolean;
  /** Callback when validation fails */
  onValidationFailed?: (
    toolName: string,
    input: unknown,
    results: ToolValidationResult[],
  ) => void;
}

/**
 * Checks if a tool name matches the guardrail's tool name pattern
 */
function matchesToolName(
  guardrailToolName: string | RegExp | string[],
  toolName: string,
): boolean {
  if (typeof guardrailToolName === 'string') {
    return guardrailToolName === toolName || guardrailToolName === '*';
  }
  if (guardrailToolName instanceof RegExp) {
    return guardrailToolName.test(toolName);
  }
  if (Array.isArray(guardrailToolName)) {
    return guardrailToolName.includes(toolName);
  }
  return false;
}

/**
 * Wraps tools with parameter validation guardrails.
 *
 * This function intercepts tool calls and validates/sanitizes their inputs
 * BEFORE the tool executes, preventing dangerous operations.
 *
 * @example
 * ```typescript
 * const protectedTools = withToolParameterGuardrails(
 *   {
 *     executeSQL: tool({
 *       description: 'Execute SQL query',
 *       parameters: z.object({ query: z.string() }),
 *       execute: async ({ query }) => db.execute(query)
 *     }),
 *     readFile: tool({
 *       description: 'Read a file',
 *       parameters: z.object({ path: z.string() }),
 *       execute: async ({ path }) => fs.readFile(path, 'utf-8')
 *     })
 *   },
 *   [
 *     {
 *       name: 'sql-injection-prevention',
 *       toolName: 'executeSQL',
 *       validateInput: async (input) => {
 *         if (containsSQLInjection(input.query)) {
 *           return { valid: false, block: true, message: 'SQL injection detected' };
 *         }
 *         return { valid: true, sanitizedInput: { query: escapeSql(input.query) } };
 *       }
 *     },
 *     {
 *       name: 'path-traversal-prevention',
 *       toolName: 'readFile',
 *       validateInput: async (input) => {
 *         if (input.path.includes('..')) {
 *           return { valid: false, block: true, message: 'Path traversal detected' };
 *         }
 *         return { valid: true };
 *       }
 *     }
 *   ]
 * );
 * ```
 *
 * @deprecated For gating tool calls, prefer {@link guardrailApproval} with the
 * `toolApproval` option of `generateText` / `streamText` / `Agent` (AI SDK v7).
 * It runs inside the agent loop, so it can pause for human-in-the-loop approval
 * and resume — which wrapping the tool cannot. The same `ToolParameterGuardrail`
 * objects work with both. Keep using `withToolParameterGuardrails` only when you
 * need to *rewrite* tool input via `sanitizedInput` before execution, which
 * `toolApproval` (allow/deny only) does not do. This wrapper will be removed in a
 * future major.
 */
export function withToolParameterGuardrails<
  TOOLS extends ToolSet,
  TContext = Record<string, unknown>,
>(
  tools: TOOLS,
  guardrails: ToolParameterGuardrail<unknown, TContext>[],
  options: ToolParameterGuardrailsOptions<TContext> = {},
): TOOLS {
  const { throwOnInvalid = true, onValidationFailed, requestContext } = options;

  const wrappedTools: Record<string, unknown> = {};

  for (const [toolName, tool] of Object.entries(tools)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalTool = tool as any;

    // Find guardrails that apply to this tool
    const applicableGuardrails = guardrails.filter((g) =>
      matchesToolName(g.toolName, toolName),
    );

    if (applicableGuardrails.length === 0) {
      // No guardrails for this tool, pass through unchanged
      wrappedTools[toolName] = tool;
      continue;
    }

    // Create wrapped tool with validation
    wrappedTools[toolName] = {
      ...originalTool,
      execute: async (input: unknown, execOptions?: unknown) => {
        const context: ToolValidationContext<TContext> = {
          toolName,
          requestContext,
        };

        let currentInput = input;
        const failedResults: ToolValidationResult[] = [];

        // Run all applicable guardrails
        for (const guardrail of applicableGuardrails) {
          const result = await guardrail.validateInput(currentInput, context);

          if (!result.valid) {
            failedResults.push(result);

            if (result.block) {
              // Immediate block
              if (onValidationFailed) {
                onValidationFailed(toolName, input, [result]);
              }

              if (throwOnInvalid) {
                throw new ToolParameterValidationError(
                  toolName,
                  guardrail.name,
                  result.message || 'Validation failed',
                  result.severity,
                );
              }

              return {
                error: `Tool parameter validation failed: ${result.message}`,
                blocked: true,
                guardrail: guardrail.name,
              };
            }
          } else if (result.sanitizedInput !== undefined) {
            // Use sanitized input for next guardrail and execution
            currentInput = result.sanitizedInput;
          }
        }

        // If any guardrails failed (but didn't block), report them
        if (failedResults.length > 0) {
          if (onValidationFailed) {
            onValidationFailed(toolName, input, failedResults);
          }

          if (throwOnInvalid) {
            const messages = failedResults.map((r) => r.message).join('; ');
            throw new ToolParameterValidationError(
              toolName,
              'multiple',
              messages,
              failedResults[0]?.severity,
            );
          }
        }

        // Execute with (potentially sanitized) input
        return originalTool.execute(currentInput, execOptions);
      },
    };
  }

  return wrappedTools as TOOLS;
}

/**
 * Error thrown when tool parameter validation fails
 */
export class ToolParameterValidationError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly guardrailName: string,
    message: string,
    public readonly severity?: 'low' | 'medium' | 'high' | 'critical',
  ) {
    super(
      `Tool "${toolName}" parameter validation failed (${guardrailName}): ${message}`,
    );
    this.name = 'ToolParameterValidationError';
  }
}

// ============================================================================
// Built-in Tool Parameter Guardrails
// ============================================================================

/**
 * Creates a guardrail that prevents SQL injection attacks
 */
export function sqlInjectionGuardrail(
  options: {
    toolName?: string | string[];
    patterns?: RegExp[];
  } = {},
): ToolParameterGuardrail<{ query?: string; sql?: string }> {
  const defaultPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|TRUNCATE)\b.*\b(FROM|INTO|TABLE|DATABASE)\b)/i,
    /(--)|(\/\*)|(\*\/)/,
    /(\b(OR|AND)\b\s+\d+\s*=\s*\d+)/i,
    /(;\s*(SELECT|INSERT|UPDATE|DELETE|DROP))/i,
    /(\bEXEC\b|\bEXECUTE\b)/i,
  ];

  return {
    name: 'sql-injection-prevention',
    description: 'Prevents SQL injection attacks in tool parameters',
    toolName: options.toolName || '*',
    validateInput: (input) => {
      const query = input.query || input.sql || '';
      const patterns = options.patterns || defaultPatterns;

      for (const pattern of patterns) {
        if (pattern.test(query)) {
          return {
            valid: false,
            block: true,
            message: 'Potential SQL injection detected',
            severity: 'critical',
            metadata: { pattern: pattern.source },
          };
        }
      }

      return { valid: true };
    },
  };
}

/**
 * Creates a guardrail that prevents path traversal attacks
 */
export function pathTraversalGuardrail(
  options: {
    toolName?: string | string[];
    allowedPaths?: string[];
    blockedPatterns?: RegExp[];
  } = {},
): ToolParameterGuardrail<{ path?: string; file?: string; filename?: string }> {
  const defaultBlockedPatterns = [
    /\.\./,
    /^\/etc\//,
    /^\/proc\//,
    /^\/sys\//,
    /^~\//,
    /\0/,
  ];

  return {
    name: 'path-traversal-prevention',
    description: 'Prevents path traversal attacks in file operations',
    toolName: options.toolName || '*',
    validateInput: (input) => {
      const path = input.path || input.file || input.filename || '';
      const blockedPatterns = options.blockedPatterns || defaultBlockedPatterns;

      for (const pattern of blockedPatterns) {
        if (pattern.test(path)) {
          return {
            valid: false,
            block: true,
            message: 'Path traversal attempt detected',
            severity: 'critical',
            metadata: { path, pattern: pattern.source },
          };
        }
      }

      if (options.allowedPaths && options.allowedPaths.length > 0) {
        const isAllowed = options.allowedPaths.some((allowed) =>
          path.startsWith(allowed),
        );
        if (!isAllowed) {
          return {
            valid: false,
            block: true,
            message: 'Path not in allowed list',
            severity: 'high',
            metadata: { path, allowedPaths: options.allowedPaths },
          };
        }
      }

      return { valid: true };
    },
  };
}

/**
 * Creates a guardrail that enforces parameter length limits
 */
export function parameterLengthGuardrail(
  options: {
    toolName?: string | string[];
    maxLength?: number;
    fields?: string[];
  } = {},
): ToolParameterGuardrail<Record<string, unknown>> {
  const maxLength = options.maxLength || 10000;

  return {
    name: 'parameter-length-limit',
    description: 'Enforces maximum length on tool parameters',
    toolName: options.toolName || '*',
    validateInput: (input) => {
      const fields = options.fields || Object.keys(input);

      for (const field of fields) {
        const value = input[field];
        if (typeof value === 'string' && value.length > maxLength) {
          return {
            valid: false,
            block: true,
            message: `Parameter "${field}" exceeds maximum length (${value.length} > ${maxLength})`,
            severity: 'medium',
            metadata: { field, length: value.length, maxLength },
          };
        }
      }

      return { valid: true };
    },
  };
}

/**
 * Creates a role-based access control guardrail for tools
 */
export function toolRBACGuardrail<TContext = Record<string, unknown>>(options: {
  toolName: string | string[];
  requiredPermissions: string[];
  mode?: 'any' | 'all';
}): ToolParameterGuardrail<unknown, TContext> {
  const mode = options.mode || 'any';

  return {
    name: 'tool-rbac',
    description: `Requires ${mode === 'any' ? 'any of' : 'all of'} [${options.requiredPermissions.join(', ')}] permissions`,
    toolName: options.toolName,
    validateInput: (_input, context) => {
      const userPermissions = context.requestContext?.permissions || [];

      const hasPermission =
        mode === 'any'
          ? options.requiredPermissions.some((p) => userPermissions.includes(p))
          : options.requiredPermissions.every((p) =>
              userPermissions.includes(p),
            );

      if (!hasPermission) {
        return {
          valid: false,
          block: true,
          message: `Insufficient permissions. Required: ${options.requiredPermissions.join(', ')}`,
          severity: 'high',
          metadata: {
            requiredPermissions: options.requiredPermissions,
            userPermissions,
            mode,
          },
        };
      }

      return { valid: true };
    },
  };
}
