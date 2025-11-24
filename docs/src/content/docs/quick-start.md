---
title: Quick Start
description: Get started with AI SDK Guardrails
---

This guide shows you how to add guardrails to your AI SDK application.

## Installation

```bash
npm install ai-sdk-guardrails
```

Requires `ai` SDK v4.0+ and Node.js 22+.

## Basic Usage

Wrap your AI SDK model with guardrails:

```ts
import { withGuardrails, piiDetector } from 'ai-sdk-guardrails';
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';

const model = withGuardrails(openai('gpt-4o'), {
  inputGuardrails: [piiDetector()],
});

const { text } = await generateText({
  model,
  prompt: 'Analyze this customer request...',
});
```

## Input Guardrails

Input guardrails run before the model receives the request:

```ts
import { piiDetector, promptInjectionDetector, blockedKeywords } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  inputGuardrails: [
    piiDetector(),
    promptInjectionDetector(),
    blockedKeywords(['spam', 'scam']),
  ],
});
```

## Output Guardrails

Output guardrails run after the model generates a response:

```ts
import { sensitiveDataFilter, minLengthRequirement } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [
    sensitiveDataFilter(),
    minLengthRequirement(50),
  ],
});
```

## Combining Guardrails

Use both input and output guardrails together:

```ts
const model = withGuardrails(openai('gpt-4o'), {
  inputGuardrails: [
    piiDetector(),
    promptInjectionDetector(),
  ],
  outputGuardrails: [
    sensitiveDataFilter(),
    minLengthRequirement(50),
  ],
});
```

## Handling Violations

By default, guardrails throw errors when blocked. Handle them with try-catch:

```ts
import { isGuardrailsError } from 'ai-sdk-guardrails';

try {
  const { text } = await generateText({
    model,
    prompt: 'My email is john@company.com',
  });
} catch (error) {
  if (isGuardrailsError(error)) {
    console.log('Blocked:', error.message);
    console.log('Severity:', error.severity);
  }
}
```

## Warning Mode

Use callbacks instead of throwing errors:

```ts
const model = withGuardrails(openai('gpt-4o'), {
  inputGuardrails: [piiDetector()],
  throwOnBlocked: false,
  onInputBlocked: (summary) => {
    console.log('Input blocked:', summary.blockedResults);
  },
});
```

## Streaming

Guardrails work with streaming:

```ts
import { streamText } from 'ai';

const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [minLengthRequirement(100)],
});

const { textStream } = await streamText({
  model,
  prompt: 'Write a summary...',
});

for await (const chunk of textStream) {
  process.stdout.write(chunk);
}
```

## OpenAI Config Compatibility

Load configs from [guardrails.openai.com](https://guardrails.openai.com):

```ts
import { mapOpenAIConfigToGuardrails, loadPipelineConfig } from 'ai-sdk-guardrails';

// Load from file
const config = await loadPipelineConfig('./guardrails-config.json');
const guardrailsConfig = mapOpenAIConfigToGuardrails(config);

const model = withGuardrails(openai('gpt-4o'), guardrailsConfig);
```

Or use the config directly:

```ts
const config = {
  version: 1,
  input: {
    version: 1,
    guardrails: [
      {
        name: 'Contains PII',
        config: { entities: ['EMAIL_ADDRESS', 'PHONE_NUMBER'] },
      },
    ],
  },
};

const guardrailsConfig = mapOpenAIConfigToGuardrails(config);
const model = withGuardrails(openai('gpt-4o'), guardrailsConfig);
```

## Next Steps

- [Built-in Guardrails](/reference/built-in-guardrails/) - Explore all available guardrails
- [Custom Guardrails](/guides/custom-guardrails/) - Create your own guardrails
- [Streaming Guide](/guides/streaming/) - Streaming patterns
- [OpenAI Configs](/guides/openai-configs/) - Working with OpenAI config format
