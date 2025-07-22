import type {
  InputGuardrail,
  OutputGuardrail,
  GuardrailResult,
  InputGuardrailContext,
  OutputGuardrailContext,
  AIResult,
  LanguageModelV2,
  LanguageModelV2Middleware,
  LanguageModelV2CallOptions,
  LanguageModelV2StreamPart,
  InputGuardrailsMiddlewareConfig,
  OutputGuardrailsMiddlewareConfig,
} from './types';

/**
 * Creates a well-structured input guardrail with enhanced metadata
 * @param guardrail - The guardrail configuration
 * @returns Enhanced input guardrail with automatic metadata injection
 */
export function defineInputGuardrail(
  guardrail: InputGuardrail,
): InputGuardrail {
  const enhanced: InputGuardrail = {
    enabled: true,
    priority: 'medium',
    version: '1.0.0',
    tags: [],
    ...guardrail,
    execute: async (params) => {
      const startTime = Date.now();
      const originalExecute = guardrail.execute;

      try {
        const result = await originalExecute(params);
        const executionTime = Date.now() - startTime;

        return {
          ...result,
          context: {
            guardrailName: guardrail.name,
            guardrailVersion: guardrail.version,
            executedAt: new Date(),
            executionTimeMs: executionTime,
            ...result.context,
          },
        };
      } catch (error) {
        const executionTime = Date.now() - startTime;
        return {
          tripwireTriggered: true,
          message: `Guardrail execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          severity: 'critical',
          context: {
            guardrailName: guardrail.name,
            guardrailVersion: guardrail.version,
            executedAt: new Date(),
            executionTimeMs: executionTime,
          },
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  };

  return enhanced;
}

/**
 * Executes input guardrails with enhanced performance monitoring and error handling
 * @param guardrails - Array of input guardrails to execute
 * @param params - Parameters for guardrail execution
 * @param options - Execution options
 * @returns Promise resolving to array of guardrail results
 */
export async function executeInputGuardrails(
  guardrails: InputGuardrail[],
  params: InputGuardrailContext,
  options: {
    /** Execute guardrails in parallel (default: true) */
    parallel?: boolean;
    /** Maximum execution time in milliseconds */
    timeout?: number;
    /** Whether to continue on first failure */
    continueOnFailure?: boolean;
    /** Logging level */
    logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
  } = {},
): Promise<GuardrailResult[]> {
  const {
    parallel = true,
    timeout = 30_000, // 30 seconds
    continueOnFailure = true,
    logLevel = 'info',
  } = options;

  // Filter enabled guardrails and sort by priority
  const enabledGuardrails = guardrails
    .filter((g) => g.enabled !== false)
    .sort((a, b) => {
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return (
        (priorityOrder[b.priority || 'medium'] || 2) -
        (priorityOrder[a.priority || 'medium'] || 2)
      );
    });

  const results: GuardrailResult[] = [];

  const executeWithTimeout = async (
    guardrail: InputGuardrail,
  ): Promise<GuardrailResult> => {
    const timeoutPromise = new Promise<GuardrailResult>((_, reject) => {
      setTimeout(async () => {
        const { GuardrailTimeoutError } = await import('./errors');
        reject(new GuardrailTimeoutError(guardrail.name, timeout));
      }, timeout);
    });

    const executionPromise = guardrail.execute(params);

    return Promise.race([executionPromise, timeoutPromise]);
  };

  if (parallel) {
    // Execute all guardrails in parallel
    const promises = enabledGuardrails.map(async (guardrail) => {
      try {
        const result = await executeWithTimeout(guardrail);

        if (result.tripwireTriggered && logLevel !== 'none') {
          console.log(
            `Input guardrail "${guardrail.name}" triggered: ${result.message}`,
          );
        }

        return result;
      } catch (error) {
        if (logLevel !== 'none') {
          console.error(
            `Error executing input guardrail "${guardrail.name}":`,
            error,
          );
        }

        return {
          tripwireTriggered: true,
          message: `Guardrail execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          severity: 'critical' as const,
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    });

    results.push(...(await Promise.all(promises)));
  } else {
    // Execute guardrails sequentially
    for (const guardrail of enabledGuardrails) {
      try {
        const result = await executeWithTimeout(guardrail);
        results.push(result);

        if (result.tripwireTriggered) {
          if (logLevel !== 'none') {
            console.log(
              `Input guardrail "${guardrail.name}" triggered: ${result.message}`,
            );
          }

          if (!continueOnFailure) {
            break;
          }
        }
      } catch (error) {
        if (logLevel !== 'none') {
          console.error(
            `Error executing input guardrail "${guardrail.name}":`,
            error,
          );
        }

        const errorResult = {
          tripwireTriggered: true,
          message: `Guardrail execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          severity: 'critical' as const,
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          },
        };

        results.push(errorResult);

        if (!continueOnFailure) {
          break;
        }
      }
    }
  }

  return results;
}

/**
 * Creates a well-structured output guardrail with enhanced metadata
 * @param guardrail - The guardrail configuration
 * @returns Enhanced output guardrail with automatic metadata injection
 */
export function defineOutputGuardrail(
  guardrail: OutputGuardrail,
): OutputGuardrail {
  const enhanced: OutputGuardrail = {
    enabled: true,
    priority: 'medium',
    version: '1.0.0',
    tags: [],
    ...guardrail,
    execute: async (params) => {
      const startTime = Date.now();
      const originalExecute = guardrail.execute;

      try {
        const result = await originalExecute(params);
        const executionTime = Date.now() - startTime;

        return {
          ...result,
          context: {
            guardrailName: guardrail.name,
            guardrailVersion: guardrail.version,
            executedAt: new Date(),
            executionTimeMs: executionTime,
            ...result.context,
          },
        };
      } catch (error) {
        const executionTime = Date.now() - startTime;
        return {
          tripwireTriggered: true,
          message: `Guardrail execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          severity: 'critical',
          context: {
            guardrailName: guardrail.name,
            guardrailVersion: guardrail.version,
            executedAt: new Date(),
            executionTimeMs: executionTime,
          },
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  };

  return enhanced;
}

/**
 * Executes output guardrails with enhanced performance monitoring and error handling
 * @param guardrails - Array of output guardrails to execute
 * @param params - Parameters for guardrail execution
 * @param options - Execution options
 * @returns Promise resolving to array of guardrail results
 */
export async function executeOutputGuardrails(
  guardrails: OutputGuardrail[],
  params: OutputGuardrailContext,
  options: {
    /** Execute guardrails in parallel (default: true) */
    parallel?: boolean;
    /** Maximum execution time in milliseconds */
    timeout?: number;
    /** Whether to continue on first failure */
    continueOnFailure?: boolean;
    /** Logging level */
    logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
  } = {},
): Promise<GuardrailResult[]> {
  const {
    parallel = true,
    timeout = 30_000, // 30 seconds
    continueOnFailure = true,
    logLevel = 'info',
  } = options;

  // Filter enabled guardrails and sort by priority
  const enabledGuardrails = guardrails
    .filter((g) => g.enabled !== false)
    .sort((a, b) => {
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return (
        (priorityOrder[b.priority || 'medium'] || 2) -
        (priorityOrder[a.priority || 'medium'] || 2)
      );
    });

  const results: GuardrailResult[] = [];

  const executeWithTimeout = async (
    guardrail: OutputGuardrail,
  ): Promise<GuardrailResult> => {
    const timeoutPromise = new Promise<GuardrailResult>((_, reject) => {
      setTimeout(async () => {
        const { GuardrailTimeoutError } = await import('./errors');
        reject(new GuardrailTimeoutError(guardrail.name, timeout));
      }, timeout);
    });

    const executionPromise = guardrail.execute(params);

    return Promise.race([executionPromise, timeoutPromise]);
  };

  if (parallel) {
    // Execute all guardrails in parallel
    const promises = enabledGuardrails.map(async (guardrail) => {
      try {
        const result = await executeWithTimeout(guardrail);

        if (result.tripwireTriggered && logLevel !== 'none') {
          console.log(
            `Output guardrail "${guardrail.name}" triggered: ${result.message}`,
          );
        }

        return result;
      } catch (error) {
        if (logLevel !== 'none') {
          console.error(
            `Error executing output guardrail "${guardrail.name}":`,
            error,
          );
        }

        return {
          tripwireTriggered: true,
          message: `Guardrail execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          severity: 'critical' as const,
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    });

    results.push(...(await Promise.all(promises)));
  } else {
    // Execute guardrails sequentially
    for (const guardrail of enabledGuardrails) {
      try {
        const result = await executeWithTimeout(guardrail);
        results.push(result);

        if (result.tripwireTriggered) {
          if (logLevel !== 'none') {
            console.log(
              `Output guardrail "${guardrail.name}" triggered: ${result.message}`,
            );
          }

          if (!continueOnFailure) {
            break;
          }
        }
      } catch (error) {
        if (logLevel !== 'none') {
          console.error(
            `Error executing output guardrail "${guardrail.name}":`,
            error,
          );
        }

        const errorResult = {
          tripwireTriggered: true,
          message: `Guardrail execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          severity: 'critical' as const,
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          },
        };

        results.push(errorResult);

        if (!continueOnFailure) {
          break;
        }
      }
    }
  }

  return results;
}

type MessageContent = Array<{ type: string; text?: string }>;

function extractTextFromContent(content: MessageContent): string {
  return content
    .filter((part) => part.type === 'text')
    .map((part) => part.text || '')
    .join('');
}

/**
 * Creates an input guardrails middleware that executes before AI calls
 * @param config - Input guardrails configuration
 * @returns AI SDK middleware that executes input guardrails
 */
export function createInputGuardrailsMiddleware(
  config: InputGuardrailsMiddlewareConfig,
): LanguageModelV2Middleware {
  const {
    inputGuardrails,
    executionOptions = {},
    onInputBlocked,
    throwOnBlocked = false,
  } = config;

  return {
    middlewareVersion: 'v2',
    transformParams: async ({
      params,
    }: {
      type: 'generate' | 'stream';
      params: LanguageModelV2CallOptions;
      model: LanguageModelV2;
    }) => {
      const enhancedParams = {
        ...params,
        guardrailsBlocked: undefined,
      } as LanguageModelV2CallOptions & {
        guardrailsBlocked?: GuardrailResult[];
      };

      const promptMessages = Array.isArray(enhancedParams.prompt)
        ? enhancedParams.prompt
        : [];
      const systemMessage = promptMessages.find((msg) => msg.role === 'system');
      const system =
        systemMessage && Array.isArray(systemMessage.content)
          ? extractTextFromContent(systemMessage.content as MessageContent)
          : '';
      const messages = promptMessages
        .filter((msg) => msg.role !== 'system')
        .map((msg) => ({
          role: msg.role as string,
          content:
            msg.content && Array.isArray(msg.content)
              ? extractTextFromContent(msg.content as MessageContent)
              : '',
        }));
      const prompt =
        messages.length === 1 && messages[0]?.role === 'user'
          ? messages[0].content
          : messages.map((m) => m.content).join(' ');

      const guardrailContext = {
        prompt,
        messages,
        system,
        maxOutputTokens: enhancedParams.maxOutputTokens,
        temperature: enhancedParams.temperature,
      } as InputGuardrailContext;

      const inputResults = await executeInputGuardrails(
        inputGuardrails,
        guardrailContext,
        executionOptions,
      );

      const blockedResults = inputResults.filter((r) => r.tripwireTriggered);
      if (blockedResults.length > 0) {
        if (onInputBlocked) {
          onInputBlocked(blockedResults, guardrailContext);
        }

        if (throwOnBlocked) {
          const { InputBlockedError } = await import('./errors');
          const blockedGuardrails = blockedResults.map((r) => ({
            name: r.context?.guardrailName || 'unknown',
            message: r.message || 'Blocked',
            severity: r.severity || ('medium' as const),
          }));

          throw new InputBlockedError(blockedGuardrails);
        }

        // Store blocked results for later use
        enhancedParams.guardrailsBlocked = blockedResults;
      }

      return enhancedParams;
    },

    wrapGenerate: async ({
      doGenerate,
      params,
    }: {
      doGenerate: () => ReturnType<LanguageModelV2['doGenerate']>;
      doStream: () => ReturnType<LanguageModelV2['doStream']>;
      params: LanguageModelV2CallOptions;
      model: LanguageModelV2;
    }) => {
      const paramsWithGuardrails = params as LanguageModelV2CallOptions & {
        guardrailsBlocked?: GuardrailResult[];
      };

      if (paramsWithGuardrails.guardrailsBlocked) {
        const blockedResults = paramsWithGuardrails.guardrailsBlocked;
        const blockedMessage = blockedResults.map((r) => r.message).join(', ');

        return {
          content: [
            { type: 'text', text: `[Input blocked: ${blockedMessage}]` },
          ],
          finishReason: 'other',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          warnings: [],
        };
      }

      return doGenerate();
    },

    wrapStream: async ({
      doStream,
      params,
    }: {
      doGenerate: () => ReturnType<LanguageModelV2['doGenerate']>;
      doStream: () => ReturnType<LanguageModelV2['doStream']>;
      params: LanguageModelV2CallOptions;
      model: LanguageModelV2;
    }) => {
      const paramsWithGuardrails = params as LanguageModelV2CallOptions & {
        guardrailsBlocked?: GuardrailResult[];
      };

      if (paramsWithGuardrails.guardrailsBlocked) {
        const blockedResults = paramsWithGuardrails.guardrailsBlocked;
        const blockedMessage = blockedResults.map((r) => r.message).join(', ');

        const stream = new ReadableStream<LanguageModelV2StreamPart>({
          start(controller) {
            controller.enqueue({
              type: 'text-delta',
              id: '1',
              delta: `[Input blocked: ${blockedMessage}]`,
            });
            controller.enqueue({
              type: 'finish',
              finishReason: 'other',
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            });
            controller.close();
          },
        });

        return { stream };
      }

      return doStream();
    },
  };
}

/**
 * Creates an output guardrails middleware that executes after AI calls
 * @param config - Output guardrails configuration
 * @returns AI SDK middleware that executes output guardrails
 */
export function createOutputGuardrailsMiddleware(
  config: OutputGuardrailsMiddlewareConfig,
): LanguageModelV2Middleware {
  const {
    outputGuardrails,
    executionOptions = {},
    onOutputBlocked,
    throwOnBlocked = false,
  } = config;

  return {
    middlewareVersion: 'v2',
    wrapGenerate: async ({
      doGenerate,
      params,
    }: {
      doGenerate: () => ReturnType<LanguageModelV2['doGenerate']>;
      doStream: () => ReturnType<LanguageModelV2['doStream']>;
      params: LanguageModelV2CallOptions;
      model: LanguageModelV2;
    }) => {
      const result = await doGenerate();

      // Transform v5 params to a simple context for guardrails
      const promptMessages = Array.isArray(params.prompt) ? params.prompt : [];
      const systemMessage = promptMessages.find((msg) => msg.role === 'system');
      const system =
        systemMessage && Array.isArray(systemMessage.content)
          ? extractTextFromContent(systemMessage.content as MessageContent)
          : '';
      const messages = promptMessages
        .filter((msg) => msg.role !== 'system')
        .map((msg) => ({
          role: msg.role as string,
          content:
            msg.content && Array.isArray(msg.content)
              ? extractTextFromContent(msg.content as MessageContent)
              : '',
        }));
      const prompt =
        messages.length === 1 && messages[0]?.role === 'user'
          ? messages[0].content
          : messages.map((m) => m.content).join(' ');

      // Create a minimal context that matches GenerateTextParams structure
      const guardrailContext = {
        prompt,
        messages,
        system,
        maxOutputTokens: params.maxOutputTokens,
        temperature: params.temperature,
      } as InputGuardrailContext;

      const outputContext: OutputGuardrailContext = {
        input: guardrailContext,
        result: result as AIResult,
      };

      const outputResults = await executeOutputGuardrails(
        outputGuardrails,
        outputContext,
        executionOptions,
      );

      const blockedResults = outputResults.filter((r) => r.tripwireTriggered);
      if (blockedResults.length > 0) {
        if (onOutputBlocked) {
          onOutputBlocked(blockedResults, guardrailContext, result);
        }

        if (throwOnBlocked) {
          const { OutputBlockedError } = await import('./errors');
          const blockedGuardrails = blockedResults.map((r) => ({
            name: r.context?.guardrailName || 'unknown',
            message: r.message || 'Blocked',
            severity: r.severity || ('medium' as const),
          }));

          throw new OutputBlockedError(blockedGuardrails);
        }
      }

      return result;
    },

    wrapStream: async ({
      doStream,
      params,
    }: {
      doGenerate: () => ReturnType<LanguageModelV2['doGenerate']>;
      doStream: () => ReturnType<LanguageModelV2['doStream']>;
      params: LanguageModelV2CallOptions;
      model: LanguageModelV2;
    }) => {
      const streamResult = await doStream();

      // For streaming, we need to wrap the stream to monitor output
      let accumulatedText = '';
      const blockedChunks: LanguageModelV2StreamPart[] = [];

      const transformStream = new TransformStream<
        LanguageModelV2StreamPart,
        LanguageModelV2StreamPart
      >({
        transform(chunk: LanguageModelV2StreamPart) {
          // Accumulate text for output guardrails
          if (chunk.type === 'text-delta') {
            accumulatedText += chunk.delta || '';
          }

          // Store chunks for replay if not blocked
          blockedChunks.push(chunk);

          // Don't enqueue yet - wait for flush to check guardrails
        },

        async flush(controller) {
          // Execute output guardrails on accumulated text
          // Transform v5 params to a simple context for guardrails
          const promptMessages = Array.isArray(params.prompt)
            ? params.prompt
            : [];
          const systemMessage = promptMessages.find(
            (msg) => msg.role === 'system',
          );
          const system =
            systemMessage && Array.isArray(systemMessage.content)
              ? extractTextFromContent(systemMessage.content as MessageContent)
              : '';
          const messages = promptMessages
            .filter((msg) => msg.role !== 'system')
            .map((msg) => ({
              role: msg.role as string,
              content:
                msg.content && Array.isArray(msg.content)
                  ? extractTextFromContent(msg.content as MessageContent)
                  : '',
            }));
          const prompt =
            messages.length === 1 && messages[0]?.role === 'user'
              ? messages[0].content
              : messages.map((m) => m.content).join(' ');

          const guardrailContext = {
            prompt,
            messages,
            system,
            maxOutputTokens: params.maxOutputTokens,
            temperature: params.temperature,
          } as InputGuardrailContext;

          const outputContext: OutputGuardrailContext = {
            input: guardrailContext,
            result: { text: accumulatedText } as AIResult,
          };

          const outputResults = await executeOutputGuardrails(
            outputGuardrails,
            outputContext,
            executionOptions,
          );

          const blockedResults = outputResults.filter(
            (r) => r.tripwireTriggered,
          );

          if (blockedResults.length > 0) {
            if (onOutputBlocked) {
              onOutputBlocked(blockedResults, guardrailContext, {
                text: accumulatedText,
              });
            }

            if (throwOnBlocked) {
              controller.error(
                new Error(
                  `Output guardrails blocked response: ${blockedResults.map((r) => r.message).join(', ')}`,
                ),
              );
              return;
            }

            // Replace all chunks with blocked message
            controller.enqueue({
              type: 'text-delta',
              id: '1',
              delta: '[Output blocked by guardrails]',
            });
            controller.enqueue({
              type: 'finish',
              finishReason: 'error',
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            });
          } else {
            // Not blocked - replay all chunks
            for (const chunk of blockedChunks) {
              controller.enqueue(chunk);
            }
          }
        },
      });

      return {
        stream: streamResult.stream.pipeThrough(transformStream),
      };
    },
  };
}
