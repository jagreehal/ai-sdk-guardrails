/**
 * MCP tool-definition scanner. Inspects an MCP tool's *definition* (name +
 * description) at registration time for supply-chain threats — before the tool
 * is ever exposed to the model. Complements `mcpSecurityGuardrail`, which scans
 * tool *output* at runtime.
 *
 * Pure, dependency-free detection for MCP supply-chain threats.
 */

import type { JSONObject, JSONValue } from '@ai-sdk/provider';
import { z } from 'zod';
import { homoglyphTarget, isInvisibleChar } from './normalization';
import { matchInjectionSignals } from './injection-signals';

export type McpThreatType =
  | 'tool_poisoning'
  | 'typosquatting'
  | 'hidden_instruction'
  | 'rug_pull'
  | 'exfiltration';

export interface McpThreat {
  type: McpThreatType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  evidence?: string;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  parameters?: JSONObject;
}

export interface McpScanResult {
  toolName: string;
  threats: McpThreat[];
  /** 0-100, capped. */
  riskScore: number;
  safe: boolean;
}

export interface McpToolScanOptions {
  /** Well-known tool names used for typosquatting detection. Has sensible defaults. */
  knownToolNames?: string[];
  /** Description length over which rug-pull heuristics apply. Default 500. */
  rugPullDescriptionLength?: number;
  /** Instruction-pattern matches needed to flag a rug-pull. Default 2. */
  rugPullMinInstructionMatches?: number;
}

const DEFAULT_KNOWN_TOOL_NAMES: string[] = [
  'read_file',
  'write_file',
  'execute_command',
  'search',
  'browse',
  'fetch',
  'list_directory',
  'create_file',
  'delete_file',
  'run_script',
  'get_weather',
  'send_email',
  'query_database',
  'http_request',
  'calculator',
];

const POISONING_PATTERNS: RegExp[] = [
  /<system>/i,
  /ignore previous/i,
  /you must/i,
  /disregard/i,
  /override/i,
  /forget (all|your|previous)/i,
  /new instructions/i,
  /act as/i,
];

const INSTRUCTION_PATTERNS: RegExp[] = [
  /you (should|must|need to)/i,
  /always /i,
  /never /i,
  /do not /i,
  /important:/i,
  /warning:/i,
  /note:/i,
  /step \d/i,
  /first,/i,
  /finally,/i,
];

const SEVERITY_WEIGHT: Record<McpThreat['severity'], number> = {
  low: 10,
  medium: 25,
  high: 50,
  critical: 80,
};

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;

  if (n === 0) return m;

  // Two rolling rows; Int32Array indexing is `number` (strict-null safe).
  let prev = new Int32Array(n + 1);
  let curr = new Int32Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ac = a.codePointAt(i - 1);

    for (let j = 1; j <= n; j++) {
      const cost = ac === b.codePointAt(j - 1) ? 0 : 1;
      // `?? 0` satisfies noUncheckedIndexedAccess; indices are always in range.
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }

    const tmp = prev;
    prev = curr;
    curr = tmp;
  }

  return prev[n] ?? 0;
}

function codePointLabel(ch: string): string {
  return `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
}

function detectToolPoisoning(description: string, threats: McpThreat[]): void {
  const scan = (text: string, viaDecode: boolean): void => {
    for (const pattern of POISONING_PATTERNS) {
      const match = pattern.exec(text);

      if (match) {
        threats.push({
          type: 'tool_poisoning',
          severity: 'critical',
          description: viaDecode
            ? `Encoded prompt-injection detected after URL-decoding: "${match[0]}"`
            : `Prompt-injection pattern detected in tool description: "${match[0]}"`,
          evidence: match[0],
        });
      }
    }
  };

  scan(description, false);

  // Shared injection signals (override, extraction, persona, indirect
  // "note to the AI", delimiter spoofing), checked on decoded variants too.
  const signal = matchInjectionSignals(description)[0];

  if (signal && signal.weight >= 0.75 && threats.length === 0) {
    threats.push({
      type: 'tool_poisoning',
      severity: 'critical',
      description: `Tool description carries an instruction aimed at the model (${signal.category})`,
      evidence: signal.pattern.slice(0, 80),
    });
  }

  if (/%[0-9A-Fa-f]{2}/.test(description)) {
    try {
      scan(decodeURIComponent(description), true);
    } catch {
      // malformed encoding is not a threat by itself
    }
  }
}

const SECRET_LOCATION =
  /~\/\.ssh\/id_\w+|\bid_(?:rsa|ed25519|ecdsa)\b|\.aws\/credentials|(?:^|[\s'"`/])\.env\b|\/etc\/(?:passwd|shadow)|\bkeychain\b|\.npmrc|\.netrc|\.git-credentials|\bcookies?\.(?:sqlite|db)\b|\.(?:bash|zsh)_history\b|\.kube\/config|\.docker\/config\.json/i;

