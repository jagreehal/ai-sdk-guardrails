/**
 * What the detection benchmark runs: one suite per corpus file, each listing
 * the detectors that claim to catch that kind of attack and how to feed them a
 * sample. Add a detector here and it shows up in the report and the floors.
 */
import type { AIResult, InputGuardrail, OutputGuardrail } from '../src/types';
import {
  piiDetector,
  promptInjectionDetector,
  toxicityDetector,
} from '../src/guardrails/input';
import {
  enhancedPromptInjectionDetector,
  intentBasedInjectionDetector,
} from '../src/guardrails/enhanced-prompt-injection';
import { mcpToolResultGuardrail } from '../src/guardrails/mcp-security';
import {
  secretRedaction,
  sensitiveDataFilter,
  toxicityFilter,
} from '../src/guardrails/output';
import { guardMcpTools, scanMcpTool } from '../src/guardrails/mcp-tool-scan';

export interface TextSample {
  id: string;
  text: string;
  label: 'attack' | 'benign';
  technique: string;
}

export interface ToolSample {
  id: string;
  tool: { name: string; description: string };
  label: 'attack' | 'benign';
  technique: string;
}

export type Sample = TextSample | ToolSample;

/** Returns true when the detector flags the sample. Throwing counts as an error, not a flag. */
export type Detect = (sample: Sample) => Promise<boolean>;

export interface Suite {
  corpus: string;
  detectors: Record<string, Detect>;
}

export function textOf(sample: Sample): string {
  if (!('text' in sample)) throw new Error(`${sample.id} is not a text sample`);

  return sample.text;
}

function toolOf(sample: Sample): ToolSample['tool'] {
  if (!('tool' in sample)) throw new Error(`${sample.id} is not a tool sample`);

  return sample.tool;
}

const asUser =
  (rail: InputGuardrail): Detect =>
  async (s) => {
    const text = textOf(s);

    const r = await rail.execute({
      prompt: text,
      messages: [{ role: 'user', content: text }],
      system: '',
    });

    return r.tripwireTriggered;
  };

/** Sample arrives as a tool result the model is about to read (indirect injection path). */
const asToolResult =
  (rail: InputGuardrail): Detect =>
  async (s) => {
    const text = textOf(s);

    const r = await rail.execute({
      prompt: 'summarise this',
      messages: [
        { role: 'user', content: 'summarise this' },
        { role: 'assistant', content: '' },
        { role: 'tool', content: text },
      ],
      system: '',
    });

    return r.tripwireTriggered;
  };

const asOutput =
  <M>(rail: OutputGuardrail<M>): Detect =>
  async (s) => {
    const text = textOf(s);

    const r = await rail.execute({
      input: { prompt: '', messages: [], system: '' },
      // SAFETY: the output rails benchmarked here read only `result.text`.
      result: { text } as AIResult,
    });

    return r.tripwireTriggered;
  };

export const builtinSuites: Suite[] = [
  {
    corpus: 'prompt-injection',
    detectors: {
      promptInjectionDetector: asUser(promptInjectionDetector()),
      enhancedPromptInjectionDetector: asUser(
        enhancedPromptInjectionDetector(),
      ),
      intentBasedInjectionDetector: asUser(intentBasedInjectionDetector()),
      'mcpToolResultGuardrail (as tool result)': asToolResult(
        mcpToolResultGuardrail(),
      ),
    },
  },
  {
    corpus: 'pii',
    detectors: { piiDetector: asUser(piiDetector()) },
  },
  {
    corpus: 'secrets',
    detectors: {
      secretRedaction: asOutput(secretRedaction),
      sensitiveDataFilter: asOutput(sensitiveDataFilter()),
    },
  },
  {
    corpus: 'toxicity',
    detectors: {
      toxicityDetector: asUser(toxicityDetector()),
      toxicityFilter: asOutput(toxicityFilter()),
    },
  },
  {
    corpus: 'mcp-tools',
    detectors: {
      scanMcpTool: async (s) => !scanMcpTool(toolOf(s)).safe,
      guardMcpTools: async (s) => {
        const tool = toolOf(s);

        return (
          guardMcpTools({ [tool.name]: { description: tool.description } })
            .blocked.length > 0
        );
      },
    },
  },
];
