---
'ai-sdk-guardrails': minor
---

Added utility functions and type exports from guardrail modules to improve developer experience and enable better custom guardrail creation.

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
