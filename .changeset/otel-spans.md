---
'ai-sdk-guardrails': minor
---

Emit an OpenTelemetry span for every input and output guardrail run when `@opentelemetry/api` (new optional peer) is installed and a tracer provider is registered. Spans carry pass and block counts and one `gen_ai.guard.stop` event per blocked result. No configuration needed; without a provider the spans are no-ops.
