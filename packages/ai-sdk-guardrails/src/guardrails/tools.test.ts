import { describe, it, expect } from 'vitest';
import { expectedToolUse } from './tools';
import type { AIResult, OutputGuardrailContext } from '../types';

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
      const result = {
        text: 'Result text',
        content: [
          { type: 'text', text: 'Some text' },
          { type: 'tool-call', toolName: 'calculator', args: {} },
          { type: 'tool-call', toolName: 'search', args: {} },
        ],
      } as unknown as AIResult;

      const guardrail = expectedToolUse({ tools: ['calculator'] });
      const response = await guardrail.execute(createContext(result));

      expect(response.tripwireTriggered).toBe(false);
    });

    it('should extract tools from toolCalls array with toolName', async () => {
      const result = {
        text: 'Result text',
        toolCalls: [
          { toolName: 'calculator', args: {} },
          { toolName: 'search', args: {} },
        ],
      } as unknown as AIResult;

      const guardrail = expectedToolUse({ tools: ['calculator'] });
      const response = await guardrail.execute(createContext(result));

      expect(response.tripwireTriggered).toBe(false);
    });

    it('should extract tools from toolCalls array with name', async () => {
      const result = {
        text: 'Result text',
        toolCalls: [
          { name: 'calculator', args: {} },
          { name: 'search', args: {} },
        ],
      } as unknown as AIResult;

      const guardrail = expectedToolUse({ tools: ['calculator'] });
      const response = await guardrail.execute(createContext(result));

      expect(response.tripwireTriggered).toBe(false);
    });

    it('should handle metadata locations', async () => {
      const result = {
        text: 'Result text',
        experimental_providerMetadata: {
          toolCalls: [{ name: 'calculator' }],
        },
      } as unknown as AIResult;

      const guardrail = expectedToolUse({
        tools: ['calculator'],
        mode: 'provider',
      });
      const response = await guardrail.execute(createContext(result));

      expect(response.tripwireTriggered).toBe(false);
    });

    it('should fail when expected tool is not found', async () => {
      const result = {
        text: 'Result text with no tools used',
      } as unknown as AIResult;

      const guardrail = expectedToolUse({ tools: ['calculator'] });
      const response = await guardrail.execute(createContext(result));

      expect(response.tripwireTriggered).toBe(true);
      expect(response.message).toBe('Expected tool not used: calculator');
    });

    it('should use text markers when provider detection fails', async () => {
      const result = {
        text: 'I used TOOL_USED: calculator to compute this',
      } as unknown as AIResult;

      const guardrail = expectedToolUse({ tools: ['calculator'] });
      const response = await guardrail.execute(createContext(result));

      expect(response.tripwireTriggered).toBe(false);
    });

    it('should handle multiple tools with requireAll: true', async () => {
      const result = {
        text: 'Result text',
        toolCalls: [{ name: 'calculator' }],
      } as unknown as AIResult;

      const guardrail = expectedToolUse({
        tools: ['calculator', 'search'],
        requireAll: true,
      });
      const response = await guardrail.execute(createContext(result));

      expect(response.tripwireTriggered).toBe(true);
      expect(response.message).toBe('Expected tool(s) missing: search');
    });

    it('should handle multiple tools with requireAll: false', async () => {
      const result = {
        text: 'Result text',
        toolCalls: [{ name: 'calculator' }],
      } as unknown as AIResult;

      const guardrail = expectedToolUse({
        tools: ['calculator', 'search'],
        requireAll: false,
      });
      const response = await guardrail.execute(createContext(result));

      expect(response.tripwireTriggered).toBe(false);
    });
  });
});
