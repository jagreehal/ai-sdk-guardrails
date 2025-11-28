# ai-sdk-guardrails

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
