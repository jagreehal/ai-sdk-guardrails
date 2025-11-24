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
  GuardrailsInputError,
  GuardrailsOutputError,
  MiddlewareError,
  isGuardrailsError,
  extractErrorInfo,
} from './core';

export type { RetryOptions, RetryAttemptInfo, RetryBuilderArgs } from './core';

export {
  defineInputGuardrail,
  defineOutputGuardrail,
  executeInputGuardrails,
  executeOutputGuardrails,
  normalizeGuardrailContext,
  // Primary API
  withGuardrails,
  createGuardrails,
  withAgentGuardrails,
  // Lower-level middleware functions (for advanced use cases)
  createInputGuardrailsMiddleware,
  createOutputGuardrailsMiddleware,
} from './guardrails';

export type {
  // Core guardrail types
  InputGuardrail,
  OutputGuardrail,
  GuardrailExecutionSummary,
  GuardrailsParams,
  InputGuardrailsMiddlewareConfig,
  OutputGuardrailsMiddlewareConfig,
  NormalizedGuardrailContext,
  // Context types
  InputGuardrailContext,
  OutputGuardrailContext,
  AIResult,
  // Utility types for metadata inference
  ExtractGuardrailMetadata,
  UnionFromGuardrails,
  InferInputMetadata,
  InferOutputMetadata,
  // Logger interface
  Logger,
  // AI SDK parameter types (derived for convenience)
  GenerateTextParams,
  GenerateObjectParams,
  StreamTextParams,
  StreamObjectParams,
  EmbedParams,
  // AI SDK result types (derived for convenience)
  GenerateTextResult,
  GenerateObjectResult,
  StreamTextResult,
  StreamObjectResult,
  EmbedResult,
  // Core AI SDK types needed for guardrails API
  LanguageModelV2,
  LanguageModelV2Middleware,
  LanguageModelV2CallOptions,
  LanguageModelV2StreamPart,
} from './types';

// Telemetry types for OpenTelemetry integration
export type { GuardrailTelemetrySettings } from './telemetry/types';

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

// Built-in guardrails
export {
  // Output guardrails
  minLengthRequirement,
  sensitiveDataFilter,
  blockedContent,
  outputLengthLimit,
  jsonValidation,
  confidenceThreshold,
  toxicityFilter,
  customValidation,
  schemaValidation,
  tokenUsageLimit,
  performanceMonitor,
  hallucinationDetector,
  biasDetector,
  factualAccuracyChecker,
  privacyLeakageDetector,
  contentConsistencyChecker,
  complianceChecker,
  // New advanced guardrails
  secretRedaction,
  unsafeContentDetector,
  costQuotaRails,
  enhancedHallucinationDetector,
  retryAfterIntegration,
} from './guardrails/output';

export {
  // Input guardrails
  lengthLimit as inputLengthLimit,
  blockedWords,
  contentLengthLimit,
  blockedKeywords,
  rateLimiting,
  profanityFilter,
  customValidation as customInputValidation,
  promptInjectionDetector,
  piiDetector,
  toxicityDetector,
  mathHomeworkDetector,
  codeGenerationLimiter,
  allowedToolsGuardrail,
} from './guardrails/input';

export {
  // Tool guardrails
  expectedToolUse,
  toolEgressPolicy,
} from './guardrails/tools';

export {
  // MCP Security guardrails
  mcpSecurityGuardrail,
  mcpResponseSanitizer,
} from './guardrails/mcp-security';

export type {
  ExpectedToolUseOptions,
  ToolEgressPolicyOptions,
} from './guardrails/tools';

export type {
  McpSecurityOptions,
  McpSecurityMetadata,
} from './guardrails/mcp-security';

export type { AllowedToolsOptions } from './guardrails/input';

// Stop condition helpers for agent guardrails
export {
  criticalViolationDetected,
  violationCountIs,
  violationSeverityIs,
  specificGuardrailViolated,
  consecutiveViolations,
  anyOf,
  allOf,
  custom as customStopCondition,
} from './guardrails/stop-conditions';

export type { GuardrailViolation } from './guardrails/stop-conditions';

// Agent guardrails types
export type {
  AgentGuardrailsRetry,
  AgentGuardrailsConfig,
} from './guardrails/agent';

// Abort controller for guardrail-based stopping
export {
  createGuardrailAbortController,
  GuardrailViolationAbort,
} from './guardrails/abort-controller';

// Stream transforms for efficient guardrail checking
export {
  createGuardrailStreamTransform,
  createGuardrailStreamTransformBuffered,
} from './guardrails/streaming';

export type { GuardrailStreamTransformOptions } from './guardrails/streaming';

// Token-level streaming control
export {
  createTokenBudgetTransform,
  createTokenAwareGuardrailTransform,
  estimateTokenCount,
} from './guardrails/token-control';

export type {
  TokenBudgetOptions,
  TokenAwareGuardrailOptions,
} from './guardrails/token-control';

// Multi-step guardrail-aware prepareStep
export {
  createGuardrailPrepareStep,
  createAdaptivePrepareStep,
} from './guardrails/prepare-step';

export type {
  GuardrailPrepareStepOptions,
  AdaptivePrepareStepOptions,
} from './guardrails/prepare-step';

// Tool execution abortion
export {
  wrapToolWithAbortion,
  createToolAbortionController,
} from './guardrails/tool-abortion';

export type {
  ToolAbortionControllerOptions,
  WrapToolWithAbortionOptions,
} from './guardrails/tool-abortion';

// Finish reason customization and provider metadata
export {
  getGuardrailFinishReason,
  createGuardrailProviderMetadata,
  createFinishReasonEnhancement,
} from './guardrails/finish-reason';

export type {
  FinishReasonOptions,
  ProviderMetadataOptions,
} from './guardrails/finish-reason';

// OpenAI-compatible guardrails (auto-registered on import)
import './openai-guardrails';

// Export OpenAI config types and runtime
export type {
  GuardrailConfig,
  GuardrailBundle,
  PipelineConfig,
  GuardrailBundleResult,
  GuardrailContext,
} from './enhanced-types';

// Re-export GuardrailResult from enhanced-types (OpenAI-compatible)
// Note: This is the same as the one from types.ts but with OpenAI-compatible info structure
export type { GuardrailResult } from './enhanced-types';

export {
  loadPipelineConfig,
  loadGuardrailBundle,
  validatePipelineConfig,
  runGuardrails,
  runStageGuardrails,
  checkPlainText,
  instantiateGuardrails,
  configUtils,
  runtimeUtils,
} from './enhanced-runtime';

export { defaultRegistry, GuardrailRegistry, createRegistry } from './registry';
export { GuardrailSpec, ConfiguredGuardrail } from './spec';

// Config mapper for converting OpenAI config format to our internal convention
export {
  mapOpenAIConfigToGuardrails,
  type GuardrailsConfigFromOpenAI,
} from './config-mapper';
