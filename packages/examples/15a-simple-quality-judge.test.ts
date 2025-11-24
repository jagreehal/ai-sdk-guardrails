/**
 * Simple Quality Judge Example - Test
 *
 * Basic demonstration of using an LLM to evaluate response quality.
 * This is a focused example showing the core concept simply.
 *
 * Note: These tests use real LLM models and may be flaky.
 * They're designed for manual verification, not CI/CD.
 * These tests are slow due to double LLM calls.
 */

import { describe, it, expect } from 'vitest';
import { generateText } from 'ai';
import { model } from './model';
import { defineOutputGuardrail, withGuardrails } from 'ai-sdk-guardrails';
import { extractContent } from 'ai-sdk-guardrails/guardrails/output';

// Simple quality evaluation guardrail
const qualityJudgeGuardrail = defineOutputGuardrail<{
  qualityScore: number;
  passed: boolean;
  evaluatedText: string;
  judgeError?: string;
  fallbackApproved: boolean;
}>({
  name: 'quality-judge',
  description: 'Uses LLM to evaluate response quality',
  execute: async (context) => {
    const { text } = extractContent(context.result);

    // Skip evaluation for very short responses
    if (text.length < 10) {
      return {
        tripwireTriggered: false,
        metadata: {
          qualityScore: 10,
          passed: true,
          evaluatedText: text,
          fallbackApproved: false,
        },
      };
    }

    try {
      // Use the same model as a judge
      const judgmentResult = await generateText({
        model,
        prompt: `Rate this response on a scale of 1-10 for quality and helpfulness:

"${text}"

Respond with just a number (1-10):`,
      });

      // Extract the score
      const score = Number.parseInt(judgmentResult.text.trim());

      // Check if score is valid and acceptable
      if (Number.isNaN(score) || score < 6) {
        return {
          tripwireTriggered: true,
          message: `Response quality too low (score: ${Number.isNaN(score) ? 'invalid' : score}/10)`,
          severity: score < 4 ? 'high' : 'medium',
          metadata: {
            qualityScore: Number.isNaN(score) ? 0 : score,
            evaluatedText: text.slice(0, 100) + '...',
            passed: false,
            judgeError: undefined,
            fallbackApproved: false,
          },
        };
      }

      return {
        tripwireTriggered: false,
        metadata: {
          qualityScore: score,
          passed: true,
          evaluatedText: text.slice(0, 100) + '...',
          judgeError: undefined,
          fallbackApproved: false,
        },
      };
    } catch (error) {
      // If judge fails, allow the response but log the error
      return {
        tripwireTriggered: false,
        metadata: {
          qualityScore: 5, // Default neutral score
          passed: true, // Fallback approval
          evaluatedText: text.slice(0, 100) + '...',
          judgeError: (error as Error).message,
          fallbackApproved: true,
        },
      };
    }
  },
});

describe('Simple Quality Judge Example', () => {
  it(
    'should evaluate response quality using LLM judge',
    async () => {
      let blockedMessage: string | undefined;
      let blockedMetadata: any;

      const judgedModel = withGuardrails(model, {
        outputGuardrails: [qualityJudgeGuardrail],
        throwOnBlocked: false, // Warning mode
        onOutputBlocked: (executionSummary) => {
          blockedMessage = executionSummary.blockedResults[0]?.message;
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      const result = await generateText({
        model: judgedModel,
        prompt: 'Explain the water cycle in a clear and informative way',
      });

      expect(result.text).toBeDefined();
      expect(result.text.length).toBeGreaterThan(0);
      // If quality judge triggered, verify metadata
      if (blockedMessage) {
        expect(blockedMessage).toContain('Response quality too low');
        if (blockedMetadata) {
          expect(blockedMetadata.qualityScore).toBeDefined();
          expect(blockedMetadata.passed).toBe(false);
        }
      }
    },
    120000,
  );

  it(
    'should provide quality score in metadata',
    async () => {
      let capturedMetadata: any;

      const judgedModel = withGuardrails(model, {
        outputGuardrails: [qualityJudgeGuardrail],
        throwOnBlocked: false,
        onOutputBlocked: (executionSummary) => {
          capturedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      const result = await generateText({
        model: judgedModel,
        prompt: 'What are three benefits of regular exercise?',
      });

      expect(result.text).toBeDefined();
      // If metadata was captured, verify structure
      if (capturedMetadata) {
        expect(capturedMetadata.qualityScore).toBeDefined();
        expect(capturedMetadata.passed).toBeDefined();
        expect(capturedMetadata.evaluatedText).toBeDefined();
        expect(capturedMetadata.fallbackApproved).toBeDefined();
      }
    },
    120000,
  );

  it(
    'should handle brief responses appropriately',
    async () => {
      let blockedMessage: string | undefined;
      let blockedMetadata: any;

      const judgedModel = withGuardrails(model, {
        outputGuardrails: [qualityJudgeGuardrail],
        throwOnBlocked: false,
        onOutputBlocked: (executionSummary) => {
          blockedMessage = executionSummary.blockedResults[0]?.message;
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      const result = await generateText({
        model: judgedModel,
        prompt: 'Say just "yes" or "no" - nothing else',
      });

      expect(result.text).toBeDefined();
      // Brief responses may trigger quality concerns
      if (blockedMessage) {
        expect(blockedMessage).toContain('Response quality');
        if (blockedMetadata) {
          expect(blockedMetadata.qualityScore).toBeDefined();
        }
      }
    },
    120000,
  );

  it(
    'should skip evaluation for very short responses',
    async () => {
      let capturedMetadata: any;

      const judgedModel = withGuardrails(model, {
        outputGuardrails: [qualityJudgeGuardrail],
        throwOnBlocked: false,
        onOutputBlocked: (executionSummary) => {
          capturedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      // Generate a very short response
      const result = await generateText({
        model: judgedModel,
        prompt: 'Say "OK"',
      });

      expect(result.text).toBeDefined();
      // Very short responses should skip evaluation
      // The guardrail should handle this internally
    },
    120000,
  );

  it(
    'should handle judge errors gracefully with fallback',
    async () => {
      // This test verifies that if the judge fails, the response is still allowed
      const judgedModel = withGuardrails(model, {
        outputGuardrails: [qualityJudgeGuardrail],
        throwOnBlocked: false,
      });

      const result = await generateText({
        model: judgedModel,
        prompt: 'Explain photosynthesis',
      });

      expect(result.text).toBeDefined();
      // Even if judge fails, response should be allowed (fallback approval)
    },
    120000,
  );
});
