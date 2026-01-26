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
  // ==========================================================================
  // CORE GUARDRAIL TYPES
  // ==========================================================================
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
  // Request context for passing user/session data
  RequestContext,
  // Utility types for metadata inference
  ExtractGuardrailMetadata,
  UnionFromGuardrails,
  InferInputMetadata,
  InferOutputMetadata,
  // Logger interface
  Logger,
  // AI SDK parameter types (derived for convenience)
  GenerateTextParams,
  StreamTextParams,
  EmbedParams,
  // AI SDK result types (derived for convenience)
  GenerateTextResult,
  StreamTextResult,
  EmbedResult,
  // Retry configuration types (v5.0)
  GuardrailRetryConfig,
  RetryInstructionContext,
  RetryInstruction,
  // ==========================================================================
  // UNIFIED AI SDK TYPES (Recommended for public API usage)
  // These types work seamlessly with both V2 and V3 providers
  // Import these from 'ai-sdk-guardrails' or directly from 'ai'
  // ==========================================================================
  LanguageModel,
  LanguageModelMiddleware,
  LanguageModelUsage,
  FinishReason,
  CallWarning,
  ProviderMetadata,
  ToolSet,
  // ==========================================================================
  // V3 PROVIDER TYPES (For advanced middleware implementations)
  // For new code, prefer importing these directly from '@ai-sdk/provider'
  // ==========================================================================
  LanguageModelV3,
  LanguageModelV3Middleware,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
  LanguageModelV3StreamPart,
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
  // Utility functions
  extractContent,
  stringifyContent,
  normalizeUsage,
} from './guardrails/output';

export type { NormalizedUsage } from './guardrails/output';

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
  // Utility functions
  extractTextContent,
  extractMetadata,
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
  ExpectedToolUseMetadata,
  ToolEgressPolicyOptions,
} from './guardrails/tools';

// Retry helpers for advanced customization
export {
  createDefaultBuildRetryParams,
  resolveRetryConfig,
} from './guardrails/retry-helpers';

export type { DefaultBuildRetryParamsOptions } from './guardrails/retry-helpers';

export type {
  McpSecurityOptions,
  McpSecurityMetadata,
} from './guardrails/mcp-security';

export type {
  AllowedToolsOptions,
  LengthLimitOptions,
  BlockedWordsOptions,
  RateLimitingOptions,
  ProfanityCategory,
  ProfanityFilterOptions,
  CustomValidationInput,
  CustomValidationResult,
  CustomValidationOptions,
  PromptInjectionOptions,
  MathHomeworkOptions,
  CodeGenerationMode,
  CodeGenerationOptions,
} from './guardrails/input';

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

// ============================================================================
// DX Enhancement Features
// ============================================================================

// Tool Parameter Validation (pre-execution guardrails)
export {
  withToolParameterGuardrails,
  ToolParameterValidationError,
  // Built-in tool parameter guardrails
  sqlInjectionGuardrail,
  pathTraversalGuardrail,
  parameterLengthGuardrail,
  toolRBACGuardrail,
} from './guardrails/tool-parameters';

export type {
  ToolParameterGuardrail,
  ToolValidationResult,
  ToolValidationContext,
  ToolParameterGuardrailsOptions,
} from './guardrails/tool-parameters';

// Stream Transform Integration (for experimental_transform)
export {
  createGuardrailTransform,
  createPIIRedactionTransform,
  createContentFilterTransform,
  // PII patterns for custom transforms
  PII_PATTERNS,
} from './guardrails/stream-transform';

export type {
  GuardrailTransformOptions,
  ViolationHandler,
  ViolationHandlerResult,
  StreamTransformContext,
  StreamTextTransform,
} from './guardrails/stream-transform';

// Guardrail Composition DSL
export {
  when,
  after,
  withFallback,
  parallel,
  createPipeline,
  not,
  withRetry,
  inputPipeline,
  outputPipeline,
} from './guardrails/composition';

export type {
  ComposableGuardrail,
  GuardrailCondition,
  PipelineResult,
} from './guardrails/composition';

// Gradual Enforcement Mode
export {
  withGradualEnforcement,
  clearViolationHistory,
  getViolationStats,
  // Preset configurations
  warnOnly,
  lenientEscalation,
  strictEscalation,
  withGracePeriod,
} from './guardrails/gradual-enforcement';

export type {
  EnforcementMode,
  EscalationConfig,
  GracePeriodConfig,
  GradualEnforcementOptions,
  ViolationStats,
} from './guardrails/gradual-enforcement';

// Observability & Metrics
export {
  createMetricsCollector,
  createHealthCheck,
  logExecutionSummary,
} from './guardrails/observability';

export type {
  GuardrailMetrics,
  MetricsCollectorOptions,
  AggregatedMetrics,
  GuardrailHealthStatus,
} from './guardrails/observability';

// Debug/Tracing Mode
export {
  createDebugWrapper,
  formatTraceForConsole,
  formatTraceAsJSON,
  formatTraceSummary,
  // Quick debug utilities
  createConsoleDebugger,
  envDebugMode,
} from './guardrails/debug';

export type {
  GuardrailTraceEntry,
  ExecutionTrace,
  DebugOptions,
} from './guardrails/debug';

// Language Model Middleware Factory
export {
  createGuardrailMiddleware,
  createInputGuardrailMiddleware,
  createOutputGuardrailMiddleware,
  createNoOpGuardrailMiddleware,
} from './guardrails/middleware';

export type { GuardrailMiddlewareConfig } from './guardrails/middleware';