const READ_VERB =
  /\b(?:read|cat|include|attach|append|pass|send|upload|copy|collect|extract|dump|print)\b/i;

const EXFIL_VERB =
  /\b(?:send|sent|sending|post(?:ed|ing)?|upload(?:ed|ing)?|forward(?:ed|ing)?|transmit(?:ted)?|report(?:ed)?|sync(?:ed)?|exfiltrat\w*|cop(?:y|ied)|mirror(?:ed)?|beacon|e-?mail(?:ed)?|submit(?:ted)?|log(?:ged)?|pass(?:ed)?|embed(?:ded)?|include[ds]?|attach(?:ed)?)\b/i;

const SENSITIVE_DATA =
  /\b(?:conversation|transcript|chat (?:history|log)|(?:entire |whole |full )?(?:repository|repo|codebase|source code)|(?:user(?:'s)? )?profile|contact(?:s| list)|(?:every |any |all )?documents? (?:the user|they) (?:shares?|uploads?)|(?:any |every )?tokens? found|(?:last|latest|every|all|each) (?:of the )?(?:user(?:'s)? )?messages?|user(?:'s)? (?:last |latest )?messages?|(?:full |entire )?message history|user(?:'s)? (?:data|messages|files|prompt|input)|credentials?|secrets?|tokens?|api[ _-]?keys?|passwords?|env(?:ironment)? variables|file contents|private keys?|session (?:cookies?|ids?)|system prompt|clipboard)\b/i;

