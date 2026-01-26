---
title: Streaming with Guardrails
description: Learn how to use guardrails with streaming responses
---

Guardrails work seamlessly with streaming responses. You can choose when and how guardrails check streamed content.

## Basic Streaming

Guardrails run automatically after the stream completes:

```ts
import { streamText } from 'ai';
import { withGuardrails, minLengthRequirement } from 'ai-sdk-guardrails';
import { openai } from '@ai-sdk/openai';

const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [minLengthRequirement(100)],
});

// Stream works normally - guardrails run after completion
const { textStream } = await streamText({
  model,
  prompt: 'Explain quantum computing',
});

for await (const chunk of textStream) {
  process.stdout.write(chunk);
}
```

## Stream Modes

### Buffer Mode (Default)

Wait for the entire stream to complete, then check:

```ts
const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [minLengthRequirement(100)],
  streamMode: 'buffer', // Default - waits for completion
});
```

**Best for:**
- Validating complete responses
- Checking output length
- Running quality assessments
- Schema validation

**Trade-off**: User sees entire response before validation

### Progressive Mode

Check guardrails as tokens arrive (early termination):

```ts
const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [toxicityFilter()],
  streamMode: 'progressive', // Check during streaming
});
```

**Best for:**
- Real-time content filtering
- Early stopping on violations
- Saving costs (terminate bad generations early)
- Immediate feedback

**Trade-off**: Some guardrails may not work with partial content

## Handling Blocked Streams

### Replace with Fallback

```ts
const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [minLengthRequirement(100)],
  replaceOnBlocked: true, // Replace with a safe placeholder message
});
```

### Throw Errors

```ts
import { isGuardrailsError } from 'ai-sdk-guardrails';
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { withGuardrails, toxicityFilter } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [toxicityFilter()],
  throwOnBlocked: true,
});

try {
  const { textStream } = await streamText({ model, prompt: '...' });
  for await (const chunk of textStream) {
    process.stdout.write(chunk);
  }
} catch (error) {
  if (isGuardrailsError(error)) {
    console.error('Stream blocked:', error.message);
  }
}
```

## Auto-Retry on Quality Issues

Automatically retry when streaming output doesn't meet requirements:

```ts
const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [minLengthRequirement(100)],
  retry: {
    maxRetries: 2,
    buildRetryParams: ({ lastParams }) => ({
      ...lastParams,
      maxOutputTokens: (lastParams.maxOutputTokens ?? 400) + 200,
      prompt: [
        ...lastParams.prompt,
        {
          role: 'user',
          content: 'Please provide a more detailed response.',
        },
      ],
    }),
  },
});

const { textStream } = await streamText({ model, prompt: '...' });
// Automatically retries if output is too short
```

## Stream Transform Stopping

For more control, use stream transformers:

```ts
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import {
  createGuardrailStreamTransform,
  toxicityFilter,
} from 'ai-sdk-guardrails';

const result = await streamText({
  model: openai('gpt-4o'),
  prompt: '...',
  experimental_transform: createGuardrailStreamTransform([toxicityFilter()], {
    stopOnSeverity: 'high',
  }),
});

// Stops streaming early when a guardrail violation is detected
```

### Progressive Mode with Accumulated Text

In progressive mode, guardrails automatically receive the accumulated text as chunks arrive. This allows guardrails to make decisions based on the full text seen so far:

```ts
import { defineOutputGuardrail } from 'ai-sdk-guardrails';

const streamingAwareGuardrail = defineOutputGuardrail({
  name: 'streaming-check',
  execute: async ({ result }, accumulatedText) => {
    // In progressive mode, accumulatedText contains all text seen so far
    // In buffer mode, accumulatedText is undefined
    const text = accumulatedText ?? result.text ?? '';
    
    // Check the accumulated text for violations
    if (text.includes('forbidden')) {
      return {
        tripwireTriggered: true,
        message: 'Forbidden content detected',
        severity: 'high',
      };
    }
    
    return { tripwireTriggered: false };
  },
});
```

The `accumulatedText` parameter is automatically provided by the middleware when using progressive streaming mode.

## Monitoring Stream Violations

Track violations during streaming:

```ts
const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [toxicityFilter()],
  onOutputBlocked: (summary) => {
    // Log to monitoring service
    summary.blockedResults.forEach((r) => console.log('Blocked:', r.message));
  },
});
```

## Best Practices

### 1. Choose the Right Mode

- Use **buffer mode** for quality checks (length, schema, structure)
- Use **progressive mode** for safety checks (toxicity, PII in responses)

### 2. Handle Failures Gracefully

```ts
const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [minLengthRequirement(100)],
  replaceOnBlocked: true,
  onOutputBlocked: async (summary, params, result) => {
    // Log to monitoring
    await logToMonitoring({ summary, params, result, timestamp: Date.now() });
  },
});
```

### 3. Set Appropriate Timeouts

```ts
const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [minLengthRequirement(100)],
  streamMode: 'progressive',
  executionOptions: { timeout: 30000 }, // 30 second timeout
});
```

## Next Steps

- [Custom Guardrails](/guides/custom-guardrails/) - Create streaming-aware guardrails
- [Stopping Mechanisms](/guides/stopping-mechanisms/) - Stopping strategies
- [API Reference](/reference/api/) - Complete configuration options
