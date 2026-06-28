/**
 * MCP tool-definition scanner. Inspects an MCP tool's *definition* (name +
 * description) at registration time for supply-chain threats — before the tool
 * is ever exposed to the model. Complements `mcpSecurityGuardrail`, which scans
 * tool *output* at runtime.
 *
 * Pure, dependency-free detection for MCP supply-chain threats.
 */

import { homoglyphTarget, isInvisibleChar } from './normalization';

export type McpThreatType =
  | 'tool_poisoning'
  | 'typosquatting'
  | 'hidden_instruction'
  | 'rug_pull';

export interface McpThreat {
  type: McpThreatType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  evidence?: string;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
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

  if (/%[0-9A-Fa-f]{2}/.test(description)) {
    try {
      scan(decodeURIComponent(description), true);
    } catch {
      // malformed encoding is not a threat by itself
    }
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
