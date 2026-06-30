---
'ai-sdk-guardrails': patch
---

Sync `text` and `content` on generate results after output guardrails run. AI SDK v7 reads user-visible text from the `content` array, so guardrails that only mutated the top-level `text` field (including in-place redaction) were silently ignored. Middleware now snapshots the result before guardrails and aligns both fields before returning.
