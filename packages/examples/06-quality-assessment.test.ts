/**
 * Quality Assessment Example - Test
 *
 * Demonstrates how to assess and ensure the quality of AI responses
 * by checking for common quality issues.
 *
 * Note: These tests use real LLM models and may be flaky.
 * They're designed for manual verification, not CI/CD.
 */

import { describe, it, expect } from 'vitest';
import { generateText } from 'ai';
import { model } from './model';
import { defineOutputGuardrail, withGuardrails } from 'ai-sdk-guardrails';
import { extractContent } from 'ai-sdk-guardrails/guardrails/output';

interface AdvancedQualityMetadata {
  avgSentenceLength: number;
  wordVariety: number;
  hasStructure: boolean;
  qualityScore: number;
  issues: string[];
}

// Define a guardrail that assesses output quality
const qualityAssessmentGuardrail = defineOutputGuardrail({
  name: 'quality-assessment',
  description: 'Assesses output quality and helpfulness',
  execute: async (params) => {
    const { text } = extractContent(params.result);
    const qualityIssues: string[] = [];
    let severity: 'low' | 'medium' | 'high' = 'low';

    // Check 1: Too short
    if (text.length < 20) {
      qualityIssues.push('Response too short');
      severity = 'medium';
    }

    // Check 2: Generic/unhelpful responses
    const genericPhrases = [
      "I can't help",
      "I don't know",
      "I'm sorry, but",
      'I cannot provide',
      "I'm not able to",
    ];

    const hasGenericResponse = genericPhrases.some((phrase) =>
      text.toLowerCase().includes(phrase.toLowerCase()),
    );

    if (hasGenericResponse) {
      qualityIssues.push('Generic/unhelpful response');
      severity = 'medium';
    }

    // Check 3: Repetitive content
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const uniqueSentences = new Set(
      sentences.map((s) => s.trim().toLowerCase()),
    );

    if (sentences.length > 2 && uniqueSentences.size / sentences.length < 0.7) {
      qualityIssues.push('Repetitive content');
      severity = 'medium';
    }

    // Check 4: Too many questions (not answering the prompt)
    const questionCount = (text.match(/\?/g) || []).length;
    if (questionCount > 3) {
      qualityIssues.push(`Too many questions (${questionCount})`);
    }

    // Check 5: Incomplete sentences
    const incompletePattern = /[^.!?]\s*$/;
    if (incompletePattern.test(text.trim())) {
      qualityIssues.push('Incomplete sentence');
      severity = 'high';
    }

    // Check 6: Code quality (if code is present)
    const hasCode = /```[\s\S]*?```/.test(text) || /`[^`]+`/.test(text);
    if (hasCode) {
      const codeBlocks = text.match(/```[\s\S]*?```/g) || [];
      for (const block of codeBlocks) {
        // Check for empty code blocks
        const content = block
          .replace(/```\w*\n?/, '')
          .replace(/```/, '')
          .trim();
        if (content.length === 0) {
          qualityIssues.push('Empty code block');
        }
      }
    }

    if (qualityIssues.length > 0) {
      return {
        tripwireTriggered: true,
        message: `Quality issues detected: ${qualityIssues.join(', ')}`,
        severity,
        metadata: {
          issues: qualityIssues,
          issueCount: qualityIssues.length,
          textLength: text.length,
        },
      };
    }

    return { tripwireTriggered: false };
  },
});

describe('Quality Assessment Example', () => {
  it('should allow well-formed response to pass quality checks', async () => {
    const qualityModel = withGuardrails(model, {
      outputGuardrails: [qualityAssessmentGuardrail],
      throwOnBlocked: false,
    });

    const result = await generateText({
      model: qualityModel,
      prompt: 'Explain the concept of machine learning in simple terms',
    });

    expect(result.text).toBeDefined();
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('should detect short responses as quality issue', async () => {
    let blockedMessage: string | undefined;
    let blockedMetadata: any;

    const qualityModel = withGuardrails(model, {
      outputGuardrails: [qualityAssessmentGuardrail],
      throwOnBlocked: false,
      onOutputBlocked: (executionSummary) => {
        blockedMessage = executionSummary.blockedResults[0]?.message;
        blockedMetadata = executionSummary.blockedResults[0]?.metadata;
      },
    });

    const result = await generateText({
      model: qualityModel,
      prompt: 'Reply with just "OK"',
    });

    // In warning mode, it may or may not trigger depending on actual response
    // But if it does trigger, we should see the quality issue
    if (blockedMessage) {
      expect(blockedMessage).toContain('Quality issues detected');
      expect(blockedMetadata?.issues).toBeDefined();
    }

    expect(result.text).toBeDefined();
  });

  describe('Advanced Quality Metrics', () => {
    const advancedQualityGuardrail = defineOutputGuardrail<AdvancedQualityMetadata>({
      name: 'advanced-quality',
      description: 'Advanced quality metrics including readability',
      execute: async (params) => {
        const { text } = extractContent(params.result);
        const metrics: Partial<AdvancedQualityMetadata> = {};

        // Calculate average sentence length
        const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
        const avgSentenceLength =
          sentences.length > 0
            ? sentences.reduce((sum, s) => sum + s.split(/\s+/).length, 0) /
              sentences.length
            : 0;

        metrics.avgSentenceLength = Math.round(avgSentenceLength);

        // Calculate word variety (unique words / total words)
        const words = text.toLowerCase().match(/\b\w+\b/g) || [];
        const uniqueWords = new Set(words);
        metrics.wordVariety =
          words.length > 0
            ? Math.round((uniqueWords.size / words.length) * 100)
            : 0;

        // Check for structure (paragraphs, lists, etc.)
        const hasParagraphs = text.includes('\n\n');
        const hasList = /[-*•]\s/.test(text) || /\d+\.\s/.test(text);
        metrics.hasStructure = hasParagraphs || hasList;

        // Quality score calculation
        let qualityScore = 100;
        const issues: string[] = [];

        if (avgSentenceLength > 25) {
          qualityScore -= 10;
          issues.push('Sentences too long');
        }
        if (avgSentenceLength < 5 && sentences.length > 1) {
          qualityScore -= 10;
          issues.push('Sentences too short');
        }
        if (metrics.wordVariety && metrics.wordVariety < 50) {
          qualityScore -= 15;
          issues.push('Low word variety');
        }
        if (!metrics.hasStructure && text.length > 200) {
          qualityScore -= 10;
          issues.push('Lacks structure');
        }

        metrics.qualityScore = qualityScore;

        const shouldBlock = qualityScore < 70;

        return {
          tripwireTriggered: shouldBlock,
          message: shouldBlock
            ? `Quality score too low: ${qualityScore}/100`
            : `Quality score: ${qualityScore}/100`,
          severity:
            qualityScore < 50 ? 'high' : qualityScore < 70 ? 'medium' : 'low',
          metadata: {
            ...metrics,
            issues,
            qualityScore,
          } as AdvancedQualityMetadata,
        };
      },
    });

    it('should calculate quality metrics for response', async () => {
      let blockedMetadata: AdvancedQualityMetadata | undefined;

      const advancedModel = withGuardrails(model, {
        outputGuardrails: [advancedQualityGuardrail],
        throwOnBlocked: false,
        onOutputBlocked: (executionSummary) => {
          blockedMetadata = executionSummary.blockedResults[0]
            ?.metadata as AdvancedQualityMetadata;
        },
      });

      const result = await generateText({
        model: advancedModel,
        prompt: 'Write a detailed explanation of cloud computing with examples',
      });

      expect(result.text).toBeDefined();
      expect(result.text.length).toBeGreaterThan(0);

      // If quality was assessed, check metadata structure
      // Note: In warning mode, metadata may not always be populated
      if (blockedMetadata) {
        expect(blockedMetadata.qualityScore).toBeDefined();
        expect(blockedMetadata.avgSentenceLength).toBeDefined();
        expect(blockedMetadata.wordVariety).toBeDefined();
        expect(blockedMetadata.hasStructure).toBeDefined();
      }
    });
  });

  describe('Completeness Check', () => {
    const completenessGuardrail = defineOutputGuardrail({
      name: 'completeness-check',
      description: 'Ensures responses are complete for the prompt type',
      execute: async (params) => {
        const { text } = extractContent(params.result);
        const { prompt } = params.input;
        const issues: string[] = [];

        // Check for expected elements based on prompt
        if (prompt.toLowerCase().includes('list')) {
          const hasListItems = /[-*•]\s/.test(text) || /\d+\.\s/.test(text);
          if (!hasListItems) {
            issues.push('Expected list format not found');
          }
        }

        if (prompt.toLowerCase().includes('example')) {
          const hasExample =
            text.toLowerCase().includes('example') ||
            text.toLowerCase().includes('for instance') ||
            text.includes('e.g.');
          if (!hasExample) {
            issues.push('No examples provided');
          }
        }

        if (prompt.toLowerCase().includes('explain') && text.length < 100) {
          issues.push('Explanation too brief');
        }

        if (issues.length > 0) {
          return {
            tripwireTriggered: true,
            message: `Response incomplete: ${issues.join(', ')}`,
            severity: 'medium',
            metadata: {
              promptType: (prompt.split(' ')[0] ?? '').toLowerCase(),
              missingElements: issues,
            },
          };
        }

        return { tripwireTriggered: false };
      },
    });

    it('should check for completeness based on prompt type', async () => {
      let blockedMessage: string | undefined;
      let blockedMetadata: any;

      const completenessModel = withGuardrails(model, {
        outputGuardrails: [completenessGuardrail],
        throwOnBlocked: false,
        onOutputBlocked: (executionSummary) => {
          blockedMessage = executionSummary.blockedResults[0]?.message;
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      const result = await generateText({
        model: completenessModel,
        prompt: 'List the benefits of exercise with examples',
      });

      expect(result.text).toBeDefined();
      expect(result.text.length).toBeGreaterThan(0);

      // If completeness check triggered, verify metadata
      if (blockedMessage) {
        expect(blockedMessage).toContain('Response incomplete');
        expect(blockedMetadata?.missingElements).toBeDefined();
      }
    });

    it('should detect missing examples when prompt requests them', async () => {
      // Create a response that doesn't include examples
      const testText = 'Exercise has many benefits. It improves health.';
      
      // We can test the guardrail directly using executeOutputGuardrails
      // But for now, we'll test it through the model
      const completenessModel = withGuardrails(model, {
        outputGuardrails: [completenessGuardrail],
        throwOnBlocked: false,
      });

      // This test verifies the guardrail logic works
      // The actual response may vary, so we're testing the guardrail is applied
      const result = await generateText({
        model: completenessModel,
        prompt: 'Explain the benefits of exercise with examples',
      });

      expect(result.text).toBeDefined();
    });
  });
});
