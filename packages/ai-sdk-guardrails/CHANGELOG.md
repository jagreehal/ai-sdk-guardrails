# ai-sdk-guardrails

## 6.0.1

### Patch Changes

- 5d2672b: Sync `text` and `content` on generate results after output guardrails run. AI SDK v7 reads user-visible text from the `content` array, so guardrails that only mutated the top-level `text` field (including in-place redaction) were silently ignored. Middleware now snapshots the result before guardrails and aligns both fields before returning.

## 6.0.0

### Major Changes

- b457da4: Require AI SDK v7. The package now targets `ai@^7` and `@ai-sdk/provider@^4`, and
  its middleware is emitted as `LanguageModelV4Middleware` (`specificationVersion: 'v4'`).

  **Breaking**
  - Peer dependency bump: requires `ai@^7.0.0` (now a `peerDependency`, not bundled)
    and `@ai-sdk/provider@^4`. Stay on `ai-sdk-guardrails@5.x` if you are on AI SDK v6.
  - Advanced provider types are now exported under their V4 names
    (`LanguageModelV4`, `LanguageModelV4Middleware`, `LanguageModelV4CallOptions`, …).
    The old `LanguageModelV3*` names remain as deprecated aliases and will be removed
    in a future major.

  **New**
  - `guardrailApproval(guardrails, options?)` — adapts tool-parameter guardrails
    (e.g. `sqlInjectionGuardrail`, `toolRBACGuardrail`) into AI SDK v7's first-class
    `toolApproval` slot. The result drops straight into a `ToolLoopAgent` (the
    recommended agent API) as well as `generateText` / `streamText`, with the tool
    set inferred and no casts at the call site. Maps guardrail
    results to `approved` / `denied` / `user-approval` / `not-applicable`, with a
    configurable severity threshold (`denyAtOrAbove`), an `onBlock` override, and an
    `onDecision` observability hook. This is the recommended way to gate tool calls;
    it gains pause/resume and human-in-the-loop that wrapping the model cannot.

  **Unchanged**
  - The public API is source-compatible: `withGuardrails`, `defineInputGuardrail`,
    `defineOutputGuardrail`, and all built-in content guardrails keep the same
    signatures and behaviour.

  **Docs**
  - New Cookbook section with five intent-based recipe pages (input safety, output
    safety, quality and judges, security, tools and agents). Each recipe pairs a
    runnable example with its real captured terminal output and a Mermaid flow.

### Patch Changes

- 2cad663: chore: update dependencies

  Minor/patch dependency refresh via npm-check-updates (--target minor, 3-day publish cooldown) — no major version bumps.

## 5.4.0

### Minor Changes

- 56568c4: Add advanced guardrails features: configurable `executionOptions` with richer blocked-callback summaries, improved streaming support (progressive evaluation + optional early termination), default retry instructions, and new utilities for middleware composition, stream transforms, tool-parameter validation, gradual enforcement, observability, and debugging.

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
