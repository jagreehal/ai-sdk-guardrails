import { createOutputGuardrail } from '../core';
import type {
  AIResult,
  OutputGuardrail,
  OutputGuardrailContext,
} from '../types';
import { extractContent } from './output';

export interface ExpectedToolUseOptions {
  /** One or more tool names that must be used. */
  tools: string | string[];
  /** Whether all tools must be observed. If false, any match passes. Default: true */
  requireAll?: boolean;
  /**
   * Detection mode:
   * - 'auto': try provider metadata, then text markers (default)
   * - 'provider': provider metadata only
   * - 'marker': text marker(s) only
   */
  mode?: 'auto' | 'provider' | 'marker';
  /**
   * Build one or more markers to search for in the final text output for each tool.
   * Default marker builder: (t) => `TOOL_USED: ${t}`
   */
  textMarkers?: ((tool: string) => string | string[]) | string[];
  /**
   * Optional custom extractor to read tool call names from the raw AIResult.
   * Return an array of tool names observed.
   */
  providerExtractor?: (result: AIResult) => string[];
}

function defaultMarker(tool: string): string {
  return `TOOL_USED: ${tool}`;
}

// Helper functions to reduce complexity of tryHeuristicProviderExtraction
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function pushIfString(value: unknown, target: string[]) {
  if (typeof value === 'string' && value.trim().length > 0) {
    target.push(value);
  }
}

function extractFromContentArray(content: unknown[]): string[] {
  const names: string[] = [];
  for (const contentItem of content) {
    if (!isRecord(contentItem)) {
      continue;
    }
    if (contentItem.type !== 'tool-call') {
      continue;
    }
    pushIfString(contentItem.toolName, names);
  }
  return names;
}

function extractFromToolCallsArray(toolCalls: unknown[]): string[] {
  const names: string[] = [];
  for (const toolCall of toolCalls) {
    if (!isRecord(toolCall)) {
      continue;
    }

    const potentialName =
      typeof toolCall.toolName === 'string'
        ? toolCall.toolName
        : typeof toolCall.name === 'string'
          ? toolCall.name
          : undefined;

    pushIfString(potentialName, names);
  }
  return names;
}

function extractToolNameFromItem(
  item: Record<string, unknown>,
): string | undefined {
  if ('name' in item && typeof item.name === 'string') {
    return item.name;
  }
  if ('tool' in item && typeof item.tool === 'string') {
    return item.tool;
  }
  if ('type' in item && typeof item.type === 'string') {
    return item.type;
  }
  if ('toolName' in item && typeof item.toolName === 'string') {
    return item.toolName;
  }
  return undefined;
}

function extractFromCandidateArrays(candidates: unknown[]): string[] {
  const names: string[] = [];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }
    for (const item of candidate) {
      if (!isRecord(item)) {
        continue;
      }
      pushIfString(extractToolNameFromItem(item), names);
    }
  }
  return names;
}

function tryHeuristicProviderExtraction(result: AIResult): string[] {
  const names = new Set<string>();
  const resultWithUnknownProps = result as AIResult & Record<string, unknown>;
  const md =
    resultWithUnknownProps?.experimental_providerMetadata ??
    resultWithUnknownProps?.providerMetadata ??
    {};

  // Check for AI SDK content array with tool-call objects first
  if (Array.isArray(resultWithUnknownProps.content)) {
    const contentNames = extractFromContentArray(
      resultWithUnknownProps.content as unknown[],
    );
    for (const name of contentNames) {
      names.add(name);
    }
  }

  // Check for AI SDK toolCalls array
  if (Array.isArray(resultWithUnknownProps.toolCalls)) {
    const toolCallNames = extractFromToolCallsArray(
      resultWithUnknownProps.toolCalls as unknown[],
    );
    for (const name of toolCallNames) {
      names.add(name);
    }
  }

  // Common ad-hoc spots people might stash tool calls
  const candidates: unknown[] = [
    (md as Record<string, unknown>).toolCalls,
    resultWithUnknownProps.toolCalls,
    (md as Record<string, unknown>).tools,
    resultWithUnknownProps.tools,
    (md as Record<string, unknown>).calledTools,
    resultWithUnknownProps.calledTools,
  ].filter(Boolean);

  const candidateNames = extractFromCandidateArrays(candidates);
  for (const name of candidateNames) {
    names.add(name);
  }

  return [...names];
}

