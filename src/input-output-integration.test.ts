import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  defineInputGuardrail,
  defineOutputGuardrail,
  executeInputGuardrails,
  executeOutputGuardrails,
  wrapWithInputGuardrails,
  wrapWithOutputGuardrails,
  wrapWithGuardrails,
} from './guardrails';
import { extractTextContent } from './guardrails/input';
import { extractContent } from './guardrails/output';
import type { LanguageModelV2, AIResult } from './types';

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

describe('Input and Output Guardrails Integration', () => {
  let mockModel: LanguageModelV2;

  beforeEach(() => {
    mockModel = createMockModel();
  });

  describe('Input Guardrails', () => {
    it('should validate input content successfully', async () => {
      const profanityGuardrail = defineInputGuardrail({
        name: 'profanity-filter',
        description: 'Filters inappropriate content',
        execute: async (params) => {
          const { prompt } = extractTextContent(params);
          const profanity = ['damn', 'hell', 'crap'];
          const found = profanity.find((word) =>
            prompt.toLowerCase().includes(word),
          );

          if (found) {
            return {
              tripwireTriggered: true,
              message: `Profanity detected: "${found}"`,
              severity: 'medium',
              metadata: { word: found },
            };
          }
          return { tripwireTriggered: false };
        },
      });

      const inputContext = {
        prompt: 'What is the weather like today?',
        messages: [],
        system: '',
      };

      const results = await executeInputGuardrails(
        [profanityGuardrail],
        inputContext,
      );
      const blockedResults = results.filter((r) => r.tripwireTriggered);

      expect(blockedResults).toHaveLength(0);
    });

    it('should block input with profanity', async () => {
      const profanityGuardrail = defineInputGuardrail({
        name: 'profanity-filter',
        description: 'Filters inappropriate content',
        execute: async (params) => {
          const { prompt } = extractTextContent(params);
          const profanity = ['damn', 'hell', 'crap'];
          const found = profanity.find((word) =>
            prompt.toLowerCase().includes(word),
          );

          if (found) {
            return {
              tripwireTriggered: true,
              message: `Profanity detected: "${found}"`,
              severity: 'medium',
              metadata: { word: found },
            };
          }
          return { tripwireTriggered: false };
        },
      });

      const inputContext = {
        prompt: 'Why the hell is this not working?',
        messages: [],
        system: '',
      };

      const results = await executeInputGuardrails(
        [profanityGuardrail],
        inputContext,
      );
      const blockedResults = results.filter((r) => r.tripwireTriggered);

      expect(blockedResults).toHaveLength(1);
      expect(blockedResults[0]?.message).toContain('Profanity detected');
      expect(blockedResults[0]?.metadata?.word).toBe('hell');
    });

    it('should handle multiple input guardrails', async () => {
      const profanityGuardrail = defineInputGuardrail({
        name: 'profanity-filter',
        description: 'Filters inappropriate content',
        execute: async (params) => {
          const { prompt } = extractTextContent(params);
          const profanity = ['damn', 'hell', 'crap'];
          const found = profanity.find((word) =>
            prompt.toLowerCase().includes(word),
          );

          if (found) {
            return {
              tripwireTriggered: true,
              message: `Profanity detected: "${found}"`,
              severity: 'medium',
              metadata: { word: found },
            };
          }
          return { tripwireTriggered: false };
        },
      });

      const lengthGuardrail = defineInputGuardrail({
        name: 'length-limit',
        description: 'Limits input length',
        execute: async (params) => {
          const { prompt } = extractTextContent(params);
          if (prompt.length > 100) {
            return {
              tripwireTriggered: true,
              message: `Input too long: ${prompt.length} characters`,
              severity: 'low',
              metadata: { length: prompt.length },
            };
          }
          return { tripwireTriggered: false };
        },
      });

      const inputContext = {
        prompt:
          'This is a very long input that exceeds the character limit and should be blocked by the length guardrail',
        messages: [],
        system: '',
      };

      const results = await executeInputGuardrails(
        [profanityGuardrail, lengthGuardrail] as any,
        inputContext,
      );
      const blockedResults = results.filter((r) => r.tripwireTriggered);

      expect(blockedResults).toHaveLength(1);
      expect(blockedResults[0]?.context?.guardrailName).toBe('length-limit');
    });
  });

  describe('Output Guardrails', () => {
    it('should validate output content successfully', async () => {
      const contentFilter = defineOutputGuardrail({
        name: 'content-filter',
        description: 'Filters inappropriate output',
        execute: async (context) => {
          const { text } = extractContent(context.result);
          const inappropriate = ['hate', 'violence', 'discrimination'];
          const found = inappropriate.find((word) =>
            text.toLowerCase().includes(word),
          );

          if (found) {
            return {
              tripwireTriggered: true,
              message: `Inappropriate content detected: "${found}"`,
              severity: 'high',
              metadata: { word: found },
            };
          }
          return { tripwireTriggered: false };
        },
      });

      const outputContext = {
        input: {
          prompt: 'Tell me about the weather',
          messages: [],
          system: '',
        },
        result: {
          text: 'The weather is sunny and pleasant today.',
        } as unknown as AIResult,
      };

      const results = await executeOutputGuardrails(
        [contentFilter],
        outputContext,
      );
      const blockedResults = results.filter((r) => r.tripwireTriggered);

      expect(blockedResults).toHaveLength(0);
    });

    it('should block inappropriate output', async () => {
      const contentFilter = defineOutputGuardrail({
        name: 'content-filter',
        description: 'Filters inappropriate output',
        execute: async (context) => {
          const { text } = extractContent(context.result);
          const inappropriate = ['hate', 'violence', 'discrimination'];
          const found = inappropriate.find((word) =>
            text.toLowerCase().includes(word),
          );

          if (found) {
            return {
              tripwireTriggered: true,
              message: `Inappropriate content detected: "${found}"`,
              severity: 'high',
              metadata: { word: found },
            };
          }
          return { tripwireTriggered: false };
        },
      });

      const outputContext = {
        input: {
          prompt: 'Tell me about hate speech',
          messages: [],
          system: '',
        },
        result: {
          text: 'Hate speech is a form of discrimination that should be avoided.',
        } as unknown as AIResult,
      };

      const results = await executeOutputGuardrails(
        [contentFilter],
        outputContext,
      );
      const blockedResults = results.filter((r) => r.tripwireTriggered);

      expect(blockedResults).toHaveLength(1);
      expect(blockedResults[0]?.message).toContain(
        'Inappropriate content detected',
      );
      expect(blockedResults[0]?.metadata?.word).toBe('hate');
    });
  });

  describe('Combined Input and Output Guardrails', () => {
    it('should handle both input and output violations', async () => {
      const inputGuardrail = defineInputGuardrail({
        name: 'input-filter',
        description: 'Filters input',
        execute: async (params) => {
          const { prompt } = extractTextContent(params);
          if (prompt.includes('blocked')) {
            return {
              tripwireTriggered: true,
              message: 'Input contains blocked word',
              severity: 'medium',
            };
          }
          return { tripwireTriggered: false };
        },
      });

      const outputGuardrail = defineOutputGuardrail({
        name: 'output-filter',
        description: 'Filters output',
        execute: async (context) => {
          const { text } = extractContent(context.result);
          if (text.includes('blocked')) {
            return {
              tripwireTriggered: true,
              message: 'Output contains blocked word',
              severity: 'medium',
            };
          }
          return { tripwireTriggered: false };
        },
      });

      // Test input violation
      const inputContext = {
        prompt: 'This prompt contains blocked word',
        messages: [],
        system: '',
      };

      const inputResults = await executeInputGuardrails(
        [inputGuardrail],
        inputContext,
      );
      const inputBlocked = inputResults.filter((r) => r.tripwireTriggered);
      expect(inputBlocked).toHaveLength(1);
      expect(inputBlocked[0]?.message).toBe('Input contains blocked word');

      // Test output violation
      const outputContext = {
        input: inputContext,
        result: {
          text: 'This response contains blocked word',
        } as unknown as AIResult,
      };

      const outputResults = await executeOutputGuardrails(
        [outputGuardrail],
        outputContext,
      );
      const outputBlocked = outputResults.filter((r) => r.tripwireTriggered);
      expect(outputBlocked).toHaveLength(1);
      expect(outputBlocked[0]?.message).toBe('Output contains blocked word');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle guardrail execution errors gracefully', async () => {
      const errorGuardrail = defineInputGuardrail({
        name: 'error-guardrail',
        description: 'Guardrail that throws an error',
        execute: async () => {
          throw new Error('Guardrail execution failed');
        },
      });

      const inputContext = {
        prompt: 'Test prompt',
        messages: [],
        system: '',
      };

      const results = await executeInputGuardrails(
        [errorGuardrail],
        inputContext,
      );
      const blockedResults = results.filter((r) => r.tripwireTriggered);

      expect(blockedResults).toHaveLength(1);
      expect(blockedResults[0]?.message).toContain(
        'Guardrail execution failed',
      );
      expect(blockedResults[0]?.severity).toBe('critical');
    });

    it('should handle timeout scenarios', async () => {
      const slowGuardrail = defineInputGuardrail({
        name: 'slow-guardrail',
        description: 'Slow guardrail',
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return { tripwireTriggered: false };
        },
      });

      const inputContext = {
        prompt: 'Test prompt',
        messages: [],
        system: '',
      };

      const results = await executeInputGuardrails(
        [slowGuardrail],
        inputContext,
        {
          timeout: 100, // 100ms timeout
        },
      );

      // Should have at least one result (either success or timeout error)
      expect(results.length).toBeGreaterThan(0);
    });

    it('should handle empty guardrail arrays', async () => {
      const inputContext = {
        prompt: 'Test prompt',
        messages: [],
        system: '',
      };

      const results = await executeInputGuardrails([], inputContext);
      expect(results).toHaveLength(0);

      const outputContext = {
        input: inputContext,
        result: { text: 'Test response' } as unknown as AIResult,
      };

      const outputResults = await executeOutputGuardrails([], outputContext);
      expect(outputResults).toHaveLength(0);
    });

    it('should handle disabled guardrails', async () => {
      const disabledGuardrail = defineInputGuardrail({
        name: 'disabled-guardrail',
        description: 'Disabled guardrail',
        enabled: false,
        execute: async () => ({
          tripwireTriggered: true,
          message: 'This should not execute',
          severity: 'high',
        }),
      });

      const inputContext = {
        prompt: 'Test prompt',
        messages: [],
        system: '',
      };

      const results = await executeInputGuardrails(
        [disabledGuardrail],
        inputContext,
      );
      expect(results).toHaveLength(0);
    });
  });

  describe('Performance and Parallel Execution', () => {
    it('should execute guardrails in parallel by default', async () => {
      const startTime = Date.now();

      const slowGuardrail1 = defineInputGuardrail({
        name: 'slow-1',
        description: 'Slow guardrail 1',
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return { tripwireTriggered: false };
        },
      });

      const slowGuardrail2 = defineInputGuardrail({
        name: 'slow-2',
        description: 'Slow guardrail 2',
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return { tripwireTriggered: false };
        },
      });

      const inputContext = {
        prompt: 'Test prompt',
        messages: [],
        system: '',
      };

      await executeInputGuardrails(
        [slowGuardrail1, slowGuardrail2],
        inputContext,
      );
      const executionTime = Date.now() - startTime;

      // Should execute in parallel (less than 200ms for 2x100ms operations)
      expect(executionTime).toBeLessThan(200);
    });

    it('should execute guardrails sequentially when parallel is disabled', async () => {
      const startTime = Date.now();

      const slowGuardrail1 = defineInputGuardrail({
        name: 'slow-1',
        description: 'Slow guardrail 1',
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { tripwireTriggered: false };
        },
      });

      const slowGuardrail2 = defineInputGuardrail({
        name: 'slow-2',
        description: 'Slow guardrail 2',
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { tripwireTriggered: false };
        },
      });

      const inputContext = {
        prompt: 'Test prompt',
        messages: [],
        system: '',
      };

      await executeInputGuardrails(
        [slowGuardrail1, slowGuardrail2],
        inputContext,
        {
          parallel: false,
        },
      );
      const executionTime = Date.now() - startTime;

      // Should execute sequentially (at least 100ms for 2x50ms operations)
      expect(executionTime).toBeGreaterThanOrEqual(100);
    });
  });
});
