import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createInputGuardrailsMiddleware,
  createOutputGuardrailsMiddleware,
  defineInputGuardrail,
  defineOutputGuardrail,
  // New AI SDK 5 Helper Functions
  wrapWithInputGuardrails,
  wrapWithOutputGuardrails,
  wrapWithGuardrails,
} from './guardrails';
import type { LanguageModelV2, LanguageModelV2CallOptions } from './types';

// Mock AI model for testing
const createMockModel = (response = 'Mock AI response'): LanguageModelV2 => ({
  specificationVersion: 'v2',
  provider: 'test',
  modelId: 'test-model',
  supportedUrls: {},
  async doGenerate(options) {
    return {
      content: [{ type: 'text', text: response }],
      finishReason: 'stop',
      usage: {
        inputTokens: 10,
        outputTokens: 10,
        totalTokens: 20,
      },
      rawCall: {
        rawPrompt: options.prompt,
        rawSettings: {},
      },
      response: {
        headers: {},
      },
      warnings: [],
    };
  },
  async doStream(options) {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: 'text-delta' as const,
          id: '1',
          delta: response,
        });
        controller.enqueue({
          type: 'finish' as const,
          finishReason: 'stop',
          usage: {
            inputTokens: 10,
            outputTokens: 10,
            totalTokens: 20,
          },
        });
        controller.close();
      },
    });

    return {
      stream,
      rawCall: {
        rawPrompt: options.prompt,
        rawSettings: {},
      },
      response: {
        headers: {},
      },
      warnings: [],
    };
  },
});

