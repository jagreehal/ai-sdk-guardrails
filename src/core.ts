import {
  generateText,
  generateObject,
  streamText,
  streamObject,
  embed,
} from 'ai';

import type {
  StreamTextParams,
  StreamObjectParams,
  EmbedParams,
  OutputGuardrailContext,
  InputGuardrailContext,
  GuardrailsParams,
} from './types';

export type { InputGuardrail, OutputGuardrail } from './types';

export class GuardrailError extends Error {
  public issues: Array<{
    guardrail: string;
    message: string;
    metadata?: Record<string, unknown>;
  }>;

  constructor(
    public guardrailName: string,
    public reason: string,
    public type: 'input' | 'output',
  ) {
    super(`${type} guardrail '${guardrailName}' blocked: ${reason}`);
    this.name = 'GuardrailError';
    this.issues = [{ guardrail: guardrailName, message: reason }];
  }

  getSummary() {
    return {
      totalIssues: this.issues.length,
      guardrailsTriggered: this.issues.map((i) => i.guardrail),
      type: this.type,
    };
  }
}

// ============================================================================
// CORE GUARDRAIL EXECUTION
// ============================================================================

async function runInputGuardrails(
  guardrails: import('./types').InputGuardrail[] = [],
  context: InputGuardrailContext,
): Promise<void> {
  for (const guardrail of guardrails) {
    const result = await guardrail.execute(context);
    if (result.tripwireTriggered) {
      throw new GuardrailError(
        guardrail.name,
        result.message || 'Input blocked',
        'input',
      );
    }
  }
}

async function runOutputGuardrails(
  guardrails: import('./types').OutputGuardrail[] = [],
  context: OutputGuardrailContext,
  accumulatedText?: string,
): Promise<void> {
  for (const guardrail of guardrails) {
    const result = await guardrail.execute(context, accumulatedText);
    if (result.tripwireTriggered) {
      throw new GuardrailError(
        guardrail.name,
        result.message || 'Output blocked',
        'output',
      );
    }
  }
}

// ============================================================================
// CORE GUARDED AI SDK FUNCTIONS
// ============================================================================

export async function generateTextWithGuardrails(
  params: Parameters<typeof generateText>[0],
  guardrailParams: GuardrailsParams,
) {
  const { inputGuardrails, outputGuardrails } = guardrailParams;
  const startTime = Date.now();

  // Determine which guardrails to use
  const finalInputGuardrails = inputGuardrails;
  const finalOutputGuardrails = outputGuardrails;

  try {
    // Run input guardrails with rich context
    await runInputGuardrails(finalInputGuardrails, params);
  } catch (error) {
    if (error instanceof GuardrailError && guardrailParams.onInputBlocked) {
      guardrailParams.onInputBlocked(error);
      if (guardrailParams.throwOnBlocked !== false) {
        throw error;
      }
      return generateText(params);
    }
    throw error;
  }

  // Call AI SDK function
  const result = await generateText(params);
  const generationTimeMs = Date.now() - startTime;

  try {
    // Run output guardrails with rich context
    await runOutputGuardrails(finalOutputGuardrails, {
      input: params,
      result,
    });
  } catch (error) {
    if (error instanceof GuardrailError && guardrailParams.onOutputBlocked) {
      guardrailParams.onOutputBlocked(error);
      if (guardrailParams.throwOnBlocked !== false) {
        throw error;
      }
      return { ...result, text: '' };
    }
    throw error;
  }

  return result;
}

