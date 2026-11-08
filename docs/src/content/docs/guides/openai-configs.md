---
title: OpenAI Guardrails Configs
description: Use guardrails_config.json exports from guardrails.openai.com directly with AI SDK Guardrails.
---

AI SDK Guardrails now uses the same configuration schema as [OpenAI Guardrails](https://guardrails.openai.com). That means the `guardrails_config.json` file you download from the OpenAI Guardrails wizard can run unchanged inside your AI SDK apps – no manual translation or YAML editing required.

This guide shows how to:

1. Load a config exported from the OpenAI wizard.
2. Execute those guardrails at any pipeline stage.
3. Convert the config into the familiar `withGuardrails()` shape so you can mix in AI SDK–specific guardrails.

## 1. Export a config

Create or adjust a pipeline at https://guardrails.openai.com, then click **Download config** to get a `guardrails_config.json` file. The file has the structure:

```jsonc
{
  "version": 1,
  "pre_flight": {
    "version": 1,
    "guardrails": [
      { "name": "Contains PII", "config": { "entities": ["EMAIL_ADDRESS"] } },
    ],
  },
  "input": {
    "version": 1,
    "guardrails": [
      {
        "name": "Prompt Injection Detection",
        "config": { "confidence_threshold": 0.65 },
      },
    ],
  },
  "output": {
    "version": 1,
    "guardrails": [
      {
        "name": "Moderation",
        "config": { "categories": ["hate", "violence"] },
      },
    ],
  },
}
```

All guardrail names are registered inside `ai-sdk-guardrails`, so you can reference them verbatim. What each one needs:

| Guardrail                                                                                | Engine                | Needs                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contains PII, URL Filter                                                                 | Regex                 | nothing                                                                                                                                                                                                 |
| Moderation                                                                               | OpenAI Moderation API | `openaiApiKey` in the context or `OPENAI_API_KEY` env var                                                                                                                                               |
| Prompt Injection Detection, Jailbreak, Off Topic Prompts, Custom Prompt Check, NSFW Text | LLM classifier        | `llm` in the context                                                                                                                                                                                    |

A guardrail that can't reach a verdict blocks and reports `executionFailed: true`: a missing `llm` or API key, an LLM reply without a boolean `flagged` and a `confidence` in [0, 1], a moderation response without results, or a moderation call that takes longer than 10 seconds. Pass `raiseGuardrailErrors: true` to `runGuardrails()` to make those throw instead.

`Hallucination Detection` is not registered: OpenAI's version checks a vector store. A config that names it fails `validatePipelineConfig()`; write a custom output guardrail with your own source check instead.

## 2. Load and run stages directly

Use the runtime helpers to load and execute guardrails exactly the way OpenAI clients do:

```ts
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import {
  loadPipelineConfig,
  runStageGuardrails,
} from 'ai-sdk-guardrails/config';

// Load from file path, JSON string, or object literal
const pipeline = await loadPipelineConfig('./guardrails_config.json');

export async function handleChat(userPrompt: string, userId: string) {
  // Run pre-flight/input guardrails before calling the model
  const preflight = await runStageGuardrails(userPrompt, pipeline, 'input', {
    llm: openai('gpt-4o-mini'), // Required for LLM-powered guardrails
    requestId: 'req_123',
    userId,
  });

  if (preflight?.blocked) {
    // Inspect individual results or surface a friendly error
    return Response.json({
      error: 'Message blocked',
      details: preflight.results,
    });
  }

  const { text } = await generateText({
    model: openai('gpt-4o'),
    prompt: userPrompt,
  });

  // After you get a completion, run the output stage:
  const output = await runStageGuardrails(text, pipeline, 'output', {
    llm: openai('gpt-4o-mini'),
  });

  return Response.json({ text, blocked: output?.blocked ?? false });
}
```

Need a lower-level primitive? `runGuardrails()` accepts any `GuardrailBundle`, so you can execute just the `pipeline.output` block or even the `guardrails` array itself.

```ts
import { openai } from '@ai-sdk/openai';
import { loadPipelineConfig, runGuardrails } from 'ai-sdk-guardrails/config';

const pipeline = await loadPipelineConfig('./guardrails_config.json');

if (pipeline.output) {
  await runGuardrails('model response text', pipeline.output, {
    llm: openai('gpt-4o-mini'),
  });
}
```

## 3. Wrap AI SDK models with wizard configs

Prefer the ergonomic `withGuardrails()` middleware? Convert the OpenAI schema into AI SDK's format with the provided mapper and keep stacking your own guardrails on top:

```ts
import { withGuardrails, sensitiveDataFilter } from 'ai-sdk-guardrails';
import {
  mapOpenAIConfigToGuardrails,
  loadPipelineConfig,
} from 'ai-sdk-guardrails/config';
import { openai } from '@ai-sdk/openai';

const openAIConfig = await loadPipelineConfig('./guardrails_config.json');
const guardrailsFromWizard = mapOpenAIConfigToGuardrails(openAIConfig);

const model = withGuardrails({
  model: openai('gpt-4o'),
  ...guardrailsFromWizard,
  outputGuardrails: [
    ...(guardrailsFromWizard.outputGuardrails ?? []),
    sensitiveDataFilter(), // Extend with AI SDK–specific guardrails
  ],
});
```

This gives you the exact same enforcement as the OpenAI Guardrails client, plus the ability to mix in AI SDK Guardrails features such as:

- Streaming-aware guardrails, retries, and stop conditions
- Tool guardrails and MCP security layers
- Custom guardrails built with `defineInputGuardrail` / `defineOutputGuardrail`

## Tips

- **Context matters**: Guardrails like Prompt Injection Detection or Jailbreak checks need an `llm` inside the context so they can call an LLM. Pass your AI SDK model (e.g., `openai('gpt-4o-mini')`) when running stages.
- **File vs string**: `loadPipelineConfig()` detects file paths automatically. Passing a JSON string or object works the same way for configs stored in a database.
- **Validation**: Use `validatePipelineConfig()` to show friendly errors when users upload configs with typos or unsupported guardrails.
- **Partial execution**: You can run only the pre-flight stage for filtering before you invoke other guardrails, or run `pipeline.output` asynchronously after streaming completes.

The bottom line: if a guardrail works in the OpenAI wizard, it now works in AI SDK Guardrails—with the option to extend it using all of the additional guardrails and automations in this library.