describe('AI SDK 5 Helper Functions', () => {
  let mockModel: LanguageModelV2;
  let testInputGuardrail: ReturnType<typeof defineInputGuardrail>;
  let testOutputGuardrail: ReturnType<typeof defineOutputGuardrail>;

  beforeEach(() => {
    mockModel = createMockModel();
    testInputGuardrail = defineInputGuardrail({
      name: 'test-input',
      description: 'Test input guardrail',
      execute: async () => ({
        tripwireTriggered: false,
        info: {
          guardrailName: 'test-guardrail',
        },
      }),
    });
    testOutputGuardrail = defineOutputGuardrail({
      name: 'test-output',
      description: 'Test output guardrail',
      execute: async () => ({
        tripwireTriggered: false,
        info: {
          guardrailName: 'test-guardrail',
        },
      }),
    });
  });

  describe('wrapWithInputGuardrails', () => {
    it('should wrap model with input guardrails', () => {
      const wrappedModel = wrapWithInputGuardrails(
        mockModel,
        [testInputGuardrail],
        { throwOnBlocked: false },
      );

      expect(wrappedModel).toHaveProperty('doGenerate');
      expect(wrappedModel).toHaveProperty('doStream');
      expect(wrappedModel.provider).toBe('test');
      expect(wrappedModel.modelId).toBe('test-model');
    });

    it('should apply input guardrails correctly', async () => {
      const blockingGuardrail = defineInputGuardrail({
        name: 'blocking',
        execute: async () => ({
          tripwireTriggered: true,
          message: 'Blocked',
          severity: 'high' as const,
          info: {
            guardrailName: 'test-guardrail',
          },
        }),
      });

      const wrappedModel = wrapWithInputGuardrails(
        mockModel,
        [blockingGuardrail],
        { throwOnBlocked: false },
      );

      const result = await wrappedModel.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      });

      expect(result.content[0]).toEqual(
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('[Input blocked: Blocked]'),
        }),
      );
    });
  });

  describe('wrapWithOutputGuardrails', () => {
    it('should wrap model with output guardrails', () => {
      const wrappedModel = wrapWithOutputGuardrails(
        mockModel,
        [testOutputGuardrail],
        { throwOnBlocked: false },
      );

      expect(wrappedModel).toHaveProperty('doGenerate');
      expect(wrappedModel).toHaveProperty('doStream');
      expect(wrappedModel.provider).toBe('test');
      expect(wrappedModel.modelId).toBe('test-model');
    });
  });

  describe('wrapWithGuardrails', () => {
    it('should wrap model with both input and output guardrails', () => {
      const wrappedModel = wrapWithGuardrails(mockModel, {
        inputGuardrails: [testInputGuardrail],
        outputGuardrails: [testOutputGuardrail],
        throwOnBlocked: false,
      });

      expect(wrappedModel).toHaveProperty('doGenerate');
      expect(wrappedModel).toHaveProperty('doStream');
      expect(wrappedModel.provider).toBe('test');
      expect(wrappedModel.modelId).toBe('test-model');
    });

    it('should return original model when no guardrails provided', () => {
      const wrappedModel = wrapWithGuardrails(mockModel, {});
      expect(wrappedModel).toBe(mockModel);
    });

    it('should handle input-only guardrails', () => {
      const wrappedModel = wrapWithGuardrails(mockModel, {
        inputGuardrails: [testInputGuardrail],
      });

      expect(wrappedModel).toHaveProperty('doGenerate');
      expect(wrappedModel).toHaveProperty('doStream');
    });

    it('should handle output-only guardrails', () => {
      const wrappedModel = wrapWithGuardrails(mockModel, {
        outputGuardrails: [testOutputGuardrail],
      });

      expect(wrappedModel).toHaveProperty('doGenerate');
      expect(wrappedModel).toHaveProperty('doStream');
    });

    it('should handle callback configuration', () => {
      const onInputBlocked = vi.fn();
      const onOutputBlocked = vi.fn();

      const wrappedModel = wrapWithGuardrails(mockModel, {
        inputGuardrails: [testInputGuardrail],
        outputGuardrails: [testOutputGuardrail],
        onInputBlocked,
        onOutputBlocked,
        throwOnBlocked: false,
      });

      expect(wrappedModel).toHaveProperty('doGenerate');
      expect(wrappedModel).toHaveProperty('doStream');
    });
  });

  describe('replaceOnBlocked configuration', () => {
    it('should replace blocked output when replaceOnBlocked is true (default)', async () => {
      const blockingGuardrail = defineOutputGuardrail({
        name: 'blocking-output',
        description: 'Test blocking guardrail',
        execute: async () => ({
          tripwireTriggered: true,
          message: 'Output blocked for test',
          info: {
            guardrailName: 'test-guardrail',
          },
        }),
      });

      const wrappedModel = wrapWithOutputGuardrails(
        mockModel,
        [blockingGuardrail],
        {
          throwOnBlocked: false,
          // replaceOnBlocked defaults to true
        },
      );

      const result = await wrappedModel.doGenerate({
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'test prompt' }] },
        ],
        temperature: 0.7,
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({
        type: 'text',
        text: '[Output blocked: Output blocked for test]',
      });
    });

    it('should not replace blocked output when replaceOnBlocked is false', async () => {
      const blockingGuardrail = defineOutputGuardrail({
        name: 'blocking-output',
        description: 'Test blocking guardrail',
        execute: async () => ({
          tripwireTriggered: true,
          message: 'Output blocked for test',
          info: {
            guardrailName: 'test-guardrail',
          },
        }),
      });

      const wrappedModel = wrapWithOutputGuardrails(
        mockModel,
        [blockingGuardrail],
        {
          throwOnBlocked: false,
          replaceOnBlocked: false,
        },
      );

      const result = await wrappedModel.doGenerate({
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'test prompt' }] },
        ],
        temperature: 0.7,
      });

      // Should return original content
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({
        type: 'text',
        text: 'Mock AI response',
      });
    });
  });
});

