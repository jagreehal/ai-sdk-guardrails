import { describe, it, expect, vi } from 'vitest';
import { retry, retryHelpers } from './core';

describe('retry', () => {
  it('should return result immediately if validation passes', async () => {
    const mockGenerate = vi.fn().mockResolvedValue({ text: 'Valid response' });
    const mockValidate = vi.fn().mockResolvedValue({ blocked: false });

    const result = await retry({
      generate: mockGenerate,
      params: { prompt: 'test' },
      validate: mockValidate,
      buildRetryParams: () => ({ prompt: 'retry test' }),
      maxRetries: 1,
    });

    expect(result).toEqual({ text: 'Valid response' });
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockValidate).toHaveBeenCalledTimes(1);
    expect(mockValidate).toHaveBeenCalledWith({ text: 'Valid response' });
  });

  it('should retry when validation initially blocks', async () => {
    const mockGenerate = vi
      .fn()
      .mockResolvedValueOnce({ text: 'Bad response' })
      .mockResolvedValueOnce({ text: 'Good response' });

    const mockValidate = vi
      .fn()
      .mockResolvedValueOnce({ blocked: true, message: 'Too short' })
      .mockResolvedValueOnce({ blocked: false });

    const mockBuildRetryParams = vi.fn().mockReturnValue({
      prompt: 'retry test with more details',
    });

    const result = await retry({
      generate: mockGenerate,
      params: { prompt: 'test' },
      validate: mockValidate,
      buildRetryParams: mockBuildRetryParams,
      maxRetries: 1,
    });

    expect(result).toEqual({ text: 'Good response' });
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(mockGenerate).toHaveBeenNthCalledWith(1, { prompt: 'test' });
    expect(mockGenerate).toHaveBeenNthCalledWith(2, {
      prompt: 'retry test with more details',
    });
    expect(mockValidate).toHaveBeenCalledTimes(2);
    expect(mockBuildRetryParams).toHaveBeenCalledWith({
      summary: {
        blockedResults: [{ message: 'Too short', metadata: undefined }],
      },
      originalParams: { prompt: 'test' },
      lastParams: { prompt: 'test' },
      lastResult: { text: 'Bad response' },
    });
  });

  it('should return last result when max retries exhausted', async () => {
    const mockGenerate = vi
      .fn()
      .mockResolvedValueOnce({ text: 'Bad response 1' })
      .mockResolvedValueOnce({ text: 'Bad response 2' })
      .mockResolvedValueOnce({ text: 'Bad response 3' });

    const mockValidate = vi
      .fn()
      .mockResolvedValue({ blocked: true, message: 'Always blocked' });
    const mockBuildRetryParams = vi
      .fn()
      .mockReturnValueOnce({ prompt: 'retry 1' })
      .mockReturnValueOnce({ prompt: 'retry 2' });

    const result = await retry({
      generate: mockGenerate,
      params: { prompt: 'test' },
      validate: mockValidate,
      buildRetryParams: mockBuildRetryParams,
      maxRetries: 2,
    });

    expect(result).toEqual({ text: 'Bad response 3' });
    expect(mockGenerate).toHaveBeenCalledTimes(3);
    expect(mockValidate).toHaveBeenCalledTimes(3);
  });

  it('should support sync validate function', async () => {
    const mockGenerate = vi.fn().mockResolvedValue({ text: 'Valid response' });
    const mockValidate = vi.fn().mockReturnValue({ blocked: false });

    const result = await retry({
      generate: mockGenerate,
      params: { prompt: 'test' },
      validate: mockValidate,
      buildRetryParams: () => ({ prompt: 'retry' }),
      maxRetries: 1,
    });

    expect(result).toEqual({ text: 'Valid response' });
    expect(mockValidate).toHaveBeenCalledWith({ text: 'Valid response' });
  });

  it('should apply backoff delay between retries', async () => {
    const mockGenerate = vi
      .fn()
      .mockResolvedValueOnce({ text: 'Bad response' })
      .mockResolvedValueOnce({ text: 'Good response' });

    const mockValidate = vi
      .fn()
      .mockResolvedValueOnce({ blocked: true, message: 'Blocked' })
      .mockResolvedValueOnce({ blocked: false });

    const startTime = Date.now();
    await retry({
      generate: mockGenerate,
      params: { prompt: 'test' },
      validate: mockValidate,
      buildRetryParams: () => ({ prompt: 'retry' }),
      maxRetries: 1,
      backoffMs: 100,
    });
    const endTime = Date.now();

    // Should take at least 95ms due to backoff (allowing for timing variance)
    expect(endTime - startTime).toBeGreaterThanOrEqual(95);
  });

  it('should apply function-based backoff delay', async () => {
    const mockGenerate = vi
      .fn()
      .mockResolvedValueOnce({ text: 'Bad response' })
      .mockResolvedValueOnce({ text: 'Good response' });

    const mockValidate = vi
      .fn()
      .mockResolvedValueOnce({ blocked: true, message: 'Blocked' })
      .mockResolvedValueOnce({ blocked: false });

    const mockBackoffFn = vi.fn().mockReturnValue(150);

    const startTime = Date.now();
    await retry({
      generate: mockGenerate,
      params: { prompt: 'test' },
      validate: mockValidate,
      buildRetryParams: () => ({ prompt: 'retry' }),
      maxRetries: 1,
      backoffMs: mockBackoffFn,
    });
    const endTime = Date.now();

    expect(mockBackoffFn).toHaveBeenCalledWith(1);
    expect(endTime - startTime).toBeGreaterThanOrEqual(145);
  });

  it('should default to 1 maxRetries when not specified', async () => {
    const mockGenerate = vi
      .fn()
      .mockResolvedValueOnce({ text: 'Bad response' })
      .mockResolvedValueOnce({ text: 'Good response' });

    const mockValidate = vi
      .fn()
      .mockResolvedValueOnce({ blocked: true, message: 'Blocked' })
      .mockResolvedValueOnce({ blocked: false });

    const result = await retry({
      generate: mockGenerate,
      params: { prompt: 'test' },
      validate: mockValidate,
      buildRetryParams: () => ({ prompt: 'retry' }),
      // maxRetries not specified - should default to 1
    });

    expect(result).toEqual({ text: 'Good response' });
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it('should handle validate function with metadata', async () => {
    const mockGenerate = vi.fn().mockResolvedValue({ text: 'Valid response' });
    const mockValidate = vi.fn().mockResolvedValue({
      blocked: false,
      message: 'All good',
      metadata: { confidence: 0.95 },
    });

    await retry({
      generate: mockGenerate,
      params: { prompt: 'test' },
      validate: mockValidate,
      buildRetryParams: () => ({ prompt: 'retry' }),
      maxRetries: 1,
    });

    expect(mockValidate).toHaveBeenCalledWith({ text: 'Valid response' });
  });

  // Enhanced features tests
  describe('enhanced features', () => {
    it('should support cancellation with AbortSignal', async () => {
      const controller = new AbortController();
      const mockGenerate = vi
        .fn()
        .mockImplementation(async (_params, signal?: AbortSignal) => {
          // Simulate async work that checks for cancellation
          for (let i = 0; i < 10; i++) {
            signal?.throwIfAborted();
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          return { text: 'Response' };
        });

      // Abort after 25ms
      setTimeout(() => controller.abort(), 25);

      await expect(
        retry({
          generate: mockGenerate,
          params: { prompt: 'test' },
          validate: () => ({ blocked: false }),
          buildRetryParams: () => ({ prompt: 'retry' }),
          signal: controller.signal,
        }),
      ).rejects.toThrow();
    });

    it('should call onAttempt callback for each attempt', async () => {
      const mockGenerate = vi
        .fn()
        .mockResolvedValueOnce({ text: 'Bad response' })
        .mockResolvedValueOnce({ text: 'Good response' });

      const mockValidate = vi
        .fn()
        .mockResolvedValueOnce({ blocked: true, message: 'Too short' })
        .mockResolvedValueOnce({ blocked: false });

      const mockOnAttempt = vi.fn();

      await retry({
        generate: mockGenerate,
        params: { prompt: 'test' },
        validate: mockValidate,
        buildRetryParams: () => ({ prompt: 'retry test' }),
        maxRetries: 1,
        onAttempt: mockOnAttempt,
      });

      expect(mockOnAttempt).toHaveBeenCalledTimes(2);
      expect(mockOnAttempt).toHaveBeenNthCalledWith(1, {
        attempt: 0,
        totalAttempts: 2,
        isRetry: false,
      });
      expect(mockOnAttempt).toHaveBeenNthCalledWith(2, {
        attempt: 1,
        totalAttempts: 2,
        lastResult: { text: 'Bad response' },
        waitMs: 0,
        isRetry: true,
      });
    });

    it('should retry on generation errors when retryOnError returns true', async () => {
      const mockError = new Error('Network error');
      const mockGenerate = vi
        .fn()
        .mockRejectedValueOnce(mockError)
        .mockResolvedValueOnce({ text: 'Good response' });

      const mockValidate = vi.fn().mockReturnValue({ blocked: false });
      const mockRetryOnError = vi.fn().mockReturnValue(true);
      const mockOnError = vi.fn();

      const result = await retry({
        generate: mockGenerate,
        params: { prompt: 'test' },
        validate: mockValidate,
        buildRetryParams: () => ({ prompt: 'retry' }),
        maxRetries: 1,
        retryOnError: mockRetryOnError,
        onError: mockOnError,
      });

      expect(result).toEqual({ text: 'Good response' });
      expect(mockRetryOnError).toHaveBeenCalledWith(mockError, 0);
      expect(mockOnError).toHaveBeenCalledWith(mockError, 0);
      expect(mockGenerate).toHaveBeenCalledTimes(2);
    });

    it('should throw immediately when retryOnError returns false', async () => {
      const mockError = new Error('Network error');
      const mockGenerate = vi.fn().mockRejectedValue(mockError);
      const mockRetryOnError = vi.fn().mockReturnValue(false);

      await expect(
        retry({
          generate: mockGenerate,
          params: { prompt: 'test' },
          validate: () => ({ blocked: false }),
          buildRetryParams: () => ({ prompt: 'retry' }),
          maxRetries: 1,
          retryOnError: mockRetryOnError,
        }),
      ).rejects.toThrow('Network error');

      expect(mockGenerate).toHaveBeenCalledTimes(1);
    });

    it('should throw on exhaustion when onExhausted is "throw"', async () => {
      const mockGenerate = vi.fn().mockResolvedValue({ text: 'Short' });
      const mockValidate = vi.fn().mockReturnValue({
        blocked: true,
        message: 'Too short',
      });

      await expect(
        retry({
          generate: mockGenerate,
          params: { prompt: 'test' },
          validate: mockValidate,
          buildRetryParams: () => ({ prompt: 'retry' }),
          maxRetries: 1,
          onExhausted: 'throw',
        }),
      ).rejects.toThrow('Retry exhausted after 1 attempts: Too short');
    });

    it('should include enhanced summary fields when using new features', async () => {
      const mockGenerate = vi
        .fn()
        .mockResolvedValueOnce({ text: 'Bad response' })
        .mockResolvedValueOnce({ text: 'Good response' });

      const mockValidate = vi
        .fn()
        .mockResolvedValueOnce({ blocked: true, message: 'Too short' })
        .mockResolvedValueOnce({ blocked: false });

      const mockBuildRetryParams = vi.fn().mockReturnValue({ prompt: 'retry' });

      await retry({
        generate: mockGenerate,
        params: { prompt: 'test' },
        validate: mockValidate,
        buildRetryParams: mockBuildRetryParams,
        maxRetries: 1,
        onAttempt: () => {}, // This triggers enhanced mode
      });

      expect(mockBuildRetryParams).toHaveBeenCalledWith({
        summary: {
          blockedResults: [{ message: 'Too short', metadata: undefined }],
          totalAttempts: 2,
          attempts: [
            {
              attempt: 0,
              result: { text: 'Bad response' },
              blocked: true,
            },
          ],
        },
        originalParams: { prompt: 'test' },
        lastParams: { prompt: 'test' },
        lastResult: { text: 'Bad response' },
      });
    });
  });
});

describe('retryHelpers', () => {
  describe('increaseTokens', () => {
    it('should increase maxOutputTokens by specified amount', () => {
      const helper = retryHelpers.increaseTokens(300);
      const result = helper({
        lastParams: {
          maxOutputTokens: 500,
        } as { maxOutputTokens?: number },
        summary: { blockedResults: [] },
        originalParams: {},
        lastResult: {},
      });

      expect(result.maxOutputTokens).toBe(800); // 500 + 300
    });

    it('should use default minimum when no maxOutputTokens', () => {
      const helper = retryHelpers.increaseTokens(200);
      const result = helper({
        lastParams: {} as { maxOutputTokens?: number },
        summary: { blockedResults: [] },
        originalParams: {},
        lastResult: {},
      });

      expect(result.maxOutputTokens).toBe(600); // 400 + 200
    });

    it('should use default increase when not specified', () => {
      const helper = retryHelpers.increaseTokens();
      const result = helper({
        lastParams: {
          maxOutputTokens: 400,
        } as { maxOutputTokens?: number },
        summary: { blockedResults: [] },
        originalParams: {},
        lastResult: {},
      });

      expect(result.maxOutputTokens).toBe(600); // 400 + 200 (default)
    });
  });

  describe('addEncouragingPrompt', () => {
    it('should add encouraging message to array prompt', () => {
      const helper = retryHelpers.addEncouragingPrompt(
        'Be more detailed please.',
      );
      const result = helper({
        lastParams: {
          prompt: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'Original question' }],
            },
          ],
        },
        summary: {
          blockedResults: [{ message: 'Response too short' }],
        },
        originalParams: {},
        lastResult: {},
      });

      const prompt1 = result.prompt as Array<{
        role: string;
        content: Array<{ type: string; text: string }>;
      }>;
      expect(prompt1).toHaveLength(2);
      expect(prompt1[1]).toEqual({
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Note: Response too short. Be more detailed please.',
          },
        ],
      });
    });

    it('should convert string prompt to array and add encouragement', () => {
      const helper = retryHelpers.addEncouragingPrompt();
      const result = helper({
        lastParams: {
          prompt: 'What is AI?' as unknown as Array<{
            role: string;
            content: Array<{ type: string; text: string }>;
          }>,
        },
        summary: { blockedResults: [{ message: 'Too brief' }] },
        originalParams: {},
        lastResult: {},
      });

      const prompt2 = result.prompt as Array<{
        role: string;
        content: Array<{ type: string; text: string }>;
      }>;
      expect(Array.isArray(prompt2)).toBe(true);
      expect(prompt2).toHaveLength(2);
      expect(prompt2[0]).toEqual({
        role: 'user',
        content: [{ type: 'text', text: 'What is AI?' }],
      });
      const content1 = (prompt2?.[1]?.content ?? []) as Array<{
        type: string;
        text: string;
      }>;
      expect(content1[0]?.text ?? '').toContain('Too brief');
    });

    it('should use default encouragement when not specified', () => {
      const helper = retryHelpers.addEncouragingPrompt();
      const result = helper({
        lastParams: {
          prompt: 'test' as unknown as Array<{
            role: string;
            content: Array<{ type: string; text: string }>;
          }>,
        },
        summary: { blockedResults: [] },
        originalParams: {},
        lastResult: {},
      });
      const prompt3 = result.prompt as Array<{
        role: string;
        content: Array<{ type: string; text: string }>;
      }>;
      const content2 = (prompt3?.[1]?.content ?? []) as Array<{
        type: string;
        text: string;
      }>;
      expect(content2[0]?.text ?? '').toContain(
        'more detailed and comprehensive',
      );
    });
  });

  describe('noChange', () => {
    it('should return lastParams unchanged', () => {
      const helper = retryHelpers.noChange();
      const lastParams = {
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
        maxOutputTokens: 500,
      };
      const result = helper({
        lastParams,
        summary: { blockedResults: [] },
        originalParams: {},
        lastResult: {},
      });

      expect(result).toBe(lastParams);
    });
  });
});
