---
title: Built-in Guardrails
description: Complete reference of all built-in guardrails
---

AI SDK Guardrails ships 52 built-in guardrails: 48 from the root `ai-sdk-guardrails` entry (input, output, tool, MCP, governance and tool-parameter rails) and 4 advanced prompt-injection detectors from `ai-sdk-guardrails/advanced`.

:::note[Heuristic and offline by default]
No built-in guardrail calls a model or an external API. They run in-process and offline, and they are pattern heuristics, not trained classifiers: paraphrase, translation into an unsupported language, and novel phrasing get through. The [detection benchmark](/reference/threat-model/) measures each one against a labelled attack corpus; see the [threat model](/reference/threat-model/) for held-out catch and false-alarm rates.

- `promptInjectionDetector`, `enhancedPromptInjectionDetector` and its variants, `mcpToolResultGuardrail`: phrase-level injection signals, checked on de-obfuscated and decoded variants (NFKC, zero-width, split letters, base64/hex/URL/ROT13) plus override phrases in ten languages
- `toxicityDetector`, `toxicityFilter`: English phrase patterns for threats, insults and harassment aimed at a person
- `piiDetector`: regex with Luhn (cards) and mod-97 (IBAN) validation
- `hallucinationDetector`, `confidenceThreshold`: uncertainty phrases ("I think", "probably")
- `enhancedHallucinationDetector`, `factualAccuracyChecker`: claim phrases ("studies show") without citation markers
- `biasDetector`, `complianceChecker`, `privacyLeakageDetector`: phrase and regex lists
- `contentConsistencyChecker`: word overlap with a reference string

Where the numbers aren't good enough, put a model behind a guardrail with [`classifierGuardrail`](/guides/classifiers/) (any AI SDK model, OpenAI Moderation, Presidio, or a Hugging Face classifier such as Prompt Guard).
:::

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

**Obfuscation resistance:** input is normalized before matching, so leetspeak (`1gn0re`), homoglyphs (full-width / Cyrillic look-alikes), zero-width characters, spaced-out letters, and common typos are caught too. Normalization is additive: it never lowers detection on the raw text. Tune or disable it with the `normalize` option:

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
    toxicityDetector(0.7), // trips when the score reaches 0.7; lower = stricter
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

Flag input whose Shannon entropy is abnormally high: a signal of encoded or obfuscated payloads (base64 blobs, ciphertext, packed data) smuggled into a prompt. Natural language sits well below the default threshold:

```ts
import { highEntropyDetector } from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: openai('gpt-4o'),
  inputGuardrails: [highEntropyDetector({ threshold: 4.5, minLength: 40 })],
});
```

**Use cases:** Catching encoded payloads, defence against obfuscated injection

### On User Turn

Run any input guardrail only when the newest message is the user's. Inside a `ToolLoopAgent` input guardrails otherwise run on every step, including the ones whose newest message is a tool result:

```ts
import {
  agentGuardrails,
  onUserTurn,
  promptInjectionDetector,
} from 'ai-sdk-guardrails';

agentGuardrails({
  model,
  inputGuardrails: [
    promptInjectionDetector(), // every step
    onUserTurn(offTopicJudge), // once per user message
  ],
});
```

**Use cases:** LLM-judged checks, rate limits, per-message rules in agent loops

### Other input guardrails

