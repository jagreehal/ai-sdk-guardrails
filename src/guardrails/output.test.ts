import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  lengthLimit,
  blockedContent,
  outputLengthLimit,
  blockedOutputContent,
  jsonValidation,
  confidenceThreshold,
  toxicityFilter,
  customValidation,
  schemaValidation,
  tokenUsageLimit,
  performanceMonitor,
} from './output';

describe('Output Guardrails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('lengthLimit', () => {
    it('should pass when text content is within limit', async () => {
      const guardrail = lengthLimit(100);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'Short response',
          usage: { totalTokens: 10, inputTokens: 5, outputTokens: 5 },
          finishReason: 'stop',
          experimental_providerMetadata: { generationTimeMs: 1000 },
        } as any,
      });

      expect(result.tripwireTriggered).toBe(false);
      expect(result.metadata?.contentLength).toBe(14);
    });

    it('should block when text content exceeds limit', async () => {
      const guardrail = lengthLimit(10);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'This is a very long response that exceeds the limit',
          usage: { totalTokens: 20, inputTokens: 10, outputTokens: 10 },
          finishReason: 'stop',
          experimental_providerMetadata: { generationTimeMs: 2000 },
        } as any,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toContain('Output length 51 exceeds limit of 10');
      expect(result.severity).toBe('medium');
      expect(result.metadata?.contentLength).toBe(51);
      expect(result.metadata?.maxLength).toBe(10);
    });

    it('should handle object output by stringifying', async () => {
      const guardrail = lengthLimit(50);
      const obj = { name: 'John', age: 30, city: 'New York' };
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: '',
          object: obj,
          usage: { totalTokens: 15 },
          finishReason: 'stop',
          experimental_providerMetadata: { generationTimeMs: 1500 },
        } as any,
      });

      const stringified = JSON.stringify(obj);
      expect(result.metadata?.contentLength).toBe(stringified.length);
      expect(result.metadata?.hasObject).toBe(true);
    });

    it('should include performance metadata', async () => {
      const guardrail = lengthLimit(100);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'Test',
          usage: { totalTokens: 20, inputTokens: 10, outputTokens: 10 },
          finishReason: 'stop',
          experimental_providerMetadata: { generationTimeMs: 2000 },
        } as any,
      });

      expect(result.metadata?.usage).toBeDefined();
      expect(result.metadata?.finishReason).toBe('stop');
      expect(result.metadata?.generationTimeMs).toBe(2000);
      expect(result.metadata?.tokensPerMs).toBe(0.01); // 20 / 2000
    });
  });

  describe('blockedContent', () => {
    it('should pass when no blocked words are found', async () => {
      const guardrail = blockedContent(['spam', 'hack']);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'Clean output content',
          object: null,
        } as any,
      });

      expect(result.tripwireTriggered).toBe(false);
    });

    it('should block when blocked word is found in text', async () => {
      const guardrail = blockedContent(['spam', 'hack']);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'This response contains spam content',
          object: null,
        } as any,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toBe('Blocked content detected: spam');
      expect(result.severity).toBe('high');
      expect(result.metadata?.blockedWord).toBe('spam');
      expect(result.metadata?.allWords).toEqual(['spam', 'hack']);
    });

    it('should block when blocked word is found in object', async () => {
      const guardrail = blockedContent(['confidential']);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: '',
          object: { message: 'This is confidential information' },
        } as any,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toBe('Blocked content detected: confidential');
    });

    it('should be case insensitive', async () => {
      const guardrail = blockedContent(['SPAM']);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'spam content',
          object: null,
        } as any,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.metadata?.blockedWord).toBe('SPAM');
    });
  });

  describe('outputLengthLimit', () => {
    it('should pass when content is within limit', async () => {
      const guardrail = outputLengthLimit(100);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'Short output',
          object: null,
        } as any,
      });

      expect(result.tripwireTriggered).toBe(false);
      expect(result.metadata?.contentLength).toBe(12);
    });

    it('should block when content exceeds limit', async () => {
      const guardrail = outputLengthLimit(10);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'This is a very long output that exceeds the limit',
          object: null,
        } as any,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toContain('Output length 49 exceeds limit of 10');
      expect(result.severity).toBe('medium');
    });
  });

  describe('blockedOutputContent', () => {
    it('should pass when no blocked content is found', async () => {
      const guardrail = blockedOutputContent(['password', 'secret']);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'Safe output content',
          object: null,
        } as any,
      });

      expect(result.tripwireTriggered).toBe(false);
    });

    it('should block when blocked content is found', async () => {
      const guardrail = blockedOutputContent(['password', 'secret']);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'Your password is 123456',
          object: null,
        } as any,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toBe('Blocked output content detected: password');
      expect(result.severity).toBe('high');
    });
  });

  describe('jsonValidation', () => {
    it('should pass when object is provided', async () => {
      const guardrail = jsonValidation();
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: '',
          object: { valid: true },
        } as any,
      });

      expect(result.tripwireTriggered).toBe(false);
    });

    it('should pass when text is valid JSON', async () => {
      const guardrail = jsonValidation();
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: '{"name": "John", "age": 30}',
          object: null,
        } as any,
      });

      expect(result.tripwireTriggered).toBe(false);
    });

    it('should block when text is invalid JSON', async () => {
      const guardrail = jsonValidation();
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: '{"name": "John", "age": 30',
          object: null,
        } as any,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toBe('Output is not valid JSON');
      expect(result.severity).toBe('medium');
      expect(result.metadata?.error).toBeDefined();
      expect(result.metadata?.textLength).toBe(26);
    });

    it('should handle empty text', async () => {
      const guardrail = jsonValidation();
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: '',
          object: null,
        } as any,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toBe('Output is not valid JSON');
    });
  });

  describe('confidenceThreshold', () => {
    it('should pass when confidence is above threshold', async () => {
      const guardrail = confidenceThreshold(0.8);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'I am certain this is correct',
          object: null,
          usage: { totalTokens: 10 },
          finishReason: 'stop',
          reasoningText: 'High confidence response',
        } as any,
      });

      expect(result.tripwireTriggered).toBe(false);
    });

    it('should block when confidence is below threshold due to uncertainty words', async () => {
      const guardrail = confidenceThreshold(0.7);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'I think this might be correct, but I am not sure',
          object: null,
          usage: { totalTokens: 15 },
          finishReason: 'stop',
        } as any,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toContain('confidence 0.5 below threshold 0.7');
      expect(result.severity).toBe('medium');
      expect(result.metadata?.hasUncertainty).toBe(true);
    });

    it('should apply finish reason penalty', async () => {
      const guardrail = confidenceThreshold(0.8);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'This is a confident response',
          object: null,
          usage: { totalTokens: 10 },
          finishReason: 'length',
        } as any,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.metadata?.finishReasonPenalty).toBe(0.2);
      expect(result.metadata?.confidence).toBe(0.7); // 0.9 - 0.2
    });

    it('should include comprehensive metadata', async () => {
      const guardrail = confidenceThreshold(0.6);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'Maybe this is correct',
          object: null,
          usage: { totalTokens: 20, inputTokens: 10, outputTokens: 10 },
          finishReason: 'stop',
          reasoningText: 'Uncertain response',
          experimental_providerMetadata: {
            reasoningText: 'Uncertain response',
          },
        } as any,
      });

      expect(result.metadata?.confidence).toBeDefined();
      expect(result.metadata?.minConfidence).toBe(0.6);
      expect(result.metadata?.hasUncertainty).toBe(true);
      expect(result.metadata?.textLength).toBe(21);
      expect(result.metadata?.usage).toBeDefined();
      expect(result.metadata?.finishReason).toBe('stop');
      expect(result.metadata?.reasoningText).toBe('Uncertain response');
    });
  });

  describe('toxicityFilter', () => {
    it('should pass when content is not toxic', async () => {
      const guardrail = toxicityFilter(0.7);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'This is a positive and helpful response',
          object: null,
        } as any,
      });

      expect(result.tripwireTriggered).toBe(false);
    });

    it('should block when content is toxic', async () => {
      const guardrail = toxicityFilter(0.5);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'This is toxic and harmful content',
          object: null,
        } as any,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toContain(
        'Content toxicity score 0.6 exceeds threshold 0.5',
      );
      expect(result.severity).toBe('high');
      expect(result.metadata?.toxicityScore).toBe(0.6); // 2 toxic words * 0.3
      expect(result.metadata?.detectedWords).toEqual(['toxic', 'harmful']);
    });

    it('should use default threshold', async () => {
      const guardrail = toxicityFilter();
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'This is toxic and harmful and offensive content',
          object: null,
        } as any,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.metadata?.threshold).toBe(0.7);
      expect(result.metadata?.toxicityScore).toBe(0.899_999_999_999_999_9); // 3 toxic words * 0.3
    });

    it('should handle object content', async () => {
      const guardrail = toxicityFilter(0.2);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: '',
          object: { message: 'This is toxic content' },
        } as any,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.metadata?.detectedWords).toEqual(['toxic']);
    });
  });

  describe('customValidation', () => {
    it('should pass when validator returns false', async () => {
      const guardrail = customValidation(
        'test-validator',
        () => false,
        'Custom validation failed',
      );

      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'Test output',
          object: null,
        } as any,
      });

      expect(result.tripwireTriggered).toBe(false);
    });

    it('should block when validator returns true', async () => {
      const guardrail = customValidation(
        'test-validator',
        () => true,
        'Custom validation failed',
      );

      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'Test output',
          object: null,
        } as any,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toBe('Custom validation failed');
      expect(result.severity).toBe('medium');
    });

    it('should pass output data to validator', async () => {
      const mockValidator = vi.fn(() => false);
      const guardrail = customValidation(
        'test-validator',
        mockValidator,
        'Test message',
      );

      const output = {
        text: 'Test output',
        object: { test: true },
        usage: { totalTokens: 10, inputTokens: 5, outputTokens: 5 },
        finishReason: 'stop',
        generationTimeMs: 1000,
        experimental_providerMetadata: { generationTimeMs: 1000 },
      };

      await guardrail.execute({
        input: {} as any,
        result: output as any,
      });

      expect(mockValidator).toHaveBeenCalledWith({
        text: 'Test output',
        object: { test: true },
        usage: { totalTokens: 10, promptTokens: 5, completionTokens: 5 },
        finishReason: 'stop',
        generationTimeMs: 1000,
      });
    });

    it('should include comprehensive metadata', async () => {
      const guardrail = customValidation(
        'test-validator',
        () => true,
        'Test message',
      );

      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'Test output',
          object: { test: true },
          usage: { totalTokens: 10, inputTokens: 5, outputTokens: 5 },
          finishReason: 'stop',
          generationTimeMs: 1000,
          experimental_providerMetadata: { generationTimeMs: 1000 },
        } as any,
      });

      expect(result.metadata?.validatorName).toBe('test-validator');
      expect(result.metadata?.hasText).toBe(true);
      expect(result.metadata?.hasObject).toBe(true);
      expect(result.metadata?.usage).toBeDefined();
      expect(result.metadata?.finishReason).toBe('stop');
      expect(result.metadata?.generationTimeMs).toBe(1000);
    });
  });

  describe('schemaValidation', () => {
    const mockSchema = {
      parse: vi.fn(),
    };

    beforeEach(() => {
      mockSchema.parse.mockClear();
    });

    it('should block when no object is provided', async () => {
      const guardrail = schemaValidation(mockSchema);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'Text output',
          object: null,
        } as any,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toBe('No object to validate');
      expect(result.severity).toBe('medium');
      expect(result.metadata?.hasObject).toBe(false);
    });

    it('should pass when object validates successfully', async () => {
      mockSchema.parse.mockReturnValue({ valid: true });
      const guardrail = schemaValidation(mockSchema);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: '',
          object: { name: 'John', age: 30 },
          usage: { totalTokens: 10 },
          finishReason: 'stop',
          generationTimeMs: 1000,
        } as any,
      });

      expect(result.tripwireTriggered).toBe(false);
      expect(result.metadata?.hasObject).toBe(true);
      expect(result.metadata?.validationPassed).toBe(true);
      expect(mockSchema.parse).toHaveBeenCalledWith({ name: 'John', age: 30 });
    });

    it('should block when schema validation fails', async () => {
      const error = new Error('Invalid schema');
      mockSchema.parse.mockImplementation(() => {
        throw error;
      });

      const guardrail = schemaValidation(mockSchema);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: '',
          object: { invalid: true },
          usage: { totalTokens: 10 },
          finishReason: 'stop',
          generationTimeMs: 1000,
        } as any,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toBe('Schema validation failed: Invalid schema');
      expect(result.severity).toBe('high');
      expect(result.metadata?.hasObject).toBe(true);
      expect(result.metadata?.validationPassed).toBe(false);
      expect(result.metadata?.error).toBe('Invalid schema');
    });

    it('should handle non-Error exceptions', async () => {
      mockSchema.parse.mockImplementation(() => {
        throw new Error('String error');
      });

      const guardrail = schemaValidation(mockSchema);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: '',
          object: { invalid: true },
        } as any,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toBe('Schema validation failed: String error');
      expect(result.metadata?.error).toBe('String error');
    });
  });

  describe('tokenUsageLimit', () => {
    it('should pass when token usage is within limit', async () => {
      const guardrail = tokenUsageLimit(100);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'Output text',
          object: null,
          usage: { totalTokens: 50, inputTokens: 20, outputTokens: 30 },
          generationTimeMs: 1000,
        } as any,
      });

      expect(result.tripwireTriggered).toBe(false);
    });

    it('should block when token usage exceeds limit', async () => {
      const guardrail = tokenUsageLimit(50);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'Output text',
          object: null,
          usage: { totalTokens: 100, inputTokens: 40, outputTokens: 60 },
          generationTimeMs: 2000,
          experimental_providerMetadata: { generationTimeMs: 2000 },
        } as any,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toBe('Token usage 100 exceeds limit of 50');
      expect(result.severity).toBe('medium');
      expect(result.metadata?.totalTokens).toBe(100);
      expect(result.metadata?.maxTokens).toBe(50);
      expect(result.metadata?.inputTokens).toBe(40);
      expect(result.metadata?.outputTokens).toBe(60);
      expect(result.metadata?.tokensPerMs).toBe(0.05); // 100 / 2000
    });

    it('should handle missing usage information', async () => {
      const guardrail = tokenUsageLimit(50);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'Output text',
          object: null,
          usage: null,
          generationTimeMs: 1000,
        } as any,
      });

      expect(result.tripwireTriggered).toBe(false);
      expect(result.metadata?.totalTokens).toBe(0);
    });
  });

  describe('performanceMonitor', () => {
    it('should pass when generation time is within limit', async () => {
      const guardrail = performanceMonitor(5000);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'Fast response',
          object: null,
          usage: { totalTokens: 20, inputTokens: 10, outputTokens: 10 },
          generationTimeMs: 3000,
        } as any,
      });

      expect(result.tripwireTriggered).toBe(false);
    });

    it('should block when generation time exceeds limit', async () => {
      const guardrail = performanceMonitor(2000);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'Slow response',
          object: null,
          usage: { totalTokens: 20, inputTokens: 10, outputTokens: 10 },
          generationTimeMs: 5000,
          experimental_providerMetadata: { generationTimeMs: 5000 },
        } as any,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toBe(
        'Generation time 5000ms exceeds limit of 2000ms',
      );
      expect(result.severity).toBe('low');
      expect(result.metadata?.generationTimeMs).toBe(5000);
      expect(result.metadata?.maxGenerationTimeMs).toBe(2000);
    });

    it('should calculate performance metrics', async () => {
      const guardrail = performanceMonitor(10_000);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'Response with metrics',
          object: null,
          usage: { totalTokens: 100, inputTokens: 40, outputTokens: 60 },
          generationTimeMs: 4000,
          experimental_providerMetadata: { generationTimeMs: 4000 },
        } as any,
      });

      expect(result.metadata?.tokensPerMs).toBe(0.025); // 100 / 4000
      expect(result.metadata?.charactersPerMs).toBe(0.005_25); // 21 / 4000
      expect(result.metadata?.contentLength).toBe(21);
    });

    it('should handle missing generation time', async () => {
      const guardrail = performanceMonitor(5000);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'Response',
          object: null,
          usage: { totalTokens: 20 },
          generationTimeMs: 0,
        } as any,
      });

      expect(result.tripwireTriggered).toBe(false);
      expect(result.metadata?.generationTimeMs).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty text and null object', async () => {
      const guardrail = lengthLimit(100);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: '',
          object: null,
        } as any,
      });

      expect(result.tripwireTriggered).toBe(false);
      expect(result.metadata?.contentLength).toBe(0);
    });

    it('should handle undefined inputs gracefully', async () => {
      const guardrail = blockedContent(['test']);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: undefined,
          object: undefined,
        } as any,
      });

      expect(result.tripwireTriggered).toBe(false);
    });

    it('should handle complex nested objects', async () => {
      const guardrail = lengthLimit(200);
      const complexObject = {
        user: { name: 'John', details: { age: 30, city: 'NYC' } },
        items: [
          { id: 1, name: 'item1' },
          { id: 2, name: 'item2' },
        ],
      };

      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: '',
          object: complexObject,
        } as any,
      });

      const expectedLength = JSON.stringify(complexObject).length;
      expect(result.metadata?.contentLength).toBe(expectedLength);
    });

    it('should handle null usage gracefully', async () => {
      const guardrail = tokenUsageLimit(100);
      const result = await guardrail.execute({
        input: {} as any,
        result: {
          text: 'Test',
          object: null,
          usage: undefined,
          generationTimeMs: 1000,
        } as any,
      });

      expect(result.tripwireTriggered).toBe(false);
      expect(result.metadata?.totalTokens).toBe(0);
    });
  });
});
