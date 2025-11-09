# ai-sdk-guardrails

## 5.1.0

### Minor Changes

- a700143: Add advanced guardrail features for streaming control, token management, and execution abortion:
  - **Streaming transforms**: `createGuardrailStreamTransform` for real-time guardrail checking during streaming
  - **Token-level control**: `createTokenBudgetTransform` and `createTokenAwareGuardrailTransform` for token budget management
  - **Abort controllers**: `createGuardrailAbortController` for canceling operations on violations
  - **Tool abortion**: `wrapToolWithAbortion` and `createToolAbortionController` for aborting tool execution
  - **Prepare steps**: `createGuardrailPrepareStep` and `createAdaptivePrepareStep` for agent step preparation
  - **Finish reason enhancement**: `createFinishReasonEnhancement` for proper finish reason mapping

  Add 7 new examples (53-59) demonstrating these features. Fix linting and type errors throughout the codebase.

## 5.0.2

### Patch Changes

- c97bd93: **Telemetry Integration with AI SDK**

  Guardrails now automatically inherit telemetry settings from the AI SDK's `experimental_telemetry` option when available. This enables seamless distributed tracing integration without requiring duplicate configuration.

  **Key Changes:**
  - **Automatic Telemetry Inheritance**: Guardrails automatically extract and merge telemetry settings from AI SDK's `experimental_telemetry` parameter passed to `generateText()`, `streamText()`, etc.
  - **Priority System**: Guardrail-specific telemetry settings take precedence over inherited AI SDK settings, with fallback inheritance when not explicitly set
  - **Improved No-op Implementations**: Refactored no-op span and tracer implementations to match AI SDK patterns for better compatibility
  - **Enhanced Error Handling**: Added `recordErrorOnSpan()` helper function matching AI SDK's error recording patterns
  - **Type Safety**: Fixed type definitions to properly support telemetry inheritance in `withGuardrails()` and middleware functions

  **Usage:**

  ```typescript
  // AI SDK telemetry is automatically inherited
  const result = await generateText({
    model: guardedModel,
    prompt: 'Hello',
    experimental_telemetry: {
      isEnabled: true,
      tracer: myTracer,
      functionId: 'chat-endpoint',
    },
  });

  // Guardrails will use the same tracer and functionId automatically
  // You can still override with guardrail-specific settings:
  const guardedModel = withGuardrails(model, {
    inputGuardrails: [piiDetector],
    executionOptions: {
      telemetry: {
        recordMetadata: true, // Guardrail-specific override
      },
    },
  });
  ```

  This ensures guardrail spans are properly correlated with AI SDK spans in your distributed tracing system.

## 5.0.1

### Patch Changes

- 5c86ba3: Update README heading to be more accurate - changed "Add Guardrails in one line of code" to "Drop-in Guardrails for any AI model" to better reflect the actual implementation approach.

## 5.0.0

### Major Changes

- 997595b: BREAKING: Fix import paths and add comprehensive MCP security validation

  This is a breaking change that fixes import paths in all examples and adds significant new security features.

  **Breaking Changes:**
  - Fix broken import paths from `../src/guardrails` to `../src/index` in 51 example files
  - Import path changes may affect users who were importing from the old paths

  **New Features:**
  - Add comprehensive security validation tests proving guardrails catch real threats
  - Add security effectiveness metrics showing 66.7% recall and 50% precision
  - Improve MCP security documentation and examples
  - Add new security validation test suite

  **Fixes:**
  - Fix TypeScript compilation issues and ESLint violations
  - Ensure all examples compile and run correctly
  - Fix ES module compatibility issues in examples

## 4.0.0

### Major Changes

- c3d5b66: # Version 4.0.0 - Major Release

  ## 🚀 New Features

  ### Autoevals Integration Example
  - Added comprehensive autoevals guardrails example demonstrating AI-powered factuality evaluation
  - Shows integration with autoevals library for quality assessment
  - Includes multiple examples: factuality checking, blocking/non-blocking modes, custom evaluation logic
  - Demonstrates best practices for AI-powered guardrails

  ## 🔧 Improvements
  - Enhanced output guardrails with better type safety
  - Improved error handling and fallback mechanisms
  - Added comprehensive examples for different use cases

  ## 📚 Documentation
  - Added detailed autoevals integration guide
  - Improved example documentation with clear explanations
  - Better type definitions and error messages

  ## 🛠️ Technical Changes
  - Updated dependencies to latest versions
  - Improved build configuration
  - Enhanced TypeScript type safety

## 3.0.0

### Major Changes

- 1b5b452: Update for v5 AI SDK release

## 2.0.0

### Major Changes

- Updated to use AI SDK v5

## 1.0.0

### Major Changes

- c51a3df: Initial release of AI SDK Guardrails - the safest way to build production AI applications with the Vercel AI SDK.

  ## Features
  - **Complete Protection**: Input and output validation with intelligent guardrails
  - **Real-time Streaming Safety**: First-class support for streaming with real-time monitoring
  - **Built-in Guardrails**:
    - Input: Length limits, blocked keywords, PII detection, prompt injection protection, toxicity detection
    - Output: Content filtering, confidence thresholds, schema validation, performance monitoring
  - **TypeScript Support**: Full type safety and autocompletion
  - **Vercel AI SDK Integration**: Works with `generateText`, `generateObject`, `streamText`, `streamObject`, and `embed`
  - **Developer Friendly**: Simple API with helpful error messages and sensible defaults

  ## Breaking Changes

  This is the first major release. No breaking changes from previous versions.
