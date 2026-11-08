import { describe, it, expect } from 'vitest';
import type { LanguageModelV4, LanguageModelV4CallOptions } from '../types';
import { guardrailMiddleware } from './middleware';
import { tokenUsageLimit } from './output';

const createV3Usage = (inputTotal: number, outputTotal: number) => ({
  inputTokens: {
    total: inputTotal,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: outputTotal,
    text: undefined,
    reasoning: undefined,
  },
});

const createMockModel = (response = 'Mock AI response'): LanguageModelV4 => ({
  specificationVersion: 'v4',
  provider: 'test',
  modelId: 'test-model',
  supportedUrls: {},
  async doGenerate(options: LanguageModelV4CallOptions) {
    return {
      content: [{ type: 'text', text: response }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: createV3Usage(10, 10),
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
  async doStream(options: LanguageModelV4CallOptions) {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: 'text-delta' as const,
          id: '1',
          delta: response,
        });
        controller.enqueue({
          type: 'finish' as const,
          finishReason: { unified: 'stop', raw: undefined },
          usage: createV3Usage(10, 10),
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

describe('guardrailMiddleware', () => {
  it('should pass usage data to output guardrails', async () => {
    const mockModel = createMockModel();

    const middleware = guardrailMiddleware({
      outputGuardrails: [tokenUsageLimit(5)],
      throwOnBlocked: false,
      replaceOnBlocked: true,
    });

    const params: LanguageModelV4CallOptions = {
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'Test prompt' }] },
      ],
    };

    const result = await middleware.wrapGenerate!({
      doGenerate: () => mockModel.doGenerate(params),
      doStream: () => mockModel.doStream(params),
      params,
      model: mockModel,
    });

    expect(result.content[0]).toEqual({
      type: 'text',
      text: '[Output blocked: Token usage 20 exceeds limit of 5]',
    });
  });

  it('should replace text when output is blocked', async () => {
    const mockModel: LanguageModelV4 = {
      ...createMockModel(),
      async doGenerate(options: LanguageModelV4CallOptions) {
        return {
          content: [{ type: 'text', text: 'Original content' }],
          text: 'Original content',
          finishReason: { unified: 'stop', raw: undefined },
          usage: createV3Usage(10, 10),
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
    };

    const middleware = guardrailMiddleware({
      outputGuardrails: [tokenUsageLimit(5)],
      throwOnBlocked: false,
      replaceOnBlocked: true,
    });

    const params: LanguageModelV4CallOptions = {
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'Test prompt' }] },
      ],
    };

    const result = await middleware.wrapGenerate!({
      doGenerate: () => mockModel.doGenerate(params),
      doStream: () => mockModel.doStream(params),
      params,
      model: mockModel,
    });

    expect(result).toHaveProperty(
      'text',
      '[Output blocked: Token usage 20 exceeds limit of 5]',
    );
  });

  it('should include text when input is blocked', async () => {
    const mockModel = createMockModel();

    const middleware = guardrailMiddleware({
      inputGuardrails: [
        {
          name: 'blocking-input',
          execute: async () => ({
            tripwireTriggered: true,
            message: 'Input blocked',
            severity: 'high' as const,
            info: {
              guardrailName: 'blocking-input',
            },
          }),
        },
      ],
      throwOnBlocked: false,
    });

    const params: LanguageModelV4CallOptions = {
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'Test prompt' }] },
      ],
    };

    const transformedParams = await middleware.transformParams!({
      type: 'generate',
      params,
      model: mockModel,
    });

    const result = await middleware.wrapGenerate!({
      doGenerate: () => mockModel.doGenerate(params),
      doStream: () => mockModel.doStream(params),
      params: transformedParams,
      model: mockModel,
    });

    expect(result).toMatchObject({
      text: expect.stringContaining('[Input blocked by guardrails]'),
    });
  });
});