/**
 * Guardrail that verifies evidence of expected tool usage.
 *
 * DX Options:
 * - Minimal: expectedToolUse({ tools: 'calculator' })
 * - Multiple: expectedToolUse({ tools: ['search', 'browser'], requireAll: false })
 * - Provider-aware: pass providerExtractor to read tool names from provider metadata
 * - Text markers only: set mode: 'marker' and optionally customize textMarkers
 */
// Helper functions to reduce complexity of expectedToolUse execute function
function extractProviderTools(
  result: AIResult,
  mode: ExpectedToolUseOptions['mode'],
  providerExtractor?: (result: AIResult) => string[],
): { tools: string[]; usedProvider: boolean } {
  if (mode === 'auto' || mode === 'provider') {
    const providerTools = providerExtractor
      ? providerExtractor(result)
      : tryHeuristicProviderExtraction(result);
    if (providerTools.length > 0) {
      return { tools: providerTools, usedProvider: true };
    }
  }
  return { tools: [], usedProvider: false };
}

function getToolMarkers(
  tool: string,
  textMarkers?: ExpectedToolUseOptions['textMarkers'],
): string[] {
  if (Array.isArray(textMarkers)) {
    return textMarkers;
  }
  if (typeof textMarkers === 'function') {
    const built = textMarkers(tool);
    return Array.isArray(built) ? built : [built];
  }
  return [defaultMarker(tool)];
}

function extractMarkerTools(
  result: AIResult,
  expected: string[],
  mode: ExpectedToolUseOptions['mode'],
  textMarkers?: ExpectedToolUseOptions['textMarkers'],
  observedToolsLength = 0,
): { markers: string[]; usedMarkers: boolean } {
  if ((mode === 'auto' && observedToolsLength === 0) || mode === 'marker') {
    const { text } = extractContent(result);
    const observedMarkers: string[] = [];

    for (const tool of expected) {
      const markers = getToolMarkers(tool, textMarkers);
      const found = markers.find((m) => m && text.includes(m));
      if (found) {
        observedMarkers.push(found);
      }
    }

    return {
      markers: observedMarkers,
      usedMarkers: observedMarkers.length > 0,
    };
  }
  return { markers: [], usedMarkers: false };
}

function determineDetectionType(
  usedProvider: boolean,
  usedMarkers: boolean,
): string {
  if (usedProvider && usedMarkers) {
    return 'mixed';
  }
  if (usedProvider) {
    return 'provider';
  }
  if (usedMarkers) {
    return 'marker';
  }
  return 'none';
}

