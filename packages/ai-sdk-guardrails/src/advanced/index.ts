/**
 * `ai-sdk-guardrails/advanced` — power-user composition and operational tooling
 * that sits on top of the core guardrails. None of this is needed for the common
 * path (`withGuardrails` / `agentGuardrails` / `guardrailApproval` at the root);
 * import from here when you need to compose, observe, debug, transform streams,
 * or drop down to the raw middleware.
 */

// ── Advanced prompt-injection detectors ------------------------------------
// Heavier, multi-signal variants of the root `promptInjectionDetector()`.
export {
  enhancedPromptInjectionDetector,
  incrementalPromptInjectionDetector,
  toolCallInjectionDetector,
  intentBasedInjectionDetector,
} from '../guardrails/enhanced-prompt-injection';

// ── Detection-time normalization (anti-evasion preprocessing) --------------
// The injection detectors apply this by default; exported for standalone use
// (e.g. normalizing text before your own custom guardrail matches it).
export {
  normalizeForDetection,
  resolveDetectNormalization,
  DEFAULT_DETECT_NORMALIZATION,
} from '../guardrails/normalization';
export type { ResolvedDetectNormalizationOptions } from '../guardrails/normalization';

// ── System-prompt leak detection (standalone) ------------------------------
// The `systemPromptLeakDetector()` output guardrail lives at the root; this is
// the pure verdict-only function behind it.
export { detectSystemPromptLeak } from '../guardrails/prompt-leak';
export type { SystemPromptLeakResult } from '../guardrails/prompt-leak';

// ── Lower-level middleware -------------------------------------------------
export {
  inputGuardrailsMiddleware,
  outputGuardrailsMiddleware,
} from '../guardrails';

// V4 provider types for authoring custom middleware by hand. Prefer importing
// these from '@ai-sdk/provider' directly; re-exported here for convenience
// alongside the raw middleware factories above.
export type {
  LanguageModelV4,
  LanguageModelV4Middleware,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamResult,
  LanguageModelV4StreamPart,
} from '../types';

export {
  guardrailMiddleware,
  noopGuardrailMiddleware,
} from '../guardrails/middleware';
export type { GuardrailMiddlewareConfig } from '../guardrails/middleware';

// ── Composition DSL --------------------------------------------------------
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
} from '../guardrails/composition';
export type {
  ComposableGuardrail,
  GuardrailCondition,
  PipelineResult,
} from '../guardrails/composition';

// ── Gradual enforcement (rollouts) -----------------------------------------
export {
  withGradualEnforcement,
  clearViolationHistory,
  getViolationStats,
  warnOnly,
  lenientEscalation,
  strictEscalation,
  withGracePeriod,
} from '../guardrails/gradual-enforcement';
export type {
  EnforcementMode,
  EscalationConfig,
  GracePeriodConfig,
  GradualEnforcementOptions,
  ViolationStats,
} from '../guardrails/gradual-enforcement';

// ── Observability & metrics ------------------------------------------------
export {
  createMetricsCollector,
  createHealthCheck,
  logExecutionSummary,
} from '../guardrails/observability';
export type {
  GuardrailMetrics,
  MetricsCollectorOptions,
  AggregatedMetrics,
  GuardrailHealthStatus,
} from '../guardrails/observability';

// ── Debug / tracing --------------------------------------------------------
export {
  createDebugWrapper,
  formatTraceForConsole,
  formatTraceAsJSON,
  formatTraceSummary,
  createConsoleDebugger,
  envDebugMode,
} from '../guardrails/debug';
export type {
  GuardrailTraceEntry,
  ExecutionTrace,
  DebugOptions,
} from '../guardrails/debug';

// ── Stream transforms ------------------------------------------------------
export {
  createGuardrailStreamTransform,
  createGuardrailStreamTransformBuffered,
} from '../guardrails/streaming';
export type { GuardrailStreamTransformOptions } from '../guardrails/streaming';

export {
  createTokenBudgetTransform,
  createTokenAwareGuardrailTransform,
  estimateTokenCount,
} from '../guardrails/token-control';
export type {
  TokenBudgetOptions,
  TokenAwareGuardrailOptions,
} from '../guardrails/token-control';

export {
  createGuardrailTransform,
  createPIIRedactionTransform,
  createContentFilterTransform,
  PII_PATTERNS,
} from '../guardrails/stream-transform';
export type {
  GuardrailTransformOptions,
  ViolationHandler,
  ViolationHandlerResult,
  StreamTransformContext,
  StreamTextTransform,
} from '../guardrails/stream-transform';

// ── Multi-step / agent-loop helpers ----------------------------------------
export {
  createGuardrailPrepareStep,
  createAdaptivePrepareStep,
} from '../guardrails/prepare-step';
export type {
  GuardrailPrepareStepOptions,
  AdaptivePrepareStepOptions,
} from '../guardrails/prepare-step';

export {
  wrapToolWithAbortion,
  createToolAbortionController,
} from '../guardrails/tool-abortion';
export type {
  ToolAbortionControllerOptions,
  WrapToolWithAbortionOptions,
} from '../guardrails/tool-abortion';

export {
  createGuardrailAbortController,
  GuardrailViolationAbort,
} from '../guardrails/abort-controller';

// ── Finish-reason / provider metadata --------------------------------------
export {
  getGuardrailFinishReason,
  createGuardrailProviderMetadata,
  createFinishReasonEnhancement,
} from '../guardrails/finish-reason';
export type {
  FinishReasonOptions,
  ProviderMetadataOptions,
} from '../guardrails/finish-reason';

// ── Pre-execution tool-parameter wrapper -----------------------------------
// (For tool gating, prefer the root `guardrailApproval([...])` → native
// `toolApproval`. This wrapper is the lower-level execute()-wrapping form.)
export {
  withToolParameterGuardrails,
  ToolParameterValidationError,
} from '../guardrails/tool-parameters';
export type { ToolParameterGuardrailsOptions } from '../guardrails/tool-parameters';

// ── Retry / backoff helpers ------------------------------------------------
export {
  createDefaultBuildRetryParams,
  resolveRetryConfig,
} from '../guardrails/retry-helpers';
export type { DefaultBuildRetryParamsOptions } from '../guardrails/retry-helpers';

export {
  exponentialBackoff,
  linearBackoff,
  fixedBackoff,
  noBackoff,
  compositeBackoff,
  jitteredExponentialBackoff,
  presets as backoffPresets,
} from '../backoff';
export type { BackoffOptions } from '../backoff';
