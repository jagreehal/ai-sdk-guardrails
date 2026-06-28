import { wrapLanguageModel } from 'ai';
import {
  ENABLE_PERFORMANCE_TRACKING,
  createConditionalContext,
  guardrailErrorResult,
} from './guardrails/internal';
import {
  inputGuardrailsMiddleware,
  outputGuardrailsMiddleware,
} from './guardrails/middleware-factories';
import type {
  InputGuardrail,
  OutputGuardrail,
  GuardrailResult,
  LanguageModel,
  LanguageModelV4,
  LanguageModelV4Middleware,
  InputGuardrailsMiddlewareConfig,
  OutputGuardrailsMiddlewareConfig,
} from './types';

// ── Re-exports -------------------------------------------------------------
// The execution engine + context helpers live in ./guardrails/internal and the
// V4 middleware factories in ./guardrails/middleware-factories; both are part of
// this module's public surface, re-exported here so the import path is stable.
export {
  executeInputGuardrails,
  executeOutputGuardrails,
  normalizeGuardrailContext,
  toNormalizedGuardrailContext,
} from './guardrails/internal';
export { inputGuardrailsMiddleware, outputGuardrailsMiddleware };

// ============================================================================
// CORE GUARDRAIL FUNCTIONS
// ============================================================================

/**
 * Runs an authored guardrail body with the standard envelope: optional timing,
 * automatic context metadata, and uniform error capture. Shared by
 * {@link defineInputGuardrail} and {@link defineOutputGuardrail}, whose only
 * difference is the (differently typed) `execute` signature they forward to.
 */
async function runWithEnvelope<M extends Record<string, unknown>>(
  name: string,
  version: string | undefined,
  run: () => GuardrailResult<M> | Promise<GuardrailResult<M>>,
): Promise<GuardrailResult<M>> {
  const startTime = ENABLE_PERFORMANCE_TRACKING ? Date.now() : 0;
  try {
    const result = await run();
    const executionTime = ENABLE_PERFORMANCE_TRACKING
      ? Date.now() - startTime
      : undefined;
    return {
      ...result,
      context: createConditionalContext(
        name,
        version,
        executionTime,
        result.context,
      ),
    };
  } catch (error) {
    const executionTime = ENABLE_PERFORMANCE_TRACKING
      ? Date.now() - startTime
      : undefined;
    return guardrailErrorResult<M>(name, error, {
      context: createConditionalContext(name, version, executionTime),
    });
  }
}

/**
 * Creates a well-structured input guardrail with enhanced metadata
 * @param guardrail - The guardrail configuration
 * @returns Enhanced input guardrail with automatic metadata injection
 */
export function defineInputGuardrail<
  M extends Record<string, unknown> = Record<string, unknown>,
>(guardrail: InputGuardrail<M>): InputGuardrail<M> {
  const originalExecute = guardrail.execute;
  return {
    enabled: true,
    priority: 'medium',
    version: '1.0.0',
    tags: [],
    ...guardrail,
    execute: (params, options) =>
      runWithEnvelope(guardrail.name, guardrail.version, () =>
        options === undefined
          ? originalExecute(params)
          : originalExecute(params, options),
      ),
  };
}

/**
 * Creates a well-structured output guardrail with enhanced metadata
 * @param guardrail - The guardrail configuration
 * @returns Enhanced output guardrail with automatic metadata injection
 */
export function defineOutputGuardrail<
  M extends Record<string, unknown> = Record<string, unknown>,
>(guardrail: OutputGuardrail<M>): OutputGuardrail<M> {
  const originalExecute = guardrail.execute;
  return {
    enabled: true,
    priority: 'medium',
    version: '1.0.0',
    tags: [],
    ...guardrail,
    execute: (params, options) =>
      runWithEnvelope(guardrail.name, guardrail.version, () =>
        options === undefined
          ? originalExecute(params)
          : originalExecute(params, options),
      ),
  };
}

// ============================================================================
// MODEL WRAPPING
// ============================================================================

/**
 * Configuration shared by {@link withGuardrails} and {@link createGuardrails}.
 * The model itself is supplied separately by `withGuardrails`.
 */
export interface GuardrailModelConfig<
  MIn extends Record<string, unknown> = Record<string, unknown>,
  MOut extends Record<string, unknown> = Record<string, unknown>,