export async function generateObjectWithGuardrails(
  params: Parameters<typeof generateObject>[0],
  guardrailParams: GuardrailsParams,
): Promise<ReturnType<typeof generateObject>> {
  const { inputGuardrails, outputGuardrails } = guardrailParams;
  const startTime = Date.now();

  // Determine which guardrails to use
  const finalInputGuardrails = inputGuardrails;
  const finalOutputGuardrails = outputGuardrails;

  try {
    // Run input guardrails with rich context
    await runInputGuardrails(finalInputGuardrails, params);
  } catch (error) {
    if (error instanceof GuardrailError && guardrailParams.onInputBlocked) {
      guardrailParams.onInputBlocked(error);
      if (guardrailParams.throwOnBlocked !== false) {
        throw error;
      }
      return generateObject(params);
    }
    throw error;
  }

  // Call AI SDK function
  const result = await generateObject(params);

  try {
    // Run output guardrails with rich context
    await runOutputGuardrails(finalOutputGuardrails, {
      input: params,
      result,
    });
  } catch (error) {
    if (error instanceof GuardrailError && guardrailParams.onOutputBlocked) {
      guardrailParams.onOutputBlocked(error);
      if (guardrailParams.throwOnBlocked !== false) {
        throw error;
      }
      return { ...result, object: null };
    }
    throw error;
  }

  return result;
}

export async function streamTextWithGuardrails(
  params: StreamTextParams,
  guardrailParams: GuardrailsParams,
): Promise<ReturnType<typeof streamText>> {
  const { inputGuardrails, outputGuardrails } = guardrailParams;

  // Determine which guardrails to use
  const finalInputGuardrails = inputGuardrails;
  const finalOutputGuardrails = outputGuardrails;

  try {
    // Run input guardrails with rich context
    await runInputGuardrails(finalInputGuardrails, params);
  } catch (error) {
    if (error instanceof GuardrailError && guardrailParams.onInputBlocked) {
      guardrailParams.onInputBlocked(error);
      if (guardrailParams.throwOnBlocked !== false) {
        throw error;
      }
    }
    throw error;
  }

  // Call AI SDK function
  const result = await streamText(params);

  // If no output guardrails, return original result
  if (!finalOutputGuardrails) {
    return result;
  }

  // Create a transformed stream that checks guardrails on each chunk
  let accumulatedText = '';

  const transformedStream = new ReadableStream({
    start(controller) {
      const reader = result.textStream.getReader();

      const processChunk = async () => {
        try {
          const { done, value } = await reader.read();

          if (done) {
            controller.close();
            return;
          }

          // Add new chunk to accumulated text
          accumulatedText += value;

          // Check output guardrails on accumulated text
          try {
            await runOutputGuardrails(
              finalOutputGuardrails,
              {
                input: params,
                result,
              },
              accumulatedText,
            );

            // If guardrails pass, enqueue the chunk
            controller.enqueue(value);

            // Continue processing
            processChunk();
          } catch (error) {
            if (error instanceof GuardrailError) {
              if (guardrailParams.onOutputBlocked) {
                guardrailParams.onOutputBlocked(error);
              }
              if (guardrailParams.throwOnBlocked !== false) {
                controller.error(error);
                return;
              }
            } else {
              controller.error(error);
              return;
            }
          }
        } catch (error) {
          controller.error(error);
        }
      };

      processChunk();
    },
  });

  // Return modified result with transformed stream
  return {
    ...result,
    textStream: transformedStream,
  };
}

export async function streamObjectWithGuardrails(
  params: StreamObjectParams,
  guardrailParams: GuardrailsParams,
): Promise<ReturnType<typeof streamObject>> {
  const { inputGuardrails } = guardrailParams;

  // Run input guardrails with rich context
  await runInputGuardrails(inputGuardrails, params);

  // Call AI SDK function
  const result = await streamObject(params);

  return result;
}

export async function embedWithGuardrails(
  params: EmbedParams,
  guardrailParams: GuardrailsParams,
) {
  const { inputGuardrails } = guardrailParams;

  // Run input guardrails (value is the input)
  await runInputGuardrails(inputGuardrails, params);

  // Call AI SDK function
  const result = await embed(params);

  return result;
}

// ============================================================================
// HELPER FUNCTIONS TO CREATE GUARDRAILS
// ============================================================================

export function createInputGuardrail(
  name: string,
  description: string,
  execute: import('./types').InputGuardrail['execute'],
): import('./types').InputGuardrail {
  return { name, description, execute };
}

export function createOutputGuardrail(
  name: string,
  execute: import('./types').OutputGuardrail['execute'],
): import('./types').OutputGuardrail {
  return { name, execute };
}
