---
'ai-sdk-guardrails': minor
---

Add simplified retry UX with context-aware retry instructions. Guardrails can now implement `getRetryInstruction()` to provide intelligent retry prompts, and users can configure retry at the guardrail level with just `retry: { maxRetries: 2 }` instead of writing complex `buildRetryParams` functions. The library automatically uses guardrail-specific retry instructions when available, falling back to sensible defaults.
