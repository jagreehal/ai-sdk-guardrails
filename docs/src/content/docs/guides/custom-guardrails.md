---
title: Custom Guardrails
description: Create domain-specific guardrails for your application
---

Create custom guardrails tailored to your application's specific requirements.

## Input Guardrails

Input guardrails check prompts before they reach the AI model.

### Basic Example

```ts
import { defineInputGuardrail } from 'ai-sdk-guardrails';
import { extractTextContent } from 'ai-sdk-guardrails/guardrails/input';

const businessHoursGuardrail = defineInputGuardrail({
  name: 'business-hours',
  description: 'Only allow requests during business hours',
  execute: async (params) => {
    const hour = new Date().getHours();

    if (hour >= 9 && hour <= 17) {
      return { tripwireTriggered: false };
    }

    return {
      tripwireTriggered: true,
      message: 'Requests only allowed during business hours (9 AM - 5 PM)',
      severity: 'medium',
      metadata: { currentHour: hour },
    };
  },
});
```

### With Text Extraction

```ts
const maxLengthGuardrail = defineInputGuardrail({
  name: 'max-length',
  description: 'Limit input length',
  execute: async (params) => {
    const { prompt } = extractTextContent(params);
    const maxLength = 1000;

    if (prompt.length <= maxLength) {
      return { tripwireTriggered: false };
    }

    return {
      tripwireTriggered: true,
      message: `Input too long: ${prompt.length} chars (max: ${maxLength})`,
      severity: 'high',
      metadata: {
        length: prompt.length,
        maxLength,
        exceeded: prompt.length - maxLength,
      },
    };
  },
});
```

### Async Validation

```ts
const allowlistGuardrail = defineInputGuardrail({
  name: 'user-allowlist',
  description: 'Only allow approved users',
  execute: async (params) => {
    const { prompt } = extractTextContent(params);
    const userId = params.userId; // From custom metadata

    // Check database
    const isAllowed = await db.users.isAllowed(userId);

    if (isAllowed) {
      return { tripwireTriggered: false };
    }

    return {
      tripwireTriggered: true,
      message: 'User not approved for AI access',
      severity: 'critical',
    };
  },
});
```

## Output Guardrails

Output guardrails check AI responses before returning them to users.

### Basic Example

```ts
import { defineOutputGuardrail } from 'ai-sdk-guardrails';
import { extractContent } from 'ai-sdk-guardrails/guardrails/output';

const minQualityGuardrail = defineOutputGuardrail({
  name: 'min-quality',
  description: 'Ensure responses meet minimum quality standards',
  execute: async ({ result }) => {
    const { text } = extractContent(result);
    const minLength = 100;

    if (text.length >= minLength) {
      return { tripwireTriggered: false };
    }

    return {
      tripwireTriggered: true,
      message: `Response too short: ${text.length} chars (min: ${minLength})`,
      severity: 'medium',
      metadata: { length: text.length, minLength },
    };
  },
});
```

### With Structured Outputs

```ts
const companyPolicyGuardrail = defineOutputGuardrail({
  name: 'company-policy',
  description: 'Enforce company communication policy',
  execute: async ({ result }) => {
    const { text } = extractContent(result);

    const bannedPhrases = [
      'guaranteed results',
      'risk-free',
      'limited time only',
    ];

    const violations = bannedPhrases.filter((phrase) =>
      text.toLowerCase().includes(phrase)
    );

    if (violations.length === 0) {
      return { tripwireTriggered: false };
    }

    return {
      tripwireTriggered: true,
      message: 'Response violates company policy',
      severity: 'high',
      metadata: { violations },
    };
  },
});
```

### LLM-as-Judge Pattern

Use another LLM to validate responses:

