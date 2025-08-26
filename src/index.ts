export {
  createInputGuardrail,
  createOutputGuardrail,
  GuardrailsError,
  GuardrailValidationError,
  GuardrailExecutionError,
  GuardrailTimeoutError,
  GuardrailConfigurationError,
  InputBlockedError,
  OutputBlockedError,
  MiddlewareError,
  isGuardrailsError,
  extractErrorInfo,
} from './core';

export {
  defineInputGuardrail,
  defineOutputGuardrail,
  executeInputGuardrails,
  executeOutputGuardrails,
  normalizeGuardrailContext,
  // AI SDK 5 Helper Functions (Recommended API)
  wrapWithInputGuardrails,
  wrapWithOutputGuardrails,
  wrapWithGuardrails,
  // Lower-level middleware functions (for advanced use cases)
  createInputGuardrailsMiddleware,
  createOutputGuardrailsMiddleware,
} from './guardrails';

export type {
  InputGuardrail,
  OutputGuardrail,
  GuardrailResult,
  GuardrailsParams,
  InputGuardrailsMiddlewareConfig,
  OutputGuardrailsMiddlewareConfig,
  NormalizedGuardrailContext,
  // Re-export AI SDK types for convenience
  LanguageModelV2,
  LanguageModelV2Middleware,
  LanguageModelV2CallOptions,
  LanguageModelV2StreamPart,
} from './types';
