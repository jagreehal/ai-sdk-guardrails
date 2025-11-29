# ai-sdk-guardrails

## 5.3.0

### Minor Changes

- 40c23fd: Added utility functions and type exports from guardrail modules to improve developer experience and enable better custom guardrail creation.

  **New utility function exports:**
  - `extractContent` - Extract content from AI result objects
  - `stringifyContent` - Stringify content for streaming-aware processing
  - `normalizeUsage` - Normalize usage metrics from different providers
  - `extractTextContent` - Extract text content from input guardrail context
  - `extractMetadata` - Extract metadata from input guardrail context

  **New type exports:**
  - `NormalizedUsage` - Type for normalized usage metrics
  - `LengthLimitOptions` - Options for input length limit guardrail
  - `BlockedWordsOptions` - Options for blocked words guardrail
  - `RateLimitingOptions` - Options for rate limiting guardrail
  - `ProfanityCategory` - Type for profanity categories
  - `ProfanityFilterOptions` - Options for profanity filter guardrail
  - `CustomValidationInput` - Input type for custom validation functions
  - `CustomValidationResult` - Result type for custom validation functions
  - `CustomValidationOptions` - Options for custom validation guardrail
  - `PromptInjectionOptions` - Options for prompt injection detector
  - `MathHomeworkOptions` - Options for math homework detector
  - `CodeGenerationMode` - Type for code generation limiter modes
  - `CodeGenerationOptions` - Options for code generation limiter

  These exports enable developers to:
  - Reuse the same content extraction logic used by built-in guardrails
  - Build custom guardrails with proper type safety
  - Access configuration types for better IDE autocomplete and type checking

## 5.2.0

### Minor Changes

- 564a331: Add simplified retry UX with context-aware retry instructions. Guardrails can now implement `getRetryInstruction()` to provide intelligent retry prompts, and users can configure retry at the guardrail level with just `retry: { maxRetries: 2 }` instead of writing complex `buildRetryParams` functions. The library automatically uses guardrail-specific retry instructions when available, falling back to sensible defaults.

## 5.1.0

### Minor Changes

- bbe8342: Add advanced guardrail features for streaming control, token management, and execution abortion:
  - **Streaming transforms**: `createGuardrailStreamTransform` for real-time guardrail checking during streaming
  - **Token-level control**: `createTokenBudgetTransform` and `createTokenAwareGuardrailTransform` for token budget management
  - **Abort controllers**: `createGuardrailAbortController` for canceling operations on violations
  - **Tool abortion**: `wrapToolWithAbortion` and `createToolAbortionController` for aborting tool execution
  - **Prepare steps**: `createGuardrailPrepareStep` and `createAdaptivePrepareStep` for agent step preparation
  - **Finish reason enhancement**: `createFinishReasonEnhancement` for proper finish reason mapping

  Add 7 new examples (53-59) demonstrating these features. Fix linting and type errors throughout the codebase.

  ## Documentation
  - Set up automated GitHub Pages deployment with GitHub Actions workflow
  - Fix CardGrid alignment issues in documentation layout
  - Update Astro configuration for GitHub Pages compatibility with proper base path
  - Add comprehensive GitHub Pages deployment guide