| Guardrail                                                                                      | Purpose                                                                                                             |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `blockedWords(string[] \| { words, allowlist?, useWordBoundaries?, severity? })`               | Word blocking with word boundaries (on by default) and an allowlist. `blockedKeywords` is the partial-match variant |
| `contentLengthLimit(maxLength)`                                                                | Deprecated alias for `inputLengthLimit({ maxLength, countMethod: 'characters' })`                                   |
| `customInputValidation({ name, description, validator, message?, severity? })`                 | Your own predicate over the input, without writing a full guardrail                                                 |
| `mathHomeworkDetector({ enabled?, strictMode?, allowedContexts?, severity? })`                 | Policy rail for homework-style math requests. Disabled unless `enabled: true`                                       |
| `codeGenerationLimiter(string[] \| { allowedLanguages?, deniedLanguages?, mode?, severity? })` | Allow or deny code generation by programming language                                                               |

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
    toxicityFilter(0.7), // trips when the score reaches 0.7; lower = stricter
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
    secretRedaction, // a guardrail instance, not a factory: don't call it
  ],
});
```

**Use cases:** Security, preventing accidental leaks

### System Prompt Leak Detector

Catch the model echoing, quoting, or paraphrasing its own system prompt back to the user. Distinct from the secret/PII filters: this looks for the _instructions themselves_ leaking, using n-gram and word overlap against the system prompt:

```ts
import { systemPromptLeakDetector } from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: openai('gpt-4o'),
  outputGuardrails: [systemPromptLeakDetector()],
});
```

The system prompt is read from the call context by default, so no configuration is needed. When a leak trips, a redacted copy of the output is provided on `metadata.sanitized` (leaked fragments replaced with `[REDACTED]`): pair with `replaceOnBlocked` to swap it in, or pass an explicit `systemPrompt`, `threshold`, or `severity`.

**Use cases:** Preventing system-prompt extraction, protecting proprietary instructions

### Other output guardrails

| Guardrail                                                                                                                              | Purpose                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blockedContent(words)`                                                                                                                | Block responses containing any of the given words                                                                                                                                                                                                                                                             |
| `customOutputValidation(name, validator, message)`                                                                                     | Your own boolean predicate over the output                                                                                                                                                                                                                                                                    |
| `tokenUsageLimit(maxTokens)`                                                                                                           | Block when reported total tokens exceed the limit                                                                                                                                                                                                                                                             |
| `performanceMonitor(maxGenerationTimeMs)`                                                                                              | Flag slow generations                                                                                                                                                                                                                                                                                         |
| `biasDetector()`                                                                                                                       | Phrase-list bias detection (gender, age, and similar stereotypes)                                                                                                                                                                                                                                             |
| `factualAccuracyChecker(requireSources?)`                                                                                              | Flag factual-claim phrases without sources                                                                                                                                                                                                                                                                    |
| `privacyLeakageDetector()`                                                                                                             | Regex/keyword detection of emails, phone numbers, financial and location terms in output                                                                                                                                                                                                                      |
| `contentConsistencyChecker(referenceContent?)`                                                                                         | Word-overlap consistency against a reference; no-op without one                                                                                                                                                                                                                                               |
| `complianceChecker(regulations)`                                                                                                       | Phrase checks for `'gdpr'`, `'hipaa'`, `'pci'`, `'sox'`, `'coppa'`                                                                                                                                                                                                                                            |
| `unsafeContentDetector`                                                                                                                | Harmful or prohibited content (instance, not a factory)                                                                                                                                                                                                                                                       |
| `costQuotaRails({ maxTokensPerRequest?, maxCostPerRequest?, tokenCostPer1K? })`                                                        | Per-request token and cost ceilings. For cumulative budgets use `budgetGuardrail`                                                                                                                                                                                                                             |
| `enhancedHallucinationDetector({ requireCitations?, citationFormats?, factCheckPatterns?, confidenceThreshold?, schemaConstraints? })` | Citation-aware variant of `hallucinationDetector`                                                                                                                                                                                                                                                             |
| `retryAfterIntegration({ maxRetryDelayMs?, defaultBackoffMs?, jitterFactor?, minRemaining? })`                                         | Reads the provider's `retry-after` / `retry-after-ms` and `x-ratelimit-remaining-*` / `x-ratelimit-reset-*` response headers. Trips when the provider asks you to back off or a remaining quota is at or below `minRemaining` (default 0), with a jittered `recommendedBackoffMs` capped at `maxRetryDelayMs` |

## MCP Security Guardrails

Specialized guardrails for Model Context Protocol (MCP) tools.

### MCP Tool Result Guardrail

Indirect prompt injection arrives in tool results. `mcpToolResultGuardrail` is an **input** guardrail: on each agent step it scans the `tool` messages since the last assistant turn, before the model reads them, and passes on steps with no new tool results.

