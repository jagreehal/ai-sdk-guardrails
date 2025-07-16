import { createOutputGuardrail } from '../core';
import type {
  OutputGuardrail,
  AIResult,
  OutputGuardrailContext,
} from '../types';

// Type definitions for AI result objects
interface BaseResult {
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  finishReason?: string;
  experimental_providerMetadata?: {
    generationTimeMs?: number;
    reasoning?: string;
  };
  reasoning?: string;
}

interface ObjectResult extends BaseResult {
  object: unknown;
  text?: string;
}

interface TextResult extends BaseResult {
  text: string;
}

interface InputContextWithEnvironment {
  environment?: string;
}

// Helper function to safely extract content from different AI result types
export function extractContent(result: AIResult): {
  text: string;
  object: unknown;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  finishReason?: string;
  generationTimeMs?: number;
  reasoning?: string;
} {
  // Handle different result types
  if ('object' in result && result.object != null) {
    // GenerateObjectResult - prioritize object over text
    const objectResult = result as ObjectResult;
    return {
      text: objectResult.text || '',
      object: objectResult.object,
      usage: objectResult.usage,
      finishReason: objectResult.finishReason,
      generationTimeMs:
        objectResult.experimental_providerMetadata?.generationTimeMs,
      reasoning:
        objectResult.reasoning ||
        objectResult.experimental_providerMetadata?.reasoning,
    };
  } else if ('text' in result) {
    // GenerateTextResult
    const textResult = result as TextResult;
    return {
      text: textResult.text || '',
      object: null,
      usage: textResult.usage,
      finishReason: textResult.finishReason,
      generationTimeMs:
        textResult.experimental_providerMetadata?.generationTimeMs,
      reasoning:
        textResult.reasoning ||
        textResult.experimental_providerMetadata?.reasoning,
    };
  } else if ('textStream' in result) {
    // StreamTextResult
    return {
      text: '',
      object: null,
      usage: undefined,
      finishReason: undefined,
      generationTimeMs: undefined,
    };
  } else if ('objectStream' in result) {
    // StreamObjectResult
    return {
      text: '',
      object: null,
      usage: undefined,
      finishReason: undefined,
      generationTimeMs: undefined,
    };
  } else if ('embeddings' in result || 'then' in result) {
    // EmbedResult or Promise<EmbedResult>
    return {
      text: '',
      object: null,
      usage: undefined,
      finishReason: undefined,
      generationTimeMs: undefined,
    };
  }

  // Default fallback
  return {
    text: '',
    object: null,
    usage: undefined,
    finishReason: undefined,
    generationTimeMs: undefined,
  };
}

// ============================================================================
// OUTPUT GUARDRAILS
// ============================================================================

export const lengthLimit = (maxLength: number): OutputGuardrail =>
  createOutputGuardrail(
    'output-length-limit',
    (context: OutputGuardrailContext, accumulatedText?: string) => {
      const { text, object, usage, finishReason, generationTimeMs } =
        extractContent(context.result);
      // For streaming, use accumulatedText; otherwise use text or stringified object
      const content =
        accumulatedText || text || (object ? JSON.stringify(object) : '');

      return {
        tripwireTriggered: content.length > maxLength,
        message: `Output length ${content.length} exceeds limit of ${maxLength}`,
        severity: 'medium' as const,
        metadata: {
          contentLength: content.length,
          maxLength,
          hasObject: !!object,
          usage,
          finishReason,
          generationTimeMs,
          tokensPerMs:
            usage?.totalTokens && generationTimeMs
              ? usage.totalTokens / generationTimeMs
              : undefined,
        },
      };
    },
  );

export const blockedContent = (words: string[]): OutputGuardrail =>
  createOutputGuardrail(
    'blocked-content',
    (context: OutputGuardrailContext) => {
      const { text, object } = extractContent(context.result);
      const content = (
        text || (object ? JSON.stringify(object) : '')
      ).toLowerCase();

      const blockedWord = words.find((word) =>
        content.includes(word.toLowerCase()),
      );

      return {
        tripwireTriggered: !!blockedWord,
        message: blockedWord
          ? `Blocked content detected: ${blockedWord}`
          : undefined,
        severity: 'high' as const,
        metadata: {
          blockedWord,
          allWords: words,
          contentLength: content.length,
        },
      };
    },
  );

