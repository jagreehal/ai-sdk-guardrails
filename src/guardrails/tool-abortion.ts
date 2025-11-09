import type {
  OutputGuardrail,
  OutputGuardrailContext,
  AIResult,
} from '../types';
import { executeOutputGuardrails } from '../guardrails';

/**
 * Options for tool abortion controller
 */
export interface ToolAbortionControllerOptions {
  /**
   * Minimum severity to trigger abortion
   * @default 'critical'
   */
  minSeverity?: 'low' | 'medium' | 'high' | 'critical';

  /**
   * Timeout for guardrail execution
   * @default 3000
   */
  timeout?: number;
}

/**
 * Controller for aborting tool execution based on guardrail violations
 */
export class ToolAbortionController {
  private controller: AbortController;
  private minSeverity: 'low' | 'medium' | 'high' | 'critical';
  private timeout: number;

  constructor(options: ToolAbortionControllerOptions = {}) {
    this.controller = new AbortController();
    this.minSeverity = options.minSeverity ?? 'critical';
    this.timeout = options.timeout ?? 3000;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /**
   * Check guardrails and abort if violations detected
   */
  async checkAndAbort(
    guardrails: OutputGuardrail[],
    context: OutputGuardrailContext,
  ): Promise<boolean> {
    const severityOrder = { low: 1, medium: 2, high: 3, critical: 4 };
    const minLevel = severityOrder[this.minSeverity];

    const results = await executeOutputGuardrails(guardrails, context, {
      parallel: true,
      timeout: this.timeout,
      continueOnFailure: true,
      logLevel: 'none',
    });

    const shouldAbort = results.some((result) => {
      if (!result.tripwireTriggered) return false;
      const resultSeverity = result.severity ?? 'medium';
      return severityOrder[resultSeverity] >= minLevel;
    });

    if (shouldAbort) {
      this.controller.abort('Guardrail violation detected');
      return true;
    }

    return false;
  }

  /**
   * Manually abort
   */
  abort(reason?: string): void {
    this.controller.abort(reason);
  }
}

/**
 * Creates a tool abortion controller
 *
 * @param options - Configuration options
 * @returns Tool abortion controller
 *
 * @example
 * ```typescript
 * const controller = createToolAbortionController({
 *   minSeverity: 'high',
 * });
 *
 * // Use in tool wrapper
 * const wrappedTool = wrapToolWithAbortion(tool, guardrails, {
 *   abortSignal: controller.signal,
 * });
 * ```
 */
export function createToolAbortionController(
  options?: ToolAbortionControllerOptions,
): ToolAbortionController {
  return new ToolAbortionController(options);
}

/**
 * Options for wrapping tools with abortion capability
 */
export interface WrapToolWithAbortionOptions {
  /**
   * Check guardrails before executing tool
   * @default false
   */
  checkBefore?: boolean;

  /**
   * Monitor execution with periodic guardrail checks
   * @default false
   */
  monitorDuring?: boolean;

  /**
   * Interval for monitoring checks in milliseconds
   * @default 100
   */
  monitorInterval?: number;

  /**
   * Check input deltas in streaming tool inputs
   * @default false
   */
  checkInputDelta?: boolean;

  /**
   * Minimum severity to abort on
   * @default 'critical'
   */
  abortOnSeverity?: 'low' | 'medium' | 'high' | 'critical';

