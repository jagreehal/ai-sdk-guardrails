---
title: MCP Security
description: Scan MCP tool definitions, check outputs at runtime, and gate MCP tool calls with approval
---

A Model Context Protocol (MCP) server decides which tools your model sees, what their descriptions say, and what they return. Each of those is a place an attacker can inject content. The library covers four points in that flow:

| When            | API                                            | What it checks                                                     |
| --------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| Definition time | `scanMcpTool` / `scanMcpTools`                 | Tool names and descriptions, before the model sees them            |
| Call time       | `guardrailApproval` → `toolApproval`           | Each tool call's name and arguments, before the tool runs          |
| Result time     | `mcpToolResultGuardrail` (input guardrail)     | Tool results new in this step, before the model reads them         |
| Output time     | `mcpSecurityGuardrail`, `mcpResponseSanitizer` | Generated output, for signs that injected tool content took effect |

All of these are exported from `ai-sdk-guardrails`. Read [Limits](#limits) before relying on any of them.

## Definition-time scanning

`scanMcpTool(tool, options?)` checks one tool definition (`{ name, description, parameters? }`). `scanMcpTools(tools, options?)` checks an array and returns one result per tool. Both are pure, synchronous and make no network calls.

```ts
import { createMCPClient } from '@ai-sdk/mcp';
import { scanMcpTools } from 'ai-sdk-guardrails';

const mcpClient = await createMCPClient({ transport });

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

const tools = await mcpClient.tools();
```

Each `McpScanResult` has `toolName`, `threats`, `riskScore` (0–100, capped) and `safe` (`true` when there are no threats). Each threat has a `type`, a `severity`, a `description` and optional `evidence`:

| Threat type          | Detection                                                                                                                | Severity                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| `tool_poisoning`     | Injection phrases in the description (`<system>`, "ignore previous", "you must", "act as", ...), also after URL-decoding | `critical`               |
| `typosquatting`      | Name within Levenshtein distance 1–2 of a known tool name                                                                | `high` (1), `medium` (2) |
| `hidden_instruction` | Zero-width characters or homoglyphs in the description                                                                   | `high`                   |
| `rug_pull`           | Description longer than `rugPullDescriptionLength` with at least `rugPullMinInstructionMatches` instruction-like phrases | `medium`                 |

Options (`McpToolScanOptions`):

| Option                         | Default                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `knownToolNames`               | Built-in list (`read_file`, `write_file`, `execute_command`, `send_email`, `query_database`, ...) |
| `rugPullDescriptionLength`     | `500`                                                                                             |
| `rugPullMinInstructionMatches` | `2`                                                                                               |

Pass your own `knownToolNames` (for example, the names of tools from servers you trust) to improve typosquatting detection.

## Re-scanning when tools change

Tool definitions are not fixed: a server can add tools or rewrite a description
after you reviewed it (a "rug pull"). The AI SDK MCP client has no tools-changed
callback, so gate the tool set every time you fetch it with `guardMcpTools`. It
scans each definition, enforces a tool-name allowlist, and blocks any tool whose
description no longer matches what you pinned.

```ts
import { createMCPClient } from '@ai-sdk/mcp';
import { guardMcpTools } from 'ai-sdk-guardrails';

const mcpClient = await createMCPClient({ transport });

const { tools, blocked, pins } = guardMcpTools(await mcpClient.tools(), {
  allow: ['search', 'read_file'], // server allowlist; omit to allow any name
  pinned: await loadPins(), // descriptions you approved earlier
  blockAtOrAbove: 'high', // default
});

if (blocked.length > 0) logger.warn('mcp tools blocked', blocked);
await savePins(pins); // after review, lock in what you approved

const agent = new ToolLoopAgent({ model, tools });
```

Call it on connect and again whenever you reconnect or refetch tools. New tools
are scanned normally; a pinned tool whose description changed is blocked as a
`rug_pull` with critical severity. `loadPins` and `savePins` are yours: any
key-value store works, since `pins` is a plain `name → description` object.

## Call-time approval gating

`guardrailApproval(guardrails, options?)` turns tool-parameter guardrails into an AI SDK v7 `toolApproval` function. It works with MCP tools the same way it works with local ones:

```ts
import { ToolLoopAgent } from 'ai';
import {
  guardrailApproval,
  sqlInjectionGuardrail,
  pathTraversalGuardrail,
} from 'ai-sdk-guardrails';

const agent = new ToolLoopAgent({
  model,
  tools: await mcpClient.tools(),
  toolApproval: guardrailApproval([
    sqlInjectionGuardrail({ toolName: 'query_database' }),
    pathTraversalGuardrail({ toolName: ['read_file', 'write_file'] }),
  ]),
});
```

The first failing guardrail decides: `denied` if its severity is at or above `denyAtOrAbove` (default `'high'`), otherwise `user-approval`. A tool no guardrail matches gets `not-applicable`, so it **runs without a check**. That is the wrong default for a tool set you didn't write.

To fix this, wrap the gate with `wrapMcpTools` from `@ai-sdk/policy-opa`. Any tool the gate does not govern then falls back to a default, here human approval:

```ts
import { wrapMcpTools } from '@ai-sdk/policy-opa';

const gate = guardrailApproval([
  sqlInjectionGuardrail({ toolName: 'query_database' }),
]);

const { tools, toolApproval } = wrapMcpTools(await mcpClient.tools(), gate, {
  default: 'user-approval',
});
```

`wrapMcpTools` does not need an OPA server. See [OPA & Policy Interop](/guides/policy-opa/) for this pattern and for shadow-mode rollout.

## Result-time scanning

Indirect prompt injection arrives in what a tool returns: a fetched page, an email, a ticket. In an agent loop the tool result becomes a `tool` message in the next step's prompt, and input guardrails see it there. `mcpToolResultGuardrail` scans only the tool results that are new since the last assistant turn, so it costs nothing on steps without tool calls:

```ts
import { agentGuardrails, mcpToolResultGuardrail } from 'ai-sdk-guardrails';
import { ToolLoopAgent } from 'ai';

const agent = new ToolLoopAgent({
  ...agentGuardrails({
    model,
    inputGuardrails: [
      mcpToolResultGuardrail({ allowedDomains: ['api.company.com'] }),
    ],
  }),
  tools,
});
```

It takes the same options as `mcpSecurityGuardrail` and also trips on instructions addressed to the model from inside data ("note to the AI", "assistant, when you read this", fake role markup), including base64- or otherwise-encoded ones. `promptInjectionDetector` in `inputGuardrails` sees tool results too. For stronger detection, add a [model-backed classifier](/guides/classifiers/): `classifierGuardrail` also classifies new tool results.

## Output-time checks

Both of these are **output guardrails**: they run on the wrapped model's generated output (`result.text`, or `JSON.stringify(result.object)`) and look for signs that an injection took effect. Use them with `mcpToolResultGuardrail`, which catches it on the way in.

### `mcpSecurityGuardrail(options?)`

This guardrail blocks output that shows signs of a successful tool-content attack. It checks for:

- Injection patterns: role-prefixed overrides, hidden instructions, authority claims, protocol overrides
- Exfiltration: URLs to non-allowlisted or suspicious domains, data embedded in URLs
- Encoded payloads: base64/hex content that decodes to instructions
- Cascading calls: text that tries to trigger further tool calls

```ts
import { withGuardrails, mcpSecurityGuardrail } from 'ai-sdk-guardrails';

const model = withGuardrails({
  model: openai('gpt-4o'),
  outputGuardrails: [
    mcpSecurityGuardrail({
      allowedDomains: ['api.company.com'],
      injectionThreshold: 0.7,
    }),
  ],
});
```

| Option                      | Default | Purpose                                               |
| --------------------------- | ------- | ----------------------------------------------------- |
| `injectionThreshold`        | `0.7`   | Injection confidence threshold (0–1)                  |
| `maxSuspiciousUrls`         | `0`     | Suspicious URLs tolerated before blocking             |
| `scanEncodedContent`        | `true`  | Decode and scan base64/hex                            |
| `detectExfiltration`        | `true`  | Check URLs for data exfiltration                      |
| `allowedDomains`            | `[]`    | Domains allowed in URLs                               |
| `blockCascadingCalls`       | `true`  | Block output that tries to chain tool calls           |
| `maxContentSize`            | `51200` | Bytes analyzed (50 KB)                                |
| `minEncodedLength`          | `20`    | Minimum encoded-run length to inspect                 |
| `encodedInjectionThreshold` | `0.3`   | Threshold for encoded content combined with injection |
| `highRiskThreshold`         | `0.5`   | Cascade-blocking risk threshold                       |
| `customSuspiciousDomains`   | `[]`    | Extra suspicious domain patterns (regex strings)      |
| `authorityThreshold`        | `0.7`   | Authority-manipulation threshold                      |

Results carry `McpSecurityMetadata` (`injectionPatternsDetected`, `suspiciousUrls`, `cascadeRiskLevel`, `detectedAttacks`, ...).

### `mcpResponseSanitizer()`

This guardrail never blocks. When `result.text` contains HTML comments, base64 runs that decode to instruction keywords, suspicious-domain URLs, authority claims, or override/disregard phrases, it rewrites the text with placeholders such as `[REDACTED_SUSPICIOUS_URL]`. The number of edits is reported in `metadata.modificationsCount`.

## Limits

These defenses are regex and heuristic based: pattern lists, edit distance, entropy and encoding checks, keyword scoring. They raise the cost of naive attacks and catch known payloads. They **will lose an evasion arms race** against someone who reads the patterns. Paraphrased instructions, novel encodings, instructions split across several tool results, and descriptions that are harmless on their own all get past them.

Treat them as one layer:

- **Gate actions, don't only filter text.** Use `guardrailApproval` with a `user-approval` default (via `wrapMcpTools`) for any MCP tool that writes, sends or deletes. An approval gate still holds when detection misses.
- **Put policy outside the process.** Remote policy engines (OPA via `@ai-sdk/policy-opa`'s `opaPolicy()`) and MCP gateways that allowlist servers and tools can be updated and audited without redeploying the app.
- **Limit what tools can reach.** Least-privilege scopes (`withGuardedTool` in [`ai-sdk-guardrails/governance`](/guides/governance/)), egress allowlists (`toolEgressPolicy`), and credentials scoped to each server.
- **Scan on connect, and re-scan whenever the server's tool list changes.** A definition that was clean at connect time can be swapped later (a rug pull). Results from one scan say nothing about the tools a server serves afterwards.
- **Watch the decisions.** Send denials and approvals to your tracing backend (see [Observability](/guides/observability/) and [Governance](/guides/governance/)) so you can see bypass attempts and false positives.

## Related

- [OPA & Policy Interop](/guides/policy-opa/)
- [Security guide](/guides/security/)
- [Built-in Guardrails reference](/reference/built-in-guardrails/)