export const outputLengthLimit = (maxLength: number): OutputGuardrail =>
  createOutputGuardrail(
    'output-length-limit',
    (context: OutputGuardrailContext, accumulatedText?: string) => {
      const { text, object } = extractContent(context.result);
      // For streaming, use accumulatedText; otherwise use text or stringified object
      const content =
        accumulatedText || text || (object ? JSON.stringify(object) : '');

      return {
        tripwireTriggered: content.length > maxLength,
        message: `Output length ${content.length} exceeds limit of ${maxLength}`,
        severity: 'medium' as const,
        metadata: {
          contentLength: content.length,
          maxLength,
          hasObject: !!object,
        },
      };
    },
  );

export const blockedOutputContent = (words: string[]): OutputGuardrail =>
  createOutputGuardrail(
    'blocked-output-content',
    (context: OutputGuardrailContext) => {
      const { text, object } = extractContent(context.result);
      const content = (
        text || (object ? JSON.stringify(object) : '')
      ).toLowerCase();

      const blockedWord = words.find((word) =>
        content.includes(word.toLowerCase()),
      );

      return {
        tripwireTriggered: !!blockedWord,
        message: blockedWord
          ? `Blocked output content detected: ${blockedWord}`
          : undefined,
        severity: 'high' as const,
        metadata: {
          blockedWord,
          allWords: words,
          contentLength: content.length,
        },
      };
    },
  );

export const jsonValidation = (): OutputGuardrail =>
  createOutputGuardrail(
    'json-validation',
    (context: OutputGuardrailContext) => {
      const { text, object } = extractContent(context.result);

      if (object) return { tripwireTriggered: false }; // Object is already valid

      try {
        JSON.parse(text);
        return { tripwireTriggered: false };
      } catch (error) {
        return {
          tripwireTriggered: true,
          message: 'Output is not valid JSON',
          severity: 'medium' as const,
          metadata: {
            error: error instanceof Error ? error.message : String(error),
            textLength: text.length,
          },
        };
      }
    },
  );

export const confidenceThreshold = (minConfidence: number): OutputGuardrail =>
  createOutputGuardrail(
    'confidence-threshold',
    (context: OutputGuardrailContext) => {
      const { text, object, usage, finishReason, generationTimeMs, reasoning } =
        extractContent(context.result);
      const content = text || (object ? JSON.stringify(object) : '');

      const hasUncertainty =
        content.toLowerCase().includes('i think') ||
        content.toLowerCase().includes('maybe') ||
        content.toLowerCase().includes('probably') ||
        content.toLowerCase().includes('uncertain') ||
        content.toLowerCase().includes('not sure');

      // Consider finish reason for confidence
      const finishReasonPenalty = finishReason === 'length' ? 0.2 : 0;
      const baseConfidence = hasUncertainty ? 0.5 : 0.9;
      const confidence = Math.max(0, baseConfidence - finishReasonPenalty);

      return {
        tripwireTriggered: confidence < minConfidence,
        message: `Output confidence ${confidence} below threshold ${minConfidence}`,
        severity: 'medium' as const,
        metadata: {
          confidence,
          minConfidence,
          hasUncertainty,
          textLength: content.length,
          usage,
          finishReason,
          generationTimeMs,
          finishReasonPenalty,
          reasoning,
        },
      };
    },
  );

export const toxicityFilter = (threshold: number = 0.7): OutputGuardrail =>
  createOutputGuardrail(
    'toxicity-filter',
    (context: OutputGuardrailContext) => {
      const { text, object } = extractContent(context.result);
      const content = text || (object ? JSON.stringify(object) : '');

      // Simplified toxicity detection - in real implementation,
      // you'd use a proper toxicity detection API
      const toxicWords = ['toxic', 'harmful', 'offensive', 'inappropriate'];
      const detectedWords = toxicWords.filter((word) =>
        content.toLowerCase().includes(word),
      );
      const toxicityScore = detectedWords.length * 0.3;

      return {
        tripwireTriggered: toxicityScore > threshold,
        message: `Content toxicity score ${toxicityScore} exceeds threshold ${threshold}`,
        severity: 'high' as const,
        metadata: {
          toxicityScore,
          threshold,
          detectedWords,
          contentLength: content.length,
        },
      };
    },
  );

export const customValidation = (
  name: string,
  validator: (output: {
    text?: string;
    object?: unknown;
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
    finishReason?: string;
    generationTimeMs?: number;
  }) => boolean,
  message: string,
): OutputGuardrail =>
  createOutputGuardrail(name, (context: OutputGuardrailContext) => {
    const { text, object, usage, finishReason, generationTimeMs } =
      extractContent(context.result);
    const validatorInput = {
      text,
      object,
      usage,
      finishReason,
      generationTimeMs,
    };
    const blocked = validator(validatorInput);
    return {
      tripwireTriggered: blocked,
      message: blocked ? message : undefined,
      severity: 'medium' as const,
      metadata: {
        validatorName: name,
        hasText: !!text,
        hasObject: !!object,
        usage,
        finishReason,
        generationTimeMs,
      },
    };
  });

