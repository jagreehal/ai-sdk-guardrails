# AI SDK Guardrails Examples

Short, focused scripts that show common guardrail patterns. Each file is self-contained.

## Run

```bash
# Ensure your provider env is set (e.g., OPENAI_API_KEY)
# Then run any script with tsx
npx tsx examples/01-input-length-limit.ts
```

## Highlights

- Quick starts
  - [07a-simple-combined-protection.ts](./07a-simple-combined-protection.ts) — minimal input and output setup
  - [32-auto-retry-output.ts](./32-auto-retry-output.ts) — retry until output meets a rule
  - [33-judge-auto-retry.ts](./33-judge-auto-retry.ts) — LLM-judge reasons drive auto-retry
  - [34-expected-tool-use-retry.ts](./34-expected-tool-use-retry.ts) — expect tool use and retry
  - [33-blog-post-weather-assistant.ts](./33-blog-post-weather-assistant.ts) — end-to-end input/output + retry

- Input safety
  - [01-input-length-limit.ts](./01-input-length-limit.ts) — enforce max input length
  - [02-blocked-keywords.ts](./02-blocked-keywords.ts) — block specific terms
  - [03-pii-detection.ts](./03-pii-detection.ts) — detect PII before calling the model
  - [13-rate-limiting.ts](./13-rate-limiting.ts) — simple per-user rate limit

- Output safety
  - [04-output-length-check.ts](./04-output-length-check.ts) — require min/max output length
  - [05-sensitive-output-filter.ts](./05-sensitive-output-filter.ts) — filter secrets and PII in responses
  - [19-hallucination-detection.ts](./19-hallucination-detection.ts) — flag uncertain factual claims

- Streaming
  - [11-streaming-limits.ts](./11-streaming-limits.ts) — apply limits in buffered streaming
  - [12-streaming-quality.ts](./12-streaming-quality.ts) — quality checks with streaming
  - [28-streaming-early-termination.ts](./28-streaming-early-termination.ts) — stop streams early when blocked

- Advanced
  - [15a-simple-quality-judge.ts](./15a-simple-quality-judge.ts) — cheaper model judges quality
  - [18-secret-leakage-scan.ts](./18-secret-leakage-scan.ts) — scan responses for secrets
  - [24-sql-code-safety.ts](./24-sql-code-safety.ts) — basic SQL safety checks
  - [23-role-hierarchy-enforcement.ts](./23-role-hierarchy-enforcement.ts) — enforce role rules in prompts
  - [39-advanced-security-guardrails.ts](./39-advanced-security-guardrails.ts) — comprehensive security guardrails
  - [40-comprehensive-tool-security.ts](./40-comprehensive-tool-security.ts) — complete tool security with role-based access

## Full Index

