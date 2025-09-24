import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  GenerateTextResult,
  LanguageModelRequestMetadata,
  LanguageModelResponseMetadata,
  ProviderMetadata,
  ToolSet,
} from 'ai';

// Use the proper AI SDK types for testing
type TestGenerateTextResult = GenerateTextResult<ToolSet, unknown>;
import {
  outputLengthLimit,
  blockedContent,
  jsonValidation,
  confidenceThreshold,
  toxicityFilter,
  customValidation,
  schemaValidation,
  tokenUsageLimit,
  performanceMonitor,
} from './output';

// Helper function to create mock GenerateTextResult
const createMockGenerateTextResult = (
  overrides: Partial<TestGenerateTextResult> = {},
): TestGenerateTextResult => ({
  content: [],
  text: 'Mock response text',
  reasoning: [],
  reasoningText: undefined,
  files: [],
  sources: [],
  toolCalls: [],
  staticToolCalls: [],
  dynamicToolCalls: [],
  toolResults: [],
  staticToolResults: [],
  dynamicToolResults: [],
  finishReason: 'stop' as const,
  usage: { totalTokens: 10, inputTokens: 5, outputTokens: 5 },
  totalUsage: { totalTokens: 10, inputTokens: 5, outputTokens: 5 },
  warnings: undefined,
  request: {} as LanguageModelRequestMetadata,
  response: {
    id: 'test-id',
    timestamp: new Date(),
    modelId: 'test-model',
    messages: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as LanguageModelResponseMetadata & { messages: any[] },
  providerMetadata: {
    generationTimeMs: 2000,
  } as unknown as ProviderMetadata,
  steps: [],
  experimental_output: undefined,
  ...overrides,
});

// Helper function to create mock input context
const createMockInputContext = () => ({
  prompt: 'Test prompt',
  messages: [],
  system: '',
  maxOutputTokens: 100,
  temperature: 0.7,
  modelParams: {},
});

describe('Output Guardrails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('outputLengthLimit', () => {
    it('should pass when text content is within limit', async () => {
      const guardrail = outputLengthLimit(100);
      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'Short response',
          usage: { totalTokens: 10, inputTokens: 5, outputTokens: 5 },
          finishReason: 'stop' as const,
        }),
      });

      expect(result.tripwireTriggered).toBe(false);
      expect(result.metadata?.contentLength).toBe(14);
    });

    it('should block when text content exceeds limit', async () => {
      const guardrail = outputLengthLimit(10);
      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'This is a very long response that exceeds the limit',
          usage: { totalTokens: 20, inputTokens: 10, outputTokens: 10 },
          finishReason: 'stop' as const,
        }),
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toContain('Output length 51 exceeds limit of 10');
      expect(result.severity).toBe('medium');
      expect(result.metadata?.contentLength).toBe(51);
      expect(result.metadata?.maxLength).toBe(10);
    });

    // cspell:ignore stringifying
    it('should handle object output by stringifying', async () => {
      const guardrail = outputLengthLimit(50);
      const obj = { name: 'John', age: 30, city: 'New York' };
      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: {
          ...createMockGenerateTextResult({
            text: undefined,
            usage: { totalTokens: 15, inputTokens: 0, outputTokens: 15 },
            finishReason: 'stop' as const,
          }),
          object: obj,
        } as TestGenerateTextResult & { object: unknown },
      });

      const stringified = JSON.stringify(obj);
      expect(result.metadata?.contentLength).toBe(stringified.length);
      expect(result.metadata?.hasObject).toBe(true);
    });

    it('should include performance metadata', async () => {
      const guardrail = outputLengthLimit(100);
      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'Test',
          usage: { totalTokens: 20, inputTokens: 10, outputTokens: 10 },
          finishReason: 'stop' as const,
          providerMetadata: {
            generationTimeMs: 2000,
          } as unknown as ProviderMetadata,
        }),
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
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'Clean output content',
        }),
      });

      expect(result.tripwireTriggered).toBe(false);
    });

    it('should block when blocked word is found in text', async () => {
      const guardrail = blockedContent(['spam', 'hack']);
      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'This response contains spam content',
        }),
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
        input: createMockInputContext(),
        result: {
          ...createMockGenerateTextResult({
            text: undefined,
          }),
          object: { data: 'This is confidential information' },
        } as TestGenerateTextResult & { object: unknown },
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toBe('Blocked content detected: confidential');
    });

    it('should be case insensitive', async () => {
      const guardrail = blockedContent(['SPAM']);
      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'spam content',
        }),
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.metadata?.blockedWord).toBe('SPAM');
    });
  });

  // Removed duplicate test - functionality covered above

  // Removed duplicate test - functionality covered in blockedContent tests above

  describe('jsonValidation', () => {
    it('should pass when object is provided', async () => {
      const guardrail = jsonValidation();
      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: {
          ...createMockGenerateTextResult({
            text: undefined,
          }),
          object: { name: 'John', age: 30 },
        } as TestGenerateTextResult & { object: unknown },
      });

      expect(result.tripwireTriggered).toBe(false);
    });

    it('should pass when text is valid JSON', async () => {
      const guardrail = jsonValidation();
      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: '{"name": "John", "age": 30}',
        }),
      });

      expect(result.tripwireTriggered).toBe(false);
    });

    it('should block when text is invalid JSON', async () => {
      const guardrail = jsonValidation();
      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: '{"name": "John", "age": 30',
        }),
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toContain('Output is not valid JSON');
      expect(result.severity).toBe('medium');
      expect(result.metadata?.error).toBeDefined();
      expect(result.metadata?.textLength).toBe(26);
    });

    it('should handle empty text', async () => {
      const guardrail = jsonValidation();
      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: '',
        }),
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toContain('Output is not valid JSON');
    });

    it('should fast-fail non-JSON prefixes', async () => {
      const guardrail = jsonValidation();
      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'This is not JSON',
        }),
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toContain(
        'does not start with valid JSON character',
      );
      expect(result.metadata?.firstChar).toBe('T');
    });
  });

  describe('confidenceThreshold', () => {
    it('should pass when confidence is above threshold', async () => {
      const guardrail = confidenceThreshold(0.8);
      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'I am certain this is correct',
          usage: { totalTokens: 10, inputTokens: 0, outputTokens: 10 },
          finishReason: 'stop' as const,
          reasoningText: 'High confidence response',
        }),
      });

      expect(result.tripwireTriggered).toBe(false);
    });

    it('should block when confidence is below threshold due to uncertainty words', async () => {
      const guardrail = confidenceThreshold(0.7);
      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'I think this might be correct, but I am not sure',
          usage: { totalTokens: 15, inputTokens: 0, outputTokens: 15 },
          finishReason: 'stop' as const,
        }),
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toContain('confidence 0.5 below threshold 0.7');
      expect(result.severity).toBe('medium');
      expect(result.metadata?.hasUncertainty).toBe(true);
    });

    it('should apply finish reason penalty', async () => {
      const guardrail = confidenceThreshold(0.8);
      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'This is a confident response',
          usage: { totalTokens: 10, inputTokens: 0, outputTokens: 10 },
          finishReason: 'length' as const,
        }),
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.metadata?.finishReasonPenalty).toBe(0.2);
      expect(result.metadata?.confidence).toBe(0.7); // 0.9 - 0.2
    });

    it('should include comprehensive metadata', async () => {
      const guardrail = confidenceThreshold(0.6);
      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'Maybe this is correct',
          usage: { totalTokens: 20, inputTokens: 10, outputTokens: 10 },
          finishReason: 'stop' as const,
          reasoningText: 'Uncertain response',
        }),
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
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'This is a positive and helpful response',
        }),
      });

      expect(result.tripwireTriggered).toBe(false);
    });

    it('should block when content is toxic', async () => {
      const guardrail = toxicityFilter(0.5);
      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'This is toxic and harmful content',
        }),
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
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'This is toxic and harmful and offensive content',
        }),
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.metadata?.threshold).toBe(0.7);
      expect(result.metadata?.toxicityScore).toBe(0.899_999_999_999_999_9); // 3 toxic words * 0.3
    });

    it('should handle object content', async () => {
      const guardrail = toxicityFilter(0.2);
      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: {
          ...createMockGenerateTextResult({
            text: undefined,
          }),
          object: { message: 'This is toxic content' },
        } as TestGenerateTextResult & { object: unknown },
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
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'Test output',
        }),
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
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'Test output',
        }),
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
        usage: { totalTokens: 10, inputTokens: 5, outputTokens: 5 },
        finishReason: 'stop' as const,
      };

      await guardrail.execute({
        input: createMockInputContext(),
        result: createMockGenerateTextResult(output),
      });

      expect(mockValidator).toHaveBeenCalledWith({
        text: 'Test output',
        object: null,
        usage: { totalTokens: 10, promptTokens: 5, completionTokens: 5 },
        finishReason: 'stop' as const,
        generationTimeMs: 2000,
      });
    });

    it('should include comprehensive metadata', async () => {
      const guardrail = customValidation(
        'test-validator',
        () => true,
        'Test message',
      );

      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'Test output',
          usage: { totalTokens: 10, inputTokens: 5, outputTokens: 5 },
          finishReason: 'stop' as const,
        }),
      });

      expect(result.metadata?.validatorName).toBe('test-validator');
      expect(result.metadata?.hasText).toBe(true);
      expect(result.metadata?.hasObject).toBe(false);
      expect(result.metadata?.usage).toBeDefined();
      expect(result.metadata?.finishReason).toBe('stop');
      expect(result.metadata?.generationTimeMs).toBe(2000);
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
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'Text output',
        }),
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
        input: createMockInputContext(),
        result: {
          ...createMockGenerateTextResult({
            text: undefined,
            usage: { totalTokens: 10, inputTokens: 0, outputTokens: 10 },
            finishReason: 'stop' as const,
          }),
          object: { name: 'John', age: 30 },
        } as TestGenerateTextResult & { object: unknown },
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
        input: createMockInputContext(),
        result: {
          ...createMockGenerateTextResult({
            text: undefined,
            usage: { totalTokens: 10, inputTokens: 0, outputTokens: 10 },
            finishReason: 'stop' as const,
          }),
          object: { name: 'John', age: 30 },
        } as TestGenerateTextResult & { object: unknown },
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
        input: createMockInputContext(),
        result: {
          ...createMockGenerateTextResult({
            text: undefined,
          }),
          object: { name: 'John', age: 30 },
        } as TestGenerateTextResult & { object: unknown },
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
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'Output text',
          usage: { totalTokens: 50, inputTokens: 20, outputTokens: 30 },
        }),
      });

      expect(result.tripwireTriggered).toBe(false);
    });

    it('should block when token usage exceeds limit', async () => {
      const guardrail = tokenUsageLimit(50);
      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'Output text',
          usage: { totalTokens: 100, inputTokens: 40, outputTokens: 60 },
        }),
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
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'Output text',
          usage: undefined,
        }),
      });

      expect(result.tripwireTriggered).toBe(false);
      expect(result.metadata?.totalTokens).toBe(0);
    });
  });

  describe('performanceMonitor', () => {
    it('should pass when generation time is within limit', async () => {
      const guardrail = performanceMonitor(5000);
      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'Fast response',
          usage: { totalTokens: 20, inputTokens: 10, outputTokens: 10 },
        }),
      });

      expect(result.tripwireTriggered).toBe(false);
    });

    it('should block when generation time exceeds limit', async () => {
      const guardrail = performanceMonitor(1000);
      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'Slow response',
          usage: { totalTokens: 20, inputTokens: 10, outputTokens: 10 },
        }),
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.message).toBe(
        'Generation time 2000ms exceeds limit of 1000ms',
      );
      expect(result.severity).toBe('low');
      expect(result.metadata?.generationTimeMs).toBe(2000);
      expect(result.metadata?.maxGenerationTimeMs).toBe(1000);
    });

    it('should calculate performance metrics', async () => {
      const guardrail = performanceMonitor(10_000);
      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'Response with metrics',
          usage: { totalTokens: 100, inputTokens: 40, outputTokens: 60 },
        }),
      });

      expect(result.metadata?.tokensPerMs).toBe(0.05); // 100 / 2000
      expect(result.metadata?.charactersPerMs).toBe(0.0105); // 21 / 2000
      expect(result.metadata?.contentLength).toBe(21);
    });

    it('should handle missing generation time', async () => {
      const guardrail = performanceMonitor(5000);
      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'Response',
          usage: { totalTokens: 20, inputTokens: 0, outputTokens: 20 },
          providerMetadata: undefined,
        }),
      });

      expect(result.tripwireTriggered).toBe(false);
      expect(result.metadata?.generationTimeMs).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty text and null object', async () => {
      const guardrail = outputLengthLimit(100);
      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: '',
          experimental_output: null,
        }),
      });

      expect(result.tripwireTriggered).toBe(false);
      expect(result.metadata?.contentLength).toBe(0);
    });

    it('should handle undefined inputs gracefully', async () => {
      const guardrail = blockedContent(['test']);
      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'Mock text content',
        }),
      });

      expect(result.tripwireTriggered).toBe(false);
    });

    it('should handle complex nested objects', async () => {
      const guardrail = outputLengthLimit(200);
      const complexObject = {
        user: { name: 'John', details: { age: 30, city: 'NYC' } },
        items: [
          { id: 1, name: 'item1' },
          { id: 2, name: 'item2' },
        ],
      };

      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: {
          ...createMockGenerateTextResult({
            text: undefined,
          }),
          object: complexObject,
        } as TestGenerateTextResult & { object: unknown },
      });

      const expectedLength = JSON.stringify(complexObject).length;
      expect(result.metadata?.contentLength).toBe(expectedLength);
    });

    it('should handle null usage gracefully', async () => {
      const guardrail = tokenUsageLimit(100);
      const result = await guardrail.execute({
        input: createMockInputContext(),
        result: createMockGenerateTextResult({
          text: 'Test',
          usage: undefined,
        }),
      });

      expect(result.tripwireTriggered).toBe(false);
      expect(result.metadata?.totalTokens).toBe(0);
    });
  });
});