```ts
import { agentGuardrails, mcpToolResultGuardrail } from 'ai-sdk-guardrails';
import { ToolLoopAgent } from 'ai';

const agent = new ToolLoopAgent({
  ...agentGuardrails({
    model: openai('gpt-4o'),
    inputGuardrails: [
      mcpToolResultGuardrail({ allowedDomains: ['api.company.com'] }),
    ],
  }),
  tools,
});
```

It takes the same options as `mcpSecurityGuardrail` and also trips on phrase-level injection signals aimed at the model ("note to the AI: …", "assistant, when you read this…", fake role markup).

### MCP Security Guardrail

An **output** guardrail that checks the model's own response for signs it is acting on an injection: exfiltration URLs, encoded payloads, cascading tool instructions. Pair it with `mcpToolResultGuardrail`, which catches the injection on the way in.

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

`mcpToolResultGuardrail` scans the tool results the model is about to read and `mcpSecurityGuardrail` scans the model's own output for signs it is acting on an injection; `scanMcpTool` scans a tool _definition_ at registration: before the model ever sees it. It catches malicious or compromised MCP servers via prompt-injection in the description (tool poisoning), names within edit-distance 2 of well-known tools (typosquatting), zero-width characters and homoglyphs (hidden instructions), abnormally long instruction-laden descriptions (rug-pull), and descriptions that tell the model to read secret files or send user data to an external URL, email or DNS lookup (exfiltration):

```ts
import { scanMcpTool, scanMcpTools } from 'ai-sdk-guardrails';

// Vet tools before handing them to an agent
const { tools: definitions } = await mcpClient.listTools();
const results = scanMcpTools(
  definitions.map((t) => ({ name: t.name, description: t.description ?? '' })),
);
const risky = results.filter((r) => !r.safe);
if (risky.length > 0) {
  throw new Error(
    `Unsafe MCP tools: ${risky.map((r) => r.toolName).join(', ')}`,
  );
}
```

Each result carries `threats` (typed by category and severity) and a capped `riskScore` (0–100). **Use cases:** MCP supply-chain security, vetting third-party tool servers.

`guardMcpTools(await client.tools(), { allow, pinned })` wraps the scanner for AI SDK tool sets: it returns only the tools that pass, enforces a name allowlist, and blocks tools whose description changed since you pinned it. Call it on every fetch.

See the [MCP Security guide](/guides/mcp/) for the full picture: definition scanning, approval gating, and the limits of these heuristics.

## Tool Guardrails

Output guardrails that inspect the tool calls in a result.

| Guardrail                                                                                                                                         | Purpose                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `expectedToolUse({ tools, requireAll?, mode?, textMarkers? })`                                                                                    | Require that specific tools were called (detected from provider metadata or text markers) |
| `toolEgressPolicy({ allowedTools?, deniedTools?, allowedHosts?, blockedHosts?, parameterRules?, scanForUrls?, allowFileUrls?, allowLocalhost? })` | Allow/deny tools and the hosts their arguments reach                                      |

```ts
import { toolEgressPolicy } from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: openai('gpt-4o'),
  outputGuardrails: [
    toolEgressPolicy({
      allowedTools: ['search', 'fetch'],
      allowedHosts: ['api.company.com'],
    }),
  ],
});
```

## Tool-Parameter Guardrails

These validate a tool call's name and arguments **before the tool runs**. They are not `withGuardrails` rails. Pass them to `guardrailApproval`, which turns them into an AI SDK v7 `toolApproval` function:

| Guardrail                                                                | Checks                                                                  | Severity on failure |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------- |
| `sqlInjectionGuardrail({ toolName?, patterns? })`                        | `query` / `sql` arguments against SQL-injection patterns                | `critical`          |
| `pathTraversalGuardrail({ toolName?, allowedPaths?, blockedPatterns? })` | `path` / `file` / `filename` arguments for `..`, `/etc/`, and similar   | varies              |
| `parameterLengthGuardrail({ toolName?, maxLength?, fields? })`           | String arguments longer than `maxLength` (default 10000)                | `medium`            |
| `toolRBACGuardrail({ toolName, requiredPermissions, mode? })`            | `requestContext.permissions` contains any (or all) required permissions | varies              |

