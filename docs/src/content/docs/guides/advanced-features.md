---
title: Advanced Features
description: Tool parameter validation, stream transforms, composition, and observability utilities
---

These APIs are **optional** utilities for advanced use cases. Most live behind the
`ai-sdk-guardrails/advanced` subpath (composition, observability, debug, stream
transforms, raw middleware); the config-driven runtime lives at
`ai-sdk-guardrails/config`. Built-in guardrails and the primary API stay at the
package root, `ai-sdk-guardrails`.

## Core building blocks (lowest-level API)

If you want the most minimal shape possible, you can build guardrails directly:

```ts
import { createInputGuardrail, createOutputGuardrail } from 'ai-sdk-guardrails';

const myInput = createInputGuardrail(
  'business-hours',
  'Only allow during business hours',
  async (ctx) => {
    return { tripwireTriggered: false };
  },
);

const myOutput = createOutputGuardrail('no-secrets', async ({ result }) => {
  return { tripwireTriggered: false };
});
```

### Direct Guardrail Execution

You can also execute guardrails directly without middleware:

```ts
import {
  executeOutputGuardrails,
  privacyLeakageDetector,
  sensitiveDataFilter,
} from 'ai-sdk-guardrails';
import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

// Generate text with structured output
const result = await generateText({
  model: openai('gpt-4o'),
  prompt: 'Generate a user profile',
  output: Output.object({
    schema: z.object({
      name: z.string(),
      email: z.string().email(),
    }),
  }),
});

// Validate with guardrails post-generation
const summary = await executeOutputGuardrails(
  [privacyLeakageDetector(), sensitiveDataFilter()],
  {
    input: {
      prompt: 'Generate a user profile',
      messages: [{ role: 'user', content: 'Generate a user profile' }],
      system: '',
    },
    result,
  },
  {
    // Optional: for streaming scenarios, pass accumulated text
    accumulatedText: undefined, // Only used in progressive streaming
    logLevel: 'warn',
  },
);

if (summary.some((r) => r.tripwireTriggered)) {
  console.error('Guardrail violations detected');
}
```

**Note**: For `generateText` with `Output.object()`, using `executeOutputGuardrails()` after generation is recommended for reliable validation, as the middleware may not see the structured output during generation.

## Generic retry utility + backoff helpers

The library also exports a standalone `retry()` helper (plus `retryHelpers` and backoff utilities) you can use outside middleware.

```ts
import { retry, retryHelpers } from 'ai-sdk-guardrails';
import { exponentialBackoff } from 'ai-sdk-guardrails/advanced';

const result = await retry({
  generate: (params) => generateText(params),
  params: { model, prompt: '...', maxOutputTokens: 200 },
  validate: (r) => ({ blocked: r.text.length < 500, message: 'Too short' }),
  buildRetryParams: retryHelpers.increaseTokens(200),
  maxRetries: 2,
  backoffMs: exponentialBackoff({ base: 500, max: 4000, jitter: 0.1 }),
});
```

## Tool parameter validation (pre-execution)

Wrap a toolset so inputs are validated (and optionally sanitized) **before** your tool runs.

```ts
import { tool } from 'ai';
import { z } from 'zod';
import {
  sqlInjectionGuardrail,
  pathTraversalGuardrail,
  parameterLengthGuardrail,
  toolRBACGuardrail,
} from 'ai-sdk-guardrails';
import { withToolParameterGuardrails } from 'ai-sdk-guardrails/advanced';

const tools = withToolParameterGuardrails(
  {
    executeSQL: tool({
      description: 'Execute SQL query',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => db.execute(query),
    }),
    readFile: tool({
      description: 'Read a file',
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => fs.readFile(path, 'utf-8'),
    }),
  },
  [
    sqlInjectionGuardrail({ toolName: 'executeSQL' }),
    pathTraversalGuardrail({ toolName: 'readFile', allowedPaths: ['/tmp/'] }),
    parameterLengthGuardrail({ maxLength: 10_000 }),
    toolRBACGuardrail({
      toolName: ['executeSQL', 'readFile'],
      requiredPermissions: ['admin'],
      mode: 'any',
    }),
  ],
  {
    requestContext: { userId: 'u_123', permissions: ['admin'] },
    throwOnInvalid: true,
  },
);
```