| Example                      | File                                                                                 | Tags                      |
| ---------------------------- | ------------------------------------------------------------------------------------ | ------------------------- |
| Input length limit           | [01-input-length-limit.ts](./01-input-length-limit.ts)                               | input, limits             |
| Blocked keywords             | [02-blocked-keywords.ts](./02-blocked-keywords.ts)                                   | input, filtering          |
| PII detection (input)        | [03-pii-detection.ts](./03-pii-detection.ts)                                         | input, pii, safety        |
| Output length check          | [04-output-length-check.ts](./04-output-length-check.ts)                             | output, limits            |
| Sensitive output filter      | [05-sensitive-output-filter.ts](./05-sensitive-output-filter.ts)                     | output, pii, secrets      |
| Quality assessment           | [06-quality-assessment.ts](./06-quality-assessment.ts)                               | output, quality           |
| Combined protection          | [07-combined-protection.ts](./07-combined-protection.ts)                             | combined                  |
| Simple combined protection   | [07a-simple-combined-protection.ts](./07a-simple-combined-protection.ts)             | quickstart, combined      |
| Blocking vs warning          | [08-blocking-vs-warning.ts](./08-blocking-vs-warning.ts)                             | behavior, policy          |
| Schema validation            | [09-schema-validation.ts](./09-schema-validation.ts)                                 | output, schema            |
| Object content filter        | [10-object-content-filter.ts](./10-object-content-filter.ts)                         | output, object            |
| Streaming limits             | [11-streaming-limits.ts](./11-streaming-limits.ts)                                   | streaming, limits         |
| Streaming quality            | [12-streaming-quality.ts](./12-streaming-quality.ts)                                 | streaming, quality        |
| Rate limiting                | [13-rate-limiting.ts](./13-rate-limiting.ts)                                         | input, rate limit         |
| Business logic               | [14-business-logic.ts](./14-business-logic.ts)                                       | input, custom             |
| LLM as judge                 | [15-llm-as-judge.ts](./15-llm-as-judge.ts)                                           | output, quality, judge    |
| Simple quality judge         | [15a-simple-quality-judge.ts](./15a-simple-quality-judge.ts)                         | output, quality, judge    |
| Prompt injection detection   | [16-prompt-injection-detection.ts](./16-prompt-injection-detection.ts)               | input, security           |
| Tool call validation         | [17-tool-call-validation.ts](./17-tool-call-validation.ts)                           | tools, validation         |
| Tool allowlist               | [17a-basic-tool-allowlist.ts](./17a-basic-tool-allowlist.ts)                         | tools, security           |
| Tool parameter validation    | [17b-tool-parameter-validation.ts](./17b-tool-parameter-validation.ts)               | tools, validation         |
| Secret leakage scan          | [18-secret-leakage-scan.ts](./18-secret-leakage-scan.ts)                             | output, security          |
| Hallucination detection      | [19-hallucination-detection.ts](./19-hallucination-detection.ts)                     | output, safety            |
| Human review escalation      | [20-human-review-escalation.ts](./20-human-review-escalation.ts)                     | workflow, review          |
| Regulated advice compliance  | [21-regulated-advice-compliance.ts](./21-regulated-advice-compliance.ts)             | compliance, safety        |
| Response consistency         | [22-response-consistency.ts](./22-response-consistency.ts)                           | output, quality           |
| Role hierarchy enforcement   | [23-role-hierarchy-enforcement.ts](./23-role-hierarchy-enforcement.ts)               | input, roles, policy      |
| SQL code safety              | [24-sql-code-safety.ts](./24-sql-code-safety.ts)                                     | code, security            |
| Browsing domain allowlist    | [25-browsing-domain-allowlist.ts](./25-browsing-domain-allowlist.ts)                 | tools, browsing, security |
| Memory minimization          | [26-memory-minimization.ts](./26-memory-minimization.ts)                             | privacy, safety           |
| Logging redaction            | [27-logging-redaction.ts](./27-logging-redaction.ts)                                 | privacy, logging          |
| Streaming early termination  | [28-streaming-early-termination.ts](./28-streaming-early-termination.ts)             | streaming, control        |
| Toxicity & deescalation      | [29-toxicity-harassment-deescalation.ts](./29-toxicity-harassment-deescalation.ts)   | safety, toxicity          |
| Jailbreak detection          | [30-jailbreak-detection.ts](./30-jailbreak-detection.ts)                             | security                  |
| Autoevals guardrails         | [31-autoevals-guardrails.ts](./31-autoevals-guardrails.ts)                           | testing, evals            |
| Auto retry output            | [32-auto-retry-output.ts](./32-auto-retry-output.ts)                                 | retry, output             |
| Blog post weather assistant  | [33-blog-post-weather-assistant.ts](./33-blog-post-weather-assistant.ts)             | input, output, retry      |
| Expected tool use retry      | [34-expected-tool-use-retry.ts](./34-expected-tool-use-retry.ts)                     | retry, tools              |
| LLM judge auto-retry         | [35-judge-auto-retry.ts](./33-judge-auto-retry.ts)                                   | retry, judge, quality     |
| Agent example                | [36-agent-example.ts](./36-agent-example.ts)                                         | agent, tools              |
| Agent composition cascade    | [37-agent-composition-cascade-failure.ts](./37-agent-composition-cascade-failure.ts) | agent, reliability        |
| Agent routing reliability    | [38-agent-routing-reliability.ts](./38-agent-routing-reliability.ts)                 | agent, routing            |
| Advanced security guardrails | [39-advanced-security-guardrails.ts](./39-advanced-security-guardrails.ts)           | security, comprehensive   |
| Comprehensive tool security  | [40-comprehensive-tool-security.ts](./40-comprehensive-tool-security.ts)             | tools, security, roles    |
