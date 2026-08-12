/**
 * Shared tool-call egress scanning — used by `toolEgressPolicy` and
 * `evaluationScopeGuardrail` so host/URL rules stay consistent.
 */

import type { AIResult } from '../types';

export interface ToolCallPayload {
  toolName: string;
  argsText: string;
}

export interface EgressScanOptions {
  allowedHosts?: (string | RegExp)[];
  blockedHosts?: (string | RegExp)[];
  suspiciousFilenamePatterns?: RegExp[];
  blockBase64Payloads?: boolean;
  minBase64Length?: number;
  allowFileUrls?: boolean;
  allowLocalhost?: boolean;
}

const BASE64_RUN =
  /(?:[A-Za-z0-9+/]{4}){8,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/g;
const URL_PATTERN =
  /https?:\/\/[^\s"'<>]+|ftp:\/\/[^\s"'<>]+|file:\/\/[^\s"'<>]+/gi;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

export function stringifyToolArgs(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Extract tool-call names and serialized args from an AI SDK result. */
export function extractToolCallPayloads(result: AIResult): ToolCallPayload[] {
  const payloads: ToolCallPayload[] = [];
  const resultRecord = result as AIResult & Record<string, unknown>;

  if (Array.isArray(resultRecord.content)) {
    for (const item of resultRecord.content) {
      if (!isRecord(item) || item.type !== 'tool-call') continue;
      const toolName =
        typeof item.toolName === 'string'
          ? item.toolName
          : typeof item.name === 'string'
            ? item.name
            : 'unknown';
      const rawInput = item.input ?? item.args ?? item.parameters ?? {};
      payloads.push({ toolName, argsText: stringifyToolArgs(rawInput) });
    }
  }

  if (Array.isArray(resultRecord.toolCalls)) {
    for (const call of resultRecord.toolCalls) {
      if (!isRecord(call)) continue;
      const toolName =
        typeof call.toolName === 'string'
          ? call.toolName
          : typeof call.name === 'string'
            ? call.name
            : 'unknown';
      const rawInput = call.input ?? call.args ?? call.parameters ?? {};
      payloads.push({ toolName, argsText: stringifyToolArgs(rawInput) });
    }
  }

  return payloads;
}

export function hostMatches(
  host: string,
  patterns: (string | RegExp)[],
): boolean {
  return patterns.some((pattern) =>
    typeof pattern === 'string' ? host === pattern : pattern.test(host),
  );
}

export function isRegistryWriteTool(toolName: string): boolean {
  return /upload|write|publish|put/i.test(toolName);
}

/** Scan text (tool args or model output) for egress / scope violations. */
export function scanTextEgressViolations(
  text: string,
  options: EgressScanOptions,
  prefix: string,
): string[] {
  const violations: string[] = [];
  const {
    allowedHosts = [],
    blockedHosts = [],
    suspiciousFilenamePatterns = [],
    blockBase64Payloads = false,
    minBase64Length = 64,
    allowFileUrls = false,
    allowLocalhost = false,
  } = options;

  for (const pattern of suspiciousFilenamePatterns) {
    if (pattern.test(text)) {
      violations.push(
        `${prefix}: suspicious coordination pattern (${pattern})`,
      );
    }
  }

  const urls = text.match(URL_PATTERN) ?? [];
  for (const url of urls) {
    try {
      const parsed = new URL(url);

      if (parsed.protocol === 'file:' && !allowFileUrls) {
        violations.push(`${prefix}: file URL not allowed: ${url}`);
        continue;
      }

      const host = parsed.hostname;
      if (
        !allowLocalhost &&
        (host === 'localhost' ||
          host === '127.0.0.1' ||
          /^10\.|^172\.(1[6-9]|2[0-9]|3[0-1])\.|^192\.168\.|^169\.254\./.test(
            host,
          ))
      ) {
        violations.push(`${prefix}: local/private URL not allowed: ${url}`);
        continue;
      }

      if (blockedHosts.length > 0 && hostMatches(host, blockedHosts)) {
        violations.push(`${prefix}: blocked host ${host}`);
      }

      if (allowedHosts.length > 0 && !hostMatches(host, allowedHosts)) {
        violations.push(`${prefix}: host ${host} outside allowlist`);
      }
    } catch {
      violations.push(`${prefix}: invalid URL format: ${url}`);
    }
  }

  if (blockBase64Payloads) {
    const runs = text.match(BASE64_RUN) ?? [];
    for (const run of runs) {
      if (run.length >= minBase64Length) {
        violations.push(
          `${prefix}: base64 gadget payload (${run.length} chars)`,
        );
      }
    }
  }

  return violations;
}

export interface PayloadEgressScanOptions extends EgressScanOptions {
  registryTools?: string[];
  denyRegistryWrites?: boolean;
  denySuspiciousFilenames?: boolean;
  sharedStoreId?: string;
}

/** Scan structured tool-call payloads for egress and eval-sandbox violations. */
export function scanToolCallEgress(
  payloads: ToolCallPayload[],
  options: PayloadEgressScanOptions,
): string[] {
  const {
    registryTools = [],
    denyRegistryWrites = false,
    denySuspiciousFilenames = true,
    sharedStoreId,
    suspiciousFilenamePatterns = [],
    ...scanOptions
  } = options;

  const violations: string[] = [];
  const storeTag = sharedStoreId ? `[store:${sharedStoreId}] ` : '';

  for (const payload of payloads) {
    const prefix = `${storeTag}tool:${payload.toolName}`;

    if (
      denyRegistryWrites &&
      registryTools.includes(payload.toolName) &&
      isRegistryWriteTool(payload.toolName)
    ) {
      violations.push(`${prefix}: registry writes denied in eval sandbox`);
      continue;
    }

    violations.push(
      ...scanTextEgressViolations(
        payload.argsText,
        {
          ...scanOptions,
          suspiciousFilenamePatterns: denySuspiciousFilenames
            ? suspiciousFilenamePatterns
            : [],
        },
        prefix,
      ),
    );

    if (
      denySuspiciousFilenames &&
      registryTools.includes(payload.toolName) &&
      isRegistryWriteTool(payload.toolName)
    ) {
      for (const pattern of suspiciousFilenamePatterns) {
        if (pattern.test(payload.argsText)) {
          violations.push(
            `${prefix}: registry write looks like cross-agent message board`,
          );
        }
      }
    }
  }

  return violations;
}
