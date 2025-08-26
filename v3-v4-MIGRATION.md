# Migration Guide: v3 -> v4

This guide covers breaking changes and how to migrate from v3.x to v4.0.0.

## Overview

v4 focuses on better observability and developer experience with analytics-rich callbacks, clearer streaming behavior, and stronger typing.

## Breaking Changes

### 1) Callback Interfaces: onInputBlocked, onOutputBlocked

Old (v3):

```typescript
onInputBlocked: (results: GuardrailResult[], params) => {
  console.log('Blocked:', results[0]?.message);
};

onOutputBlocked: (results: GuardrailResult[], params, result) => {
  console.log('Filtered:', results[0]?.message);
};
```

New (v4):

```typescript
onInputBlocked: (executionSummary: GuardrailExecutionSummary, params) => {
  console.log('Blocked:', executionSummary.blockedResults[0]?.message);
  console.log(`Execution time: ${executionSummary.totalExecutionTime}ms`);
  console.log(
    `Stats: ${executionSummary.stats.blocked} blocked, ${executionSummary.stats.passed} passed`,
  );
};

onOutputBlocked: (
  executionSummary: GuardrailExecutionSummary,
  params,
  result,
) => {
  console.log('Filtered:', executionSummary.blockedResults[0]?.message);
  analytics.track('guardrail_blocked', {
    guardrailsExecuted: executionSummary.guardrailsExecuted,
    totalExecutionTime: executionSummary.totalExecutionTime,
  });
};
```

Benefits:

- Complete execution analytics (timing, statistics, pass/fail rates)
- Enhanced observability and improved debugging
- Better monitoring via structured metrics

### 2) Streaming Behavior Defaults

- Output guardrails run in buffer mode by default (evaluate after full stream).
- Progressive streaming is opt-in via `streamMode: 'progressive'`.
- When blocked and not throwing, `replaceOnBlocked` defaults to `true` for output guardrails, replacing content with a placeholder.

### 3) Execution Options Defaults

- Input/Output `execute*Guardrails` defaults:
  - `parallel: true`
  - `timeout: 30000` (ms)
  - `continueOnFailure: true`
  - `logLevel: 'warn'`

### 4) Type Updates

- Introduced `AIResult`, `OutputGuardrailContext`, and normalized contexts to improve type-safety.
- Guardrail `execute` may receive an optional `{ signal?: AbortSignal }` for cancellation.
- **NEW: Automatic metadata type inference** - TypeScript now automatically infers metadata types from your guardrail definitions, eliminating the need for manual type annotations.

## Migration Steps

1. Update callbacks to new signatures.
2. Review streaming usage; choose buffer (default) or progressive mode.
3. If you relied on output passing through when blocked, set `replaceOnBlocked: false` explicitly.
4. If you relied on sequential execution or different timeouts, configure `executionOptions` accordingly.
5. Adopt new types from `ai-sdk-guardrails/types` if you reference results or contexts directly.

## Example Migration

```diff
- onOutputBlocked: (results, params, result) => {
-   console.log('Filtered:', results[0]?.message);
- },
+ onOutputBlocked: (summary, params, result) => {
+   console.log('Filtered:', summary.blockedResults[0]?.message);
+   console.log('Executed:', summary.guardrailsExecuted);
+ },
```

### Type-Safe Metadata (New in v4)

v4 introduces automatic type inference for guardrail metadata. You no longer need manual type annotations when accessing metadata in callbacks:

Old (v3) - Required type casting:

```typescript
const piiGuardrail = defineInputGuardrail({
  name: 'pii-detector',
  execute: async (context) => {
    // ... detection logic ...
    return {
      tripwireTriggered: true,
      metadata: { detectedTypes: ['SSN', 'Email'], count: 2 },
    };
  },
});

const model = wrapWithInputGuardrails(openai('gpt-4'), [piiGuardrail], {
  onInputBlocked: (results) => {
    // Had to cast or use 'any' to access metadata properties
    const metadata = results[0]?.metadata as any;
    console.log(metadata?.detectedTypes); // No type safety
  },
});
```

New (v4) - Automatic type inference:

```typescript
// Define metadata interface (must extend Record<string, unknown>)
interface PIIMetadata extends Record<string, unknown> {
  detectedTypes: string[];
  count: number;
}

// defineInputGuardrail now accepts a generic type parameter
const piiGuardrail = defineInputGuardrail<PIIMetadata>({
  name: 'pii-detector',
  execute: async (context) => {
    // ... detection logic ...
    const metadata: PIIMetadata = {
      detectedTypes: ['SSN', 'Email'],
      count: 2,
    };
    return {
      tripwireTriggered: true,
      metadata, // TypeScript validates this matches PIIMetadata
    };
  },
});

// Types flow through automatically to callbacks
const model = wrapWithInputGuardrails(openai('gpt-4'), [piiGuardrail], {
  onInputBlocked: (summary) => {
    const metadata = summary.blockedResults[0]?.metadata;
    // Full type safety and autocomplete!
    if (metadata?.detectedTypes) {
      console.log(metadata.detectedTypes.join(', ')); // TypeScript knows it's string[]
      console.log(`Found ${metadata.count} PII items`); // TypeScript knows count is number
    }
  },
});
```

Key points:

- Metadata interfaces must extend `Record<string, unknown>`
- Use generics with `defineInputGuardrail<T>()` and `defineOutputGuardrail<T>()`
- Types automatically flow to `wrapWithInputGuardrails` and `wrapWithOutputGuardrails`
- No manual type casting needed in callbacks

## FAQ

- Q: Do I need to change my guardrail implementations?
  A: No, but you can optionally accept `{ signal }` and respect cancellations/timeouts.

- Q: Are input defaults different from output?
  A: Both share the same execution defaults listed above; output also has `replaceOnBlocked` and streaming controls.

- Q: Is v3 still supported?
  A: No active feature development. Please migrate to v4.
