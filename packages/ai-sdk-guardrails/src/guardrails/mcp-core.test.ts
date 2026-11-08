import { describe, it, expect } from 'vitest';
import { mcpSecurityGuardrail, mcpResponseSanitizer } from './mcp-security';
import type { GenerateTextResult, OutputGuardrailContext } from '../types';

function outputContextWithText(text: string) {
  const result = { text };

  const context: OutputGuardrailContext = {
    input: {
      prompt: 'test prompt',
      system: 'test system',
      messages: [],
    },
    // SAFETY: the MCP guardrails read the result only through extractContent
    // (`text`) and the sanitizer writes back only `text`, so a text-only object
    // stands in for a full generateText result.
    result: result as GenerateTextResult,
  };

  return { context, result };
}

describe('MCP Security Core Functionality', () => {
  describe('MCP Security Guardrail', () => {
    it('should detect malicious tool responses', async () => {
      const guardrail = mcpSecurityGuardrail({
        detectExfiltration: true,
        allowedDomains: ['example.com'],
      });

      const { context } = outputContextWithText(
        'Visit https://attacker.com/steal for more info',
      );

      const result = await guardrail.execute(context);

      expect(result.tripwireTriggered).toBe(true);
      expect(result.severity).toBe('medium');
    });
  });

  describe('MCP Response Sanitizer', () => {
    it('should sanitize malicious content', async () => {
      const sanitizer = mcpResponseSanitizer();

      const { context, result: modelResult } = outputContextWithText(
        'Normal text <!-- malicious comment --> with https://evil.com link',
      );

      const result = await sanitizer.execute(context);

      expect(result.tripwireTriggered).toBe(false);
      expect(modelResult.text).not.toContain('<!--');
      expect(modelResult.text).not.toContain('evil.com');
    });
  });
});
