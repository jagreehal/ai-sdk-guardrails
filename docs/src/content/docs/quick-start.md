---
title: Quick Start
description: Get started with AI SDK Guardrails
---

This guide shows you how to add guardrails to your AI SDK application.

## Installation

```bash
npm install ai-sdk-guardrails
```

Requires `ai` SDK v7.0+ and Node.js 22+.

## Basic Usage

Wrap your AI SDK model with guardrails:

```ts
import { withGuardrails, piiDetector } from 'ai-sdk-guardrails';
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';

const model = withGuardrails({
  model: openai('gpt-4o'),
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
import {
  piiDetector,
  promptInjectionDetector,
  blockedKeywords,
} from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: openai('gpt-4o'),
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

const model = withGuardrails({
  model: openai('gpt-4o'),
  outputGuardrails: [sensitiveDataFilter(), minLengthRequirement(50)],
});
```

## Combining Guardrails

Use both input and output guardrails together:

```ts
const model = withGuardrails({
  model: openai('gpt-4o'),
  inputGuardrails: [piiDetector(), promptInjectionDetector()],
  outputGuardrails: [sensitiveDataFilter(), minLengthRequirement(50)],
});
```

## Policy Packs

Packs bundle the rails above for a threat model. Spread one in, then append your own:

```ts
import {
  withGuardrails,
  piiPack,
  mcpHardenedPack,
  evalSandboxPack,
} from 'ai-sdk-guardrails';

const pii = piiPack(); // piiDetector in, sensitiveDataFilter out
const model = withGuardrails({
  model: openai('gpt-4o'),
  ...pii,
  outputGuardrails: [...pii.outputGuardrails, minLengthRequirement(50)],
});
```

- `piiPack()`: detect PII in prompts, filter it from responses.
- `mcpHardenedPack({ injection, mcp, egress })`: prompt-injection scan on every step, MCP payload scanning, response sanitising, tool egress policy. Pair with `guardMcpTools` and `guardrailApproval` ([MCP guide](/guides/mcp/)).
- `evalSandboxPack({ scope, session, budget })`: evaluation scope, plan-risk across steps, optional budget ceiling ([Eval Sandbox](/guides/eval-sandbox/)).

See [`58-policy-packs.ts`](https://github.com/jagreehal/ai-sdk-guardrails/blob/main/packages/examples/58-policy-packs.ts).

## Handling Violations

If you set `throwOnBlocked: true`, guardrails throw errors when blocked. Handle them with try-catch:

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
  }
}
```

Guardrail errors extend the AI SDK's own `AISDKError`, so `AISDKError.isInstance(error)` catches them alongside other SDK errors. Input and output blocks (`GuardrailsInputError` / `GuardrailsOutputError`) carry a `blockedGuardrails` array with the name, message, and severity of each guardrail that tripped.

## Warning Mode

By default (`throwOnBlocked: false`) a blocked call returns a replacement message instead of throwing. Add callbacks to observe blocks:

```ts
const model = withGuardrails({
  model: openai('gpt-4o'),
  inputGuardrails: [piiDetector()],
  throwOnBlocked: false,
  onInputBlocked: (summary) => {
    console.log('Input blocked:', summary.blockedResults);
  },
});
```

## Streaming

`withGuardrails` guards `streamText` too. Pick one of two modes:

**1. Buffer (default): safest.** Output guardrails see the whole response before
any of it reaches the user. Use it whenever a rail needs the complete text
(length, schema, quality judges).

```ts
import { streamText } from 'ai';

const model = withGuardrails({
  model: openai('gpt-4o'),
  outputGuardrails: [sensitiveDataFilter()],
});

const { textStream } = streamText({ model, prompt: 'Write a summary...' });
for await (const chunk of textStream) process.stdout.write(chunk);
```

**2. Progressive: low latency, stops early.** Tokens stream as they arrive and
rails run on the text so far; a block ends the stream.

```ts
const model = withGuardrails({
  model: openai('gpt-4o'),
  outputGuardrails: [sensitiveDataFilter()],
  streamMode: 'progressive',
  stopOnGuardrailViolation: true, // stop on any critical or 2 violations
});
```

Start with buffer and switch a route to progressive only when latency matters
and your rails work on partial text. Stream transforms (`./advanced`) are there
for finer control; see the [Streaming guide](/guides/streaming/).

## OpenAI Config Compatibility

Load configs from [guardrails.openai.com](https://guardrails.openai.com):

```ts
import {
  mapOpenAIConfigToGuardrails,
  loadPipelineConfig,
} from 'ai-sdk-guardrails/config';

// Load from file
const config = await loadPipelineConfig('./guardrails-config.json');
const guardrailsConfig = mapOpenAIConfigToGuardrails(config);

const model = withGuardrails({ model: openai('gpt-4o'), ...guardrailsConfig });
```

Or use the config directly:

```ts
import { mapOpenAIConfigToGuardrails } from 'ai-sdk-guardrails/config';

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
const model = withGuardrails({ model: openai('gpt-4o'), ...guardrailsConfig });
```

## Next Steps

- [Built-in Guardrails](/reference/built-in-guardrails/) - Explore all available guardrails
- [Custom Guardrails](/guides/custom-guardrails/) - Create your own guardrails
- [Streaming Guide](/guides/streaming/) - Streaming patterns
- [OpenAI Configs](/guides/openai-configs/) - Working with OpenAI config format
