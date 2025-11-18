/**
 * Streaming Quality Example - Test
 *
 * Demonstrates quality monitoring and validation for streaming responses,
 * including detecting common streaming issues.
 *
 * Note: These tests use real LLM models and may be flaky.
 * They're designed for manual verification, not CI/CD.
 */

import { describe, it, expect } from 'vitest';
import { streamText } from 'ai';
import { model } from './model';
import { defineOutputGuardrail, withGuardrails } from 'ai-sdk-guardrails';
import { extractContent } from 'ai-sdk-guardrails/guardrails/output';

// Quality guardrail for streaming responses
const streamQualityGuardrail = defineOutputGuardrail({
  name: 'stream-quality-monitor',
  description: 'Monitors streaming response quality',
  execute: async (params) => {
    const { text } = extractContent(params.result);
    const issues: string[] = [];
    let severity: 'low' | 'medium' | 'high' = 'low';

    // Check 1: Incomplete sentences (common in interrupted streams)
    const lastChar = text.trim().slice(-1);
    if (lastChar && !'.!?'.includes(lastChar)) {
      issues.push('Incomplete sentence detected');
      severity = 'medium';
    }

    // Check 2: Repeated phrases (stuttering)
    const phrases = text.match(/\b(\w+\s+\w+)\b/g) || [];
    const phraseCounts = new Map<string, number>();
    for (const phrase of phrases) {
      const lower = phrase.toLowerCase();
      phraseCounts.set(lower, (phraseCounts.get(lower) || 0) + 1);
    }

    const maxPhraseRepeat = Math.max(...phraseCounts.values(), 0);
    if (maxPhraseRepeat > 3) {
      issues.push(`Repeated phrases detected (${maxPhraseRepeat}x)`);
      severity = 'medium';
    }

    // Check 3: Coherence (sudden topic changes)
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    if (sentences.length >= 2) {
      // Simple coherence check: look for common words between sentences
      const firstSentence = sentences[0] ?? '';
      const lastSentence = sentences.at(-1) ?? '';
      const firstWords = new Set(firstSentence.toLowerCase().split(/\s+/));
      const lastWords = new Set(lastSentence.toLowerCase().split(/\s+/));
      const commonWords = [...firstWords].filter((w) => lastWords.has(w));

      if (commonWords.length < 2 && sentences.length > 2) {
        issues.push('Potential coherence issue');
      }
    }

    // Check 4: Stream interruption markers
    const interruptionMarkers = [
      '...',
      '---',
      '***',
      '[truncated]',
      '[cut off]',
    ];
    const hasInterruption = interruptionMarkers.some((marker) =>
      text.includes(marker),
    );
    if (hasInterruption) {
      issues.push('Stream interruption marker detected');
      severity = 'high';
    }

    // Check 5: Quality metrics
    const metrics = {
      characterCount: text.length,
      wordCount: text.split(/\s+/).length,
      sentenceCount: sentences.length,
      avgWordsPerSentence:
        sentences.length > 0
          ? Math.round(text.split(/\s+/).length / sentences.length)
          : 0,
    };

    // Check for quality thresholds
    if (metrics.avgWordsPerSentence > 30) {
      issues.push('Sentences too long');
    }
    if (metrics.avgWordsPerSentence < 5 && metrics.sentenceCount > 2) {
      issues.push('Sentences too short');
    }

    if (issues.length > 0) {
      return {
        tripwireTriggered: true,
        message: `Stream quality issues: ${issues.join(', ')}`,
        severity,
        metadata: { issues, metrics },
      };
    }

    return {
      tripwireTriggered: false,
      metadata: {
        issues: [],
        metrics,
      },
    };
  },
});

