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
          textDelta: response,
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
      execute: async () => ({ tripwireTriggered: false }),
    });
    testOutputGuardrail = defineOutputGuardrail({
      name: 'test-output',
      description: 'Test output guardrail',
      execute: async () => ({ tripwireTriggered: false }),
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
      const executeSpy = vi
        .fn()
        .mockResolvedValue({ tripwireTriggered: false });
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

      expect(executeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.any(String),
        }),
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
        [
          expect.objectContaining({
            tripwireTriggered: true,
            message: 'Input blocked for callback test',
            severity: 'medium',
          }),
        ],
        expect.objectContaining({
          prompt: expect.any(String),
        }),
      );
      // When throwOnBlocked is false, the result includes blocked info but is not null
      expect(result).toHaveProperty('guardrailsBlocked');
    });

    it('should execute multiple input guardrails in sequence', async () => {
      const execute1Spy = vi
        .fn()
        .mockResolvedValue({ tripwireTriggered: false });
      const execute2Spy = vi
        .fn()
        .mockResolvedValue({ tripwireTriggered: false });

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
        execute: async () => ({ tripwireTriggered: false }),
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
      const inputExecuteSpy = vi
        .fn()
        .mockResolvedValue({ tripwireTriggered: false });

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
        execute: async () => ({ tripwireTriggered: false }),
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

      const neverCalledExecuteSpy = vi
        .fn()
        .mockResolvedValue({ tripwireTriggered: false });
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
          return { tripwireTriggered: false };
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
});
