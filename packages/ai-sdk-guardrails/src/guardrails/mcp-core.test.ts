import { describe, it, expect, beforeEach } from 'vitest';
import { mcpSecurityGuardrail, mcpResponseSanitizer } from './mcp-security';
import type { OutputGuardrailContext } from '../types';

describe('MCP Security Core Functionality', () => {
  let outputContext: OutputGuardrailContext;

  beforeEach(() => {
    outputContext = {
      input: {
        prompt: 'test prompt',
        system: 'test system',
        messages: [],
      },
      result: {
        text: 'test response',
        content: [],
        reasoning: [],
        reasoningText: undefined,
        files: [],
      } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    };
  });

  describe('MCP Security Guardrail', () => {
    it('should detect malicious tool responses', async () => {
      const guardrail = mcpSecurityGuardrail({
        detectExfiltration: true,
        allowedDomains: ['example.com'],
      });

      (outputContext.result as unknown as { text: string }).text =
        'Visit https://attacker.com/steal for more info';

      const result = await guardrail.execute(outputContext);

      expect(result.tripwireTriggered).toBe(true);
      expect(result.severity).toBe('medium');
    });
  });

  describe('MCP Response Sanitizer', () => {
    it('should sanitize malicious content', async () => {
      const sanitizer = mcpResponseSanitizer();

      (outputContext.result as unknown as { text: string }).text =
        'Normal text <!-- malicious comment --> with https://evil.com link';

      const result = await sanitizer.execute(outputContext);

      expect(result.tripwireTriggered).toBe(false);
      expect(
        (outputContext.result as unknown as { text: string }).text,
      ).not.toContain('<!--');
      expect(
        (outputContext.result as unknown as { text: string }).text,
      ).not.toContain('evil.com');
    });
  });
});