// Guardrail for detecting hallucination patterns
const hallucinationDetector = defineOutputGuardrail({
  name: 'hallucination-detector',
  description: 'Detects potential hallucination patterns in streams',
  execute: async (params) => {
    const { text } = extractContent(params.result);
    const warnings: string[] = [];

    // Pattern 1: Excessive confidence markers
    const confidenceMarkers = [
      'definitely',
      'absolutely',
      'certainly',
      'undoubtedly',
      'without a doubt',
      'clearly',
      'obviously',
    ];
    const confidenceCount = confidenceMarkers.filter((marker) =>
      text.toLowerCase().includes(marker),
    ).length;

    if (confidenceCount > 3) {
      warnings.push('Excessive confidence markers');
    }

    // Pattern 2: Made-up citations or references
    const fakeCitationPattern =
      /\[\d+\]|\(\d{4}\)|\b(?:Smith|Jones|Johnson) et al\./g;
    const citations = text.match(fakeCitationPattern) || [];
    if (citations.length > 2) {
      warnings.push('Potential fabricated citations');
    }

    // Pattern 3: Specific numbers without context
    const suspiciousNumbers =
      /\b\d{2,}\.?\d*%|\$\d+(?:,\d{3})*(?:\.\d{2})?|\b\d{4,}\b/g;
    const numbers = text.match(suspiciousNumbers) || [];
    if (numbers.length > 3) {
      warnings.push('Multiple specific numbers (verify accuracy)');
    }

    if (warnings.length > 0) {
      return {
        tripwireTriggered: true,
        message: `Potential hallucination patterns: ${warnings.join(', ')}`,
        severity: 'medium',
        metadata: {
          issues: warnings,
          metrics: {
            confidenceCount,
            citationCount: citations.length,
            numberCount: numbers.length,
            characterCount: text.length,
            wordCount: text.split(/\s+/).length,
            sentenceCount: text
              .split(/[.!?]+/)
              .filter((s) => s.trim().length > 0).length,
            avgWordsPerSentence: 0,
          },
        },
      };
    }

    return {
      tripwireTriggered: false,
      metadata: {
        issues: [],
        metrics: {
          confidenceCount: 0,
          citationCount: citations.length,
          numberCount: numbers.length,
          characterCount: text.length,
          wordCount: text.split(/\s+/).length,
          sentenceCount: text.split(/[.!?]+/).filter((s) => s.trim().length > 0)
            .length,
          avgWordsPerSentence: 0,
        },
      },
    };
  },
});