## Streaming transforms (`experimental_transform`)

Use transforms when you want **mid-stream** behavior (stop, drop, redact, replace) without buffering the whole response.

### Stop on guardrail violations

```ts
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { toxicityFilter } from 'ai-sdk-guardrails';
import { createGuardrailStreamTransform } from 'ai-sdk-guardrails/advanced';

const result = await streamText({
  model: openai('gpt-4o'),
  prompt: '...',
  experimental_transform: createGuardrailStreamTransform([toxicityFilter()], {
    stopOnSeverity: 'high',
  }),
});
```

### Buffered variant

If you only want a final check at the end of the stream:

```ts
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { toxicityFilter } from 'ai-sdk-guardrails';
import { createGuardrailStreamTransformBuffered } from 'ai-sdk-guardrails/advanced';

const result = await streamText({
  model: openai('gpt-4o'),
  prompt: '...',
  experimental_transform: createGuardrailStreamTransformBuffered(
    [toxicityFilter()],
    {
      stopOnSeverity: 'high',
    },
  ),
});
```

### Redact PII patterns during streaming

```ts
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { createPIIRedactionTransform } from 'ai-sdk-guardrails/advanced';

const result = await streamText({
  model: openai('gpt-4o'),
  prompt: '...',
  experimental_transform: createPIIRedactionTransform({
    redactionText: '[REDACTED]',
  }),
});
```

### Custom stream transform (stop/drop/redact/replace)

For full control, use `createGuardrailTransform()` (and built-in `PII_PATTERNS` if helpful):

```ts
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { toxicityFilter } from 'ai-sdk-guardrails';
import {
  createGuardrailTransform,
  createContentFilterTransform,
  PII_PATTERNS,
} from 'ai-sdk-guardrails/advanced';

const result = await streamText({
  model: openai('gpt-4o'),
  prompt: '...',
  experimental_transform: [
    createGuardrailTransform([toxicityFilter()], { onViolation: 'stop' }),
    createContentFilterTransform({ blockedKeywords: ['SECRET'] }),
    // Optional: use PII_PATTERNS for your own redaction rules
    // createGuardrailTransform([], { onViolation: 'redact', redactPatterns: [PII_PATTERNS.EMAIL] }),
  ],
});
```

### Token budgeting + token-aware guardrails

```ts
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { toxicityFilter } from 'ai-sdk-guardrails';
import {
  createTokenBudgetTransform,
  createTokenAwareGuardrailTransform,
} from 'ai-sdk-guardrails/advanced';

const result = await streamText({
  model: openai('gpt-4o'),
  prompt: 'Write a long story...',
  experimental_transform: [
    createTokenBudgetTransform({ maxTokens: 2000 }),
    createTokenAwareGuardrailTransform([toxicityFilter()], {
      checkEveryTokens: 100,
      stopOnSeverity: 'high',
    }),
  ],
});
```

## Agent guardrails + stop conditions

Wrap an AI SDK tool-loop agent so each step (and tool usage) is checked.

```ts
import { ToolLoopAgent, tool } from 'ai';
import { z } from 'zod';
import { openai } from '@ai-sdk/openai';
import {
  agentGuardrails,
  toxicityFilter,
  anyOf,
  hasCriticalViolation,
  isViolationCount,
} from 'ai-sdk-guardrails';

const agent = new ToolLoopAgent({
  ...agentGuardrails({
    model: openai('gpt-4o'),
    outputGuardrails: [toxicityFilter()],
    stopOnGuardrailViolation: anyOf([
      hasCriticalViolation(),
      isViolationCount(3),
    ]),
  }),
  tools: {
    search: tool({
      description: 'Search the web',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => ({ query }),
    }),
  },
});

await agent.generate({ prompt: '...' });
```

## AbortController integration

Use an `AbortController` to cancel work when guardrails trigger.

