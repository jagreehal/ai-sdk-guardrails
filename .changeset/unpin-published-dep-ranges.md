---
'ai-sdk-guardrails': patch
---

Restore caret ranges on published `dependencies` and `peerDependencies`.

A version-pinning sweep had changed these to exact versions, which would have forced every consumer
onto exactly `ai@7.0.58` / `autotel-genai@0.4.2` and installed a duplicate `zod` alongside their own —
duplicate `zod` copies break `instanceof` checks across the boundary. Ranges are carets again, as they
were before.
