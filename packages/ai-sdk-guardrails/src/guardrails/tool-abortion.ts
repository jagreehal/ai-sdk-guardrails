import type {
  OutputGuardrail,
  OutputGuardrailContext,
  AIResult,
  GenerateTextResult,
} from '../types';
import { executeOutputGuardrails } from '../guardrails';

/** Wraps `text` as a result for output guardrails that check tool input. */
function toolInputContext(text: string): OutputGuardrailContext {
  const content: GenerateTextResult['content'] = [];

  // SAFETY: output guardrails read only text, content, finishReason and usage
  // from the result; the other AIResult members are absent here.
  const result = {
    text,
    content,
    finishReason: 'stop',
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  } as AIResult;

  return {
    input: {
      prompt: '',
      messages: [],
      system: '',
    },
    result,
  };
}

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
export function wrapToolWithAbortion<
  // `never[]` params accept any tool's typed `execute` / `onInputDelta`.
  T extends {
    execute?: (...args: never[]) => void;
    onInputDelta?: (...args: never[]) => void;
  },
>(
  tool: T,
  guardrails: OutputGuardrail[],
  options: WrapToolWithAbortionOptions = {},
): T {
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

  type ToolInput = Parameters<NonNullable<T['execute']>>[0];

  type ToolOutput = ReturnType<NonNullable<T['execute']>>;

  // SAFETY: the AI SDK calls a tool's execute as `execute(input, options)`,
  // with `abortSignal` among the options.
  const originalExecute = tool.execute as
    | ((
        input: ToolInput,
        options?: { abortSignal?: AbortSignal },
      ) => ToolOutput)
    | undefined;

  // SAFETY: the AI SDK calls onInputDelta with a single InputDeltaOptions object.
  const originalOnInputDelta = tool.onInputDelta as
    | ((
        options: InputDeltaOptions,
      ) => ReturnType<NonNullable<T['onInputDelta']>>)
    | undefined;

  async function checkGuardrails(input: ToolInput): Promise<void> {
    const context = toolInputContext(JSON.stringify(input));

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
    input: ToolInput,
    executeOptions?: { abortSignal?: AbortSignal },
  ): Promise<Awaited<ToolOutput> | undefined> => {
    if (checkBefore) {
      await checkGuardrails(input);
    }

    const internalController = new AbortController();

    let monitorInterval_: NodeJS.Timeout | undefined;
    let monitorError: unknown;

    if (monitorDuring) {
      monitorInterval_ = setInterval(async () => {
        try {
          await checkGuardrails(input);
        } catch (error) {
          monitorError = error;
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

      const callOptions = combinedSignal
        ? { ...executeOptions, abortSignal: combinedSignal }
        : executeOptions;

      const result = await originalExecute?.call(tool, input, callOptions);

      if (monitorInterval_) {
        clearInterval(monitorInterval_);
      }

      if (monitorError) {
        throw monitorError;
      }

      return result;
    } catch (error) {
      if (monitorInterval_) {
        clearInterval(monitorInterval_);
      }

      throw monitorError ?? error;
    }
  };

  const wrappedOnInputDelta =
    checkInputDelta && originalOnInputDelta
      ? async (deltaOptions: InputDeltaOptions): Promise<void> => {
          const context = toolInputContext(deltaOptions.inputTextDelta);

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

          await originalOnInputDelta?.call(tool, deltaOptions);
        }
      : originalOnInputDelta;

  return {
    ...tool,
    ...(originalExecute && { execute: wrappedExecute }),
    ...(wrappedOnInputDelta && { onInputDelta: wrappedOnInputDelta }),
  };
}

interface InputDeltaOptions {
  inputTextDelta: string;
  toolCallId: string;
  messages: unknown[];
  abortSignal?: AbortSignal;
}