```ts
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { withGuardrails, toxicityFilter } from 'ai-sdk-guardrails';
import { createGuardrailAbortController } from 'ai-sdk-guardrails/advanced';

const { signal, abortOnViolation } = createGuardrailAbortController();

const model = withGuardrails({
  model: openai('gpt-4o'),
  outputGuardrails: [toxicityFilter()],
  onOutputBlocked: (summary) => abortOnViolation('high')(summary),
});

await streamText({ model, prompt: '...', abortSignal: signal });
```

## Finish reason & provider metadata

Attach consistent `finishReason` / `providerMetadata` when guardrails block.

```ts
import {
  getGuardrailFinishReason,
  createGuardrailProviderMetadata,
  createFinishReasonEnhancement,
} from 'ai-sdk-guardrails/advanced';

const finishReason = getGuardrailFinishReason(summary); // e.g. 'content_filter'
const providerMetadata = createGuardrailProviderMetadata(summary, {
  includeMetadata: true,
});

const enhancedResult = createFinishReasonEnhancement(summary, result);
```

## Guardrail-aware `prepareStep`

Use `prepareStep` to adapt multi-step behavior after violations (e.g. reduce temperature).

```ts
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { GuardrailViolation } from 'ai-sdk-guardrails';
import {
  createGuardrailPrepareStep,
  createAdaptivePrepareStep,
} from 'ai-sdk-guardrails/advanced';

const violations: GuardrailViolation[] = [];

const result = await streamText({
  model: openai('gpt-4o'),
  prompt: '...',
  prepareStep: createGuardrailPrepareStep(violations, { stopOnCritical: true }),
});

// Or: adaptive escalation based on violation patterns
const adaptive = createAdaptivePrepareStep({ violations, escalateAfter: 3 });
```

## Abort dangerous tool execution

Wrap tools so they can be aborted based on guardrail checks before/during execution.

```ts
import { tool } from 'ai';
import { z } from 'zod';
import {
  wrapToolWithAbortion,
  createToolAbortionController,
} from 'ai-sdk-guardrails/advanced';

const controller = createToolAbortionController({ minSeverity: 'high' });

const dangerousTool = tool({
  description: 'Do something risky',
  inputSchema: z.object({ payload: z.string() }),
  execute: async ({ payload }, { abortSignal }) => {
    abortSignal?.throwIfAborted?.();
    return payload;
  },
});

const safeTool = wrapToolWithAbortion(dangerousTool, [], {
  checkBefore: true,
  abortOnSeverity: 'high',
});
```

## Middleware factory (compose with `wrapLanguageModel`)

Build a guardrails middleware that composes with other middleware.

```ts
import { wrapLanguageModel } from 'ai';
import { openai } from '@ai-sdk/openai';
import { piiDetector } from 'ai-sdk-guardrails';
import { guardrailMiddleware } from 'ai-sdk-guardrails/advanced';

const model = wrapLanguageModel({
  model: openai('gpt-4o'),
  middleware: [
    guardrailMiddleware({
      inputGuardrails: [piiDetector()],
      executionOptions: { timeout: 10_000 },
      // Optional: provide request context for guardrails
      context: { userId: 'u_123', sessionId: 's_456' },
    }),
  ],
});
```

**Note**: `guardrailMiddleware` accepts both input and output guardrails. For a single phase, use the focused `inputGuardrailsMiddleware()` or `outputGuardrailsMiddleware()` factories instead (also exported from `ai-sdk-guardrails/advanced`). `noopGuardrailMiddleware()` is available as a pass-through for conditional composition.

### Request Context Support

You can provide request context that will be available to all guardrails:

```ts
import { defineInputGuardrail, piiDetector } from 'ai-sdk-guardrails';
import { inputGuardrailsMiddleware } from 'ai-sdk-guardrails/advanced';

const middleware = inputGuardrailsMiddleware({
  inputGuardrails: [piiDetector()],
  context: {
    userId: 'u_123',
    sessionId: 's_456',
    permissions: ['read', 'write'],
    // Any custom context data
  },
  executionOptions: { timeout: 10_000 },
});

// Guardrails can access this via params.requestContext
const userAwareGuardrail = defineInputGuardrail({
  name: 'user-aware',
  execute: async (params) => {
    const userId = params.requestContext?.userId;
    // Use userId for validation...
    return { tripwireTriggered: false };
  },
});
```

## Tool-call guardrails

