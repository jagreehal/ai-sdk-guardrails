---
title: Threat Model and Detection Rates
description: What each built-in detector is meant to stop, what it misses, and how well it does on a labelled attack corpus.
---

The built-in detectors are offline heuristics. This page says what each one is for, what it is not for, and how it scores on the repository's labelled corpus, so you can decide where a heuristic is enough and where you need a [model-backed classifier](/guides/classifiers/).

## How the numbers are produced

`packages/ai-sdk-guardrails/bench/` holds a labelled corpus of synthetic attacks and benign look-alikes (705 samples across prompt injection, PII, secrets, toxicity and MCP tool definitions) and a benchmark that runs every detector against it. CI fails if a catch rate drops or a false-alarm rate rises.

- **Catch rate**: share of attack samples the detector flags.
- **False alarms**: share of benign samples it flags. Half the benign samples are deliberate look-alikes ("how do I ignore a file in git", order numbers, `kill -9`), so this number is pessimistic for ordinary traffic.
- **Held-out**: about 30% of samples, chosen by a hash of their id, are never looked at when tuning a detector. Those numbers are the honest ones; the full-corpus numbers include samples the patterns were written against.

The corpus is small and synthetic. Treat the numbers as a regression baseline and a rough ranking, not as a guarantee about your traffic. Run `pnpm --filter ai-sdk-guardrails bench` locally; `bench/RESULTS.md` has the per-technique breakdown.

## Held-out results

| Area                 | Detector                                              | Catch rate | False alarms |
| -------------------- | ----------------------------------------------------- | ---------- | ------------ |
| Prompt injection     | `promptInjectionDetector`                             | 56%        | 10%          |
| Prompt injection     | `enhancedPromptInjectionDetector`                     | 63%        | 10%          |
| Prompt injection     | `mcpToolResultGuardrail` (injection in a tool result) | 63%        | 13%          |
| PII                  | `piiDetector`                                         | 79%        | 6%           |
| Secrets in output    | `secretRedaction`                                     | 88%        | 0%           |
| Secrets in output    | `sensitiveDataFilter`                                 | 35%        | 0%           |
| Toxicity             | `toxicityDetector` / `toxicityFilter`                 | 47%        | 5%           |
| MCP tool definitions | `scanMcpTool`                                         | 75%        | 0%           |
| MCP tool definitions | `guardMcpTools` (blocks at `high`)                    | 58%        | 0%           |

## Per detector

### Prompt injection: `promptInjectionDetector`, `enhancedPromptInjectionDetector`, `mcpToolResultGuardrail`

**Meant to stop:** instruction override ("ignore/disregard/forget … instructions"), system-prompt extraction, persona and "developer mode" switches, fake role or delimiter markup (`<|im_start|>`, `</system>`, `"role":"system"`), text addressed to the AI from inside data (indirect injection), decode-and-obey and split-payload tricks. Text is also checked after removing zero-width and bidi characters, NFKC folding (fullwidth, mathematical letters), rejoining split letters (`i.g.n.o.r.e`), and decoding base64, hex, binary, URL-encoding, ROT13 and reversed text. Override phrases are recognised in Spanish, French, German, Italian, Portuguese, Chinese, Japanese, Russian, Arabic, Hindi and Korean.

**Weakest on (full corpus):** split payloads (about 50%), role-play framings (about 60%), spacing tricks (60%) and indirect injection phrased as ordinary prose (about 60%).

**Not meant to stop:** paraphrased attacks that avoid the phrase patterns, languages outside the list above, or attacks spread across several turns. A quoted mention ("what does 'ignore previous instructions' mean?") counts at half weight, but some security discussions still trip (9–31% false alarms on look-alikes, depending on the detector).

**Where tool output is checked:** `promptInjectionDetector`, `mcpToolResultGuardrail` and `classifierGuardrail` read tool results on every agent step, so they cover indirect injection. Length, PII and other input rails judge only what the user sent. Wrap expensive rails with `onUserTurn` if they should only run on user turns.

### PII: `piiDetector`

**Meant to stop:** emails, US and international phone numbers (with separators), SSNs, Luhn-valid card numbers, IBANs (mod-97 checked), IP addresses, US street addresses, and spelled-out emails ("jane at example dot com").

**Weakest on:** other obfuscation (spaced or worded digits, about 30%) and non-US address formats.

**Not meant to stop:** names, dates of birth, free-text health or financial details. Use `presidioClassifier` for entity recognition beyond fixed formats.

### Secrets in output: `secretRedaction`, `sensitiveDataFilter`

**Meant to stop (`secretRedaction`):** AWS key pairs, GitHub tokens (`ghp_`, `gho_`, `github_pat_` …), Google API keys, JWTs, PEM private keys, connection strings with credentials (Postgres, MySQL, Mongo, Redis, AMQP, SQL Server …), and passwords stated in prose ("the password is …"). Documented placeholders (`ghp_xxxx…`, `AKIA…EXAMPLE`, `USER:PASSWORD`) are ignored.

**Weakest on:** provider keys without a fixed prefix pattern (OpenAI `sk-` keys about 60%) and passwords phrased unusually.

`sensitiveDataFilter` is a narrower, older filter; prefer `secretRedaction` for credentials.

### Toxicity: `toxicityDetector`, `toxicityFilter`

**Meant to stop:** English threats ("I'll find you", "I know where you live"), self-harm encouragement, insults and harassment aimed at a person ("you're worthless", "everyone hates you"), including leetspeak and spacing. Figurative uses ("kill the process") don't match.

**Weakest on:** harassment without stock phrases (about 33%) and insults phrased creatively (about 40%).

**Not meant to stop:** hate speech classification, other languages, sarcasm or context-dependent abuse. Use `openAIModerationClassifier` or an `llmClassifier` for those.

### MCP tool definitions: `scanMcpTool`, `guardMcpTools`

**Meant to stop:** prompt injection in descriptions (tool poisoning), names one edit from well-known tools (typosquatting), zero-width and homoglyph characters, abnormally long instruction-laden descriptions (rug-pull), and exfiltration instructions: reading secret files (`~/.ssh/id_*`, `.env`, `.aws/credentials`), sending user data to an external URL or email, templating user data into a URL, or DNS-encoding data. `guardMcpTools` also blocks names outside an allowlist and descriptions that changed since you pinned them.

**Note:** `guardMcpTools` blocks at `high` by default, so typosquats (rated `medium`) are reported by `scanMcpTool` but not blocked. Pass `blockAtOrAbove: 'medium'` to block them.

**Not meant to stop:** a malicious server whose descriptions are clean but whose tool _behaviour_ is hostile. Gate calls with `guardrailApproval` and scan results with `mcpToolResultGuardrail`.

## When to add a classifier

Use a heuristic alone when the cost of a miss is low, or as a free first pass. Add a [model-backed classifier](/guides/classifiers/) when:

- you face motivated attackers (public agents, agents with write tools or access to private data),
- your users write in languages outside the lists above,
- false alarms on security discussions are unacceptable, or
- you need categories the heuristics don't cover (hate, sexual content, self-harm at large, entity-level PII).

`bench/providers.test.ts` runs the same corpus through the model-backed classifiers (`BENCH_PROVIDERS=1`), so you can compare them on equal terms before switching.
