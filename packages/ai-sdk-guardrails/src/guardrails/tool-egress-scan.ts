/**
 * Shared tool-call egress scanning, used by `toolEgressPolicy` and
 * `evaluationScopeGuardrail` so host/URL rules stay consistent.
 */

import { z } from 'zod';
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

const optionalText = z.string().optional().catch(undefined);

/** Serializes tool arguments: strings pass through, everything else as JSON. */
const argsTextSchema = z.union([
  z.string(),
  z.unknown().transform((value) => {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }),
]);

/** A tool call as found in `content` or `toolCalls`, across SDK and provider shapes. */
const toolCallSchema = z
  .object({
    type: z.unknown().optional(),
    toolName: optionalText,
    name: optionalText,
    input: z.unknown().optional(),
    args: z.unknown().optional(),
    parameters: z.unknown().optional(),
  })
  .transform((call) => ({
    type: call.type,
    toolName: call.toolName ?? call.name ?? 'unknown',
    argsText: argsTextSchema.parse(
      call.input ?? call.args ?? call.parameters ?? {},
    ),
  }));

const optionalList = z.array(z.unknown()).optional().catch(undefined);

const resultToolFieldsSchema = z.object({
  content: optionalList,
  toolCalls: optionalList,
});

/** Extract tool-call names and serialized args from an AI SDK result. */
export function extractToolCallPayloads(result: AIResult): ToolCallPayload[] {
  const payloads: ToolCallPayload[] = [];
  const fields = resultToolFieldsSchema.safeParse(result);

  if (!fields.success) return payloads;

  for (const item of fields.data.content ?? []) {
    const call = toolCallSchema.safeParse(item);

    if (!call.success || call.data.type !== 'tool-call') continue;

    payloads.push({
      toolName: call.data.toolName,
      argsText: call.data.argsText,
    });
  }

  for (const item of fields.data.toolCalls ?? []) {
    const call = toolCallSchema.safeParse(item);

    if (!call.success) continue;

    payloads.push({
      toolName: call.data.toolName,
      argsText: call.data.argsText,
    });
  }

  return payloads;
}

export function hostMatches(
  host: string,
  patterns: (string | RegExp)[],
): boolean {
  return patterns.some((pattern) =>
    pattern instanceof RegExp ? pattern.test(host) : host === pattern,
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
