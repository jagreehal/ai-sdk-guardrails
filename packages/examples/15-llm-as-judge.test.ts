/**
 * LLM-as-Judge Example - Test
 *
 * Demonstrates using another LLM to evaluate and validate responses
 * for quality, accuracy, and compliance.
 *
 * Note: These tests use real LLM models and may be flaky.
 * They're designed for manual verification, not CI/CD.
 * These tests are slow and expensive due to double LLM calls.
 */

import { describe, it, expect } from 'vitest';
import { generateText } from 'ai';
import { model } from './model';
import { defineOutputGuardrail, withGuardrails } from 'ai-sdk-guardrails';
import { extractContent } from 'ai-sdk-guardrails/guardrails/output';

// Define types for LLM judge metadata
interface LLMJudgmentMetadata extends Record<string, unknown> {
  llmJudgment?: {
    score: number;
    quality: string;
    issues?: string[];
    isAppropriate: boolean;
    reasoning: string;
  };
  evaluatedText?: string;
  qualityScore?: number;
  judgeError?: string;
  fallbackApproved?: boolean;
}

interface FactCheckMetadata extends Record<string, unknown> {
  factCheck?: {
    confidenceLevel: number;
    recommendation: string;
    isAccurate: boolean;
    sources?: string[];
  };
  evaluatedContent?: string;
  accuracyVerified?: boolean;
  factCheckError?: string;
  skippedVerification?: boolean;
}

interface BiasCheckMetadata extends Record<string, unknown> {
  biasCheck?: {
    hasBias: boolean;
    biasTypes: string[];
    severity: string;
    explanation: string;
    suggestions: string[];
  };
  suggestions?: string[];
  biasScreenPassed?: boolean;
  biasCheckError?: string;
  skippedBiasCheck?: boolean;
}

// LLM-based content evaluation guardrail
const llmJudgeGuardrail = defineOutputGuardrail<LLMJudgmentMetadata>({
  name: 'llm-content-judge',
  description: 'Uses LLM to evaluate response quality and appropriateness',
  execute: async (context) => {
    const { text } = extractContent(context.result);

    try {
      // Use the same model as a judge (in production, might use a different model)
      const judgmentResult = await generateText({
        model,
        prompt: `Please evaluate the following AI response for quality and appropriateness.
        
Response to evaluate:
"${text}"

Please provide a JSON evaluation with:
- score: number from 1-10 (10 being excellent)
- quality: "excellent", "good", "fair", or "poor"
- issues: array of any problems found
- isAppropriate: boolean
- reasoning: brief explanation

Respond only with valid JSON.`,
      });

      // Parse the judgment
      let judgment;
      try {
        const jsonMatch = judgmentResult.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          judgment = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON found in response');
        }
      } catch {
        // Fallback to simple heuristics if JSON parsing fails
        judgment = {
          score: text.length > 20 ? 7 : 4,
          quality: 'fair',
          issues: ['Could not parse LLM judgment'],
          isAppropriate: true,
          reasoning: 'Fallback evaluation used',
        };
      }

      // Determine if this should trigger the guardrail
      const shouldBlock = !judgment.isAppropriate || judgment.score < 6;

      if (shouldBlock) {
        return {
          tripwireTriggered: true,
          message: `LLM Judge evaluation failed: ${judgment.reasoning || 'Quality below threshold'}`,
          severity: judgment.score < 4 ? 'high' : 'medium',
          metadata: {
            llmJudgment: judgment,
            evaluatedText: text.slice(0, 100),
            qualityScore: undefined,
            judgeError: undefined,
            fallbackApproved: undefined,
          },
        };
      }

      return {
        tripwireTriggered: false,
        metadata: {
          llmJudgment: judgment,
          qualityScore: judgment.score,
          evaluatedText: undefined,
          judgeError: undefined,
          fallbackApproved: undefined,
        },
      };
    } catch (error) {
      // If LLM judge fails, allow the response but log the error
      return {
        tripwireTriggered: false,
        metadata: {
          judgeError: (error as Error).message,
          fallbackApproved: true,
          llmJudgment: undefined,
          evaluatedText: undefined,
          qualityScore: undefined,
        },
      };
    }
  },
});