> {
  inputGuardrails?: InputGuardrail<MIn>[];
  outputGuardrails?: OutputGuardrail<MOut>[];
  throwOnBlocked?: boolean;
  replaceOnBlocked?: boolean;
  streamMode?: 'buffer' | 'progressive';
  stopOnGuardrailViolation?: OutputGuardrailsMiddlewareConfig<MOut>['stopOnGuardrailViolation'];
  executionOptions?: InputGuardrailsMiddlewareConfig<MIn>['executionOptions'];
  onInputBlocked?: InputGuardrailsMiddlewareConfig<MIn>['onInputBlocked'];
  onOutputBlocked?: OutputGuardrailsMiddlewareConfig<MOut>['onOutputBlocked'];
  retry?: OutputGuardrailsMiddlewareConfig<MOut>['retry'];
}

// ============================================================================
// PRIMARY API FUNCTIONS (RECOMMENDED)
// ============================================================================

/**
 * Primary guardrails API - wraps a language model with input and/or output guardrails
 *
 * This is the main entry point for applying guardrails to AI models. Use this decorator-like
 * function for most use cases.
 *
 * @param config - The model to wrap plus input/output guardrail configuration
 * @returns Wrapped language model with guardrails applied
 *
 * @example
 * ```typescript
 * import { openai } from '@ai-sdk/openai';
 * import { withGuardrails } from 'ai-sdk-guardrails';
 * import { piiDetector } from 'ai-sdk-guardrails/guardrails/input';
 * import { minLength } from 'ai-sdk-guardrails/guardrails/output';
 *
 * const guardedModel = withGuardrails({
 *   model: openai('gpt-4o'),
 *   inputGuardrails: [piiDetector()],
 *   outputGuardrails: [minLength(100)],
 *   throwOnBlocked: true,
 * });
 * ```
 */
export function withGuardrails<
  MIn extends Record<string, unknown> = Record<string, unknown>,
  MOut extends Record<string, unknown> = Record<string, unknown>,
>(
  config: GuardrailModelConfig<MIn, MOut> & {
    /** The language model to wrap. */
    model: LanguageModel;
  },
): LanguageModel {
  const {
    model,
    inputGuardrails = [],
    outputGuardrails = [],
    throwOnBlocked,
    replaceOnBlocked,
    streamMode,
    stopOnGuardrailViolation,
    executionOptions,
    onInputBlocked,
    onOutputBlocked,
    retry,
  } = config;

  const middlewares: LanguageModelV4Middleware[] = [];

  if (inputGuardrails.length > 0) {
    middlewares.push(
      inputGuardrailsMiddleware({
        inputGuardrails,
        throwOnBlocked,
        executionOptions,
        onInputBlocked,
      }),
    );
  }

  if (outputGuardrails.length > 0) {
    middlewares.push(
      outputGuardrailsMiddleware({
        outputGuardrails,
        throwOnBlocked,
        replaceOnBlocked,
        streamMode,
        stopOnGuardrailViolation,
        executionOptions,
        onOutputBlocked,
        retry,
      }),
    );
  }

  // If no guardrails provided, return the original model unchanged.
  if (middlewares.length === 0) {
    return model;
  }

  return wrapLanguageModel({
    model: model as unknown as LanguageModelV4,
    middleware: middlewares as unknown as LanguageModelV4Middleware[],
  }) as LanguageModel;
}

/**
 * Creates a reusable guardrails configuration factory
 *
 * Use this factory when you want to apply the same guardrails configuration to multiple
 * models, or when building composable guardrail systems.
 *
 * @param config - Configuration for both input and output guardrails
 * @returns Function that accepts a model and returns a wrapped model
 *
 * @example
 * ```typescript
 * import { openai } from '@ai-sdk/openai';
 * import { anthropic } from '@ai-sdk/anthropic';
 * import { createGuardrails } from 'ai-sdk-guardrails';
 * import { piiDetector } from 'ai-sdk-guardrails/guardrails/input';
 * import { qualityCheck } from 'ai-sdk-guardrails/guardrails/output';
 *
 * // Create reusable guardrails configuration
 * const productionGuards = createGuardrails({
 *   inputGuardrails: [piiDetector()],
 *   outputGuardrails: [qualityCheck()],
 *   throwOnBlocked: true,
 * });
 *
 * // Apply to multiple models
 * const gpt4 = productionGuards(openai('gpt-4o'));
 * const claude = productionGuards(anthropic('claude-3-sonnet'));
 *
 * // Compose multiple guardrail sets
 * const strictLimits = createGuardrails({ inputGuardrails: [maxLength(500)] });
 * const piiProtection = createGuardrails({ inputGuardrails: [piiDetector()] });
 * const model = piiProtection(strictLimits(openai('gpt-4o')));
 * ```
 */
export function createGuardrails<
  MIn extends Record<string, unknown> = Record<string, unknown>,
  MOut extends Record<string, unknown> = Record<string, unknown>,
>(config: GuardrailModelConfig<MIn, MOut>) {
  return (model: LanguageModel): LanguageModel =>
    withGuardrails({ model, ...config });
}
