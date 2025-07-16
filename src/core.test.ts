import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateTextWithGuardrails,
  generateObjectWithGuardrails,
  GuardrailError,
  createInputGuardrail,
  createOutputGuardrail,
} from './core';
import { extractContent } from './guardrails/output';
import { z } from 'zod';

// Mock AI SDK functions
vi.mock('ai', () => ({
  generateText: vi.fn(),
  generateObject: vi.fn(),
  streamText: vi.fn(),
  streamObject: vi.fn(),
  embed: vi.fn(),
}));

import { generateText, generateObject, type LanguageModel } from 'ai';

const mockGenerateText = vi.mocked(generateText);
const mockGenerateObject = vi.mocked(generateObject);

describe('Core Guardrails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateTextWithGuardrails', () => {
    it('works without guardrails', async () => {
      mockGenerateText.mockResolvedValue({
        text: 'Hello world',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      } as any);

      const result = await generateText({
        model: 'test-model' as any,
        prompt: 'Hello',
      });

      expect(mockGenerateText).toHaveBeenCalledWith({
        model: 'test-model',
        prompt: 'Hello',
      });
      expect(result.text).toBe('Hello world');
    });

    it('blocks input when guardrail triggers', async () => {
      const blockingGuardrail = createInputGuardrail(
        'test-block',
        'Test blocking guardrail',
        () => ({
          tripwireTriggered: true,
          message: 'Blocked!',
        }),
      );

      await expect(
        generateTextWithGuardrails(
          {
            model: 'test-model' as any,
            prompt: 'Hello',
          },
          {
            inputGuardrails: [blockingGuardrail],
            throwOnBlocked: true,
          },
        ),
      ).rejects.toThrow(GuardrailError);

      expect(mockGenerateText).not.toHaveBeenCalled();
    });

    it('blocks output when guardrail triggers', async () => {
      mockGenerateText.mockResolvedValue({
        text: 'Bad content',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      } as any);

      const blockingGuardrail = createOutputGuardrail('test-block', () => ({
        tripwireTriggered: true,
        message: 'Blocked output!',
      }));

      await expect(
        generateTextWithGuardrails(
          {
            model: 'test-model' as any,
            prompt: 'Hello',
          },
          {
            outputGuardrails: [blockingGuardrail],
            throwOnBlocked: true,
          },
        ),
      ).rejects.toThrow(GuardrailError);

      expect(mockGenerateText).toHaveBeenCalled();
    });

    it('handles multiple guardrails', async () => {
      const passingGuardrail = createInputGuardrail(
        'pass',
        'Passing guardrail',
        () => ({
          tripwireTriggered: false,
        }),
      );

      const blockingGuardrail = createInputGuardrail(
        'block',
        'Blocking guardrail',
        () => ({
          tripwireTriggered: true,
          message: 'Blocked by second guardrail',
        }),
      );

      await expect(
        generateTextWithGuardrails(
          {
            model: 'test-model' as any,
            prompt: 'Hello',
          },
          {
            inputGuardrails: [passingGuardrail, blockingGuardrail],
            throwOnBlocked: true,
          },
        ),
      ).rejects.toThrow('Blocked by second guardrail');
    });

    it('handles async guardrails', async () => {
      const asyncGuardrail = createInputGuardrail(
        'async-test',
        'Async test guardrail',
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { tripwireTriggered: true, message: 'Async blocked!' };
        },
      );

      await expect(
        generateTextWithGuardrails(
          {
            model: 'test-model' as unknown as LanguageModel,
            prompt: 'Hello',
          },
          {
            inputGuardrails: [asyncGuardrail],
            throwOnBlocked: true,
          },
        ),
      ).rejects.toThrow('Async blocked!');
    });
  });

  describe('generateObjectWithGuardrails', () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    it('works without guardrails', async () => {
      mockGenerateObject.mockResolvedValue({
        object: { name: 'John', age: 30 },
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      } as any);

      const result = await generateObject({
        model: 'test-model' as unknown as LanguageModel,
        prompt: 'Create a person',
        schema,
      });

      expect(mockGenerateObject).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'test-model',
          prompt: 'Create a person',
          schema,
        }),
      );
      expect(result.object).toEqual({ name: 'John', age: 30 });
    });

    it('blocks with output guardrails', async () => {
      mockGenerateObject.mockResolvedValue({
        object: { name: 'John', age: 30 },
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      } as any);

      const blockingGuardrail = createOutputGuardrail(
        'object-block',
        ({ result }) => {
          const { object } = extractContent(result);
          const person = object as { name: string; age: number };
          return {
            tripwireTriggered: person.age > 25,
            message: 'Age too high',
          };
        },
      );

      await expect(
        generateObjectWithGuardrails(
          {
            model: 'test-model' as unknown as LanguageModel,
            prompt: 'Create a person',
            schema,
          } as any,
          {
            outputGuardrails: [blockingGuardrail],
            throwOnBlocked: true,
          },
        ),
      ).rejects.toThrow('Age too high');
    });
  });

  describe('GuardrailError', () => {
    it('has correct properties', () => {
      const error = new GuardrailError(
        'test-guardrail',
        'Test message',
        'input',
      );

      expect(error.name).toBe('GuardrailError');
      expect(error.guardrailName).toBe('test-guardrail');
      expect(error.reason).toBe('Test message');
      expect(error.type).toBe('input');
      expect(error.message).toBe(
        "input guardrail 'test-guardrail' blocked: Test message",
      );
    });
  });

  describe('createInputGuardrail', () => {
    it('creates input guardrail with correct structure', () => {
      const guardrail = createInputGuardrail('test', 'Test guardrail', () => ({
        tripwireTriggered: false,
      }));

      expect(guardrail.name).toBe('test');
      expect(typeof guardrail.execute).toBe('function');
    });
  });

  describe('createOutputGuardrail', () => {
    it('creates output guardrail with correct structure', () => {
      const guardrail = createOutputGuardrail('test', () => ({
        tripwireTriggered: false,
      }));

      expect(guardrail.name).toBe('test');
      expect(typeof guardrail.execute).toBe('function');
    });
  });
});
