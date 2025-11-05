---
'ai-sdk-guardrails': patch
---

**Telemetry Integration with AI SDK**

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
  }
});

// Guardrails will use the same tracer and functionId automatically
// You can still override with guardrail-specific settings:
const guardedModel = withGuardrails(model, {
  inputGuardrails: [piiDetector],
  executionOptions: {
    telemetry: {
      recordMetadata: true,  // Guardrail-specific override
    }
  }
});
```

This ensures guardrail spans are properly correlated with AI SDK spans in your distributed tracing system.
