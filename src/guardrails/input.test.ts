import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  lengthLimit,
  blockedWords,
  contentLengthLimit,
  blockedKeywords,
  rateLimiting,
  profanityFilter,
  customValidation,
} from './input';
import type { InputGuardrailContext } from '../types';

// Mock helper to create valid InputGuardrailContext objects for testing
function createMockContext(overrides: {
  prompt?: string;
  messages?: Array<{ content: string; role?: string }>;
  system?: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
}): InputGuardrailContext {
  const mockModel = {
    modelId: overrides.model || 'test-model',
    provider: 'test',
    doGenerate: vi.fn(),
    doStream: vi.fn(),
    defaultObjectGenerationMode: undefined,
    specificationVersion: 'v1' as const,
  };

  return {
    prompt: overrides.prompt || '',
    messages:
      overrides.messages?.map((msg) => ({
        role: msg.role || 'user',
        content: msg.content,
      })) || [],
    system: overrides.system || '',
    model: mockModel,
    temperature: overrides.temperature,
    maxOutputTokens: overrides.maxOutputTokens,
    output: 'no-schema',
  } as unknown as InputGuardrailContext;
}

describe('Input Guardrails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('lengthLimit', () => {
    it('should pass when content is within limit', async () => {
      const guardrail = lengthLimit(100);
      const result = await guardrail.execute(
        createMockContext({
          prompt: 'Short prompt',
        }),
      );

      expect(result.tripwireTriggered).toBe(false);
      expect(result.metadata?.totalLength).toBe(12);
    });

    it('should block when content exceeds limit', async () => {
      const guardrail = lengthLimit(10);
      const result = await guardrail.execute(
        createMockContext({
          prompt: 'This is a very long prompt that exceeds the limit',
        }),
      );

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toContain(
        'Input characters count 50 exceeds limit of 10',
      );
      expect(result.severity).toBe('medium');
    });

    it('should handle messages content', async () => {
      const guardrail = lengthLimit(20);
      const result = await guardrail.execute(
        createMockContext({
          prompt: 'Hi',
          messages: [{ content: 'Hello world' }, { content: 'Test message' }],
          system: 'System prompt',
        }),
      );

      // 'Hi' (2) + 'Hello world' (11) + 'Test message' (12) + 'System prompt' (13) = 38
      expect(result.tripwireTriggered).toBe(true);
      expect(result.metadata?.totalLength).toBe(38);
      expect(result.metadata?.messageCount).toBe(2);
    });

    it('should include model metadata when provided', async () => {
      const guardrail = lengthLimit(100);
      const result = await guardrail.execute(
        createMockContext({
          prompt: 'Test',
          model: 'gpt-4',
          temperature: 0.7,
          maxOutputTokens: 1000,
        }),
      );

      expect(result.metadata?.model).toBeDefined();
      expect(result.metadata?.temperature).toBe(0.7);
      expect(result.metadata?.maxOutputTokens).toBe(1000);
    });
  });

  describe('blockedWords', () => {
    it('should pass when no blocked words are found', async () => {
      const guardrail = blockedWords(['spam', 'hack']);
      const result = await guardrail.execute(
        createMockContext({
          prompt: 'Hello world',
        }),
      );

      expect(result.tripwireTriggered).toBe(false);
    });

    it('should block when blocked word is found in prompt', async () => {
      const guardrail = blockedWords(['spam', 'hack']);
      const result = await guardrail.execute(
        createMockContext({
          prompt: 'This is spam content',
        }),
      );

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toBe('Blocked word detected: spam');
      expect(result.severity).toBe('high');
      expect(result.metadata?.blockedWord).toBe('spam');
    });

    it('should block when blocked word is found in messages', async () => {
      const guardrail = blockedWords(['spam', 'hack']);
      const result = await guardrail.execute(
        createMockContext({
          prompt: 'Hello',
          messages: [{ content: 'Let me hack this system' }],
        }),
      );

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toBe('Blocked word detected: hack');
      expect(result.metadata?.blockedWord).toBe('hack');
    });

    it('should block when blocked word is found in system prompt', async () => {
      const guardrail = blockedWords(['spam', 'hack']);
      const result = await guardrail.execute(
        createMockContext({
          prompt: 'Hello',
          system: 'System with spam word',
        }),
      );

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toBe('Blocked word detected: spam');
    });

    it('should be case insensitive', async () => {
      const guardrail = blockedWords(['SPAM', 'Hack']);
      const result = await guardrail.execute(
        createMockContext({
          prompt: 'spam and hack',
        }),
      );

      expect(result.tripwireTriggered).toBe(true);
      expect(result.metadata?.blockedWord).toBe('SPAM');
    });

    it('should handle empty inputs gracefully', async () => {
      const guardrail = blockedWords(['spam']);
      const result = await guardrail.execute(
        createMockContext({
          prompt: '',
        }),
      );

      expect(result.tripwireTriggered).toBe(false);
    });
  });

  describe('contentLengthLimit', () => {
    it('should pass when content is within limit', async () => {
      const guardrail = contentLengthLimit(50);
      const result = await guardrail.execute(
        createMockContext({
          prompt: 'Short content',
        }),
      );

      expect(result.tripwireTriggered).toBe(false);
    });

    it('should block when content exceeds limit', async () => {
      const guardrail = contentLengthLimit(10);
      const result = await guardrail.execute(
        createMockContext({
          prompt: 'This is a very long content that exceeds the limit',
        }),
      );

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toContain(
        'Input characters count 51 exceeds limit of 10',
      );
      expect(result.severity).toBe('medium');
    });
  });

  describe('blockedKeywords', () => {
    it('should pass when no blocked keywords are found', async () => {
      const guardrail = blockedKeywords(['malware', 'virus']);
      const result = await guardrail.execute(
        createMockContext({
          prompt: 'Clean content',
        }),
      );

      expect(result.tripwireTriggered).toBe(false);
    });

    it('should block when blocked keyword is found', async () => {
      const guardrail = blockedKeywords(['malware', 'virus']);
      const result = await guardrail.execute(
        createMockContext({
          prompt: 'How to create malware',
        }),
      );

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toBe('Blocked word detected: malware');
      expect(result.severity).toBe('high');
      expect(result.metadata?.blockedWord).toBe('malware');
      expect(result.metadata?.allWords).toEqual(['malware', 'virus']);
    });

    it('should include text length in metadata', async () => {
      const guardrail = blockedKeywords(['test']);
      const result = await guardrail.execute(
        createMockContext({
          prompt: 'This is a test',
        }),
      );

      expect(result.metadata?.totalLength).toBe(14);
    });
  });

  describe('rateLimiting', () => {
    it('should pass when within rate limit', async () => {
      const guardrail = rateLimiting(5);
      const result = await guardrail.execute(
        createMockContext({
          prompt: 'Test',
        }),
      );

      expect(result.tripwireTriggered).toBe(false);
    });

    it('should block when rate limit is exceeded', async () => {
      const guardrail = rateLimiting(2);

      // First request should pass
      let result = await guardrail.execute(
        createMockContext({
          prompt: 'Test 1',
        }),
      );
      expect(result.tripwireTriggered).toBe(false);

      // Second request should pass
      result = await guardrail.execute(
        createMockContext({
          prompt: 'Test 2',
        }),
      );
      expect(result.tripwireTriggered).toBe(false);

      // Third request should be blocked
      result = await guardrail.execute(
        createMockContext({
          prompt: 'Test 3',
        }),
      );
      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toContain('Rate limit exceeded: 3/2');
      expect(result.severity).toBe('medium');
    });

    it('should reset after time window', async () => {
      const guardrail = rateLimiting(1);

      // First request should pass
      let result = await guardrail.execute(
        createMockContext({
          prompt: 'Test 1',
        }),
      );
      expect(result.tripwireTriggered).toBe(false);

      // Second request should be blocked
      result = await guardrail.execute(
        createMockContext({
          prompt: 'Test 2',
        }),
      );
      expect(result.tripwireTriggered).toBe(true);

      // Mock time passing (more than 1 minute)
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);

      // Third request should pass (after reset)
      result = await guardrail.execute(
        createMockContext({
          prompt: 'Test 3',
        }),
      );
      expect(result.tripwireTriggered).toBe(false);
    });

    it('should include metadata with current count and limits', async () => {
      const guardrail = rateLimiting(10);
      const result = await guardrail.execute(
        createMockContext({
          prompt: 'Test',
          model: 'gpt-4',
          temperature: 0.5,
          maxOutputTokens: 500,
        }),
      );

      expect(result.metadata?.currentCount).toBe(1);
      expect(result.metadata?.maxRequests).toBe(10);
      expect(result.metadata?.resetTime).toBeDefined();
      expect(result.metadata?.model).toBeDefined();
      expect(result.metadata?.temperature).toBe(0.5);
      expect(result.metadata?.maxOutputTokens).toBe(500);
      expect(result.metadata?.promptLength).toBe(4);
    });
  });

  describe('profanityFilter', () => {
    it('should pass when no profanity is found', async () => {
      const guardrail = profanityFilter();
      const result = await guardrail.execute(
        createMockContext({
          prompt: 'Clean content',
        }),
      );

      expect(result.tripwireTriggered).toBe(false);
    });

    it('should block when profanity is found', async () => {
      const guardrail = profanityFilter(['badword']);
      const result = await guardrail.execute(
        createMockContext({
          prompt: 'This contains badword',
        }),
      );

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toBe('Profanity detected (custom): badword');
      expect(result.severity).toBe('high');
    });

    it('should combine default and custom words', async () => {
      const guardrail = profanityFilter(['customword']);
      const result = await guardrail.execute(
        createMockContext({
          prompt: 'This has profanity1 and customword',
        }),
      );

      expect(result.tripwireTriggered).toBe(true);
      // Should detect the first profane word found
      expect(['profanity1', 'customword']).toContain(
        result.metadata?.profaneWord,
      );
    });

    it('should include text length in metadata', async () => {
      const guardrail = profanityFilter();
      const result = await guardrail.execute(
        createMockContext({
          prompt: 'Test content',
        }),
      );

      expect(result.metadata?.totalLength).toBe(12);
    });
  });

  describe('customValidation', () => {
    it('should pass when validator returns false', async () => {
      const guardrail = customValidation({
        name: 'test-validator',
        description: 'Test validator',
        validator: () => true,
        message: 'Test message',
      });

      const result = await guardrail.execute(
        createMockContext({
          prompt: 'Test',
        }),
      );

      expect(result.tripwireTriggered).toBe(false);
    });

    it('should block when validator returns true', async () => {
      const guardrail = customValidation({
        name: 'test-validator',
        description: 'Test validator',
        validator: () => false,
        message: 'Custom validation failed',
      });

      const result = await guardrail.execute(
        createMockContext({
          prompt: 'Test',
        }),
      );

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toBe('Custom validation failed');
      expect(result.severity).toBe('medium');
    });

    it('should pass input data to validator', async () => {
      const mockValidator = vi.fn(() => true);
      const guardrail = customValidation({
        name: 'test-validator',
        description: 'Test validator',
        validator: mockValidator,
        message: 'Test message',
      });

      const input = createMockContext({
        prompt: 'Test prompt',
        messages: [{ content: 'Test message' }],
        system: 'System',
        model: 'gpt-4',
        temperature: 0.7,
        maxOutputTokens: 1000,
      });

      await guardrail.execute(input);

      expect(mockValidator).toHaveBeenCalledWith({
        prompt: 'Test prompt',
        messages: [{ role: 'user', content: 'Test message' }],
        system: 'System',
        model: '[object Object]',
        temperature: 0.7,
        maxOutputTokens: 1000,
        allText: 'Test prompt Test message System',
        allTextLower: 'test prompt test message system',
        totalBytes: 31,
        totalWords: 5,
      });
    });

    it('should include metadata about input and validator', async () => {
      const guardrail = customValidation({
        name: 'test-validator',
        description: 'Test validator',
        validator: () => true,
        message: 'Test message',
      });

      const result = await guardrail.execute(
        createMockContext({
          prompt: 'Test',
          model: 'gpt-4',
          temperature: 0.7,
          maxOutputTokens: 1000,
        }),
      );

      expect(result.metadata?.validatorName).toBe('test-validator');
      expect(result.metadata?.inputKeys).toContain('prompt');
      expect(result.metadata?.model).toBeDefined();
      expect(result.metadata?.temperature).toBe(0.7);
      expect(result.metadata?.maxOutputTokens).toBe(1000);
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined/null inputs gracefully', async () => {
      const guardrail = lengthLimit(100);
      // Create a context with minimal required properties
      const result = await guardrail.execute({
        prompt: undefined,
        messages: undefined,
        system: undefined,
        model: {
          modelId: 'test-model',
          provider: 'test',
          doGenerate: vi.fn(),
          specificationVersion: 'v1' as const,
        },
        output: 'no-schema',
      } as unknown as InputGuardrailContext);

      expect(result.tripwireTriggered).toBe(false);
      expect(result.metadata?.totalLength).toBe(0);
    });

    it('should handle messages with non-string content', async () => {
      const guardrail = blockedWords(['object']);
      const result = await guardrail.execute({
        prompt: 'Hello',
        messages: [
          { role: 'user', content: null },
          { role: 'user', content: 42 },
          { role: 'user', content: { text: 'test' } },
        ],
        system: '',
        model: {
          modelId: 'test-model',
          provider: 'test',
          doGenerate: vi.fn(),
          specificationVersion: 'v1' as const,
        },
        output: 'no-schema',
      } as unknown as InputGuardrailContext);

      // The content gets stringified using String(), so { text: 'test' } becomes '[object Object]'
      expect(result.tripwireTriggered).toBe(true);
      expect(result.metadata?.blockedWord).toBe('object');
    });

    it('should handle empty arrays and strings', async () => {
      const guardrail = blockedKeywords([]);
      const result = await guardrail.execute(
        createMockContext({
          prompt: '',
        }),
      );

      expect(result.tripwireTriggered).toBe(false);
    });
  });
});