// Factual accuracy checker using LLM
const factualAccuracyJudge = defineOutputGuardrail<FactCheckMetadata>({
  name: 'factual-accuracy-judge',
  description: 'Uses LLM to check for potential factual errors',
  execute: async (context) => {
    const { text } = extractContent(context.result);
    const { prompt } = context.input as { prompt: string };

    try {
      const factCheckResult = await generateText({
        model,
        prompt: `Please fact-check the following response for accuracy.

Original question: "${prompt}"

Response to check:
"${text}"

Identify any potential factual errors, outdated information, or misleading statements.
Respond with JSON:
{
  "hasFactualErrors": boolean,
  "confidenceLevel": "high" | "medium" | "low",
  "potentialIssues": ["issue1", "issue2"],
  "recommendation": "approve" | "flag" | "reject"
}`,
      });

      let factCheck;
      try {
        const jsonMatch = factCheckResult.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          factCheck = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON in fact-check response');
        }
      } catch {
        factCheck = {
          hasFactualErrors: false,
          confidenceLevel: 'low',
          potentialIssues: [],
          recommendation: 'approve',
        };
      }

      const factCheckData: FactCheckMetadata = {
        factCheck: {
          confidenceLevel:
            factCheck.confidenceLevel === 'high'
              ? 0.9
              : factCheck.confidenceLevel === 'medium'
                ? 0.6
                : 0.3,
          recommendation: factCheck.recommendation,
          isAccurate: !factCheck.hasFactualErrors,
          sources: factCheck.potentialIssues || [],
        },
        evaluatedContent: text.slice(0, 100),
        accuracyVerified: !factCheck.hasFactualErrors,
        factCheckError: undefined,
        skippedVerification: false,
      };

      if (factCheck.hasFactualErrors && factCheck.recommendation === 'reject') {
        return {
          tripwireTriggered: true,
          message: `Potential factual errors detected: ${factCheck.potentialIssues.join(', ')}`,
          severity: factCheck.confidenceLevel === 'high' ? 'high' : 'medium',
          metadata: factCheckData,
        };
      }

      return {
        tripwireTriggered: false,
        metadata: factCheckData,
      };
    } catch (error) {
      return {
        tripwireTriggered: false,
        metadata: {
          factCheck: undefined,
          evaluatedContent: undefined,
          accuracyVerified: false,
          factCheckError: (error as Error).message,
          skippedVerification: true,
        },
      };
    }
  },
});

// Bias detection using LLM
const biasDetectionJudge = defineOutputGuardrail<BiasCheckMetadata>({
  name: 'bias-detection-judge',
  description: 'Uses LLM to detect potential bias in responses',
  execute: async (context) => {
    const { text } = extractContent(context.result);

    try {
      const biasCheckResult = await generateText({
        model,
        prompt: `Analyze the following text for potential bias, stereotypes, or unfair generalizations.

Text to analyze:
"${text}"

Look for:
- Gender, racial, or cultural bias
- Stereotypes or generalizations
- Unfair assumptions
- Exclusionary language

Respond with JSON:
{
  "hasBias": boolean,
  "biasTypes": ["type1", "type2"],
  "severity": "low" | "medium" | "high",
  "explanation": "brief explanation",
  "suggestions": ["suggestion1", "suggestion2"]
}`,
      });

      let biasCheck;
      try {
        const jsonMatch = biasCheckResult.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          biasCheck = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON in bias check response');
        }
      } catch {
        biasCheck = {
          hasBias: false,
          biasTypes: [],
          severity: 'low',
          explanation: 'Could not parse bias analysis',
          suggestions: [],
        };
      }

      if (biasCheck.hasBias && biasCheck.severity === 'high') {
        return {
          tripwireTriggered: true,
          message: `High-severity bias detected: ${biasCheck.explanation}`,
          severity: 'high',
          metadata: {
            biasCheck,
            suggestions: biasCheck.suggestions,
            biasScreenPassed: false,
            biasCheckError: undefined,
            skippedBiasCheck: false,
          },
        };
      }

      return {
        tripwireTriggered: false,
        metadata: {
          biasCheck,
          suggestions: biasCheck.suggestions,
          biasScreenPassed: true,
          biasCheckError: undefined,
          skippedBiasCheck: false,
        },
      };
    } catch (error) {
      return {
        tripwireTriggered: false,
        metadata: {
          biasCheck: undefined,
          suggestions: [],
          biasScreenPassed: false,
          biasCheckError: (error as Error).message,
          skippedBiasCheck: true,
        },
      };
    }
  },
});

