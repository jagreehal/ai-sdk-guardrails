/**
 * Maps the OpenAI guardrails config format (https://guardrails.openai.com) to
 * the `withGuardrails` config format.
 */

import { isObjectLike } from './guardrails/internal';
import { z } from 'zod';
import { defaultRegistry } from './registry';
// Registers the OpenAI guardrail specs in defaultRegistry.
import './openai-guardrails';
import type {
  PipelineConfig,
  GuardrailBundle,
  GuardrailConfig,
  GuardrailContext,
} from './enhanced-types';
import type { InputGuardrail, OutputGuardrail } from './types';
import { defineInputGuardrail, defineOutputGuardrail } from './guardrails';

const textSchema = z.string();

/**
 * Maps OpenAI guardrail config to our internal InputGuardrail format
 */
function mapToInputGuardrail(guardrailConfig: GuardrailConfig): InputGuardrail {
  const spec = defaultRegistry.get(guardrailConfig.name);

  if (!spec) {
    throw new Error(
      `Guardrail "${guardrailConfig.name}" not found in registry. Make sure OpenAI guardrails are registered.`,
    );
  }

  return defineInputGuardrail({
    name: guardrailConfig.name,
    description: spec.description,
    version: spec.metadata?.version || '1.0.0',
    tags: spec.metadata?.tags || [],
    execute: async (params) => {
      let promptText = '';

      const prompt =
        'prompt' in params
          ? textSchema.safeParse(params.prompt).data
          : undefined;

      if (prompt !== undefined) {
        promptText = prompt;
      } else if ('messages' in params && Array.isArray(params.messages)) {
        promptText = params.messages
          .map((msg) => textSchema.safeParse(msg.content).data ?? '')
          .join('\n');
      }

      // Language models expose doGenerate; model id strings and embedding
      // models are left out.
      let llm: GuardrailContext['llm'];

      if ('model' in params) {
        const model = params.model;

        if (isObjectLike(model) && 'doGenerate' in model) {
          llm = model;
        }
      }

      const context: GuardrailContext = {
        llm,
        userId: undefined,
        sessionId: undefined,
        metadata: {},
      };

      const result = await spec.checkFn(
        context,
        promptText,
        guardrailConfig.config,
      );

      return result;
    },
  });
}

/**
 * Maps OpenAI guardrail config to our internal OutputGuardrail format
 */
function mapToOutputGuardrail(
  guardrailConfig: GuardrailConfig,
): OutputGuardrail {
  const spec = defaultRegistry.get(guardrailConfig.name);

  if (!spec) {
    throw new Error(
      `Guardrail "${guardrailConfig.name}" not found in registry. Make sure OpenAI guardrails are registered.`,
    );
  }

  return defineOutputGuardrail({
    name: guardrailConfig.name,
    description: spec.description,
    version: spec.metadata?.version || '1.0.0',
    tags: spec.metadata?.tags || [],
    execute: async (params, accumulatedText = '') => {
      let text = accumulatedText;

      if (!text && 'result' in params) {
        const result = params.result;

        // Stream results expose text as a promise; only a settled string counts.
        const resultText =
          'text' in result ? textSchema.safeParse(result.text).data : undefined;

        if (resultText !== undefined) {
          text = resultText;
        } else if ('object' in result && result.object) {
          text = JSON.stringify(result.object);
        }
      }

      let llm: GuardrailContext['llm'];

      if (params.input && 'model' in params.input) {
        const model = params.input.model;

        if (isObjectLike(model) && 'doGenerate' in model) {
          // SAFETY: an object exposing doGenerate is the LanguageModel the
          // caller passed through on the input context.
          llm = model as GuardrailContext['llm'];
        }
      }

      const context: GuardrailContext = {
        llm,
        userId: undefined,
        sessionId: undefined,
        metadata: {},
      };

      const result = await spec.checkFn(context, text, guardrailConfig.config);

      return result;
    },
  });
}

/** Guardrail arrays for `withGuardrails()`, produced from an OpenAI config. */
export type GuardrailsConfigFromOpenAI = {
  inputGuardrails?: InputGuardrail[];
  outputGuardrails?: OutputGuardrail[];
};

/**
 * Converts an OpenAI PipelineConfig (pre_flight, input, output stages) to the
 * `withGuardrails()` config format. Guardrails missing from the registry are
 * skipped with a console warning.
 *
 * @param openAIConfig - OpenAI guardrails config format
 * @returns Config object compatible with `withGuardrails()` API
 *
 * @example
 * ```typescript
 * import { openai } from '@ai-sdk/openai';
 * import { withGuardrails, mapOpenAIConfigToGuardrails } from 'ai-sdk-guardrails';
 *
 * const openAIConfig = {
 *   version: 1,
 *   input: {
 *     version: 1,
 *     guardrails: [
 *       { name: 'Contains PII', config: { entities: ['EMAIL_ADDRESS'] } }
 *     ]
 *   }
 * };
 *
 * const guardrailsConfig = mapOpenAIConfigToGuardrails(openAIConfig);
 * const model = withGuardrails(openai('gpt-4o'), guardrailsConfig);
 * ```
 */
export function mapOpenAIConfigToGuardrails(
  openAIConfig: PipelineConfig,
): GuardrailsConfigFromOpenAI {
  const inputGuardrails: InputGuardrail[] = [];
  const outputGuardrails: OutputGuardrail[] = [];

  // pre_flight and input both run before the model call, so both become
  // inputGuardrails.
  const inputStages: Array<GuardrailBundle | undefined> = [
    openAIConfig.pre_flight,
    openAIConfig.input,
  ];

  for (const stage of inputStages) {
    if (stage?.guardrails) {
      for (const guardrailConfig of stage.guardrails) {
        try {
          inputGuardrails.push(mapToInputGuardrail(guardrailConfig));
        } catch (error) {
          console.warn(
            `Failed to map input guardrail "${guardrailConfig.name}": ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  if (openAIConfig.output?.guardrails) {
    for (const guardrailConfig of openAIConfig.output.guardrails) {
      try {
        outputGuardrails.push(mapToOutputGuardrail(guardrailConfig));
      } catch (error) {
        console.warn(
          `Failed to map output guardrail "${guardrailConfig.name}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return {
    ...(inputGuardrails.length > 0 && { inputGuardrails }),
    ...(outputGuardrails.length > 0 && { outputGuardrails }),
  };
}