export const schemaValidation = (schema: {
  parse: (obj: unknown) => unknown;
}): OutputGuardrail =>
  createOutputGuardrail(
    'schema-validation',
    (context: OutputGuardrailContext) => {
      const { object, usage, finishReason, generationTimeMs } = extractContent(
        context.result,
      );

      if (!object) {
        return {
          tripwireTriggered: true,
          message: 'No object to validate',
          severity: 'medium' as const,
          metadata: {
            hasObject: false,
            usage,
            finishReason,
            generationTimeMs,
          },
        };
      }

      try {
        schema.parse(object);
        return {
          tripwireTriggered: false,
          metadata: {
            hasObject: true,
            validationPassed: true,
            usage,
            finishReason,
            generationTimeMs,
          },
        };
      } catch (error: unknown) {
        return {
          tripwireTriggered: true,
          message: `Schema validation failed: ${error instanceof Error ? error.message : String(error)}`,
          severity: 'high' as const,
          metadata: {
            hasObject: true,
            validationPassed: false,
            error: error instanceof Error ? error.message : String(error),
            usage,
            finishReason,
            generationTimeMs,
          },
        };
      }
    },
  );

export const tokenUsageLimit = (maxTokens: number): OutputGuardrail =>
  createOutputGuardrail(
    'token-usage-limit',
    (context: OutputGuardrailContext) => {
      const { text, object, usage, generationTimeMs } = extractContent(
        context.result,
      );
      const totalTokens = usage?.totalTokens || 0;
      const content = text || (object ? JSON.stringify(object) : '');

      return {
        tripwireTriggered: totalTokens > maxTokens,
        message: `Token usage ${totalTokens} exceeds limit of ${maxTokens}`,
        severity: 'medium' as const,
        metadata: {
          totalTokens,
          maxTokens,
          promptTokens: usage?.promptTokens,
          completionTokens: usage?.completionTokens,
          contentLength: content.length,
          generationTimeMs,
          tokensPerMs:
            totalTokens && generationTimeMs
              ? totalTokens / generationTimeMs
              : undefined,
        },
      };
    },
  );

export const performanceMonitor = (
  maxGenerationTimeMs: number,
): OutputGuardrail =>
  createOutputGuardrail(
    'performance-monitor',
    (context: OutputGuardrailContext) => {
      const { text, object, usage, generationTimeMs } = extractContent(
        context.result,
      );
      const actualGenerationTimeMs = generationTimeMs || 0;
      const content = text || (object ? JSON.stringify(object) : '');

      return {
        tripwireTriggered: actualGenerationTimeMs > maxGenerationTimeMs,
        message: `Generation time ${actualGenerationTimeMs}ms exceeds limit of ${maxGenerationTimeMs}ms`,
        severity: 'low' as const,
        metadata: {
          generationTimeMs: actualGenerationTimeMs,
          maxGenerationTimeMs,
          contentLength: content.length,
          usage,
          tokensPerMs:
            usage?.totalTokens && actualGenerationTimeMs
              ? usage.totalTokens / actualGenerationTimeMs
              : undefined,
          charactersPerMs: actualGenerationTimeMs
            ? content.length / actualGenerationTimeMs
            : undefined,
        },
      };
    },
  );