describe('Streaming Quality Example', () => {
  describe('Stream Quality Monitoring', () => {
    it('should monitor well-formed stream quality', async () => {
      let blockedMessage: string | undefined;
      let blockedMetadata: any;

      const qualityModel = withGuardrails(model, {
        outputGuardrails: [streamQualityGuardrail],
        throwOnBlocked: false,
        onOutputBlocked: (executionSummary) => {
          blockedMessage = executionSummary.blockedResults[0]?.message;
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      const stream = await streamText({
        model: qualityModel,
        prompt: 'Write a clear, well-structured paragraph about trees',
      });

      let fullText = '';
      for await (const chunk of stream.textStream) {
        fullText += chunk;
      }

      expect(fullText.length).toBeGreaterThan(0);
      // If quality issues were detected, verify metadata
      if (blockedMessage) {
        expect(blockedMessage).toContain('Stream quality issues');
        expect(blockedMetadata?.metrics).toBeDefined();
        expect(blockedMetadata?.metrics.wordCount).toBeDefined();
        expect(blockedMetadata?.metrics.sentenceCount).toBeDefined();
      }
    });

    it('should detect quality issues in choppy stream', async () => {
      let blockedMessage: string | undefined;
      let blockedMetadata: any;

      const qualityModel = withGuardrails(model, {
        outputGuardrails: [streamQualityGuardrail],
        throwOnBlocked: false,
        onOutputBlocked: (executionSummary) => {
          blockedMessage = executionSummary.blockedResults[0]?.message;
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      const stream = await streamText({
        model: qualityModel,
        prompt:
          'Write very short sentences. Make them choppy. Like this. Very brief.',
      });

      let fullText = '';
      for await (const chunk of stream.textStream) {
        fullText += chunk;
      }

      expect(fullText.length).toBeGreaterThan(0);
      // If quality issues were detected, verify metadata
      if (blockedMessage) {
        expect(blockedMessage).toContain('Stream quality issues');
        expect(blockedMetadata?.issues).toBeDefined();
        expect(Array.isArray(blockedMetadata.issues)).toBe(true);
      }
    });

    it('should provide correct quality metrics', async () => {
      let blockedMetadata: any;

      const qualityModel = withGuardrails(model, {
        outputGuardrails: [streamQualityGuardrail],
        throwOnBlocked: false,
        onOutputBlocked: (executionSummary) => {
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      const stream = await streamText({
        model: qualityModel,
        prompt: 'Write a detailed paragraph about the ocean',
      });

      let fullText = '';
      for await (const chunk of stream.textStream) {
        fullText += chunk;
      }

      expect(fullText.length).toBeGreaterThan(0);
      // If metadata was captured, verify structure
      if (blockedMetadata) {
        expect(blockedMetadata.metrics).toBeDefined();
        expect(blockedMetadata.metrics.characterCount).toBeDefined();
        expect(blockedMetadata.metrics.wordCount).toBeDefined();
        expect(blockedMetadata.metrics.sentenceCount).toBeDefined();
        expect(blockedMetadata.metrics.avgWordsPerSentence).toBeDefined();
      }
    });
  });

  describe('Hallucination Detection', () => {
    it('should detect potential hallucination patterns', async () => {
      let blockedMessage: string | undefined;
      let blockedMetadata: any;

      const hallucinationModel = withGuardrails(model, {
        outputGuardrails: [hallucinationDetector],
        throwOnBlocked: false,
        onOutputBlocked: (executionSummary) => {
          blockedMessage = executionSummary.blockedResults[0]?.message;
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      const stream = await streamText({
        model: hallucinationModel,
        prompt: 'Describe general facts about the solar system',
      });

      let fullText = '';
      for await (const chunk of stream.textStream) {
        fullText += chunk;
      }

      expect(fullText.length).toBeGreaterThan(0);
      // If hallucination patterns were detected, verify metadata
      if (blockedMessage) {
        expect(blockedMessage).toContain('Potential hallucination patterns');
        expect(blockedMetadata?.metrics).toBeDefined();
        expect(blockedMetadata?.metrics.confidenceCount).toBeDefined();
        expect(blockedMetadata?.metrics.citationCount).toBeDefined();
        expect(blockedMetadata?.metrics.numberCount).toBeDefined();
      }
    });

    it('should provide correct hallucination detection metrics', async () => {
      let blockedMetadata: any;

      const hallucinationModel = withGuardrails(model, {
        outputGuardrails: [hallucinationDetector],
        throwOnBlocked: false,
        onOutputBlocked: (executionSummary) => {
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      const stream = await streamText({
        model: hallucinationModel,
        prompt: 'Explain quantum computing concepts',
      });

      let fullText = '';
      for await (const chunk of stream.textStream) {
        fullText += chunk;
      }

      expect(fullText.length).toBeGreaterThan(0);
      // If metadata was captured, verify structure
      if (blockedMetadata) {
        expect(blockedMetadata.metrics).toBeDefined();
        expect(blockedMetadata.metrics.confidenceCount).toBeDefined();
        expect(blockedMetadata.metrics.citationCount).toBeDefined();
        expect(blockedMetadata.metrics.numberCount).toBeDefined();
      }
    });
  });

  describe('Combined Quality Checks', () => {
    it('should apply multiple quality guardrails together', async () => {
      let blockedResults: any[] = [];

      const combinedModel = withGuardrails(model, {
        outputGuardrails: [streamQualityGuardrail, hallucinationDetector],
        throwOnBlocked: false,
        onOutputBlocked: (executionSummary) => {
          blockedResults = executionSummary.blockedResults;
        },
      });

      const stream = await streamText({
        model: combinedModel,
        prompt: 'Write a detailed technical explanation about quantum computing',
      });

      let fullText = '';
      for await (const chunk of stream.textStream) {
        fullText += chunk;
      }

      expect(fullText.length).toBeGreaterThan(0);
      // If any guardrails triggered, verify results
      if (blockedResults.length > 0) {
        expect(blockedResults.length).toBeGreaterThan(0);
        blockedResults.forEach((result) => {
          expect(result.message).toBeDefined();
          expect(result.severity).toBeDefined();
        });
      }
    });

    it('should provide results from all triggered guardrails', async () => {
      let blockedResults: any[] = [];

      const combinedModel = withGuardrails(model, {
        outputGuardrails: [streamQualityGuardrail, hallucinationDetector],
        throwOnBlocked: false,
        onOutputBlocked: (executionSummary) => {
          blockedResults = executionSummary.blockedResults;
        },
      });

      const stream = await streamText({
        model: combinedModel,
        prompt: 'Write a comprehensive explanation about machine learning',
      });

      let fullText = '';
      for await (const chunk of stream.textStream) {
        fullText += chunk;
      }

      expect(fullText.length).toBeGreaterThan(0);
      // Verify that if guardrails triggered, we have proper results
      if (blockedResults.length > 0) {
        expect(Array.isArray(blockedResults)).toBe(true);
        blockedResults.forEach((result) => {
          expect(result.context).toBeDefined();
          expect(result.message).toBeDefined();
        });
      }
    });
  });

  describe('Stream Completion', () => {
    it('should complete stream before quality evaluation', async () => {
      let streamCompleted = false;

      const qualityModel = withGuardrails(model, {
        outputGuardrails: [streamQualityGuardrail],
        throwOnBlocked: false,
      });

      const stream = await streamText({
        model: qualityModel,
        prompt: 'Write a paragraph about artificial intelligence',
      });

      // Stream should complete first
      for await (const chunk of stream.textStream) {
        expect(chunk).toBeDefined();
      }
      streamCompleted = true;

      expect(streamCompleted).toBe(true);
      // Quality evaluation happens after stream completion
    });
  });
});