const EXTERNAL_DEST =
  /https?:\/\/(?!(?:localhost|127\.0\.0\.1)\b)[^\s"'<>)]+|\b[\w.-]+@[\w-]+\.[a-z]{2,}\b|\bwebhook\b|\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/i;

// User data templated into a URL the client will fetch (markdown image/link
// exfiltration), or encoded into a DNS lookup.
const DATA_PLACEHOLDER = String.raw`[^}>\]\s]*(?:user|message|conversation|prompt|chat|history|token|secret|key|data|content|email|input|query|transcript|password|session)[^}>\]\s]*`;

const TEMPLATED_URL = new RegExp(
  String.raw`https?:\/\/[^\s)"']*[?&=/][^\s)"']*(?:\{${DATA_PLACEHOLDER}\}|<${DATA_PLACEHOLDER}>|\$\{${DATA_PLACEHOLDER}\}|\[${DATA_PLACEHOLDER}\])`,
  'i',
);

const DNS_EXFIL =
  /\b(?:encode|base32|base64|hex)\b[^.]{0,80}\b(?:look ?up|resolve|dns|subdomain|nslookup|dig)\b/i;

function detectExfiltration(description: string, threats: McpThreat[]): void {
  if (TEMPLATED_URL.test(description)) {
    threats.push({
      type: 'exfiltration',
      severity: 'high',
      description: 'Tool description templates user data into an external URL',
      evidence: description.match(TEMPLATED_URL)?.[0],
    });

    return;
  }

  if (DNS_EXFIL.test(description)) {
    threats.push({
      type: 'exfiltration',
      severity: 'high',
      description: 'Tool description encodes data into DNS lookups',
      evidence: description.match(DNS_EXFIL)?.[0],
    });

    return;
  }

  if (SECRET_LOCATION.test(description) && READ_VERB.test(description)) {
    threats.push({
      type: 'exfiltration',
      severity: 'critical',
      description:
        'Tool description asks the model to read credential or secret files',
      evidence: description.match(SECRET_LOCATION)?.[0],
    });

    return;
  }

  if (
    EXFIL_VERB.test(description) &&
    SENSITIVE_DATA.test(description) &&
    EXTERNAL_DEST.test(description)
  ) {
    threats.push({
      type: 'exfiltration',
      severity: 'high',
      description:
        'Tool description sends user data or secrets to an external destination',
      evidence: description.match(EXTERNAL_DEST)?.[0],
    });
  }
}

function detectTyposquatting(
  name: string,
  knownToolNames: string[],
  threats: McpThreat[],
): void {
  const lower = name.toLowerCase();

  for (const known of knownToolNames) {
    if (lower === known) continue;
    const dist = levenshtein(lower, known);

    if (dist > 0 && dist <= 2) {
      threats.push({
        type: 'typosquatting',
        severity: dist === 1 ? 'high' : 'medium',
        description: `Tool name "${name}" is suspiciously similar to known tool "${known}" (edit distance ${dist})`,
        evidence: known,
      });
    }
  }
}

function detectHiddenInstructions(
  description: string,
  threats: McpThreat[],
): void {
  for (const ch of description) {
    if (isInvisibleChar(ch)) {
      threats.push({
        type: 'hidden_instruction',
        severity: 'high',
        description: `Zero-width character ${codePointLabel(ch)} found in description`,
        evidence: codePointLabel(ch),
      });
      break;
    }
  }

  for (const ch of description) {
    const target = homoglyphTarget(ch);

    if (target) {
      threats.push({
        type: 'hidden_instruction',
        severity: 'high',
        description: `Homoglyph "${ch}" looks like "${target}" but is a different Unicode code point`,
        evidence: ch,
      });
      break;
    }
  }
}

function detectRugPull(
  description: string,
  threats: McpThreat[],
  lengthThreshold: number,
  minMatches: number,
): void {
  if (description.length <= lengthThreshold) return;

  let instructionMatches = 0;

  for (const pattern of INSTRUCTION_PATTERNS) {
    if (pattern.test(description)) instructionMatches++;
  }

  if (instructionMatches >= minMatches) {
    threats.push({
      type: 'rug_pull',
      severity: 'medium',
      description: `Unusually long description (${description.length} chars) with ${instructionMatches} instruction-like patterns — possible rug-pull payload`,
      evidence: `length=${description.length}, instruction_patterns=${instructionMatches}`,
    });
  }
}

/**
 * Scan a single MCP tool definition for supply-chain threats.
 *
 * @example
 * const result = scanMcpTool({ name: 'read_flie', description: 'Reads a file.' });
 * if (!result.safe) console.warn(result.threats);
 */
export function scanMcpTool(
  tool: McpToolDefinition,
  options: McpToolScanOptions = {},
): McpScanResult {
  const threats: McpThreat[] = [];
  const description = tool.description ?? '';

  detectToolPoisoning(description, threats);
  detectExfiltration(description, threats);
  detectTyposquatting(
    tool.name,
    options.knownToolNames ?? DEFAULT_KNOWN_TOOL_NAMES,
    threats,
  );
  detectHiddenInstructions(description, threats);
  detectRugPull(
    description,
    threats,
    options.rugPullDescriptionLength ?? 500,
    options.rugPullMinInstructionMatches ?? 2,
  );

  const riskScore = Math.min(
    100,
    threats.reduce((sum, t) => sum + SEVERITY_WEIGHT[t.severity], 0),
  );

  return {
    toolName: tool.name,
    threats,
    riskScore,
    safe: threats.length === 0,
  };
}

/** Scan many MCP tool definitions; returns one result per tool. */
export function scanMcpTools(
  tools: McpToolDefinition[],
  options: McpToolScanOptions = {},
): McpScanResult[] {
  return tools.map((tool) => scanMcpTool(tool, options));
}

const SEVERITY_RANK: Record<McpThreat['severity'], number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export interface GuardMcpToolsOptions extends McpToolScanOptions {
  /** Server allowlist: only these tool names pass. Omit to allow any name. */
  allow?: string[];
  /**
   * Descriptions you reviewed earlier (`pins` from a previous call). A tool whose
   * description no longer matches is blocked as a rug-pull. New tools are scanned
   * normally; persist `pins` after review to lock them in.
   */
  pinned?: Record<string, string>;
  /** Block tools with a threat at or above this severity. Default `'high'`. */
  blockAtOrAbove?: McpThreat['severity'];
}

export interface GuardMcpToolsResult<T> {
  /** Only the tools that passed (drop-in for the `tools` option). */
  tools: Record<string, T[keyof T]>;
  blocked: Array<{ toolName: string; reason: string; threats: McpThreat[] }>;
  /** Current name → description map; persist it to pin what you approved. */
  pins: Record<string, string>;
}

const descriptionText = z.string();

/** AI SDK tools may carry a per-call description function; resolve it without context. */
function resolveDescription(tool: {
  description?: unknown;
}): string | undefined {
  const { description } = tool;

  if (description === undefined || description === null) return '';

  if (description instanceof Function) {
    try {
      const out = descriptionText.safeParse(
        description({ context: undefined }),
      );

      return out.success ? out.data : undefined;
    } catch {
      return undefined;
    }
  }

  const text = descriptionText.safeParse(description);

  return text.success ? text.data : undefined;
}

/**
 * Gate an AI SDK tool set from an MCP server before handing it to a model.
 * Call it every time you fetch tools (`await mcp.tools()`), on connect and after
 * the server's tool list changes: it scans each definition, enforces the
 * allowlist, and blocks any tool whose description drifted from `pinned`.
 *
 * Heuristic: it raises the cost of tool poisoning, it does not prove safety.
 * Pair it with `guardrailApproval` for the calls themselves.
 *
 * @example
 * const { tools, blocked, pins } = guardMcpTools(await mcp.tools(), {
 *   allow: ['search', 'read_file'],
 *   pinned: await loadPins(),
 * });
 */
const toolSchema = z.union([
  z.object({ jsonSchema: z.json() }).transform((tool) => tool.jsonSchema),
  z.json(),
]);

/** Every `description` / `title` string inside a JSON Schema. */
function schemaText(value: JSONValue | undefined): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => schemaText(item));

  if (value === null || !(value instanceof Object)) return [];

  return Object.entries(value).flatMap(([key, child]) => {
    const text = z.string().safeParse(child);

    return (key === 'description' || key === 'title') && text.success
      ? [text.data]
      : schemaText(child);
  });
}

