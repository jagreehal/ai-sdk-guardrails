---
'ai-sdk-guardrails': minor
---

Add `onUserTurn(guardrail)`, which runs an input guardrail only when the newest message is the user's and skips the tool-loop steps that follow. Read a system message with string content when normalising the guardrail context, so `systemPromptLeakDetector()` picks up `ToolLoopAgent` instructions with no configuration. Widen the optional `autotel-genai` peer range to `>=0.4.2`. Update dependencies.
