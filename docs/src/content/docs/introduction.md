---
title: Introduction
description: An overview of AI SDK Guardrails
---

AI SDK Guardrails provides safety and quality controls for AI SDK applications. It validates inputs before they reach your model and outputs before they reach users.

## What are Guardrails?

Guardrails are validation functions that check AI inputs and outputs against specific criteria. They can:

- **Block requests**: Prevent inputs with PII or malicious content from reaching the model
- **Filter responses**: Remove sensitive data or inappropriate content from outputs
- **Enforce quality**: Require outputs to meet minimum standards
- **Validate format**: Ensure responses match expected schemas

## Example

Without guardrails:

```ts
// User provides PII in their prompt
const { text } = await generateText({
  model: openai('gpt-4o'),
  prompt: 'My email is john@company.com, help me...',
});
// PII sent to model → potential compliance issue
```

With guardrails:

```ts
const model = withGuardrails(openai('gpt-4o'), {
  inputGuardrails: [piiDetector()],
});

const { text } = await generateText({
  model,
  prompt: 'My email is john@company.com, help me...',
});
// Request blocked → PII never sent → compliant
```

## Guardrail Types

### Input Guardrails

Run before the model receives the request. Use these to:

- Detect PII (emails, phone numbers, SSNs)
- Block prompt injection attempts
- Filter toxic or inappropriate content
- Enforce length limits
- Apply rate limiting

### Output Guardrails

Run after the model generates a response. Use these to:

- Remove sensitive data from responses
- Enforce minimum quality standards
- Validate output format
- Check for hallucinations
- Filter inappropriate content

### Tool Guardrails

Run during tool execution in agent workflows. Use these to:

- Validate tool parameters
- Enforce tool allowlists
- Control tool execution policies

## Integration

AI SDK Guardrails works as middleware for the AI SDK:

```ts
import { withGuardrails } from 'ai-sdk-guardrails';

// Wrap any AI SDK model
const guardedModel = withGuardrails(openai('gpt-4o'), {
  inputGuardrails: [...],
  outputGuardrails: [...],
});

// Use it like a normal model
await generateText({ model: guardedModel, prompt: '...' });
await streamText({ model: guardedModel, prompt: '...' });
```

Your existing code, telemetry, and logging continue to work unchanged.

## Key Concepts

- **Blocking vs. Warning**: Choose whether guardrails should throw errors or just log warnings
- **Auto-retry**: Automatically retry when outputs don't meet quality standards
- **Streaming**: Guardrails work with both `generateText` and `streamText`
- **Composability**: Mix and match guardrails to fit your requirements

## Next Steps

- [Quick Start](/quick-start/) - Set up guardrails in 5 minutes
- [Built-in Guardrails](/reference/built-in-guardrails/) - Explore available guardrails
- [Custom Guardrails](/guides/custom-guardrails/) - Create your own guardrails
