---
"ai-sdk-guardrails": major
---

Require AI SDK v7. The package now targets `ai@^7` and `@ai-sdk/provider@^4`, and
its middleware is emitted as `LanguageModelV4Middleware` (`specificationVersion: 'v4'`).

**Breaking**

- Peer dependency bump: requires `ai@^7.0.0` (now a `peerDependency`, not bundled)
  and `@ai-sdk/provider@^4`. Stay on `ai-sdk-guardrails@5.x` if you are on AI SDK v6.
- Advanced provider types are now exported under their V4 names
  (`LanguageModelV4`, `LanguageModelV4Middleware`, `LanguageModelV4CallOptions`, …).
  The old `LanguageModelV3*` names remain as deprecated aliases and will be removed
  in a future major.

**New**

- `guardrailApproval(guardrails, options?)` — adapts tool-parameter guardrails
  (e.g. `sqlInjectionGuardrail`, `toolRBACGuardrail`) into AI SDK v7's first-class
  `toolApproval` slot. The result drops straight into a `ToolLoopAgent` (the
  recommended agent API) as well as `generateText` / `streamText`, with the tool
  set inferred and no casts at the call site. Maps guardrail
  results to `approved` / `denied` / `user-approval` / `not-applicable`, with a
  configurable severity threshold (`denyAtOrAbove`), an `onBlock` override, and an
  `onDecision` observability hook. This is the recommended way to gate tool calls;
  it gains pause/resume and human-in-the-loop that wrapping the model cannot.

**Unchanged**

- The public API is source-compatible: `withGuardrails`, `defineInputGuardrail`,
  `defineOutputGuardrail`, and all built-in content guardrails keep the same
  signatures and behaviour.

**Docs**

- New Cookbook section with five intent-based recipe pages (input safety, output
  safety, quality and judges, security, tools and agents). Each recipe pairs a
  runnable example with its real captured terminal output and a Mermaid flow.
