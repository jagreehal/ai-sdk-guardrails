import { describe, it, expect } from 'vitest';
import { expectedToolUse } from './tools';
import type { AIResult, OutputGuardrailContext } from '../types';

/** Result fields expectedToolUse inspects, including legacy and provider shapes. */
interface ResultFixture {
  text: string;
  content?: Array<{
    type: string;
    text?: string;
    toolName?: string;
    args?: object;
  }>;
  toolCalls?: Array<{ toolName?: string; name?: string; args?: object }>;
  experimental_providerMetadata?: { toolCalls: Array<{ name: string }> };
}

// SAFETY: expectedToolUse reads only the fields above; the fixtures include
// legacy and provider shapes that the current result type no longer declares.
const asResult = (fixture: ResultFixture): AIResult => fixture as AIResult;

const createContext = (result: AIResult): OutputGuardrailContext => ({
  input: {
    prompt: '',
    messages: [],
    system: '',
  },
  result,
});

describe('expectedToolUse', () => {
  describe('provider metadata extraction', () => {
    it('should extract tools from content array with tool-call objects', async () => {
      const result = asResult({
        text: 'Result text',
        content: [
          { type: 'text', text: 'Some text' },
          { type: 'tool-call', toolName: 'calculator', args: {} },
          { type: 'tool-call', toolName: 'search', args: {} },
        ],
      });

      const guardrail = expectedToolUse({ tools: ['calculator'] });
      const response = await guardrail.execute(createContext(result));

      expect(response.tripwireTriggered).toBe(false);
    });

    it('should extract tools from toolCalls array with toolName', async () => {
      const result = asResult({
        text: 'Result text',
        toolCalls: [
          { toolName: 'calculator', args: {} },
          { toolName: 'search', args: {} },
        ],
      });

      const guardrail = expectedToolUse({ tools: ['calculator'] });
      const response = await guardrail.execute(createContext(result));

      expect(response.tripwireTriggered).toBe(false);
    });

    it('should extract tools from toolCalls array with name', async () => {
      const result = asResult({
        text: 'Result text',
        toolCalls: [
          { name: 'calculator', args: {} },
          { name: 'search', args: {} },
        ],
      });

      const guardrail = expectedToolUse({ tools: ['calculator'] });
      const response = await guardrail.execute(createContext(result));

      expect(response.tripwireTriggered).toBe(false);
    });

    it('should handle metadata locations', async () => {
      const result = asResult({
        text: 'Result text',
        experimental_providerMetadata: {
          toolCalls: [{ name: 'calculator' }],
        },
      });

      const guardrail = expectedToolUse({
        tools: ['calculator'],
        mode: 'provider',
      });

      const response = await guardrail.execute(createContext(result));

      expect(response.tripwireTriggered).toBe(false);
    });

    it('should fail when expected tool is not found', async () => {
      const result = asResult({
        text: 'Result text with no tools used',
      });

      const guardrail = expectedToolUse({ tools: ['calculator'] });
      const response = await guardrail.execute(createContext(result));

      expect(response.tripwireTriggered).toBe(true);
      expect(response.message).toBe('Expected tool not used: calculator');
    });

    it('should use text markers when provider detection fails', async () => {
      const result = asResult({
        text: 'I used TOOL_USED: calculator to compute this',
      });

      const guardrail = expectedToolUse({ tools: ['calculator'] });
      const response = await guardrail.execute(createContext(result));

      expect(response.tripwireTriggered).toBe(false);
    });

    it('should handle multiple tools with requireAll: true', async () => {
      const result = asResult({
        text: 'Result text',
        toolCalls: [{ name: 'calculator' }],
      });

      const guardrail = expectedToolUse({
        tools: ['calculator', 'search'],
        requireAll: true,
      });

      const response = await guardrail.execute(createContext(result));

      expect(response.tripwireTriggered).toBe(true);
      expect(response.message).toBe('Expected tool(s) missing: search');
    });

    it('should handle multiple tools with requireAll: false', async () => {
      const result = asResult({
        text: 'Result text',
        toolCalls: [{ name: 'calculator' }],
      });

      const guardrail = expectedToolUse({
        tools: ['calculator', 'search'],
        requireAll: false,
      });

      const response = await guardrail.execute(createContext(result));

      expect(response.tripwireTriggered).toBe(false);
    });
  });
});
