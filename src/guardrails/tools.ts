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
  textMarkers?: ((tool: string) => string | string[]) | string[]; // eslint-disable-line no-unused-vars
  /**
   * Optional custom extractor to read tool call names from the raw AIResult.
   * Return an array of tool names observed.
   */
  providerExtractor?: (result: AIResult) => string[]; // eslint-disable-line no-unused-vars
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
    contentNames.forEach((name) => names.add(name));
  }

  // Check for AI SDK toolCalls array
  if (Array.isArray(resultWithUnknownProps.toolCalls)) {
    const toolCallNames = extractFromToolCallsArray(
      resultWithUnknownProps.toolCalls as unknown[],
    );
    toolCallNames.forEach((name) => names.add(name));
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
  candidateNames.forEach((name) => names.add(name));

  return Array.from(names);
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
  providerExtractor?: (result: AIResult) => string[], // eslint-disable-line no-unused-vars
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
        observedTools: Array.from(new Set(observedTools)),
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
        };
      }

      return {
        tripwireTriggered: false,
        metadata: {
          ...metadata,
          missingTools: [],
        },
      };
    },
  );
}