These are output guardrails intended to validate **tool usage** (allowlists, egress, “expected tool use” patterns).

```ts
import {
  withGuardrails,
  expectedToolUse,
  toolEgressPolicy,
} from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: openai('gpt-4o'),
  outputGuardrails: [
    expectedToolUse({ tools: 'search' }),
    toolEgressPolicy({ allowedDomains: ['api.company.com'] }),
  ],
});
```

## Telemetry & governance (AI SDK v7-native)

Guardrails no longer ship a bespoke OpenTelemetry tracer. Observability now rides
the AI SDK's own `telemetry` slot, so guardrail signals land in the **same** GenAI
trace as the model calls they guard — no separate tracer to wire up.

For SAIF agent-governance signals, compose explicit helpers from
`ai-sdk-guardrails/governance`:

```ts
import { ToolLoopAgent } from 'ai';
import { OpenTelemetry } from '@ai-sdk/otel';
import { withGuardrails, sensitiveDataFilter } from 'ai-sdk-guardrails';
import {
  guardrailGovernance,
  guardrailTelemetry,
} from 'ai-sdk-guardrails/governance';

const governance = guardrailGovernance({
  agent: { id: 'support-agent', model: 'gpt-4o' },
  controllerId: user.id,
});

const model = withGuardrails({
  model: baseModel,
  outputGuardrails: [sensitiveDataFilter()],
  onOutputBlocked: governance.onOutputBlocked,
});

const agent = new ToolLoopAgent({
  model,
  tools,
  telemetry: {
    integrations: [
      new OpenTelemetry({ tracer }), // creates the GenAI span tree
      guardrailTelemetry({ agent: { id: 'support-agent', model: 'gpt-4o' } }),
    ],
  },
});
```

Guardrail block decisions are now opt-in too: attach
`guardrailGovernance(...).onInputBlocked` / `.onOutputBlocked` yourself where you
want them. See the governance guide for the full SAIF bridge.

## Registry & specs (advanced)

The package also exports the lower-level registry/spec layer (`defaultRegistry`, `createRegistry`, `GuardrailSpec`, `ConfiguredGuardrail`) used by the OpenAI-config compatibility runtime.

## Guardrail composition

Compose guardrails with conditions, pipelines, parallelism, retries, and fallbacks.

```ts
import { piiDetector, promptInjectionDetector } from 'ai-sdk-guardrails';
import { createPipeline, when, withRetry } from 'ai-sdk-guardrails/advanced';

const inputGuardrails = [
  when((ctx) => ctx.prompt.length > 500, promptInjectionDetector()),
  withRetry(piiDetector(), {
    maxRetries: 2,
    backoffMs: (attempt) => attempt * 200,
  }),
];

const pipeline = createPipeline(inputGuardrails, {
  name: 'input-safety-pipeline',
  shortCircuitOnBlock: true,
});
```

## Gradual enforcement (rollouts)

Roll out a guardrail safely: warn first, then escalate to blocking.

```ts
import { toxicityFilter } from 'ai-sdk-guardrails';
import { strictEscalation } from 'ai-sdk-guardrails/advanced';

const gradualToxicity = strictEscalation(toxicityFilter(), {
  onWarn: (result, stats) => {
    console.warn('Would block (warning mode):', result.message, stats);
  },
  onEscalation: (stats) => {
    console.warn('Now enforcing blocks:', stats);
  },
});
```

## Observability & debugging

### Metrics collection

```ts
import { piiDetector } from 'ai-sdk-guardrails';
import { createMetricsCollector } from 'ai-sdk-guardrails/advanced';

const collector = createMetricsCollector({
  flushIntervalMs: 60_000,
  onFlush: (metrics) => console.log('guardrail metrics', metrics),
});

const trackedPII = collector.track(piiDetector());
```

### Execution traces

```ts
import { piiDetector } from 'ai-sdk-guardrails';
import {
  createDebugWrapper,
  formatTraceSummary,
} from 'ai-sdk-guardrails/advanced';

const debug = createDebugWrapper({
  enabled: true,
  onTrace: (trace) => console.log(formatTraceSummary(trace)),
});

const debuggedPII = debug.wrap(piiDetector());
```