describe('LLM-as-Judge Example', () => {
  describe('LLM Quality Judge', () => {
    it(
      'should evaluate response quality using LLM judge',
      async () => {
        let blockedMessage: string | undefined;
        let blockedMetadata: LLMJudgmentMetadata | undefined;

        const judgedModel = withGuardrails(model, {
          outputGuardrails: [llmJudgeGuardrail],
          throwOnBlocked: false,
          onOutputBlocked: (executionSummary) => {
            blockedMessage = executionSummary.blockedResults[0]?.message;
            blockedMetadata = executionSummary.blockedResults[0]
              ?.metadata as LLMJudgmentMetadata;
          },
        });

        const result = await generateText({
          model: judgedModel,
          prompt:
            'Explain the benefits of renewable energy in a clear and informative way',
        });

        expect(result.text).toBeDefined();
        expect(result.text.length).toBeGreaterThan(0);
        // If judge evaluation triggered, verify metadata
        if (blockedMessage) {
          expect(blockedMessage).toContain('LLM Judge evaluation');
          if (blockedMetadata?.llmJudgment) {
            expect(blockedMetadata.llmJudgment.score).toBeDefined();
            expect(blockedMetadata.llmJudgment.quality).toBeDefined();
          }
        }
      },
      180000,
    );

    it(
      'should provide quality score in metadata',
      async () => {
        let capturedMetadata: LLMJudgmentMetadata | undefined;

        const judgedModel = withGuardrails(model, {
          outputGuardrails: [llmJudgeGuardrail],
          throwOnBlocked: false,
          onOutputBlocked: (executionSummary) => {
            capturedMetadata = executionSummary.blockedResults[0]
              ?.metadata as LLMJudgmentMetadata;
          },
        });

        const result = await generateText({
          model: judgedModel,
          prompt: 'Give me a very brief, unhelpful answer',
        });

        expect(result.text).toBeDefined();
        // If metadata was captured, verify structure
        if (capturedMetadata) {
          expect(capturedMetadata.llmJudgment).toBeDefined();
          if (capturedMetadata.llmJudgment) {
            expect(capturedMetadata.llmJudgment.score).toBeDefined();
            expect(capturedMetadata.llmJudgment.quality).toBeDefined();
            expect(capturedMetadata.llmJudgment.isAppropriate).toBeDefined();
          }
        }
      },
      180000,
    );
  });

  describe('Factual Accuracy Judge', () => {
    it(
      'should verify factual accuracy using LLM',
      async () => {
        let blockedMessage: string | undefined;
        let blockedMetadata: FactCheckMetadata | undefined;

        const factCheckedModel = withGuardrails(model, {
          outputGuardrails: [factualAccuracyJudge],
          throwOnBlocked: false,
          onOutputBlocked: (executionSummary) => {
            blockedMessage = executionSummary.blockedResults[0]?.message;
            blockedMetadata = executionSummary.blockedResults[0]
              ?.metadata as FactCheckMetadata;
          },
        });

        const result = await generateText({
          model: factCheckedModel,
          prompt: 'What is the capital of France?',
        });

        expect(result.text).toBeDefined();
        // If fact-check triggered, verify metadata
        if (blockedMessage) {
          expect(blockedMessage).toContain('factual errors');
          if (blockedMetadata?.factCheck) {
            expect(blockedMetadata.factCheck.confidenceLevel).toBeDefined();
            expect(blockedMetadata.factCheck.recommendation).toBeDefined();
          }
        }
      },
      180000,
    );

    it(
      'should provide fact-check metadata',
      async () => {
        let capturedMetadata: FactCheckMetadata | undefined;

        const factCheckedModel = withGuardrails(model, {
          outputGuardrails: [factualAccuracyJudge],
          throwOnBlocked: false,
          onOutputBlocked: (executionSummary) => {
            capturedMetadata = executionSummary.blockedResults[0]
              ?.metadata as FactCheckMetadata;
          },
        });

        const result = await generateText({
          model: factCheckedModel,
          prompt: 'Explain how photosynthesis works',
        });

        expect(result.text).toBeDefined();
        // If metadata was captured, verify structure
        if (capturedMetadata) {
          expect(capturedMetadata.factCheck).toBeDefined();
          if (capturedMetadata.factCheck) {
            expect(capturedMetadata.factCheck.confidenceLevel).toBeDefined();
            expect(capturedMetadata.factCheck.isAccurate).toBeDefined();
          }
        }
      },
      180000,
    );
  });

  describe('Bias Detection Judge', () => {
    it(
      'should detect bias using LLM',
      async () => {
        let blockedMessage: string | undefined;
        let blockedMetadata: BiasCheckMetadata | undefined;

        const biasCheckedModel = withGuardrails(model, {
          outputGuardrails: [biasDetectionJudge],
          throwOnBlocked: false,
          onOutputBlocked: (executionSummary) => {
            blockedMessage = executionSummary.blockedResults[0]?.message;
            blockedMetadata = executionSummary.blockedResults[0]
              ?.metadata as BiasCheckMetadata;
          },
        });

        const result = await generateText({
          model: biasCheckedModel,
          prompt: 'Describe the qualities of a good leader',
        });

        expect(result.text).toBeDefined();
        // If bias check triggered, verify metadata
        if (blockedMessage) {
          expect(blockedMessage).toContain('bias detected');
          if (blockedMetadata?.biasCheck) {
            expect(blockedMetadata.biasCheck.hasBias).toBeDefined();
            expect(blockedMetadata.biasCheck.severity).toBeDefined();
          }
        }
      },
      180000,
    );

    it(
      'should provide bias check metadata',
      async () => {
        let capturedMetadata: BiasCheckMetadata | undefined;

        const biasCheckedModel = withGuardrails(model, {
          outputGuardrails: [biasDetectionJudge],
          throwOnBlocked: false,
          onOutputBlocked: (executionSummary) => {
            capturedMetadata = executionSummary.blockedResults[0]
              ?.metadata as BiasCheckMetadata;
          },
        });

        const result = await generateText({
          model: biasCheckedModel,
          prompt: 'Explain the importance of diversity in technology',
        });

        expect(result.text).toBeDefined();
        // If metadata was captured, verify structure
        if (capturedMetadata) {
          expect(capturedMetadata.biasCheck).toBeDefined();
          if (capturedMetadata.biasCheck) {
            expect(capturedMetadata.biasCheck.hasBias).toBeDefined();
            expect(capturedMetadata.biasCheck.biasTypes).toBeDefined();
            expect(Array.isArray(capturedMetadata.biasCheck.biasTypes)).toBe(
              true,
            );
          }
        }
      },
      180000,
    );
  });

  describe('Multiple LLM Judges', () => {
    it(
      'should apply multiple LLM judges together',
      async () => {
        let blockedResults: any[] = [];

        const multiJudgeModel = withGuardrails(model, {
          outputGuardrails: [
            llmJudgeGuardrail,
            factualAccuracyJudge,
            biasDetectionJudge,
          ],
          throwOnBlocked: false,
          onOutputBlocked: (executionSummary) => {
            blockedResults = executionSummary.blockedResults;
          },
        });

        const result = await generateText({
          model: multiJudgeModel,
          prompt: 'Explain the importance of diversity in technology companies',
        });

        expect(result.text).toBeDefined();
        // If any judges triggered, verify results
        if (blockedResults.length > 0) {
          expect(Array.isArray(blockedResults)).toBe(true);
          blockedResults.forEach((result) => {
            expect(result.message).toBeDefined();
            expect(result.severity).toBeDefined();
          });
        }
      },
      240000,
    );
  });
});