export function expectedToolUse(
  options: ExpectedToolUseOptions,
): OutputGuardrail {
  const {
    tools,
    requireAll = true,
    mode = 'auto',
    textMarkers,
    providerExtractor,
  } = options;
  const expected = Array.isArray(tools) ? tools : [tools];

  return createOutputGuardrail(
    'expected-tool-use',
    (context: OutputGuardrailContext) => {
      const { result } = context;

      // Extract provider tools
      const { tools: observedTools, usedProvider } = extractProviderTools(
        result,
        mode,
        providerExtractor,
      );

      // Extract marker tools
      const { markers: observedMarkers, usedMarkers } = extractMarkerTools(
        result,
        expected,
        mode,
        textMarkers,
        observedTools.length,
      );

      // Decide pass/fail
      const detectedTools = new Set<string>([
        ...observedTools,
        ...observedMarkers.map((m) => m.replace(/^TOOL_USED:\s*/, '')),
      ]);
      const missing = expected.filter((t) => !detectedTools.has(t));
      const passed = requireAll ? missing.length === 0 : detectedTools.size > 0;

      const metadata = {
        expectedTools: expected,
        observedTools: [...new Set(observedTools)],
        observedMarkers,
        missingTools: missing,
        detection: determineDetectionType(usedProvider, usedMarkers),
      };

      if (!passed) {
        return {
          tripwireTriggered: true,
          severity: 'medium' as const,
          message:
            expected.length === 1
              ? `Expected tool not used: ${expected[0]}`
              : `Expected tool(s) missing: ${missing.join(', ')}`,
          metadata,
          info: {
            guardrailName: 'expected-tool-use',
            expectedTools: expected,
            observedTools: [...new Set(observedTools)],
            missingTools: missing,
            detectionMethod: determineDetectionType(usedProvider, usedMarkers),
          },
        };
      }

      return {
        tripwireTriggered: false,
        metadata: {
          ...metadata,
          missingTools: [],
        },
        info: {
          guardrailName: 'expected-tool-use',
          expectedTools: expected,
          observedTools: [...new Set(observedTools)],
          missingTools: [],
          detectionMethod: determineDetectionType(usedProvider, usedMarkers),
        },
      };
    },
  );
}

/**
 * Tool-call/egress policy guardrail that controls which tools can be called
 * and validates parameters and URLs for security
 */
export interface ToolEgressPolicyOptions {
  /** List of allowed tool names. If empty, all tools are allowed */
  allowedTools?: string[];
  /** List of denied tool names */
  deniedTools?: string[];
  /** Allowed hosts for URL parameters */
  allowedHosts?: string[];
  /** Blocked hosts for URL parameters */
  blockedHosts?: string[];
  /** Parameter validation rules */
  parameterRules?: {
    [toolName: string]: {
      allowedParams?: string[];
      deniedParams?: string[];
      maxParamLength?: number;
    };
  };
  /** Whether to scan parameter values for URLs */
  scanForUrls?: boolean;
  /** Whether to allow file:// URLs */
  allowFileUrls?: boolean;
  /** Whether to allow localhost/127.0.0.1 URLs */
  allowLocalhost?: boolean;
}

