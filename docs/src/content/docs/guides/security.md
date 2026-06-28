---
title: Security
description: Layer prompt hardening, injection detection, MCP tool scanning, and output checks for defense in depth
---

No single guardrail stops every attack. Stack them. Harden the system prompt so fewer attacks land, detect malicious input before the model sees it, vet any tools you hand the model, and check the output before it reaches the user. Each layer catches what the one before it missed.

## Layer 1: Harden and grade the system prompt

`hardenSystemPrompt` wraps your prompt with defensive rules: it separates instructions from user data, resists extraction, and anchors the model's role.

```ts
import { hardenSystemPrompt } from 'ai-sdk-guardrails';

const system = hardenSystemPrompt('You are a financial advisor.', {
  customRules: ['Never mention competitors by name.'],
});

await generateText({ model, system, prompt: userInput });
```

`evaluatePromptDefense` does the reverse. It grades a prompt A to F against 13 OWASP-LLM defense vectors and names the ones you skipped. Run it in CI so a weak prompt fails the build:

```ts
import { evaluatePromptDefense } from 'ai-sdk-guardrails';

const report = evaluatePromptDefense(system);
if (report.isBlocking('B')) {
  throw new Error(
    `Prompt scored ${report.grade}; missing: ${report.missing.join(', ')}`,
  );
}
```

## Layer 2: Detect malicious input

`promptInjectionDetector` normalizes input before matching, so it catches the obfuscated variants that slip past raw pattern matching. Leetspeak (`1gn0re`), full-width and Cyrillic homoglyphs, zero-width characters, spaced-out letters, and chat-template delimiters (`<|im_start|>`, `[INST]`, `<<SYS>>`) all resolve to the same patterns as their plain-text forms. Normalization is additive, so it never weakens detection on the raw text.

```ts
import {
  withGuardrails,
  promptInjectionDetector,
  highEntropyDetector,
} from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: openai('gpt-4o'),
  inputGuardrails: [
    promptInjectionDetector(),
    highEntropyDetector(), // flags encoded/obfuscated payloads
  ],
});
```

`highEntropyDetector` flags input whose Shannon entropy runs abnormally high, the signature of base64 blobs, ciphertext, or packed payloads smuggled into a prompt. Ordinary prose sits well under the threshold.

## Layer 3: Vet MCP tools before you use them

A compromised MCP server can hide instructions inside a tool description or ship a name one keystroke away from a tool you trust. `scanMcpTool` inspects a tool definition before the model ever sees it, and reports poisoning, typosquatting, hidden characters, and rug-pull payloads.

```ts
import { scanMcpTools } from 'ai-sdk-guardrails';

const results = scanMcpTools(await mcpClient.listTools());
const risky = results.filter((r) => !r.safe);
if (risky.length > 0) {
  throw new Error(
    `Unsafe MCP tools: ${risky.map((r) => r.toolName).join(', ')}`,
  );
}
```

This guards the supply chain. For runtime defense against malicious tool _responses_, add `mcpSecurityGuardrail` to your output guardrails.

## Layer 4: Guard the output

Even a clean request can produce a response that leaks the system prompt or sensitive data. `systemPromptLeakDetector` catches the model echoing its own instructions; `sensitiveDataFilter` strips secrets and API keys.

```ts
import {
  withGuardrails,
  systemPromptLeakDetector,
  sensitiveDataFilter,
} from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: openai('gpt-4o'),
  outputGuardrails: [systemPromptLeakDetector(), sensitiveDataFilter()],
});
```

When a leak trips, `systemPromptLeakDetector` puts a redacted copy on `metadata.sanitized`. Pair it with `replaceOnBlocked` to return the cleaned text instead of the leak.

## Putting it together

```ts
import {
  withGuardrails,
  hardenSystemPrompt,
  promptInjectionDetector,
  highEntropyDetector,
  systemPromptLeakDetector,
  sensitiveDataFilter,
  mcpSecurityGuardrail,
} from 'ai-sdk-guardrails';

const system = hardenSystemPrompt('You are a support agent.');

const model = withGuardrails({
  model: openai('gpt-4o'),
  inputGuardrails: [promptInjectionDetector(), highEntropyDetector()],
  outputGuardrails: [
    systemPromptLeakDetector(),
    sensitiveDataFilter(),
    mcpSecurityGuardrail(),
  ],
  throwOnBlocked: true,
});

await generateText({ model, system, prompt: userInput });
```

Scan your MCP tools at startup, grade the prompt in CI, and let the guardrails run on every call.

## Next Steps

- [Built-in Guardrails](/reference/built-in-guardrails/) - Every guardrail and its options
- [Advanced Features](/guides/advanced-features/) - Stream transforms, tool gating, governance
- [Custom Guardrails](/guides/custom-guardrails/) - Write your own checks
