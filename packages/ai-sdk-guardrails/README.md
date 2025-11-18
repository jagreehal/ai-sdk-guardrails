# AI SDK Guardrails

Input and output safety controls for the [Vercel AI SDK](https://ai-sdk.dev).

[![npm version](https://img.shields.io/npm/v/ai-sdk-guardrails.svg?logo=npm&label=npm)](https://www.npmjs.com/package/ai-sdk-guardrails)
[![downloads](https://img.shields.io/npm/dw/ai-sdk-guardrails.svg?label=downloads)](https://www.npmjs.com/package/ai-sdk-guardrails)
[![bundle size](https://img.shields.io/bundlephobia/minzip/ai-sdk-guardrails.svg?label=minzipped)](https://bundlephobia.com/package/ai-sdk-guardrails)
[![license](https://img.shields.io/npm/l/ai-sdk-guardrails.svg?label=license)](../../LICENSE)
![types](https://img.shields.io/badge/TypeScript-Ready-3178C6?logo=typescript&logoColor=white)

📚 **[Documentation](https://jagreehal.github.io/ai-sdk-guardrails/)** | 🚀 **[Quick Start](#quick-start)** | 🛡️ **[Examples](../examples/)**

## Installation

```bash
npm install ai-sdk-guardrails
```

Requires `ai` SDK v4.0+ and Node.js 22+.

## Usage

```ts
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { withGuardrails, piiDetector, promptInjectionDetector } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  inputGuardrails: [piiDetector(), promptInjectionDetector()],
});

const { text } = await generateText({
  model,
  prompt: 'Write a friendly email',
});
```

## OpenAI Config Compatibility

Load configs from [guardrails.openai.com](https://guardrails.openai.com) directly:

```ts
import { mapOpenAIConfigToGuardrails, loadPipelineConfig } from 'ai-sdk-guardrails';

const config = await loadPipelineConfig('./guardrails-config.json');
const guardrailsConfig = mapOpenAIConfigToGuardrails(config);

const model = withGuardrails(openai('gpt-4o'), guardrailsConfig);
```

The mapper translates between OpenAI's `snake_case` config format and this library's `camelCase` API.

## Quick Start

### Basic Input Protection

```ts
import { withGuardrails, piiDetector } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  inputGuardrails: [piiDetector()],
  throwOnBlocked: true,
});

try {
  await generateText({ model, prompt: '...' });
} catch (error) {
  // Handle blocked input
}
```

### Basic Output Protection

```ts
import { sensitiveDataFilter, minLengthRequirement } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [
    sensitiveDataFilter(),
    minLengthRequirement(100)
  ],
});
```

### Streaming

```ts
import { streamText } from 'ai';

const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [minLengthRequirement(100)],
});

const { textStream } = await streamText({ model, prompt: '...' });
for await (const chunk of textStream) {
  process.stdout.write(chunk);
}
```

## Built-in Guardrails

### Input Guardrails

| Guardrail | Purpose |
|-----------|---------|
| `piiDetector()` | Detect PII (emails, phones, SSNs) |
| `promptInjectionDetector()` | Detect injection attempts |
| `blockedKeywords()` | Block specific terms |
| `inputLengthLimit()` | Enforce max input length |
| `rateLimiting()` | Per-user rate limits |
| `profanityFilter()` | Block offensive language |
| `toxicityDetector()` | Detect toxic content |
| `allowedToolsGuardrail()` | Restrict tool usage |

### Output Guardrails

| Guardrail | Purpose |
|-----------|---------|
| `sensitiveDataFilter()` | Remove secrets, API keys |
| `minLengthRequirement()` | Enforce minimum length |
| `outputLengthLimit()` | Enforce maximum length |
| `toxicityFilter()` | Block toxic responses |
| `jsonValidation()` | Validate JSON structure |
| `schemaValidation()` | Validate Zod schemas |
| `confidenceThreshold()` | Require minimum confidence |
| `hallucinationDetector()` | Detect uncertain claims |
| `mcpSecurityGuardrail()` | MCP tool security |

See [all guardrails](https://jagreehal.github.io/ai-sdk-guardrails/reference/built-in-guardrails/).

## Custom Guardrails

```ts
import { defineInputGuardrail } from 'ai-sdk-guardrails';

const businessHours = defineInputGuardrail({
  name: 'business-hours',
  execute: async () => {
    const hour = new Date().getHours();
    return hour >= 9 && hour <= 17
      ? { tripwireTriggered: false }
      : { tripwireTriggered: true, message: 'Outside business hours' };
  },
});
```

## Features

### Auto-Retry

```ts
const model = wrapWithOutputGuardrails(
  openai('gpt-4o'),
  [minLengthRequirement(100)],
  { retry: { maxRetries: 2 } }
);
```

### Streaming Modes

```ts
const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [toxicityFilter()],
  streamMode: 'progressive', // Check during streaming
});
```

### MCP Security

```ts
import { mcpSecurityGuardrail } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [
    mcpSecurityGuardrail({
      detectExfiltration: true,
      allowedDomains: ['api.company.com'],
    }),
  ],
});
```

## Examples

See [60+ examples](../examples/) including:

- [Input safety](../examples/) (PII, injection, profanity)
- [Output safety](../examples/) (sensitive data, quality checks)
- [Streaming](../examples/) (progressive and buffered modes)
- [OpenAI configs](../examples/53-openai-config-example.ts) (guardrails.openai.com)
- [Advanced patterns](../examples/) (custom guardrails, MCP security)

## Documentation

**[https://jagreehal.github.io/ai-sdk-guardrails/](https://jagreehal.github.io/ai-sdk-guardrails/)**

- [Getting Started](https://jagreehal.github.io/ai-sdk-guardrails/quick-start/)
- [Core Concepts](https://jagreehal.github.io/ai-sdk-guardrails/core-concepts/how-it-works/)
- [Guides](https://jagreehal.github.io/ai-sdk-guardrails/guides/basic-protection/)
- [API Reference](https://jagreehal.github.io/ai-sdk-guardrails/reference/built-in-guardrails/)

## Naming Conventions

This library follows AI SDK naming patterns:
- Functions: `camelCase` (withGuardrails, defineInputGuardrail)
- Types: `PascalCase` (InputGuardrail, GuardrailResult)
- Parameters: `camelCase` (inputGuardrails, throwOnBlocked)

OpenAI configs use `snake_case` (`pre_flight`, `confidence_threshold`) and are automatically mapped.

## Compatibility

- ✅ AI SDK v5.0+
- ✅ Node.js 22+
- ✅ TypeScript 5.0+
- ✅ Works with all AI SDK providers (OpenAI, Anthropic, Google, Mistral, Groq, Ollama, etc.)
- ✅ Framework-agnostic (Next.js, Express, Hono, Fastify, etc.)

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for details.

## License

MIT © [Jag Reehal](https://jagreehal.com)
