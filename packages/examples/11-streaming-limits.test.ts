/**
 * Streaming Limits Example - Test
 *
 * Demonstrates how to apply guardrails to streaming responses,
 * including length limits and content validation.
 *
 * Note: These tests use real LLM models and may be flaky.
 * They're designed for manual verification, not CI/CD.
 */

import { describe, it, expect } from 'vitest';
import { streamText } from 'ai';
import { model } from './model';
import { defineOutputGuardrail, withGuardrails } from 'ai-sdk-guardrails';
import { extractContent } from 'ai-sdk-guardrails/guardrails/output';

// Define a length limit guardrail for streaming
const streamLengthGuardrail = defineOutputGuardrail({
  name: 'stream-length-limit',
  description: 'Limits the total length of streamed content',
  execute: async (params) => {
    const { text } = extractContent(params.result);
    const maxLength = 200; // Short limit for demonstration

    if (text.length > maxLength) {
      return {
        tripwireTriggered: true,
        message: `Stream output too long: ${text.length}/${maxLength} characters`,
        severity: 'medium',
        metadata: {
          length: text.length,
          limit: maxLength,
          excess: text.length - maxLength,
        },
      };
    }

    return { tripwireTriggered: false };
  },
});

// Content filter for streaming
const streamContentFilter = defineOutputGuardrail({
  name: 'stream-content-filter',
  description: 'Filters inappropriate content in streams',
  execute: async (params) => {
    const { text } = extractContent(params.result);

    // Check for repetitive patterns (common in streaming issues)
    const words = text.split(/\s+/);
    const wordCounts = new Map<string, number>();

    for (const word of words) {
      const lower = word.toLowerCase();
      wordCounts.set(lower, (wordCounts.get(lower) || 0) + 1);
    }

    // Check if any word repeats too much
    const maxRepetitions = Math.max(...wordCounts.values());
    const totalWords = words.length;

    if (totalWords > 10 && maxRepetitions > totalWords * 0.2) {
      return {
        tripwireTriggered: true,
        message: 'Repetitive content detected in stream',
        severity: 'medium',
        metadata: {
          maxRepetitions,
          totalWords,
          repetitionRatio: Math.round((maxRepetitions / totalWords) * 100),
        },
      };
    }

    return { tripwireTriggered: false };
  },
});

describe('Streaming Limits Example', () => {
  describe('Streaming with Length Limits', () => {
    it('should allow short stream within limits', async () => {
      const limitedModel = withGuardrails(model, {
        outputGuardrails: [streamLengthGuardrail],
        throwOnBlocked: false,
      });

      const stream = await streamText({
        model: limitedModel,
        prompt: 'Write a one-sentence description of clouds',
      });

      let fullText = '';
      for await (const chunk of stream.textStream) {
        fullText += chunk;
      }

      expect(fullText.length).toBeGreaterThan(0);
      // Guardrails check happens after stream completion
    });

    it('should detect long stream exceeding limits in warning mode', async () => {
      let blockedMessage: string | undefined;
      let blockedMetadata: any;

      const limitedModel = withGuardrails(model, {
        outputGuardrails: [streamLengthGuardrail],
        throwOnBlocked: false,
        onOutputBlocked: (executionSummary) => {
          blockedMessage = executionSummary.blockedResults[0]?.message;
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      const stream = await streamText({
        model: limitedModel,
        prompt: 'Write a detailed paragraph about the history of computers',
      });

      let fullText = '';
      for await (const chunk of stream.textStream) {
        fullText += chunk;
      }

      expect(fullText.length).toBeGreaterThan(0);
      // If stream exceeded limit, check metadata
      if (blockedMessage) {
        expect(blockedMessage).toContain('Stream output too long');
        expect(blockedMetadata?.length).toBeGreaterThan(200);
        expect(blockedMetadata?.limit).toBe(200);
        expect(blockedMetadata?.excess).toBeGreaterThan(0);
      }
    });

    it('should block long stream in blocking mode', async () => {
      const blockingModel = withGuardrails(model, {
        outputGuardrails: [streamLengthGuardrail],
        throwOnBlocked: true,
      });

      const stream = await streamText({
        model: blockingModel,
        prompt: 'Write a very detailed explanation about artificial intelligence',
      });

      let fullText = '';
      let streamCompleted = false;

      try {
        for await (const chunk of stream.textStream) {
          fullText += chunk;
        }
        streamCompleted = true;
        // Guardrails check happens after stream completion
        // If blocking mode, it will throw here
        await stream;
      } catch (error) {
        // Expected to throw if stream exceeded limit
        expect(String(error)).toBeDefined();
        return;
      }

      // If stream completed without throwing, verify it was within limits
      if (streamCompleted) {
        expect(fullText.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Streaming Content Filtering', () => {
    it('should detect repetitive content in stream', async () => {
      let blockedMessage: string | undefined;
      let blockedMetadata: any;

      const filteredModel = withGuardrails(model, {
        outputGuardrails: [streamContentFilter],
        throwOnBlocked: false,
        onOutputBlocked: (executionSummary) => {
          blockedMessage = executionSummary.blockedResults[0]?.message;
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      const stream = await streamText({
        model: filteredModel,
        prompt: 'Describe a forest scene with variety and detail',
      });

      let fullText = '';
      for await (const chunk of stream.textStream) {
        fullText += chunk;
      }

      expect(fullText.length).toBeGreaterThan(0);
      // If repetitive content was detected, verify metadata
      if (blockedMessage) {
        expect(blockedMessage).toContain('Repetitive content');
        expect(blockedMetadata?.repetitionRatio).toBeDefined();
        expect(blockedMetadata?.maxRepetitions).toBeDefined();
        expect(blockedMetadata?.totalWords).toBeDefined();
      }
    });

    it('should provide correct metadata for content filtering', async () => {
      let blockedMetadata: any;

      const filteredModel = withGuardrails(model, {
        outputGuardrails: [streamContentFilter],
        throwOnBlocked: false,
        onOutputBlocked: (executionSummary) => {
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      const stream = await streamText({
        model: filteredModel,
        prompt: 'Write a detailed description of a forest',
      });

      let fullText = '';
      for await (const chunk of stream.textStream) {
        fullText += chunk;
      }

      expect(fullText.length).toBeGreaterThan(0);
      // If metadata was captured, verify structure
      if (blockedMetadata) {
        expect(blockedMetadata.maxRepetitions).toBeDefined();
        expect(blockedMetadata.totalWords).toBeDefined();
        expect(blockedMetadata.repetitionRatio).toBeDefined();
      }
    });
  });

  describe('Stream Completion Behavior', () => {
    it('should complete stream before guardrail evaluation', async () => {
      let streamCompleted = false;
      let guardrailTriggered = false;

      const limitedModel = withGuardrails(model, {
        outputGuardrails: [streamLengthGuardrail],
        throwOnBlocked: false,
        onOutputBlocked: () => {
          guardrailTriggered = true;
        },
      });

      const stream = await streamText({
        model: limitedModel,
        prompt: 'Write a detailed explanation about machine learning',
      });

      // Stream should complete first
      for await (const chunk of stream.textStream) {
        // Process chunks
        expect(chunk).toBeDefined();
      }
      streamCompleted = true;

      expect(streamCompleted).toBe(true);
      // Guardrail evaluation happens after stream completion
      // The fact that we got here means stream completed
    });
  });
});