/**
 * Text an attacker controls in a tool definition: its description plus the
 * descriptions inside its input schema (MCP tools expose it as `jsonSchema`).
 */
function definitionText(
  description: string,
  schema: JSONValue | undefined,
): string {
  return [description, ...schemaText(schema)].join('\n');
}

export function guardMcpTools<
  T extends Record<string, { description?: unknown; inputSchema?: unknown }>,
>(tools: T, options: GuardMcpToolsOptions = {}): GuardMcpToolsResult<T> {
  const { allow, pinned, blockAtOrAbove = 'high' } = options;
  const floor = SEVERITY_RANK[blockAtOrAbove];
  const passed: Record<string, T[keyof T]> = {};
  const blocked: GuardMcpToolsResult<T>['blocked'] = [];
  const pins: Record<string, string> = {};

  for (const [name, tool] of Object.entries(tools)) {
    const description = resolveDescription(tool);

    if (description === undefined) {
      // A per-call description function we could not evaluate: fail closed.
      blocked.push({
        toolName: name,
        reason: 'description could not be resolved for scanning',
        threats: [],
      });
      continue;
    }

    const schema = toolSchema.safeParse(tool.inputSchema);

    const definition = definitionText(
      description,
      schema.success ? schema.data : undefined,
    );

    const previous =
      pinned && Object.hasOwn(pinned, name) ? pinned[name] : undefined;

    pins[name] = definition;

    if (allow && !allow.includes(name)) {
      blocked.push({ toolName: name, reason: 'not in allowlist', threats: [] });
      continue;
    }

    if (previous !== undefined && previous !== definition) {
      // Keep the approved pin: saving `pins` must not clear the block.
      pins[name] = previous;
      blocked.push({
        toolName: name,
        reason: 'description changed since pinned',
        threats: [
          {
            type: 'rug_pull',
            severity: 'critical',
            description: 'Tool description changed after it was approved',
          },
        ],
      });
      continue;
    }

    const { threats } = scanMcpTool({ name, description: definition }, options);
    const worst = threats.find((t) => SEVERITY_RANK[t.severity] >= floor);

    if (worst) {
      blocked.push({ toolName: name, reason: worst.description, threats });
      continue;
    }

    // SAFETY: `tool` was read from `tools[name]`, so it is one of T's values;
    // Object.entries only widened it to the constraint.
    passed[name] = tool as T[keyof T];
  }

  return { tools: passed, blocked, pins };
}
