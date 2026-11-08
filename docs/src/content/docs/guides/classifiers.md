---
title: Model-Backed Detectors
description: Put a real classifier (an AI SDK model, OpenAI Moderation, Presidio, Prompt Guard) behind a guardrail.
---

The built-in detectors are offline heuristics: fast and free, but beatable by paraphrase, translation and encoding (see the [threat model](/reference/threat-model/) for measured rates). `classifierGuardrail` turns any classifier into a guardrail, so you can keep the heuristics as a cheap first pass and add a model for what they miss.

## The interface

A classifier is a function from text to a verdict:

```ts
import type { Classifier } from 'ai-sdk-guardrails';

const myClassifier: Classifier = async (text, { signal }) => {
  const res = await fetch('https://classifier.internal/score', {
    method: 'POST',
    body: JSON.stringify({ text }),
    signal,
  });
  const { label, score } = (await res.json()) as {
    label: string;
    score: number;
  };
  return { flagged: label === 'attack', score, categories: [label] };
};
```

Wrap it as an input or output guardrail:

```ts
import {
  classifierGuardrail,
  classifierOutputGuardrail,
  withGuardrails,
  type Classifier,
} from 'ai-sdk-guardrails';
import { openai } from '@ai-sdk/openai';

declare const myClassifier: Classifier;

const guarded = withGuardrails({
  model: openai('gpt-4o'),
  inputGuardrails: [
    classifierGuardrail({
      name: 'injection-classifier',
      classify: myClassifier,
      threshold: 0.8, // when the verdict has a score, trip at or above this
      onError: 'block', // default: fail closed if the classifier is down
    }),
  ],
  outputGuardrails: [
    classifierOutputGuardrail({ name: 'output-check', classify: myClassifier }),
  ],
});
```

- The input variant classifies what is new in each step: the user's message, or the tool results since the last assistant turn. Indirect injection in tool output is covered without re-classifying the whole history.
- `onError: 'block'` (default) fails closed when the classifier throws (network, quota, malformed reply); `'allow'` fails open. Either way the result has `executionFailed: true`, so you can alert on it.

## Ready-made classifiers

### Any AI SDK model

`llmClassifier` asks a model for a structured verdict. Built-in tasks are `'prompt-injection'`, `'toxicity'` and `'pii'`; pass a string for your own question. The text is passed as delimited data, and the system prompt tells the model not to follow it.

```ts
import {
  agentGuardrails,
  classifierGuardrail,
  llmClassifier,
  promptInjectionDetector,
} from 'ai-sdk-guardrails';
import { openai } from '@ai-sdk/openai';
import { ToolLoopAgent } from 'ai';

const agent = new ToolLoopAgent({
  ...agentGuardrails({
    model: openai('gpt-4o'),
    inputGuardrails: [
      promptInjectionDetector(), // free first pass
      classifierGuardrail({
        name: 'llm-injection-check',
        classify: llmClassifier({
          model: openai('gpt-4.1-mini'),
          task: 'prompt-injection',
        }),
      }),
    ],
  }),
});
```

A classifier model can itself be attacked by the text it reads. Use a different, small model from the one doing the work, and treat its verdict as one signal.

### OpenAI Moderation

```ts
import {
  classifierGuardrail,
  openAIModerationClassifier,
} from 'ai-sdk-guardrails';

const moderation = classifierGuardrail({
  name: 'openai-moderation',
  classify: openAIModerationClassifier({
    categories: ['harassment', 'harassment/threatening', 'hate', 'violence'],
  }), // uses OPENAI_API_KEY unless you pass apiKey
});
```

### Presidio (PII)

Point it at a [Presidio Analyzer](https://microsoft.github.io/presidio/) service:

```ts
import { classifierGuardrail, presidioClassifier } from 'ai-sdk-guardrails';

const pii = classifierGuardrail({
  name: 'presidio',
  classify: presidioClassifier({
    url: 'http://presidio-analyzer:3000',
    entities: ['PERSON', 'EMAIL_ADDRESS', 'PHONE_NUMBER', 'IBAN_CODE'],
    scoreThreshold: 0.6,
  }),
});
```

### Hugging Face text classifiers (Prompt Guard and others)

Any text-classification endpoint (Inference API, Inference Endpoints, TEI) works. Name the labels that mean "attack":

```ts
import { classifierGuardrail, huggingFaceClassifier } from 'ai-sdk-guardrails';

const promptGuard = classifierGuardrail({
  name: 'prompt-guard',
  classify: huggingFaceClassifier({
    url: process.env.PROMPT_GUARD_URL!,
    token: process.env.HF_TOKEN,
    attackLabels: ['INJECTION', 'JAILBREAK', 'MALICIOUS'],
  }),
  threshold: 0.9,
});
```

## Measure before you switch

The repository's benchmark can run classifiers over the same labelled corpus as the heuristics:

```bash
BENCH_PROVIDERS=1 OPENAI_API_KEY=... pnpm --filter ai-sdk-guardrails bench
```

It writes `bench/PROVIDER-RESULTS.md` next to the heuristics' `bench/RESULTS.md`. To compare a classifier of your own, add it to `bench/providers.test.ts`.
