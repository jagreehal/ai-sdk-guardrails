export {
  createInputGuardrail,
  createOutputGuardrail,
  retry,
  retryHelpers,
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

export type { RetryOptions, RetryAttemptInfo } from './core';

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

// Backoff helpers for retry configurations
export {
  exponentialBackoff,
  linearBackoff,
  fixedBackoff,
  noBackoff,
  compositeBackoff,
  jitteredExponentialBackoff,
  presets as backoffPresets,
} from './backoff';

export type { BackoffOptions } from './backoff';