// ============================================================================
// ADVANCED QUALITY & SAFETY GUARDRAILS
// ============================================================================

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const hallucinationDetector = (
  confidenceThreshold: number = 0.7,
): OutputGuardrail =>
  createOutputGuardrail(
    'hallucination-detector',
    (context: OutputGuardrailContext, accumulatedText?: string) => {
      const { text, object, usage, finishReason, generationTimeMs } =
        extractContent(context.result);
      const content =
        accumulatedText ||
        (object && isObject(object) ? JSON.stringify(object) : text || '');

      // Simple hallucination detection based on uncertainty indicators
      const uncertaintyIndicators = [
        'i think',
        'i believe',
        'probably',
        'likely',
        'might be',
        'could be',
        'not sure',
        'uncertain',
        'possibly',
        'perhaps',
        'maybe',
        'seems like',
        'appears to be',
        'my understanding is',
        'if i recall correctly',
      ];

      const factualClaims = [
        'according to',
        'studies show',
        'research indicates',
        'data suggests',
        'statistics show',
        'proven fact',
        'scientific evidence',
        'documented',
        'confirmed by',
        'established that',
      ];

      const uncertaintyCount = uncertaintyIndicators.filter((indicator) =>
        content.toLowerCase().includes(indicator),
      ).length;

      const factualClaimCount = factualClaims.filter((claim) =>
        content.toLowerCase().includes(claim),
      ).length;

      // Higher uncertainty with factual claims suggests potential hallucination
      const hallucinationScore =
        uncertaintyCount * 0.3 + factualClaimCount * 0.2;
      const isHallucination = hallucinationScore > confidenceThreshold;

      return {
        tripwireTriggered: isHallucination,
        message: isHallucination
          ? `Potential hallucination detected (score: ${hallucinationScore})`
          : undefined,
        severity: hallucinationScore > 0.8 ? 'high' : 'medium',
        metadata: {
          hallucinationScore,
          confidenceThreshold,
          uncertaintyCount,
          factualClaimCount,
          contentLength: content.length,
          usage,
          finishReason,
          generationTimeMs,
        },
        suggestion:
          'Please verify factual claims and consider requesting sources',
      };
    },
  );

export const biasDetector = (): OutputGuardrail =>
  createOutputGuardrail('bias-detector', (context: OutputGuardrailContext) => {
    const { text, object } = extractContent(context.result);
    const content = text || (object ? JSON.stringify(object) : '');
    const lowerContent = content.toLowerCase();

    // Simple bias detection patterns
    const biasPatterns = {
      gender: [
        'men are better at',
        'women are better at',
        'typical male',
        'typical female',
        'boys will be boys',
        'women should',
        'men should',
        'ladies',
        'gentlemen',
      ],
      racial: [
        'people of that race',
        'those people',
        'their culture',
        'natural talent',
        'genetic predisposition',
        'inherent ability',
        'cultural background',
      ],
      age: [
        'young people today',
        "older people can't",
        'millennials are',
        'boomers are',
        'too old to',
        'too young to',
      ],
      socioeconomic: [
        'poor people are',
        'rich people are',
        'welfare recipients',
        'privileged class',
        'working class',
        'upper class',
      ],
    };

    const detectedBias = [];
    const matches = [];

    for (const [category, patterns] of Object.entries(biasPatterns)) {
      const found = patterns.filter((pattern) =>
        lowerContent.includes(pattern),
      );
      if (found.length > 0) {
        detectedBias.push(category);
        matches.push(...found);
      }
    }

    return {
      tripwireTriggered: detectedBias.length > 0,
      message:
        detectedBias.length > 0
          ? `Potential bias detected in categories: ${detectedBias.join(', ')}`
          : undefined,
      severity: 'medium' as const,
      metadata: {
        biasCategories: detectedBias,
        biasPatterns: matches,
        contentLength: content.length,
      },
      suggestion:
        'Consider reviewing content for potential bias and using more inclusive language',
    };
  });

export const factualAccuracyChecker = (
  requireSources: boolean = false,
): OutputGuardrail =>
  createOutputGuardrail(
    'factual-accuracy-checker',
    (context: OutputGuardrailContext) => {
      const { text, object, generationTimeMs } = extractContent(context.result);
      const content = text || (object ? JSON.stringify(object) : '');

      // Detect factual claims without sources
      const factualClaims = [
        'according to',
        'studies show',
        'research indicates',
        'data suggests',
        'statistics show',
        'proven fact',
        'scientific evidence',
        'documented',
        'confirmed by',
        'established that',
        'published in',
        'survey found',
      ];

      const sourceCitations = [
        'source:',
        'reference:',
        'citation:',
        'published in',
        'journal of',
        'university of',
        'institute of',
        'doi:',
        'isbn:',
        'url:',
        'http',
      ];

      const factualClaimCount = factualClaims.filter((claim) =>
        content.toLowerCase().includes(claim),
      ).length;

      const sourceCitationCount = sourceCitations.filter((source) =>
        content.toLowerCase().includes(source),
      ).length;

      const hasUnfoundedClaims =
        requireSources && factualClaimCount > 0 && sourceCitationCount === 0;

      return {
        tripwireTriggered: hasUnfoundedClaims,
        message: hasUnfoundedClaims
          ? `Factual claims detected without sources (${factualClaimCount} claims, ${sourceCitationCount} sources)`
          : undefined,
        severity: 'medium' as const,
        metadata: {
          factualClaimCount,
          sourceCitationCount,
          requireSources,
          contentLength: content.length,
          generationTimeMs,
        },
        suggestion:
          'Please provide sources for factual claims or clarify that claims are general knowledge',
      };
    },
  );