```ts
import { generateObject } from 'ai';
import { z } from 'zod';

const llmJudgeGuardrail = defineOutputGuardrail({
  name: 'llm-quality-judge',
  description: 'Use LLM to assess response quality',
  execute: async ({ result }) => {
    const { text } = extractContent(result);

    const assessment = await generateObject({
      model: openai('gpt-4o-mini'), // Cheaper model for judging
      schema: z.object({
        isQuality: z.boolean(),
        reason: z.string(),
        score: z.number().min(0).max(10),
      }),
      prompt: `
        Assess if this response is helpful and complete:
        "${text}"

        Rate quality (0-10) and explain why.
      `,
    });

    if (assessment.object.score >= 7) {
      return { tripwireTriggered: false };
    }

    return {
      tripwireTriggered: true,
      message: `Low quality response (score: ${assessment.object.score})`,
      severity: 'medium',
      metadata: assessment.object,
    };
  },
});
```

## Configurable Guardrails

Create guardrails with configurable parameters:

```ts
function createLengthGuardrail(options: {
  minLength?: number;
  maxLength?: number;
}) {
  return defineOutputGuardrail({
    name: 'length-requirement',
    description: 'Enforce length requirements',
    execute: async ({ result }) => {
      const { text } = extractContent(result);
      const { minLength = 0, maxLength = Infinity } = options;

      if (text.length < minLength) {
        return {
          tripwireTriggered: true,
          message: `Response too short: ${text.length} < ${minLength}`,
          severity: 'medium',
        };
      }

      if (text.length > maxLength) {
        return {
          tripwireTriggered: true,
          message: `Response too long: ${text.length} > ${maxLength}`,
          severity: 'low',
        };
      }

      return { tripwireTriggered: false };
    },
  });
}

// Usage
const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [
    createLengthGuardrail({ minLength: 100, maxLength: 500 }),
  ],
});
```

## Conditional Guardrails

Apply guardrails based on conditions:

```ts
const conditionalGuardrail = defineInputGuardrail({
  name: 'production-only',
  description: 'Stricter rules in production',
  execute: async (params) => {
    // Skip in development
    if (process.env.NODE_ENV !== 'production') {
      return { tripwireTriggered: false };
    }

    // Strict validation in production
    const { prompt } = extractTextContent(params);

    if (prompt.length > 500) {
      return {
        tripwireTriggered: true,
        message: 'Production input limit exceeded',
        severity: 'high',
      };
    }

    return { tripwireTriggered: false };
  },
});
```

## Best Practices

### 1. Descriptive Names and Messages

```ts
const goodGuardrail = defineInputGuardrail({
  name: 'pii-email-detector',
  description: 'Detects and blocks email addresses in user input',
  execute: async (params) => {
    // ... validation
    return {
      tripwireTriggered: true,
      message: 'Email address detected. Please remove PII before submitting.',
      severity: 'critical',
      metadata: { detectedPattern: 'email' },
    };
  },
});
```

### 2. Use Appropriate Severity Levels

- **`critical`**: Security violations, PII leaks, compliance issues
- **`high`**: Quality failures, policy violations
- **`medium`**: Warning-level issues, soft limits
- **`low`**: Minor issues, informational

### 3. Include Metadata

```ts
return {
  tripwireTriggered: true,
  message: 'Rate limit exceeded',
  severity: 'high',
  metadata: {
    userId: params.userId,
    requestCount: currentCount,
    limit: maxRequests,
    resetTime: resetTimestamp,
  },
};
```

### 4. Handle Errors Gracefully

```ts
const guardrail = defineInputGuardrail({
  name: 'external-check',
  execute: async (params) => {
    try {
      const result = await externalAPI.check(params);
      return result.isValid
        ? { tripwireTriggered: false }
        : { tripwireTriggered: true, message: 'Validation failed' };
    } catch (error) {
      // Log error but don't block user
      console.error('Guardrail error:', error);
      return { tripwireTriggered: false }; // Fail open
    }
  },
});
```

## Next Steps

- [Built-in Guardrails](/reference/built-in-guardrails/) - See examples of built-in guardrails
- [API Reference](/reference/api/) - Complete guardrail API
- [Testing Guardrails](/guides/testing/) - How to test custom guardrails
