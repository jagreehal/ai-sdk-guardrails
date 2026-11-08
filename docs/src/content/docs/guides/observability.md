---
title: Observability
description: Zero-config OpenTelemetry spans for every guardrail stage
---

Every input and output guardrail stage produces an OpenTelemetry span. You do not configure anything in the library. If a tracer provider is registered, the spans show up. If not, nothing happens.

## Requirements

`@opentelemetry/api` is an optional peer dependency. The library loads it lazily the first time a guardrail stage runs.

```bash
npm install @opentelemetry/api
```

Then register a tracer provider in whatever way you already do: autotel, the official `NodeSDK`, or anything else that sets the global provider.

```ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { withGuardrails, piiDetector } from 'ai-sdk-guardrails';

new NodeSDK().start(); // or `init()` from autotel

// guardrail spans now land in the same trace as the model calls
const model = withGuardrails({
  model: openai('gpt-4o'),
  inputGuardrails: [piiDetector()],
});
```

## No-op behaviour

- **`@opentelemetry/api` not installed:** the import fails once, the result is cached, and guardrails run with no tracing overhead.
- **API installed but no provider registered:** the API's default no-op tracer is used. Spans are created and discarded.
- **No enabled guardrails for a stage:** no span is started.

Tracing never changes guardrail results. If a guardrail stage throws, the span records the exception and the error is rethrown unchanged.

## Spans

Spans come from the tracer named `ai-sdk-guardrails`. Each one starts with `startActiveSpan`, so it is a child of whatever span is active, such as the AI SDK's own model-call span.

| Span name           | When                                |
| ------------------- | ----------------------------------- |
| `guardrails.input`  | Once per input guardrail stage run  |
| `guardrails.output` | Once per output guardrail stage run |

### Attributes

| Attribute            | Type     | Set                     | Value                                           |
| -------------------- | -------- | ----------------------- | ----------------------------------------------- |
| `guardrails.stage`   | `string` | At span start           | `'input'` or `'output'`                         |
| `guardrails.count`   | `number` | At span start           | Number of enabled guardrails in the stage       |
| `guardrails.blocked` | `number` | After guardrails finish | Results with `tripwireTriggered: true`          |
| `guardrails.passed`  | `number` | After guardrails finish | Remaining results (total results minus blocked) |

If a stage throws, `guardrails.blocked` / `guardrails.passed` are not set. Instead the span gets `recordException(error)` and status `ERROR`.

### `gen_ai.guard.stop` event

Each blocked result adds one `gen_ai.guard.stop` event to the stage span:

| Event attribute         | Value                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `gen_ai.guard.rule`     | `result.context.guardrailName`, else `result.info.guardrailName`, else `'unknown'` |
| `gen_ai.guard.action`   | Always `'block'`                                                                   |
| `gen_ai.guard.message`  | `result.message`, or `''`                                                          |
| `gen_ai.guard.severity` | `result.severity`, only present when the result has one                            |

Example of what a single blocked input stage records:

```text
span guardrails.input
  guardrails.stage   = "input"
  guardrails.count   = 2
  guardrails.passed  = 1
  guardrails.blocked = 1
  event gen_ai.guard.stop
    gen_ai.guard.rule     = "prompt-injection-detector"
    gen_ai.guard.action   = "block"
    gen_ai.guard.message  = "..."
    gen_ai.guard.severity = "high"
```

## Going further

These spans record what happened. For agent-governance signals on the GenAI span (policy decisions, controller identity, tool risk classes), see the [Governance guide](/guides/governance/). For in-process metrics and debug traces that don't need an OTEL backend, see `createMetricsCollector` and `createDebugWrapper` in [Advanced Features](/guides/advanced-features/#observability--debugging).
