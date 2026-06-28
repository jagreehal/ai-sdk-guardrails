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

const model = withGuardrails({
  model: openai('gpt-4o'),
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

const model = withGuardrails({
  model: openai('gpt-4o'),
  inputGuardrails: [promptInjectionDetector()],
});
```

**Detects:**

- Role-playing attacks ("Ignore previous instructions")
- Context switching attempts
- Delimiter injection, including chat-template delimiters (`<|im_start|>`, `[INST]`, `<<SYS>>`, fenced ` ```system ` blocks)
- Encoded attacks
- Tool-hijacking and exfiltration markers (cloud-metadata SSRF, `/etc/passwd`, SSH keys, MCP/`.cursorrules` spoofing)

**Obfuscation resistance:** input is normalized before matching, so leetspeak (`1gn0re`), homoglyphs (full-width / Cyrillic look-alikes), zero-width characters, spaced-out letters, and common typos are caught too. Normalization is additive — it never lowers detection on the raw text. Tune or disable it with the `normalize` option:

```ts
promptInjectionDetector({ normalize: false }); // match raw text only
promptInjectionDetector({ normalize: { decodeLeetspeak: false } }); // tune stages
```

**Use cases:** Security, jailbreak prevention

### Blocked Keywords

Block specific terms or phrases:

```ts
import { blockedKeywords } from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: openai('gpt-4o'),
  inputGuardrails: [
    // Case-insensitive, partial-match keyword blocking
    blockedKeywords(['spam', 'scam', 'phishing']),
  ],
});
```

**Use cases:** Content policy enforcement, brand safety

### Input Length Limit

Enforce maximum input length:

```ts
import { inputLengthLimit } from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: openai('gpt-4o'),
  inputGuardrails: [
    // Pass a number for a character limit, or an object to choose the unit
    inputLengthLimit({
      maxLength: 1000,
      countMethod: 'characters', // or 'bytes' | 'words'
    }),
  ],
});
```

**Use cases:** Cost control, DoS prevention

### Rate Limiting

Per-user or global rate limits:

```ts
import { rateLimiting } from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: openai('gpt-4o'),
  inputGuardrails: [
    rateLimiting({
      maxRequestsPerMinute: 10,
      windowMs: 60000, // 10 requests per minute (optional; defaults to 60s)
    }),
  ],
});
```

**Use cases:** Abuse prevention, fair usage

### Profanity Filter

Block offensive language:

```ts
import { profanityFilter } from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: openai('gpt-4o'),
  inputGuardrails: [
    // Built-in word lists by default; pass an array to add your own terms
    profanityFilter(['customBadWord']),
  ],
});
```

**Use cases:** Content moderation, family-friendly apps

### Toxicity Detector

Detect toxic or harmful content:

```ts
import { toxicityDetector } from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: openai('gpt-4o'),
  inputGuardrails: [
    toxicityDetector(0.7), // threshold 0-1, lower = stricter
  ],
});
```

**Use cases:** Safety, harassment prevention

### Allowed Tools Guardrail

Restrict which tools can be used:

```ts
import { allowedToolsGuardrail } from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: openai('gpt-4o'),
  inputGuardrails: [
    allowedToolsGuardrail({
      allowedTools: ['search', 'calculator'],
    }),
  ],
});
```

**Use cases:** Tool security, controlled execution

### High Entropy Detector

Flag input whose Shannon entropy is abnormally high — a signal of encoded or obfuscated payloads (base64 blobs, ciphertext, packed data) smuggled into a prompt. Natural language sits well below the default threshold:

```ts
import { highEntropyDetector } from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: openai('gpt-4o'),
  inputGuardrails: [highEntropyDetector({ threshold: 4.5, minLength: 40 })],
});
```

**Use cases:** Catching encoded payloads, defence against obfuscated injection

## Output Guardrails

Output guardrails run **after** the AI model responds, ensuring quality and safety.

### Sensitive Data Filter

Remove secrets and API keys:

```ts
import { sensitiveDataFilter } from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: openai('gpt-4o'),
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

const model = withGuardrails({
  model: openai('gpt-4o'),
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

const model = withGuardrails({
  model: openai('gpt-4o'),
  outputGuardrails: [
    outputLengthLimit(500), // 500 characters max
  ],
});
```

**Use cases:** Cost control, UX constraints

### Toxicity Filter

Block toxic responses:

```ts
import { toxicityFilter } from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: openai('gpt-4o'),
  outputGuardrails: [
    toxicityFilter(0.7), // threshold 0-1, lower = stricter
  ],
});
```

**Use cases:** Safety, preventing harmful outputs

### JSON Validation

Validate JSON structure:

```ts
import { jsonValidation } from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: openai('gpt-4o'),
  outputGuardrails: [
    jsonValidation(), // Require the response to parse as valid JSON
  ],
});
```

**Use cases:** Structured output, API integration

### Schema Validation

Validate against Zod schema:

```ts
import { schemaValidation } from 'ai-sdk-guardrails';
import { z } from 'zod';

const model = withGuardrails({
  model: openai('gpt-4o'),
  outputGuardrails: [
    schemaValidation(
      z.object({
        name: z.string(),
        age: z.number(),
      }),
    ),
  ],
});
```

**Use cases:** Type safety, data validation

### Confidence Threshold

Require minimum confidence:

```ts
import { confidenceThreshold } from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: openai('gpt-4o'),
  outputGuardrails: [
    confidenceThreshold(0.8), // minimum confidence, 0-1
  ],
});
```

**Use cases:** Quality assurance, uncertain responses

### Hallucination Detector

Detect uncertain or unsupported claims:

```ts
import { hallucinationDetector } from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: openai('gpt-4o'),
  outputGuardrails: [
    hallucinationDetector(0.7), // confidence threshold, lower = stricter
  ],
});
```

**Use cases:** Accuracy, factual correctness

### Secret Redaction

Redact secrets from output:

```ts
import { secretRedaction } from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: openai('gpt-4o'),
  outputGuardrails: [
    secretRedaction(), // replaces detected secrets with [REDACTED]
  ],
});
```

**Use cases:** Security, preventing accidental leaks

### System Prompt Leak Detector

Catch the model echoing, quoting, or paraphrasing its own system prompt back to the user. Distinct from the secret/PII filters — this looks for the _instructions themselves_ leaking, using n-gram and word overlap against the system prompt:

```ts
import { systemPromptLeakDetector } from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: openai('gpt-4o'),
  outputGuardrails: [systemPromptLeakDetector()],
});
```

The system prompt is read from the call context by default, so no configuration is needed. When a leak trips, a redacted copy of the output is provided on `metadata.sanitized` (leaked fragments replaced with `[REDACTED]`) — pair with `replaceOnBlocked` to swap it in, or pass an explicit `systemPrompt`, `threshold`, or `severity`.

**Use cases:** Preventing system-prompt extraction, protecting proprietary instructions

## MCP Security Guardrails

Specialized guardrails for Model Context Protocol (MCP) tools.

### MCP Security Guardrail

MCP security:

```ts
import { mcpSecurityGuardrail } from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: openai('gpt-4o'),
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

const model = withGuardrails({
  model: openai('gpt-4o'),
  outputGuardrails: [
    mcpResponseSanitizer(), // strips injection patterns instead of blocking
  ],
});
```

**Use cases:** Non-blocking security, content cleaning

### MCP Tool Scanner

`mcpSecurityGuardrail` scans tool _output_ at runtime; `scanMcpTool` scans a tool _definition_ at registration — before the model ever sees it. It catches malicious or compromised MCP servers via prompt-injection in the description (tool poisoning), names within edit-distance 2 of well-known tools (typosquatting), zero-width characters and homoglyphs (hidden instructions), and abnormally long instruction-laden descriptions (rug-pull):

```ts
import { scanMcpTool, scanMcpTools } from 'ai-sdk-guardrails';

// Vet tools before handing them to an agent
const results = scanMcpTools(await mcpClient.listTools());
const risky = results.filter((r) => !r.safe);
if (risky.length > 0) {
  throw new Error(
    `Unsafe MCP tools: ${risky.map((r) => r.toolName).join(', ')}`,
  );
}
```

Each result carries `threats` (typed by category and severity) and a capped `riskScore` (0–100). **Use cases:** MCP supply-chain security, vetting third-party tool servers.

## Governance Guardrails

These output guardrails govern agent behaviour: how much a run is allowed to spend, and whether a planned sequence of tool calls looks dangerous.

### Budget Guardrail

Cap cumulative cost, tokens, or tool calls across an agent run. Create a shared budget once, then pass it to the guardrail:

```ts
import { budgetGuardrail, createGuardrailBudget } from 'ai-sdk-guardrails';

const budget = createGuardrailBudget({
  maxCostUsd: 1.0, // hard ceiling in USD
  maxTokens: 100_000, // input + output
  maxToolCalls: 25,
});

const model = withGuardrails({
  model: openai('gpt-4o'),
  outputGuardrails: [
    budgetGuardrail({
      budget,
      estimateCost: ({ inputTokens, outputTokens }) =>
        ((inputTokens ?? 0) * 5 + (outputTokens ?? 0) * 15) / 1_000_000,
    }),
  ],
});
```

The budget accumulates across every call that shares it, so one budget instance governs a whole conversation or agent loop. **Use cases:** cost control, runaway-loop protection.

### Plan Risk Guardrail

Block runs whose planned tool sequence reaches a risk threshold. The built-in classifier flags untrusted-read-to-destructive chains and over-long tool sequences without calling a model:

```ts
import { planRiskGuardrail } from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: openai('gpt-4o'),
  outputGuardrails: [
    planRiskGuardrail({
      blockAtOrAbove: 'high', // 'low' | 'medium' | 'high' | 'critical'
    }),
  ],
});
```

Swap in a model-based classifier through the `classifier` option for production. **Use cases:** agent safety, SAIF Layer-2 reasoning defense.

## Prompt Hardening

Guardrails catch attacks at runtime; hardening lowers the odds one lands in the first place. `hardenSystemPrompt` wraps your system prompt with a block of defensive rules — instruction/data separation, anti-extraction, and a persona anchor:

```ts
import { hardenSystemPrompt } from 'ai-sdk-guardrails';

const system = hardenSystemPrompt('You are a financial advisor.', {
  customRules: ['Never mention competitors by name.'],
});

await generateText({ model, system, prompt: userInput });
```

It returns a plain string, so it composes with any model or framework. Pair it with `promptInjectionDetector` (input) and `systemPromptLeakDetector` (output) for defence in depth.

### Evaluating prompt defenses

The inverse of hardening: `evaluatePromptDefense` grades a system prompt A to F against 13 OWASP-LLM defense vectors (role boundary, data protection, indirect-injection handling, input validation, and more) and reports which are missing. Use it as a CI gate on your prompts:

```ts
import { evaluatePromptDefense } from 'ai-sdk-guardrails';

const report = evaluatePromptDefense(mySystemPrompt);
if (report.isBlocking('B')) {
  throw new Error(
    `System prompt too weak (${report.grade}); missing: ${report.missing.join(', ')}`,
  );
}
```

**Use cases:** Pre-deploy prompt linting, enforcing a defense baseline in CI.

## Combining Guardrails

Mix and match guardrails for protection:

```ts
const model = withGuardrails({
  model: openai('gpt-4o'),
  inputGuardrails: [
    piiDetector(),
    promptInjectionDetector(),
    inputLengthLimit(1000),
    rateLimiting({ maxRequestsPerMinute: 10, windowMs: 60000 }),
  ],
  outputGuardrails: [
    sensitiveDataFilter(),
    minLengthRequirement(100),
    toxicityFilter(0.7),
    schemaValidation(mySchema),
  ],
});
```

## Next Steps

- [Custom Guardrails](/guides/custom-guardrails/) - Create your own guardrails
- [Advanced Features](/guides/advanced-features/) - Composition, stream transforms, tool gating, and governance