  /**
   * Timeout for guardrail execution
   * @default 3000
   */
  timeout?: number;
}

/**
 * Wraps a tool with guardrail-based abortion capability
 *
 * Enables stopping dangerous tool execution before or during execution based
 * on guardrail violations. Particularly useful for tools that:
 * - Make external API calls
 * - Modify system state
 * - Access sensitive data
 * - Execute long-running operations
 *
 * @param tool - The tool to wrap
 * @param guardrails - Output guardrails to check
 * @param options - Configuration options
 * @returns Wrapped tool with abortion capability
 *
 * @example
 * ```typescript
 * import { wrapToolWithAbortion } from 'ai-sdk-guardrails';
 *
 * const dangerousApiTool = {
 *   description: 'Call external API',
 *   parameters: z.object({ endpoint: z.string() }),
 *   execute: async ({ endpoint }) => {
 *     // ... API call
 *   },
 * };
 *
 * const safeTool = wrapToolWithAbortion(
 *   dangerousApiTool,
 *   [
 *     {
 *       name: 'url-validator',
 *       execute: async ({ result }) => {
 *         // Check if endpoint is safe
 *         const input = JSON.parse(result.text);
 *         if (input.endpoint.includes('internal')) {
 *           return {
 *             tripwireTriggered: true,
 *             message: 'Internal endpoint not allowed',
 *             severity: 'critical',
 *           };
 *         }
 *         return { tripwireTriggered: false, message: '' };
 *       },
 *     },
 *   ],
 *   {
 *     checkBefore: true,
 *     abortOnSeverity: 'critical',
 *   }
 * );
 * ```
 *
 * @example Monitor long-running tool execution
 * ```typescript
 * const longRunningTool = wrapToolWithAbortion(
 *   dataProcessingTool,
 *   [timeoutGuardrail],
 *   {
 *     monitorDuring: true,
 *     monitorInterval: 1000, // Check every second
 *   }
 * );
 * ```
 */
export function wrapToolWithAbortion<T extends Record<string, unknown>>(
  tool: T & {
    execute: (
      input: unknown,
      options?: { abortSignal?: AbortSignal },
    ) => Promise<unknown>;
    onInputDelta?: (options: {
      inputTextDelta: string;
      toolCallId: string;
      messages: unknown[];
      abortSignal?: AbortSignal;
    }) => Promise<void> | void;
  },
  guardrails: OutputGuardrail[],
  options: WrapToolWithAbortionOptions = {},
): T & {
  execute: (
    input: unknown,
    options?: { abortSignal?: AbortSignal },
  ) => Promise<unknown>;
  onInputDelta?: (options: {
    inputTextDelta: string;
    toolCallId: string;
    messages: unknown[];
    abortSignal?: AbortSignal;
  }) => Promise<void> | void;
} {
  const {
    checkBefore = false,
    monitorDuring = false,
    monitorInterval = 100,
    checkInputDelta = false,
    abortOnSeverity = 'critical',
    timeout = 3000,
  } = options;

  const severityOrder = { low: 1, medium: 2, high: 3, critical: 4 };
  const minLevel = severityOrder[abortOnSeverity];

  const originalExecute = tool.execute;
  const originalOnInputDelta = tool.onInputDelta;

  async function checkGuardrails(input: unknown): Promise<void> {
    // Create a minimal result object for guardrail checking
    // The actual result type is complex, so we use type assertion
    const mockResult = {
      text: JSON.stringify(input),
      content: [],
      finishReason: 'stop',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    } as unknown as AIResult;

    const context: OutputGuardrailContext = {
      input: {
        prompt: '',
        messages: [],
        system: '',
      },
      result: mockResult,
    };

    const results = await executeOutputGuardrails(guardrails, context, {
      parallel: true,
      timeout,
      continueOnFailure: true,
      logLevel: 'none',
    });

    const shouldAbort = results.some((result) => {
      if (!result.tripwireTriggered) return false;
      const resultSeverity = result.severity ?? 'medium';
      return severityOrder[resultSeverity] >= minLevel;
    });

    if (shouldAbort) {
      const messages = results
        .filter((r) => r.tripwireTriggered)
        .map((r) => r.message)
        .join(', ');
      throw new Error(`Tool execution aborted: ${messages}`);
    }
  }

  const wrappedExecute = async (
    input: unknown,
    executeOptions?: { abortSignal?: AbortSignal },
  ): Promise<unknown> => {
    // Check before execution if configured
    if (checkBefore) {
      await checkGuardrails(input);
    }

    // Create internal abort controller for monitoring
    const internalController = new AbortController();

    // Monitor during execution if configured
    let monitorInterval_: NodeJS.Timeout | undefined;
    let monitorError: Error | undefined;
    if (monitorDuring) {
      monitorInterval_ = setInterval(async () => {
        try {
          await checkGuardrails(input);
        } catch (error) {
          monitorError = error as Error;
          internalController.abort();
          clearInterval(monitorInterval_);
        }
      }, monitorInterval);
    }

    try {
      // Compose signals only when monitoring AND caller provided their own signal
      const combinedSignal =
        monitorDuring && executeOptions?.abortSignal
          ? AbortSignal.any([
              executeOptions.abortSignal,
              internalController.signal,
            ])
          : (executeOptions?.abortSignal ??
            (monitorDuring ? internalController.signal : undefined));

      // Check if we need to pass abortSignal at all
      const callOptions = combinedSignal
        ? { ...executeOptions, abortSignal: combinedSignal }
        : executeOptions;

      const result = await originalExecute.call(tool, input, callOptions);

      if (monitorInterval_) {
        clearInterval(monitorInterval_);
      }

      // Check if monitoring detected an error
      if (monitorError) {
        throw monitorError;
      }

      return result;
    } catch (error) {
      if (monitorInterval_) {
        clearInterval(monitorInterval_);
      }
      // Throw monitor error if it exists, otherwise original error
      throw monitorError ?? error;
    }
  };

  const wrappedOnInputDelta =
    checkInputDelta && originalOnInputDelta
      ? async (deltaOptions: {
          inputTextDelta: string;
          toolCallId: string;
          messages: unknown[];
          abortSignal?: AbortSignal;
        }): Promise<void> => {
          // Create a minimal result object for guardrail checking
          const mockResult = {
            text: deltaOptions.inputTextDelta,
            content: [],
            finishReason: 'stop',
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          } as unknown as AIResult;

          const context: OutputGuardrailContext = {
            input: {
              prompt: '',
              messages: [],
              system: '',
            },
            result: mockResult,
          };

          const results = await executeOutputGuardrails(guardrails, context, {
            parallel: true,
            timeout,
            continueOnFailure: true,
            logLevel: 'none',
          });

          const shouldAbort = results.some((result) => {
            if (!result.tripwireTriggered) return false;
            const resultSeverity = result.severity ?? 'medium';
            return severityOrder[resultSeverity] >= minLevel;
          });

          if (shouldAbort) {
            const violation = results.find((r) => r.tripwireTriggered);
            throw new Error(
              `Tool input delta blocked by guardrail: ${violation?.message || 'Guardrail violation'}`,
            );
          }

          // Call original if safe
          await originalOnInputDelta?.call(tool, deltaOptions);
        }
      : originalOnInputDelta;

  return {
    ...tool,
    execute: wrappedExecute,
    ...(wrappedOnInputDelta ? { onInputDelta: wrappedOnInputDelta } : {}),
  };
}
