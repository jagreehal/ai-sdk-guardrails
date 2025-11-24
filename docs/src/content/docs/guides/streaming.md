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
  replaceOnBlocked: true, // Return fallback message
  blockedMessage: 'The response did not meet quality standards.',
});
```

### Throw Errors

```ts
import { isGuardrailsError } from 'ai-sdk-guardrails';

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
import { wrapWithOutputGuardrails } from 'ai-sdk-guardrails';

const model = wrapWithOutputGuardrails(
  openai('gpt-4o'),
  [minLengthRequirement(100)],
  {
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
  },
);

const { textStream } = await streamText({ model, prompt: '...' });
// Automatically retries if output is too short
```

## Stream Transform Stopping

For more control, use stream transformers:

```ts
import { experimental_streamTransformStop } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [
    experimental_streamTransformStop({
      stopCondition: (text) => text.includes('[STOP]'),
      removeStopMarker: true,
    }),
  ],
});

// Stops streaming when "[STOP]" is detected
```

## Monitoring Stream Violations

Track violations during streaming:

```ts
const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [toxicityFilter()],
  onOutputBlocked: (violations) => {
    // Log to monitoring service
    violations.forEach((v) => {
      console.log('Blocked:', v.guardrailName, v.message);
    });
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
  blockedMessage: 'Response did not meet quality standards. Please try again.',
  onOutputBlocked: async (violations) => {
    // Log to monitoring
    await logToMonitoring({ violations, timestamp: Date.now() });
  },
});
```

### 3. Set Appropriate Timeouts

```ts
const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [minLengthRequirement(100)],
  streamMode: 'progressive',
  timeout: 30000, // 30 second timeout
});
```

## Next Steps

- [Custom Guardrails](/guides/custom-guardrails/) - Create streaming-aware guardrails
- [Stopping Mechanisms](/guides/stopping-mechanisms/) - Stopping strategies
- [API Reference](/reference/api/) - Complete configuration options