export const privacyLeakageDetector = (): OutputGuardrail =>
  createOutputGuardrail(
    'privacy-leakage-detector',
    (context: OutputGuardrailContext) => {
      const { text, object } = extractContent(context.result);
      const content = text || (object ? JSON.stringify(object) : '');

      // Detect potential privacy leakage patterns
      const privacyPatterns = {
        personal:
          /\b(john|jane|smith|doe|password|secret|private|confidential)\b/gi,
        contact: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
        phone: /\b\d{3}-\d{3}-\d{4}\b/g,
        financial:
          /\b(credit card|ssn|social security|bank account|routing number)\b/gi,
        location: /\b(address|street|apartment|zip code|postal code)\b/gi,
      };

      const detectedLeakage = [];
      const matches = [];

      for (const [category, pattern] of Object.entries(privacyPatterns)) {
        const found = content.match(pattern);
        if (found) {
          detectedLeakage.push(category);
          matches.push(...found);
        }
      }

      return {
        tripwireTriggered: detectedLeakage.length > 0,
        message:
          detectedLeakage.length > 0
            ? `Potential privacy leakage detected: ${detectedLeakage.join(', ')}`
            : undefined,
        severity: 'critical' as const,
        metadata: {
          leakageCategories: detectedLeakage,
          matchCount: matches.length,
          contentLength: content.length,
        },
        suggestion:
          'Review output for any personal or sensitive information that should be removed',
      };
    },
  );

export const contentConsistencyChecker = (
  referenceContent?: string,
): OutputGuardrail =>
  createOutputGuardrail(
    'content-consistency-checker',
    (context: OutputGuardrailContext) => {
      const { text, object } = extractContent(context.result);
      const content = text || (object ? JSON.stringify(object) : '');

      if (!referenceContent) {
        return { tripwireTriggered: false };
      }

      // Simple consistency check - in production, use semantic similarity
      const contentWords = content.toLowerCase().split(/\s+/);
      const referenceWords = referenceContent.toLowerCase().split(/\s+/);

      const commonWords = contentWords.filter((word: string) =>
        referenceWords.includes(word),
      );
      const consistencyScore =
        commonWords.length /
        Math.max(contentWords.length, referenceWords.length);

      const isInconsistent = consistencyScore < 0.3;

      return {
        tripwireTriggered: isInconsistent,
        message: isInconsistent
          ? `Content consistency score too low: ${consistencyScore.toFixed(2)}`
          : undefined,
        severity: 'medium' as const,
        metadata: {
          consistencyScore,
          contentLength: content.length,
          referenceLength: referenceContent.length,
          commonWordCount: commonWords.length,
        },
        suggestion:
          'Ensure output maintains consistency with reference content',
      };
    },
  );

export const complianceChecker = (
  regulations: string[] = [],
): OutputGuardrail =>
  createOutputGuardrail(
    'compliance-checker',
    (context: OutputGuardrailContext) => {
      const { text, object } = extractContent(context.result);
      const content = text || (object ? JSON.stringify(object) : '');

      // Check for regulatory compliance patterns
      const compliancePatterns = {
        gdpr: ['personal data', 'data processing', 'consent', 'data subject'],
        hipaa: ['patient', 'medical', 'health information', 'protected health'],
        pci: ['credit card', 'payment', 'cardholder', 'card number'],
        sox: ['financial', 'audit', 'internal controls', 'financial reporting'],
        coppa: ['children', 'under 13', 'parental consent', 'minor'],
      };

      const violations = [];

      for (const regulation of regulations) {
        const patterns =
          compliancePatterns[
            regulation.toLowerCase() as keyof typeof compliancePatterns
          ];
        if (patterns) {
          const found = patterns.some((pattern) =>
            content.toLowerCase().includes(pattern),
          );
          if (found) {
            violations.push(regulation.toUpperCase());
          }
        }
      }

      return {
        tripwireTriggered: violations.length > 0,
        message:
          violations.length > 0
            ? `Potential compliance violations detected: ${violations.join(', ')}`
            : undefined,
        severity: 'high' as const,
        metadata: {
          violations,
          regulations,
          contentLength: content.length,
          environment: (context.input as InputContextWithEnvironment)
            ?.environment,
        },
        suggestion: 'Review output for compliance with applicable regulations',
      };
    },
  );
