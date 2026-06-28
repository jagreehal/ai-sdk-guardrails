// =============================================================================
// ai-sdk-guardrails — the opinionated guardrails layer for the AI SDK (v7)
//
// This root entry is intentionally small: the primary API, guardrail authoring,
// the built-in catalog, errors, and core types. Power-user tooling lives behind
// explicit subpaths:
//   - `ai-sdk-guardrails/governance` — SAIF / autotel agent-governance bridge
//   - `ai-sdk-guardrails/config`     — OpenAI-compatible, config-driven runtime
//   - `ai-sdk-guardrails/advanced`   — composition, observability, debug,
//                                      stream transforms, raw middleware, …
// =============================================================================

// ── Primary API ------------------------------------------------------------
export {
  // Wrap a model / agent / tool call
  withGuardrails,
  createGuardrails,
  // Authoring + execution
  defineInputGuardrail,
  defineOutputGuardrail,
  executeInputGuardrails,
  executeOutputGuardrails,
  normalizeGuardrailContext,
} from './guardrails';

// Agent loop wrapper — implemented in (and exported straight from) its own module.
export { agentGuardrails } from './guardrails/agent';

export { createInputGuardrail, createOutputGuardrail } from './core';

// Prompt hardening — wrap a system prompt with defensive rules.
export { hardenSystemPrompt } from './guardrails/harden';
export type { HardenOptions } from './guardrails/harden';

// Prompt-defense evaluation — grade a system prompt's OWASP-LLM coverage.
export { evaluatePromptDefense } from './guardrails/prompt-defense';
export type {
  PromptDefenseOptions,
  PromptDefenseReport,
  PromptDefenseFinding,
} from './guardrails/prompt-defense';

// Tool-call gating via AI SDK v7 `toolApproval`.
export { guardrailApproval } from './guardrails/tool-approval';
export type {
  GuardrailApprovalOptions,
  GuardrailApprovalFunction,
} from './guardrails/tool-approval';

// ── Errors -----------------------------------------------------------------
export {
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

// ── Built-in guardrails: output --------------------------------------------
export {
  minLengthRequirement,
  sensitiveDataFilter,
  blockedContent,
  outputLengthLimit,
  jsonValidation,
  confidenceThreshold,
  toxicityFilter,
  customValidation as customOutputValidation,
  schemaValidation,
  tokenUsageLimit,
  performanceMonitor,
  hallucinationDetector,
  biasDetector,
  factualAccuracyChecker,
  privacyLeakageDetector,
  contentConsistencyChecker,
  complianceChecker,
  secretRedaction,
  unsafeContentDetector,
  costQuotaRails,
  enhancedHallucinationDetector,
  retryAfterIntegration,
  // Content helpers
  extractContent,
  stringifyContent,
  normalizeUsage,
} from './guardrails/output';
export type { NormalizedUsage } from './guardrails/output';

// ── Built-in guardrails: input ---------------------------------------------
export {
  inputLengthLimit,
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
  highEntropyDetector,
  extractTextContent,
  extractMetadata,
} from './guardrails/input';
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
  HighEntropyOptions,
} from './guardrails/input';

// ── Built-in guardrails: tools, MCP, plan-risk, budget ---------------------
export {
  expectedToolUse,
  toolEgressPolicy,
  extractToolNamesFromResult,
} from './guardrails/tools';
export type {
  ExpectedToolUseOptions,
  ExpectedToolUseMetadata,
  ToolEgressPolicyOptions,
} from './guardrails/tools';

export {
  mcpSecurityGuardrail,
  mcpResponseSanitizer,
} from './guardrails/mcp-security';
export type {
  McpSecurityOptions,
  McpSecurityMetadata,
} from './guardrails/mcp-security';

// System-prompt leak detection (output) — the model echoing its own prompt.
export { systemPromptLeakDetector } from './guardrails/prompt-leak';
export type {
  SystemPromptLeakOptions,
  SystemPromptLeakMetadata,
} from './guardrails/prompt-leak';

// MCP tool-definition scanner — supply-chain threats in tool definitions.
export { scanMcpTool, scanMcpTools } from './guardrails/mcp-tool-scan';
export type {
  McpToolDefinition,
  McpToolScanOptions,
  McpScanResult,
  McpThreat,
  McpThreatType,
} from './guardrails/mcp-tool-scan';

// Detection-time normalization options (consumed by the injection detectors).
export type { DetectNormalizationOptions } from './guardrails/normalization';

export {
  planRiskGuardrail,
  builtinPlanRiskClassifier,
} from './guardrails/plan-risk';
export type {
  PlanRiskGuardrailOptions,
  PlanRiskClassifier,
  PlanRiskVerdict,
  PlanRiskMetadata,
  PlanRiskAssessment,
} from './guardrails/plan-risk';

export { budgetGuardrail, createGuardrailBudget } from './guardrails/budget';
export type {
  GuardrailBudget,
  BudgetGuardrailOptions,
  CreateGuardrailBudgetOptions,
  BudgetStep,
  BudgetUsage,
  BudgetState,
  BudgetMetadata,
} from './guardrails/budget';

// ── Tool-parameter guardrail catalog (inputs to `guardrailApproval`) --------
export {
  sqlInjectionGuardrail,
  pathTraversalGuardrail,
  parameterLengthGuardrail,
  toolRBACGuardrail,
} from './guardrails/tool-parameters';
export type {
  ToolParameterGuardrail,
  ToolValidationResult,
  ToolValidationContext,
} from './guardrails/tool-parameters';

// ── Stop conditions (for `agentGuardrails({ stopOnGuardrailViolation })`) ---
export {
  hasCriticalViolation,
  isViolationCount,
  hasViolationSeverity,
  hasGuardrailViolation,
  hasConsecutiveViolations,
  anyOf,
  allOf,
  custom as customStopCondition,
} from './guardrails/stop-conditions';
export type { GuardrailViolation } from './guardrails/stop-conditions';

export type {
  AgentGuardrailsConfig,
  AgentGuardrailsFragments,
} from './guardrails/agent';

// ── Core types -------------------------------------------------------------
export type {
  InputGuardrail,
  OutputGuardrail,
  GuardrailResult,
  GuardrailExecutionSummary,
  GuardrailsParams,
  InputGuardrailsMiddlewareConfig,
  OutputGuardrailsMiddlewareConfig,
  NormalizedGuardrailContext,
  InputGuardrailContext,
  OutputGuardrailContext,
  AIResult,
  RequestContext,
  ExtractGuardrailMetadata,
  UnionFromGuardrails,
  InferInputMetadata,
  InferOutputMetadata,
  Logger,
  GenerateTextParams,
  StreamTextParams,
  EmbedParams,
  GenerateTextResult,
  StreamTextResult,
  EmbedResult,
  GuardrailRetryConfig,
  RetryInstructionContext,
  RetryInstruction,
  // AI SDK native types (re-exported for convenience; or import from 'ai').
  LanguageModel,
  LanguageModelMiddleware,
  LanguageModelUsage,
  FinishReason,
  CallWarning,
  ProviderMetadata,
  ToolSet,
} from './types';