`toolName` defaults to `'*'` (all tools) for the first three.

```ts
import { generateText } from 'ai';
import {
  guardrailApproval,
  sqlInjectionGuardrail,
  toolRBACGuardrail,
} from 'ai-sdk-guardrails';

await generateText({
  model,
  tools,
  prompt: userPrompt,
  toolApproval: guardrailApproval(
    [
      sqlInjectionGuardrail({ toolName: 'executeSQL' }),
      toolRBACGuardrail({
        toolName: 'deleteUser',
        requiredPermissions: ['admin'],
      }),
    ],
    { requestContext: { permissions: user.permissions } },
  ),
});
```

Failures at or above `denyAtOrAbove` (default `'high'`) are `denied`. Lower-severity failures become `user-approval`. For the lower-level `execute()`-wrapping form, see `withToolParameterGuardrails` in `ai-sdk-guardrails/advanced`.

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

For agent loops that propose **one tool per step**, pass a shared session so the classifier sees the running chain across turns:

```ts
import { createPlanRiskSession, planRiskGuardrail } from 'ai-sdk-guardrails';

const session = createPlanRiskSession();

const model = withGuardrails({
  model: openai('gpt-4o'),
  outputGuardrails: [planRiskGuardrail({ session, blockAtOrAbove: 'high' })],
});
```

### Evaluation Scope Guardrail

Keep eval agents inside their sandbox: block external hosts, suspicious registry writes, and cross-agent coordination filenames (Artifactory message-board pattern):

```ts
import { evaluationScopeGuardrail } from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: openai('gpt-4o'),
  outputGuardrails: [
    evaluationScopeGuardrail({
      sharedStoreId: 'artifactory-eval-1',
      denyRegistryWrites: true,
      denySuspiciousFilenames: true,
    }),
  ],
});
```

**Use cases:** eval sandboxes, exploit-gym isolation, preventing scope creep to HuggingFace or cloud metadata endpoints. See [Eval Sandbox guide](/guides/eval-sandbox/).

## Advanced Injection Detectors

Multi-signal variants of `promptInjectionDetector`, exported from `ai-sdk-guardrails/advanced`. All are offline heuristics: pattern scoring, context coherence, conversation flow and keyword-based intent extraction.

| Detector                                                                            | Signals enabled                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enhancedPromptInjectionDetector(options?)`                                         | Everything: incremental (cross-turn) scoring, tool-call focus, intent extraction                                                                                                                                              |
| `incrementalPromptInjectionDetector({ conversationMemory?, cumulativeThreshold? })` | Cumulative risk across recent conversation turns                                                                                                                                                                              |
| `toolCallInjectionDetector({ confidenceThreshold? })`                               | Injection aimed at tool or function calls                                                                                                                                                                                     |
| `intentBasedInjectionDetector({ confidenceThreshold? })`                            | Base pattern scoring plus phrase-level manipulation cues (instruction ignoring, authority claims, safety override, prompt extraction, persona shift, secrecy). Two cues trip on their own; one cue halves the score threshold |

```ts
import { enhancedPromptInjectionDetector } from 'ai-sdk-guardrails/advanced';

const model = withGuardrails({
  model: openai('gpt-4o'),
  inputGuardrails: [
    enhancedPromptInjectionDetector({ confidenceThreshold: 0.7 }),
  ],
});
```

## Prompt Hardening

Guardrails catch attacks at runtime; hardening lowers the odds one lands in the first place. `hardenSystemPrompt` wraps your system prompt with a block of defensive rules: instruction/data separation, anti-extraction, and a persona anchor:

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
- [MCP Security](/guides/mcp/) - Definition scanning, approval gating, and limits
- [OPA & Policy Interop](/guides/policy-opa/) - Shadow-mode rollout and total MCP coverage
- [Governance](/guides/governance/) - SAIF policy decisions via autotel-genai
