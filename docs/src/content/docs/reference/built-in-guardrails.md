---
title: Built-in Guardrails
description: Complete reference of all built-in guardrails
---

AI SDK Guardrails provides 30+ guardrails for common use cases.

## Input Guardrails

Input guardrails run **before** the AI model is called, blocking bad requests and saving costs.

### PII Detector

Block personally identifiable information:

```ts
import { piiDetector } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  inputGuardrails: [piiDetector()],
});
```

**Detects:**
- Email addresses
- Phone numbers
- Social Security Numbers
- Credit card numbers
- IP addresses
- Postal addresses

**Use cases:** Compliance (GDPR, HIPAA, CCPA), privacy protection

### Prompt Injection Detector

Detect attempts to manipulate the AI:

```ts
import { promptInjectionDetector } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  inputGuardrails: [promptInjectionDetector()],
});
```

**Detects:**
- Role-playing attacks ("Ignore previous instructions")
- Context switching attempts
- Delimiter injection
- Encoded attacks

**Use cases:** Security, jailbreak prevention

### Blocked Keywords

Block specific terms or phrases:

```ts
import { blockedKeywords } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  inputGuardrails: [
    blockedKeywords({
      keywords: ['spam', 'scam', 'phishing'],
      caseSensitive: false,
    }),
  ],
});
```

**Use cases:** Content policy enforcement, brand safety

### Input Length Limit

Enforce maximum input length:

```ts
import { inputLengthLimit } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  inputGuardrails: [
    inputLengthLimit({
      maxLength: 1000,
      unit: 'characters', // or 'tokens'
    }),
  ],
});
```

**Use cases:** Cost control, DoS prevention

### Rate Limiting

Per-user or global rate limits:

```ts
import { rateLimiting } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  inputGuardrails: [
    rateLimiting({
      maxRequests: 10,
      windowMs: 60000, // 10 requests per minute
      keyExtractor: (params) => params.userId,
    }),
  ],
});
```

**Use cases:** Abuse prevention, fair usage

### Profanity Filter

Block offensive language:

```ts
import { profanityFilter } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  inputGuardrails: [
    profanityFilter({
      severity: 'medium', // 'low', 'medium', 'high'
    }),
  ],
});
```

**Use cases:** Content moderation, family-friendly apps

### Toxicity Detector

Detect toxic or harmful content:

```ts
import { toxicityDetector } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  inputGuardrails: [
    toxicityDetector({
      threshold: 0.7, // 0-1, lower = stricter
    }),
  ],
});
```

**Use cases:** Safety, harassment prevention

### Allowed Tools Guardrail

Restrict which tools can be used:

```ts
import { allowedToolsGuardrail } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  inputGuardrails: [
    allowedToolsGuardrail({
      allowedTools: ['search', 'calculator'],
    }),
  ],
});
```

**Use cases:** Tool security, controlled execution

## Output Guardrails

Output guardrails run **after** the AI model responds, ensuring quality and safety.

### Sensitive Data Filter

Remove secrets and API keys:

```ts
import { sensitiveDataFilter } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [sensitiveDataFilter()],
});
```

**Filters:**
- API keys (AWS, OpenAI, GitHub, etc.)
- Private keys and certificates
- OAuth tokens
- Database credentials
- Environment variables

**Use cases:** Security, preventing leaks

### Min Length Requirement

Enforce minimum response length:

```ts
import { minLengthRequirement } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [
    minLengthRequirement(100), // 100 characters minimum
  ],
});
```

**Use cases:** Quality control, ensuring completeness

### Output Length Limit

Enforce maximum response length:

```ts
import { outputLengthLimit } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [
    outputLengthLimit({
      maxLength: 500,
      unit: 'characters', // or 'tokens'
    }),
  ],
});
```

**Use cases:** Cost control, UX constraints

### Toxicity Filter

Block toxic responses:

```ts
import { toxicityFilter } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [
    toxicityFilter({
      threshold: 0.7,
    }),
  ],
});
```

**Use cases:** Safety, preventing harmful outputs

### JSON Validation

Validate JSON structure:

```ts
import { jsonValidation } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [
    jsonValidation({
      strict: true, // Require valid JSON
    }),
  ],
});
```

**Use cases:** Structured output, API integration

### Schema Validation

Validate against Zod schema:

```ts
import { schemaValidation } from 'ai-sdk-guardrails';
import { z } from 'zod';

const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [
    schemaValidation({
      schema: z.object({
        name: z.string(),
        age: z.number(),
      }),
    }),
  ],
});
```

**Use cases:** Type safety, data validation

### Confidence Threshold

Require minimum confidence:

```ts
import { confidenceThreshold } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [
    confidenceThreshold({
      minConfidence: 0.8,
    }),
  ],
});
```

**Use cases:** Quality assurance, uncertain responses

### Hallucination Detector

Detect uncertain or unsupported claims:

```ts
import { hallucinationDetector } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [
    hallucinationDetector({
      sensitivity: 'medium', // 'low', 'medium', 'high'
    }),
  ],
});
```

**Use cases:** Accuracy, factual correctness

### Secret Redaction

Redact secrets from output:

```ts
import { secretRedaction } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [
    secretRedaction({
      redactWith: '[REDACTED]',
    }),
  ],
});
```

**Use cases:** Security, preventing accidental leaks

## MCP Security Guardrails

Specialized guardrails for Model Context Protocol (MCP) tools.

### MCP Security Guardrail

MCP security:

```ts
import { mcpSecurityGuardrail } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [
    mcpSecurityGuardrail({
      detectExfiltration: true,
      scanEncodedContent: true,
      allowedDomains: ['api.company.com'],
      maxContentSize: 51200, // 50KB
      injectionThreshold: 0.7,
    }),
  ],
});
```

**Prevents:**
- Direct prompt injection
- Tool response poisoning
- Data exfiltration via URLs
- Encoded attacks (base64/hex)
- Cascading exploits
- Context poisoning

### MCP Response Sanitizer

Clean malicious content:

```ts
import { mcpResponseSanitizer } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  outputGuardrails: [
    mcpResponseSanitizer({
      removeUrls: true,
      sanitizeJson: true,
    }),
  ],
});
```

**Use cases:** Non-blocking security, content cleaning

## Combining Guardrails

Mix and match guardrails for protection:

```ts
const model = withGuardrails(openai('gpt-4o'), {
  inputGuardrails: [
    piiDetector(),
    promptInjectionDetector(),
    inputLengthLimit({ maxLength: 1000 }),
    rateLimiting({ maxRequests: 10, windowMs: 60000 }),
  ],
  outputGuardrails: [
    sensitiveDataFilter(),
    minLengthRequirement(100),
    toxicityFilter({ threshold: 0.7 }),
    schemaValidation({ schema: mySchema }),
  ],
});
```

## Next Steps

- [Custom Guardrails](/guides/custom-guardrails/) - Create your own guardrails
- [API Reference](/reference/api/) - Complete API documentation
- [Examples](/examples/) - See guardrails in action
