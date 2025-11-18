---
title: Installation
description: How to install and setup AI SDK Guardrails
---

## Requirements

- Node.js 18+ or Bun
- TypeScript 5.0+ (recommended)
- Vercel AI SDK 4.0+

## Package Installation

Install via your preferred package manager:

```bash
# npm
npm install ai-sdk-guardrails

# pnpm
pnpm add ai-sdk-guardrails

# yarn
yarn add ai-sdk-guardrails

# bun
bun add ai-sdk-guardrails
```

## Peer Dependencies

AI SDK Guardrails requires the Vercel AI SDK:

```bash
npm install ai
```

You'll also need at least one AI provider:

```bash
# OpenAI
npm install @ai-sdk/openai

# Anthropic
npm install @ai-sdk/anthropic

# Or any other AI SDK provider
```

## TypeScript Configuration

For optimal TypeScript support, ensure your `tsconfig.json` includes:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

## Verify Installation

Create a simple test file to verify everything is working:

```ts
import { withGuardrails, piiDetector } from 'ai-sdk-guardrails';
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';

const model = withGuardrails(openai('gpt-4o'), {
  inputGuardrails: [piiDetector()],
});

const result = await generateText({
  model,
  prompt: 'Hello, world!',
});

console.log(result.text);
```

If this runs without errors, you're all set!

## Environment Variables

Some guardrails may require API keys. Set these in your `.env` file:

```bash
# Required for AI SDK
OPENAI_API_KEY=your-key-here

# Optional: For specific guardrails
# ANTHROPIC_API_KEY=your-key-here
```

## Framework-Specific Setup

### Next.js

AI SDK Guardrails works seamlessly with Next.js:

```ts
// app/api/chat/route.ts
import { withGuardrails, piiDetector } from 'ai-sdk-guardrails';
import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';

const model = withGuardrails(openai('gpt-4o'), {
  inputGuardrails: [piiDetector()],
});

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = await streamText({
    model,
    messages,
  });

  return result.toDataStreamResponse();
}
```

### Express

```ts
import express from 'express';
import { withGuardrails, piiDetector } from 'ai-sdk-guardrails';
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';

const app = express();
app.use(express.json());

const model = withGuardrails(openai('gpt-4o'), {
  inputGuardrails: [piiDetector()],
});

app.post('/api/chat', async (req, res) => {
  const result = await generateText({
    model,
    prompt: req.body.prompt,
  });

  res.json({ text: result.text });
});

app.listen(3000);
```

### Hono

```ts
import { Hono } from 'hono';
import { withGuardrails, piiDetector } from 'ai-sdk-guardrails';
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';

const app = new Hono();

const model = withGuardrails(openai('gpt-4o'), {
  inputGuardrails: [piiDetector()],
});

app.post('/api/chat', async (c) => {
  const { prompt } = await c.req.json();

  const result = await generateText({
    model,
    prompt,
  });

  return c.json({ text: result.text });
});

export default app;
```

## Bundle Size

AI SDK Guardrails is designed to be tree-shakeable. Only import the guardrails you actually use:

```ts
// Good - only imports what you use
import { withGuardrails } from 'ai-sdk-guardrails';
import { piiDetector } from 'ai-sdk-guardrails/guardrails';

// Avoid - imports everything
import * as guardrails from 'ai-sdk-guardrails';
```

Typical bundle impact:
- Core (`withGuardrails`): ~2KB gzipped
- Each guardrail: ~0.5-2KB gzipped
- Total with 5 guardrails: ~8-12KB gzipped

## Troubleshooting

### "Cannot find module 'ai-sdk-guardrails'"

Make sure you've installed both `ai-sdk-guardrails` and `ai`:

```bash
npm install ai-sdk-guardrails ai
```

### TypeScript Errors

Ensure your TypeScript version is 5.0 or higher:

```bash
npm install -D typescript@latest
```

### Build Errors in Next.js

If you encounter build errors, add to `next.config.js`:

```js
module.exports = {
  transpilePackages: ['ai-sdk-guardrails'],
};
```

## Next Steps

- [Quick Start](/quick-start/) - Build your first guarded AI application
- [Built-in Guardrails](/guardrails/input/pii/) - Explore available guardrails
- [API Reference](/api/with-guardrails/) - Detailed API documentation