export function toolEgressPolicy(
  options: ToolEgressPolicyOptions = {},
): OutputGuardrail {
  const {
    allowedTools = [],
    deniedTools = [],
    allowedHosts = [],
    blockedHosts = [],
    parameterRules = {},
    scanForUrls = true,
    allowFileUrls = false,
    allowLocalhost = false,
  } = options;

  return createOutputGuardrail(
    'tool-egress-policy',
    (context: OutputGuardrailContext) => {
      const { result } = context;
      const { text } = extractContent(result);

      // Extract tool calls from the result
      const { tools: observedTools } = extractProviderTools(result, 'auto');

      const violations: string[] = [];
      const detectedIssues: Array<{
        tool: string;
        issue: string;
        severity: 'low' | 'medium' | 'high';
      }> = [];

      // Check tool allowlist/denylist
      for (const tool of observedTools) {
        // Check denied tools
        if (deniedTools.includes(tool)) {
          violations.push(`Tool '${tool}' is explicitly denied`);
          detectedIssues.push({
            tool,
            issue: 'explicitly denied',
            severity: 'high',
          });
          continue;
        }

        // Check allowed tools (if allowlist is specified)
        if (allowedTools.length > 0 && !allowedTools.includes(tool)) {
          violations.push(`Tool '${tool}' is not in allowlist`);
          detectedIssues.push({
            tool,
            issue: 'not in allowlist',
            severity: 'medium',
          });
          continue;
        }

        // Check parameter rules for this tool
        const rules = parameterRules[tool];
        if (rules && rules.maxParamLength) {
          // Note: In a real implementation, you'd need access to actual tool parameters
          // This is a simplified check based on text content
          const toolMention = text.match(
            new RegExp(String.raw`${tool}.*?(?=\n|$)`, 'i'),
          );
          if (toolMention && toolMention[0].length > rules.maxParamLength) {
            violations.push(`Tool '${tool}' parameter length exceeds limit`);
            detectedIssues.push({
              tool,
              issue: 'parameter length exceeded',
              severity: 'medium',
            });
          }
        }
      }

      // Scan for URLs if enabled
      if (scanForUrls) {
        const urlPattern = /https?:\/\/[^\s]+|ftp:\/\/[^\s]+|file:\/\/[^\s]+/gi;
        const urls = text.match(urlPattern) || [];

        for (const url of urls) {
          try {
            const parsed = new URL(url);

            // Check file:// URLs
            if (parsed.protocol === 'file:' && !allowFileUrls) {
              violations.push(`File URL detected and not allowed: ${url}`);
              detectedIssues.push({
                tool: 'url-scan',
                issue: 'file URL not allowed',
                severity: 'high',
              });
              continue;
            }

            // Check localhost
            if (
              !allowLocalhost &&
              (parsed.hostname === 'localhost' ||
                parsed.hostname === '127.0.0.1' ||
                parsed.hostname.startsWith('192.168.') ||
                parsed.hostname.startsWith('10.') ||
                parsed.hostname.startsWith('172.'))
            ) {
              violations.push(`Local URL detected and not allowed: ${url}`);
              detectedIssues.push({
                tool: 'url-scan',
                issue: 'local URL not allowed',
                severity: 'high',
              });
              continue;
            }

            // Check blocked hosts
            if (blockedHosts.includes(parsed.hostname)) {
              violations.push(`Blocked host detected: ${parsed.hostname}`);
              detectedIssues.push({
                tool: 'url-scan',
                issue: 'blocked host',
                severity: 'high',
              });
              continue;
            }

            // Check allowed hosts (if allowlist is specified)
            if (
              allowedHosts.length > 0 &&
              !allowedHosts.includes(parsed.hostname)
            ) {
              violations.push(`Host not in allowlist: ${parsed.hostname}`);
              detectedIssues.push({
                tool: 'url-scan',
                issue: 'host not in allowlist',
                severity: 'medium',
              });
            }
          } catch {
            // Invalid URL format
            violations.push(`Invalid URL format detected: ${url}`);
            detectedIssues.push({
              tool: 'url-scan',
              issue: 'invalid URL format',
              severity: 'low',
            });
          }
        }
      }

      if (violations.length > 0) {
        const highSeverityCount = detectedIssues.filter(
          (i) => i.severity === 'high',
        ).length;
        const mediumSeverityCount = detectedIssues.filter(
          (i) => i.severity === 'medium',
        ).length;

        return {
          tripwireTriggered: true,
          message: `Tool egress policy violations: ${violations.join('; ')}`,
          severity:
            highSeverityCount > 0
              ? 'critical'
              : mediumSeverityCount > 0
                ? 'high'
                : 'medium',
          metadata: {
            violationCount: violations.length,
            violations,
            detectedIssues,
            observedTools,
            allowedTools,
            deniedTools,
            urlsScanned: scanForUrls,
          },
          suggestion:
            'Review tool usage and URL access patterns for security compliance',
          info: {
            guardrailName: 'tool-egress-policy',
            violationCount: violations.length,
            violations,
            detectedIssues: detectedIssues,
            observedTools: observedTools,
            allowedTools: allowedTools,
            deniedTools: deniedTools,
            urlsScanned: scanForUrls,
          },
        };
      }

      return {
        tripwireTriggered: false,
        metadata: {
          observedTools,
          urlsScanned: scanForUrls,
          policyEnforced: true,
        },
        info: {
          guardrailName: 'tool-egress-policy',
          observedTools: observedTools,
          urlsScanned: scanForUrls,
          policyEnforced: true,
        },
      };
    },
  );
}
