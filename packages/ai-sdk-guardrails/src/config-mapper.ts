/**
 * Configuration mapper for converting between OpenAI config format and our internal convention
 *
 * This module provides utilities to map from OpenAI's guardrails config format
 * (used at https://guardrails.openai.com) to our internal `withGuardrails` API format.
 * This enables public-facing APIs to accept OpenAI configs while using our internal conventions.
 */

import { defaultRegistry } from './registry';
// Ensure OpenAI guardrails are registered
import './openai-guardrails';
import type {
  PipelineConfig,
  GuardrailBundle,
  GuardrailConfig,
  GuardrailContext,
} from './enhanced-types';
import type { InputGuardrail, OutputGuardrail } from './types';
import { defineInputGuardrail, defineOutputGuardrail } from './guardrails';

/**
 * Maps OpenAI guardrail config to our internal InputGuardrail format
 */
function mapToInputGuardrail(
  guardrailConfig: GuardrailConfig,
): InputGuardrail<Record<string, unknown>> {
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
      // Extract prompt text from various input context types
      let promptText = '';
      if ('prompt' in params && typeof params.prompt === 'string') {
        promptText = params.prompt;
      } else if ('messages' in params && Array.isArray(params.messages)) {
        // Extract text from messages array
        promptText = params.messages
          .map((msg) => (typeof msg.content === 'string' ? msg.content : ''))
          .join('\n');
      }

      // Build context for OpenAI guardrails
      // Extract model if available (only LanguageModelV2, not EmbeddingModelV2)
      let llm: GuardrailContext['llm'] = undefined;
      if ('model' in params) {
        const model = params.model;
        // Only use if it's a LanguageModelV2 (has doGenerate method)
        if (model && typeof model === 'object' && 'doGenerate' in model) {
          llm = model as GuardrailContext['llm'];
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
): OutputGuardrail<Record<string, unknown>> {
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
    execute: async (params, accumulatedText) => {
      // Extract text from result or use accumulated text
      let text = accumulatedText || '';
      if (!text && 'result' in params) {
        const result = params.result;
        if ('text' in result && typeof result.text === 'string') {
          text = result.text;
        } else if ('object' in result && result.object) {
          text = JSON.stringify(result.object);
        }
      }

      // Build context for OpenAI guardrails
      // Extract model from input context if available
      let llm: GuardrailContext['llm'] = undefined;
      if (params.input && 'model' in params.input) {
        const model = params.input.model;
        // Only use if it's a LanguageModelV2 (has doGenerate method)
        if (model && typeof model === 'object' && 'doGenerate' in model) {
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

/**
 * Converts OpenAI PipelineConfig format to our internal `withGuardrails` config format
 *
 * This function maps from OpenAI's config structure (with pre_flight, input, output stages)
 * to our internal format that can be used with `withGuardrails()`.
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
export function mapOpenAIConfigToGuardrails(openAIConfig: PipelineConfig): {
  inputGuardrails?: InputGuardrail<Record<string, unknown>>[];
  outputGuardrails?: OutputGuardrail<Record<string, unknown>>[];
} {
  const inputGuardrails: InputGuardrail<Record<string, unknown>>[] = [];
  const outputGuardrails: OutputGuardrail<Record<string, unknown>>[] = [];

  // Map pre_flight and input stages to inputGuardrails
  // Note: pre_flight guardrails are typically run before input, but for withGuardrails
  // we combine them into inputGuardrails since they both run before the model call
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

  // Map output stage to outputGuardrails
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
    ...(inputGuardrails.length > 0 ? { inputGuardrails } : {}),
    ...(outputGuardrails.length > 0 ? { outputGuardrails } : {}),
  };
}

/**
 * Type helper for the result of mapOpenAIConfigToGuardrails
 */
export type GuardrailsConfigFromOpenAI = ReturnType<
  typeof mapOpenAIConfigToGuardrails
>;
