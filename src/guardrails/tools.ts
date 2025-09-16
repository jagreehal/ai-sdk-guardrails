import { createOutputGuardrail } from '../core';
import type { AIResult, OutputGuardrail, OutputGuardrailContext } from '../types';
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

function tryHeuristicProviderExtraction(result: AIResult): string[] {
  const names = new Set<string>();
  const resultWithUnknownProps = result as AIResult & Record<string, unknown>;
  const md = resultWithUnknownProps?.experimental_providerMetadata ?? resultWithUnknownProps?.providerMetadata ?? {};
  
  // Check for AI SDK content array with tool-call objects first
  if (Array.isArray(resultWithUnknownProps.content)) {
    for (const contentItem of resultWithUnknownProps.content as unknown[]) {
      if (
        contentItem && 
        typeof contentItem === 'object' && 
        'type' in contentItem && 
        contentItem.type === 'tool-call' && 
        'toolName' in contentItem &&
        typeof contentItem.toolName === 'string'
      ) {
        names.add(contentItem.toolName);
      }
    }
  }
  
  // Check for AI SDK toolCalls array
  if (Array.isArray(resultWithUnknownProps.toolCalls)) {
    for (const toolCall of resultWithUnknownProps.toolCalls as unknown[]) {
      if (toolCall && typeof toolCall === 'object') {
        const name = ('toolName' in toolCall && typeof toolCall.toolName === 'string') 
          ? toolCall.toolName 
          : ('name' in toolCall && typeof toolCall.name === 'string')
          ? toolCall.name 
          : undefined;
        if (name && name.trim().length > 0) {
          names.add(name);
        }
      }
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

  for (const c of candidates) {
    if (Array.isArray(c)) {
      for (const item of c as unknown[]) {
        if (item && typeof item === 'object') {
          const name = 
            ('name' in item && typeof item.name === 'string') ? item.name :
            ('tool' in item && typeof item.tool === 'string') ? item.tool :
            ('type' in item && typeof item.type === 'string') ? item.type :
            ('toolName' in item && typeof item.toolName === 'string') ? item.toolName :
            undefined;
          if (typeof name === 'string' && name.trim().length > 0) names.add(name);
        }
      }
    }
  }
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
export function expectedToolUse(options: ExpectedToolUseOptions): OutputGuardrail {
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
      const observedTools: string[] = [];
      const observedMarkers: string[] = [];
      let usedProvider = false;
      let usedMarkers = false;

      // Provider metadata path
      if (mode === 'auto' || mode === 'provider') {
        const providerTools = providerExtractor
          ? providerExtractor(result)
          : tryHeuristicProviderExtraction(result);
        if (providerTools.length > 0) {
          observedTools.push(...providerTools);
          usedProvider = true;
        }
      }

      // Text markers path
      if ((mode === 'auto' && observedTools.length === 0) || mode === 'marker') {
        const { text } = extractContent(result);
        const getMarkers = (tool: string): string[] => {
          if (Array.isArray(textMarkers)) return textMarkers;
          if (typeof textMarkers === 'function') {
            const built = textMarkers(tool);
            return Array.isArray(built) ? built : [built];
          }
          return [defaultMarker(tool)];
        };
        for (const tool of expected) {
          const markers = getMarkers(tool);
          const found = markers.find((m) => m && text.includes(m));
          if (found) observedMarkers.push(found);
        }
        if (observedMarkers.length > 0) usedMarkers = true;
      }

      // Decide pass/fail
      const detectedTools = new Set<string>([
        ...observedTools,
        ...observedMarkers.map((m) => m.replace(/^TOOL_USED:\s*/, '')),
      ]);
      const missing = expected.filter((t) => !detectedTools.has(t));
      const passed = requireAll ? missing.length === 0 : detectedTools.size > 0;

      if (!passed) {
        return {
          tripwireTriggered: true,
          severity: 'medium' as const,
          message:
            expected.length === 1
              ? `Expected tool not used: ${expected[0]}`
              : `Expected tool(s) missing: ${missing.join(', ')}`,
          metadata: {
            expectedTools: expected,
            observedTools: Array.from(new Set(observedTools)),
            observedMarkers,
            missingTools: missing,
            detection:
              usedProvider && usedMarkers
                ? 'mixed'
                : usedProvider
                  ? 'provider'
                  : usedMarkers
                    ? 'marker'
                    : 'none',
          },
        };
      }

      return {
        tripwireTriggered: false,
        metadata: {
          expectedTools: expected,
          observedTools: Array.from(new Set(observedTools)),
          observedMarkers,
          missingTools: [],
          detection:
            usedProvider && usedMarkers
              ? 'mixed'
              : usedProvider
                ? 'provider'
                : usedMarkers
                  ? 'marker'
                  : 'none',
        },
      };
    },
  );
}
