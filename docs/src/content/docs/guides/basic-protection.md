---
title: Basic Protection Setup
description: Get started with essential guardrails for input and output protection
---

This guide shows you how to add basic protection to your AI application using the most common guardrails.

## Input + Output Protection

The most common setup combines input protection (PII, prompt injection) with output filtering:

```ts
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import {
  withGuardrails,
  piiDetector,
  promptInjectionDetector,
  sensitiveDataFilter,
} from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  inputGuardrails: [
    piiDetector(),              // Block PII in prompts
    promptInjectionDetector(),   // Detect injection attempts
  ],
  outputGuardrails: [
    sensitiveDataFilter(),       // Remove secrets from responses
  ],
});

// Use exactly like before - nothing else changes
const { text } = await generateText({
  model,
  prompt: 'Write a friendly email',
});
```

## Why These Three?

### 1. PII Detector (Input)

Blocks personally identifiable information before it reaches your model:

- ✅ Prevents compliance violations (GDPR, HIPAA, CCPA)
- ✅ Saves costs by blocking bad requests
- ✅ Protects user privacy

**What it detects:**
- Email addresses
- Phone numbers
- Social Security Numbers
- Credit card numbers
- IP addresses
- Postal addresses

### 2. Prompt Injection Detector (Input)

Detects attempts to manipulate the AI:

- ✅ Prevents security vulnerabilities
- ✅ Blocks jailbreak attempts
- ✅ Protects against malicious instructions

**What it detects:**
- Role-playing attacks ("Ignore previous instructions")
- Context switching attempts
- Delimiter injection
- Encoded attacks

### 3. Sensitive Data Filter (Output)

Removes secrets and sensitive data from AI responses:

- ✅ Prevents API key leakage
- ✅ Blocks password exposure
- ✅ Removes tokens and secrets

**What it filters:**
- API keys (AWS, OpenAI, GitHub, etc.)
- Private keys and certificates
- OAuth tokens
- Database credentials
- Environment variables

## With Error Handling

In production, handle guardrail violations explicitly:

```ts
import { isGuardrailsError } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  inputGuardrails: [piiDetector(), promptInjectionDetector()],
  outputGuardrails: [sensitiveDataFilter()],
  throwOnBlocked: true, // Throw errors instead of silent blocking
});

try {
  const { text } = await generateText({
    model,
    prompt: userPrompt,
  });
  console.log(text);
} catch (error) {
  if (isGuardrailsError(error)) {
    // Show user-friendly message
    console.error('Request blocked:', error.message);
    // error.violations contains details
  } else {
    // Handle other errors
    throw error;
  }
}
```

## With Callbacks

Monitor violations without throwing errors:

```ts
const model = withGuardrails(openai('gpt-4o'), {
  inputGuardrails: [piiDetector()],
  outputGuardrails: [sensitiveDataFilter()],
  throwOnBlocked: false,
  onInputBlocked: (violations) => {
    // Log to monitoring service
    console.warn('Input blocked:', violations);
  },
  onOutputBlocked: (violations) => {
    // Log to monitoring service
    console.warn('Output blocked:', violations);
  },
});
```

## Reusable Configuration

Create a reusable guardrail configuration:

```ts
import { createGuardrails } from 'ai-sdk-guardrails';

// Define once
const basicProtection = createGuardrails({
  inputGuardrails: [piiDetector(), promptInjectionDetector()],
  outputGuardrails: [sensitiveDataFilter()],
  throwOnBlocked: true,
});

// Apply to multiple models
const gpt4 = basicProtection(openai('gpt-4o'));
const claude = basicProtection(anthropic('claude-3-sonnet'));
const llama = basicProtection(ollama('llama3.2'));
```

## Next Steps

- [Streaming with Guardrails](/guides/streaming/) - Handle streaming responses
- [Custom Guardrails](/guides/custom-guardrails/) - Create domain-specific rules
- [Built-in Guardrails Reference](/reference/built-in-guardrails/) - Explore all available guardrails