describe('Middleware Integration Tests', () => {
  let mockModel: LanguageModelV2;
  let mockParams: LanguageModelV2CallOptions;

  beforeEach(() => {
    mockModel = createMockModel();
    mockParams = {
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'Test prompt' }] },
      ],
    };
  });

  describe('createInputGuardrailsMiddleware', () => {
    it('should execute input guardrails before model call', async () => {
      const executeSpy = vi.fn().mockResolvedValue({
        tripwireTriggered: false,
        info: {
          guardrailName: 'test-guardrail',
        },
      });
      const inputGuardrail = defineInputGuardrail({
        name: 'test-input',
        description: 'Test input guardrail',
        execute: executeSpy,
      });

      const middleware = createInputGuardrailsMiddleware({
        inputGuardrails: [inputGuardrail],
      });

      const transformedParams = await middleware.transformParams!({
        type: 'generate',
        params: mockParams,
        model: mockModel,
      });

      // Guardrail execute now may receive an optional options argument (e.g., AbortSignal)
      expect(executeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.any(String),
        }),
        expect.anything(),
      );
      expect(transformedParams).toEqual(mockParams);
    });

    it('should block request when input guardrail is triggered', async () => {
      const inputGuardrail = defineInputGuardrail({
        name: 'blocking-input',
        description: 'Blocking input guardrail',
        execute: async () => ({
          tripwireTriggered: true,
          message: 'Input blocked',
          severity: 'high' as const,
          info: {
            guardrailName: 'test-guardrail',
          },
        }),
      });

      const middleware = createInputGuardrailsMiddleware({
        inputGuardrails: [inputGuardrail],
        throwOnBlocked: true,
      });

      await expect(
        middleware.transformParams!({
          type: 'generate',
          params: mockParams,
          model: mockModel,
        }),
      ).rejects.toThrow('Input blocked by guardrail');
    });

    it('should call onInputBlocked callback when guardrail is triggered', async () => {
      const onInputBlockedSpy = vi.fn();
      const inputGuardrail = defineInputGuardrail({
        name: 'callback-input',
        description: 'Callback input guardrail',
        execute: async () => ({
          tripwireTriggered: true,
          message: 'Input blocked for callback test',
          severity: 'medium' as const,
          info: {
            guardrailName: 'test-guardrail',
          },
        }),
      });

      const middleware = createInputGuardrailsMiddleware({
        inputGuardrails: [inputGuardrail],
        throwOnBlocked: false,
        onInputBlocked: onInputBlockedSpy,
      });

      const result = await middleware.transformParams!({
        type: 'generate',
        params: mockParams,
        model: mockModel,
      });

      expect(onInputBlockedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          allResults: expect.arrayContaining([
            expect.objectContaining({
              tripwireTriggered: true,
              message: 'Input blocked for callback test',
              severity: 'medium',
              info: expect.any(Object),
            }),
          ]),
          blockedResults: expect.arrayContaining([
            expect.objectContaining({
              tripwireTriggered: true,
              message: 'Input blocked for callback test',
              severity: 'medium',
              info: expect.any(Object),
            }),
          ]),
          guardrailsExecuted: 1,
          stats: expect.objectContaining({
            blocked: 1,
            passed: 0,
            failed: 0,
          }),
        }),
        expect.objectContaining({
          prompt: expect.any(String),
        }),
      );
      // When throwOnBlocked is false, the result includes blocked info but is not null
      expect(result).toHaveProperty('guardrailsBlocked');
    });

    it('should execute multiple input guardrails in sequence', async () => {
      const execute1Spy = vi.fn().mockResolvedValue({
        tripwireTriggered: false,
        info: {
          guardrailName: 'test-guardrail',
        },
      });
      const execute2Spy = vi.fn().mockResolvedValue({
        tripwireTriggered: false,
        info: {
          guardrailName: 'test-guardrail',
        },
      });

      const guardrail1 = defineInputGuardrail({
        name: 'first-input',
        description: 'First input guardrail',
        execute: execute1Spy,
      });

      const guardrail2 = defineInputGuardrail({
        name: 'second-input',
        description: 'Second input guardrail',
        execute: execute2Spy,
      });

      const middleware = createInputGuardrailsMiddleware({
        inputGuardrails: [guardrail1, guardrail2],
      });

      await middleware.transformParams!({
        type: 'generate',
        params: mockParams,
        model: mockModel,
      });

      expect(execute1Spy).toHaveBeenCalled();
      expect(execute2Spy).toHaveBeenCalled();
    });

    it('should handle guardrail execution errors gracefully', async () => {
      const inputGuardrail = defineInputGuardrail({
        name: 'error-input',
        description: 'Error input guardrail',
        execute: async () => {
          throw new Error('Guardrail execution failed');
        },
      });

      const middleware = createInputGuardrailsMiddleware({
        inputGuardrails: [inputGuardrail],
        throwOnBlocked: true,
        executionOptions: {
          continueOnFailure: false,
        },
      });

      await expect(
        middleware.transformParams!({
          type: 'generate',
          params: mockParams,
          model: mockModel,
        }),
      ).rejects.toThrow('Input blocked by guardrail');
    });
  });

  describe('createOutputGuardrailsMiddleware', () => {
    it('should create middleware with wrapGenerate function', () => {
      const outputGuardrail = defineOutputGuardrail({
        name: 'test-output',
        description: 'Test output guardrail',
        execute: async () => ({
          tripwireTriggered: false,
          info: {
            guardrailName: 'test-guardrail',
          },
        }),
      });

      const middleware = createOutputGuardrailsMiddleware({
        outputGuardrails: [outputGuardrail],
      });

      expect(middleware).toHaveProperty('wrapGenerate');
      expect(middleware).toHaveProperty('wrapStream');
      expect(typeof middleware.wrapGenerate).toBe('function');
      expect(typeof middleware.wrapStream).toBe('function');
    });
  });

  describe('Combined Middleware Pipeline', () => {
    it('should execute input guardrails successfully', async () => {
      const inputExecuteSpy = vi.fn().mockResolvedValue({
        tripwireTriggered: false,
        info: {
          guardrailName: 'test-guardrail',
        },
      });

      const inputGuardrail = defineInputGuardrail({
        name: 'pipeline-input',
        description: 'Pipeline input guardrail',
        execute: inputExecuteSpy,
      });

      const inputMiddleware = createInputGuardrailsMiddleware({
        inputGuardrails: [inputGuardrail],
      });

      // Simulate input processing
      const transformedParams = await inputMiddleware.transformParams!({
        type: 'generate',
        params: mockParams,
        model: mockModel,
      });

      expect(inputExecuteSpy).toHaveBeenCalled();
      expect(transformedParams).toEqual(mockParams);
    });

    it('should handle blocked input in pipeline', async () => {
      const inputGuardrail = defineInputGuardrail({
        name: 'blocking-pipeline-input',
        description: 'Blocking pipeline input guardrail',
        execute: async () => ({
          tripwireTriggered: true,
          message: 'Pipeline input blocked',
          severity: 'high' as const,
          info: {
            guardrailName: 'test-guardrail',
          },
        }),
      });

      const inputMiddleware = createInputGuardrailsMiddleware({
        inputGuardrails: [inputGuardrail],
        throwOnBlocked: false,
      });

      // Input should be blocked but return params with blocked flag
      const transformedParams = await inputMiddleware.transformParams!({
        type: 'generate',
        params: mockParams,
        model: mockModel,
      });

      // When throwOnBlocked is false, the params are returned but marked as blocked
      expect(transformedParams).toEqual(
        expect.objectContaining({
          ...mockParams,
          guardrailsBlocked: expect.any(Array),
        }),
      );
    });
  });

  describe('Error Propagation and Recovery', () => {
    it('should continue execution when continueOnFailure is true', async () => {
      const workingGuardrail = defineInputGuardrail({
        name: 'working-input',
        description: 'Working input guardrail',
        execute: async () => ({
          tripwireTriggered: false,
          info: {
            guardrailName: 'test-guardrail',
          },
        }),
      });

      const failingGuardrail = defineInputGuardrail({
        name: 'failing-input',
        description: 'Failing input guardrail',
        execute: async () => {
          throw new Error('Simulated failure');
        },
      });

      const middleware = createInputGuardrailsMiddleware({
        inputGuardrails: [workingGuardrail, failingGuardrail],
        throwOnBlocked: false,
        executionOptions: {
          continueOnFailure: true,
        },
      });

      // Should not throw and should return transformed params (but may have blocked results)
      const result = await middleware.transformParams!({
        type: 'generate',
        params: mockParams,
        model: mockModel,
      });

      expect(result).toEqual(expect.objectContaining(mockParams));
    });

    it('should stop execution when continueOnFailure is false', async () => {
      const workingGuardrail = defineInputGuardrail({
        name: 'working-input',
        description: 'Working input guardrail',
        execute: vi.fn().mockResolvedValue({ tripwireTriggered: false }),
      });

      const failingGuardrail = defineInputGuardrail({
        name: 'failing-input',
        description: 'Failing input guardrail',
        execute: async () => {
          throw new Error('Simulated failure');
        },
      });

      const neverCalledExecuteSpy = vi.fn().mockResolvedValue({
        tripwireTriggered: false,
        info: {
          guardrailName: 'test-guardrail',
        },
      });
      const neverCalledGuardrail = defineInputGuardrail({
        name: 'never-called-input',
        description: 'Never called input guardrail',
        execute: neverCalledExecuteSpy,
      });

      const middleware = createInputGuardrailsMiddleware({
        inputGuardrails: [
          workingGuardrail,
          failingGuardrail,
          neverCalledGuardrail,
        ],
        throwOnBlocked: true,
        executionOptions: {
          parallel: false,
          continueOnFailure: false,
        },
      });

      await expect(
        middleware.transformParams!({
          type: 'generate',
          params: mockParams,
          model: mockModel,
        }),
      ).rejects.toThrow('Input blocked by guardrail');

      // The third guardrail should never be called
      expect(neverCalledExecuteSpy).not.toHaveBeenCalled();
    });

    it('should handle timeout scenarios in guardrail execution', async () => {
      const slowGuardrail = defineInputGuardrail({
        name: 'slow-input',
        description: 'Slow input guardrail',
        execute: async () => {
          // Simulate a slow guardrail that takes longer than timeout
          await new Promise((resolve) => setTimeout(resolve, 200));
          return {
            tripwireTriggered: false,
            info: {
              guardrailName: 'test-guardrail',
            },
          };
        },
      });

      const middleware = createInputGuardrailsMiddleware({
        inputGuardrails: [slowGuardrail],
        throwOnBlocked: true,
        executionOptions: {
          timeout: 100, // 100ms timeout
          continueOnFailure: false,
        },
      });

      // Note: This test assumes the middleware implements timeout functionality
      // If not implemented, this test will need to be updated
      await expect(
        middleware.transformParams!({
          type: 'generate',
          params: mockParams,
          model: mockModel,
        }),
      ).rejects.toThrow();
    }, 1000);
  });

  describe('autoRetryOnBlocked integration', () => {
    it('should retry when output is blocked and succeed on second attempt', async () => {
      let callCount = 0;
      const mockModel = {
        ...createMockModel(),
        doGenerate: vi.fn().mockImplementation(async (options) => {
          callCount++;
          // First call returns short response, second call returns long response
          const text =
            callCount === 1
              ? 'Short'
              : 'This is a much longer response that meets the requirements and should not be blocked by the length guardrail';

          return {
            content: [{ type: 'text', text }],
            finishReason: 'stop',
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
            rawCall: { rawPrompt: options.prompt, rawSettings: {} },
            response: { headers: {} },
            warnings: [],
          };
        }),
      } as LanguageModelV2;

      // Guardrail that blocks short responses
      const lengthGuardrail = defineOutputGuardrail({
        name: 'min-length',
        description: 'Requires minimum length',
        execute: async ({ result }) => {
          // Handle both middleware format (content array) and direct text format
          const text =
            (result as any).text || (result as any).content?.[0]?.text || '';
          if (text.length < 50) {
            return {
              tripwireTriggered: true,
              message: `Response too short: ${text.length} characters`,
              severity: 'medium' as const,
              info: {
                guardrailName: 'test-guardrail',
              },
            };
          }
          return {
            tripwireTriggered: false,
            info: {
              guardrailName: 'test-guardrail',
            },
          };
        },
      });

      const middleware = createOutputGuardrailsMiddleware({
        outputGuardrails: [lengthGuardrail],
        replaceOnBlocked: false, // Don't replace on blocked so we can see the retry result
        retry: {
          maxRetries: 1,
          buildRetryParams: ({ originalParams }) => ({
            ...originalParams,
            prompt: [
              ...(Array.isArray(originalParams.prompt)
                ? originalParams.prompt
                : []),
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: ' Please provide a more detailed response.',
                  },
                ],
              },
            ],
          }),
        },
      });

      const mockParams = {
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'Test prompt' }] },
        ],
      } as LanguageModelV2CallOptions;

      const result = await middleware.wrapGenerate!({
        doGenerate: () => mockModel.doGenerate(mockParams),
        doStream: () => mockModel.doStream(mockParams),
        params: mockParams,
        model: mockModel,
      });

      expect(callCount).toBe(2);
      expect((result as any).content[0].text).toContain('much longer response');
    });

    it('should return blocked message when retries exhausted', async () => {
      let callCount = 0;
      const mockModel = {
        ...createMockModel(),
        doGenerate: vi.fn().mockImplementation(async () => {
          callCount++;
          // Always return short response to trigger blocking
          return {
            content: [{ type: 'text', text: 'Short' }],
            finishReason: 'stop',
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
            rawCall: { rawPrompt: 'test', rawSettings: {} },
            response: { headers: {} },
            warnings: [],
          };
        }),
      } as LanguageModelV2;

      const lengthGuardrail = defineOutputGuardrail({
        name: 'min-length',
        description: 'Requires minimum length',
        execute: async ({ result }) => {
          // Handle both middleware format (content array) and direct text format
          const text =
            (result as any).text || (result as any).content?.[0]?.text || '';
          if (text.length < 50) {
            return {
              tripwireTriggered: true,
              message: `Response too short: ${text.length} characters`,
              severity: 'medium' as const,
              info: {
                guardrailName: 'test-guardrail',
              },
            };
          }
          return {
            tripwireTriggered: false,
            info: {
              guardrailName: 'test-guardrail',
            },
          };
        },
      });

      const middleware = createOutputGuardrailsMiddleware({
        outputGuardrails: [lengthGuardrail],
        replaceOnBlocked: true,
        retry: {
          maxRetries: 2,
          buildRetryParams: ({ originalParams }) => ({
            ...originalParams,
            prompt: [
              ...(Array.isArray(originalParams.prompt)
                ? originalParams.prompt
                : []),
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: ' Please provide a more detailed response.',
                  },
                ],
              },
            ],
          }),
        },
      });

      const mockParams = {
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'Test prompt' }] },
        ],
      } as LanguageModelV2CallOptions;

      const result = await middleware.wrapGenerate!({
        doGenerate: () => mockModel.doGenerate(mockParams),
        doStream: () => mockModel.doStream(mockParams),
        params: mockParams,
        model: mockModel,
      });

      // Should try 3 times (original + 2 retries)
      expect(callCount).toBe(3);
      // Should return blocked message since replaceOnBlocked is true
      expect((result as any).content[0].text).toContain('[Output blocked:');
    });

    it('should respect onlyWhen predicate for retries', async () => {
      let callCount = 0;
      const mockModel = {
        ...createMockModel(),
        doGenerate: vi.fn().mockImplementation(async () => {
          callCount++;
          return {
            content: [{ type: 'text', text: 'Short' }],
            finishReason: 'stop',
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
            rawCall: { rawPrompt: 'test', rawSettings: {} },
            response: { headers: {} },
            warnings: [],
          };
        }),
      } as LanguageModelV2;

      const lengthGuardrail = defineOutputGuardrail({
        name: 'min-length',
        description: 'Requires minimum length',
        execute: async ({ result }) => {
          // Handle both middleware format (content array) and direct text format
          const text =
            (result as any).text || (result as any).content?.[0]?.text || '';
          if (text.length < 50) {
            return {
              tripwireTriggered: true,
              message: `Response too short: ${text.length} characters`,
              severity: 'critical' as const, // Critical severity
              info: {
                guardrailName: 'test-guardrail',
              },
            };
          }
          return {
            tripwireTriggered: false,
            info: {
              guardrailName: 'test-guardrail',
            },
          };
        },
      });

      const middleware = createOutputGuardrailsMiddleware({
        outputGuardrails: [lengthGuardrail],
        replaceOnBlocked: true,
        retry: {
          maxRetries: 2,
          onlyWhen: (summary) => {
            // Only retry for medium severity, not critical
            return summary.blockedResults.some((r) => r.severity === 'medium');
          },
          buildRetryParams: ({ originalParams }) => originalParams,
        },
      });

      const mockParams = {
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'Test prompt' }] },
        ],
      } as LanguageModelV2CallOptions;

      const result = await middleware.wrapGenerate!({
        doGenerate: () => mockModel.doGenerate(mockParams),
        doStream: () => mockModel.doStream(mockParams),
        params: mockParams,
        model: mockModel,
      });

      // Should only call once since onlyWhen predicate returns false for critical severity
      expect(callCount).toBe(1);
      expect((result as any).content[0].text).toContain('[Output blocked:');
    });

    it('should apply backoff delay between retry attempts', async () => {
      let callCount = 0;
      const mockModel = {
        ...createMockModel(),
        doGenerate: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            return {
              content: [{ type: 'text', text: 'Short' }],
              finishReason: 'stop',
              usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
              rawCall: { rawPrompt: 'test', rawSettings: {} },
              response: { headers: {} },
              warnings: [],
            };
          }
          return {
            content: [
              {
                type: 'text',
                text: 'This is a much longer response that should pass the length requirement',
              },
            ],
            finishReason: 'stop',
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
            rawCall: { rawPrompt: 'test', rawSettings: {} },
            response: { headers: {} },
            warnings: [],
          };
        }),
      } as LanguageModelV2;

      const lengthGuardrail = defineOutputGuardrail({
        name: 'min-length',
        description: 'Requires minimum length',
        execute: async ({ result }) => {
          // Handle both middleware format (content array) and direct text format
          const text =
            (result as any).text || (result as any).content?.[0]?.text || '';
          if (text.length < 50) {
            return {
              tripwireTriggered: true,
              message: `Response too short: ${text.length} characters`,
              severity: 'medium' as const,
              info: {
                guardrailName: 'test-guardrail',
              },
            };
          }
          return {
            tripwireTriggered: false,
            info: {
              guardrailName: 'test-guardrail',
            },
          };
        },
      });

      const middleware = createOutputGuardrailsMiddleware({
        outputGuardrails: [lengthGuardrail],
        replaceOnBlocked: false, // Don't replace on blocked so we can see the retry result
        retry: {
          maxRetries: 1,
          backoffMs: 100,
          buildRetryParams: ({ originalParams }) => originalParams,
        },
      });

      const mockParams = {
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'Test prompt' }] },
        ],
      } as LanguageModelV2CallOptions;

      const startTime = Date.now();
      await middleware.wrapGenerate!({
        doGenerate: () => mockModel.doGenerate(mockParams),
        doStream: () => mockModel.doStream(mockParams),
        params: mockParams,
        model: mockModel,
      });
      const endTime = Date.now();

      expect(callCount).toBe(2);
      // Should take at least 95ms due to backoff (allowing for timing variance)
      expect(endTime - startTime).toBeGreaterThanOrEqual(95);
    });
  });
});
