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
    reasoningText?: string;
  };
  reasoningText?: string;
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

type UsageRecord = Record<string, unknown> | undefined;

interface ContentExtraction {
  text: string;
  object: unknown;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  finishReason?: string;
  generationTimeMs?: number;
  reasoningText?: string;
}

const EMPTY_CONTENT: ContentExtraction = {
  text: '',
  object: null,
  usage: undefined,
  finishReason: undefined,
  generationTimeMs: undefined,
  reasoningText: undefined,
};

function emptyContent(): ContentExtraction {
  return { ...EMPTY_CONTENT };
}

function mapUsage(
  usage: UsageRecord,
):
  | { promptTokens?: number; completionTokens?: number; totalTokens?: number }
  | undefined {
  if (!usage) {
    return undefined;
  }

  const pickNumber = (keys: string[]): number | undefined => {
    for (const key of keys) {
      const value = usage[key];
      if (typeof value === 'number') {
        return value;
      }
    }
    return undefined;
  };

  const totalTokens = pickNumber(['totalTokens']);
  const promptTokens = pickNumber(['inputTokens', 'promptTokens']);
  const completionTokens = pickNumber(['outputTokens', 'completionTokens']);

  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

function extractGenerationTime(result: BaseResult) {
  return result.experimental_providerMetadata?.generationTimeMs;
}

function extractReasoningText(result: BaseResult) {
  return (
    result.reasoningText ||
    result.experimental_providerMetadata?.reasoningText ||
    undefined
  );
}

function createContent(partial: Partial<ContentExtraction>): ContentExtraction {
  return {
    ...EMPTY_CONTENT,
    ...partial,
  };
}

// Helper function to safely extract content from different AI result types
export function extractContent(result: AIResult): ContentExtraction {
  if (
    'content' in result &&
    Array.isArray((result as { content?: unknown[] }).content)
  ) {
    const typedResult = result as BaseResult & {
      content: Array<{ type: string; text?: string }>;
      usage?: UsageRecord;
    };
    const textContent = typedResult.content
      .filter((item) => item.type === 'text' && item.text)
      .map((item) => item.text as string)
      .join('');

    return createContent({
      text: textContent || '',
      object: null,
      usage: mapUsage(typedResult.usage),
      finishReason: typedResult.finishReason,
      generationTimeMs: extractGenerationTime(typedResult),
      reasoningText: extractReasoningText(typedResult),
    });
  }

  if ('object' in result && result.object !== null) {
    const objectResult = result as ObjectResult;
    return createContent({
      text: objectResult.text || '',
      object: objectResult.object,
      usage: mapUsage(objectResult.usage as UsageRecord),
      finishReason: objectResult.finishReason,
      generationTimeMs: extractGenerationTime(objectResult),
      reasoningText: extractReasoningText(objectResult),
    });
  }

  if ('text' in result && typeof result.text === 'string') {
    const textResult = result as TextResult;
    return createContent({
      text: textResult.text || '',
      object: null,
      usage: mapUsage(textResult.usage as UsageRecord),
      finishReason: textResult.finishReason,
      generationTimeMs: extractGenerationTime(textResult),
      reasoningText: extractReasoningText(textResult),
    });
  }

  if (
    'textStream' in result ||
    'objectStream' in result ||
    'embeddings' in result ||
    'then' in result
  ) {
    return emptyContent();
  }

  return emptyContent();
}

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

export const minLengthRequirement = (minLength: number): OutputGuardrail =>
  createOutputGuardrail(
    'output-min-length',
    (context: OutputGuardrailContext, accumulatedText?: string) => {
      const { text, object } = extractContent(context.result);
      const content =
        accumulatedText || text || (object ? JSON.stringify(object) : '');

      if (content.length < minLength) {
        return {
          tripwireTriggered: true,
          message: `Output too short: ${content.length} characters (min: ${minLength})`,
          severity: 'medium' as const,
          metadata: {
            currentLength: content.length,
            minLength,
            deficit: minLength - content.length,
            hasObject: !!object,
          },
        };
      }

      return { tripwireTriggered: false };
    },
  );

export const sensitiveDataFilter = (): OutputGuardrail =>
  createOutputGuardrail(
    'sensitive-data-filter',
    (context: OutputGuardrailContext, accumulatedText?: string) => {
      const { text, object } = extractContent(context.result);
      const content =
        accumulatedText || text || (object ? JSON.stringify(object) : '');

      const sensitivePatterns = [
        {
          name: 'SSN',
          regex: /\b\d{3}-\d{2}-\d{4}\b/,
          severity: 'high' as const,
        },
        {
          name: 'API Key',
          regex:
            /(?:api[_-]?key|apikey|api_token)[\s:=]*['"]*([a-zA-Z0-9]{32,})/i,
          severity: 'critical' as const,
        },
        {
          name: 'Credit Card',
          regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/,
          severity: 'high' as const,
        },
        {
          name: 'Email',
          regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
          severity: 'medium' as const,
        },
        {
          name: 'Phone',
          regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,
          severity: 'medium' as const,
        },
        {
          name: 'AWS Access Key',
          regex: /AKIA[0-9A-Z]{16}/,
          severity: 'critical' as const,
        },
        {
          name: 'Private Key',
          regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
          severity: 'critical' as const,
        },
      ];

      const detected = sensitivePatterns.filter((p) => p.regex.test(content));
      if (detected.length > 0) {
        const severityOrder = { low: 1, medium: 2, high: 3, critical: 4 };
        let highestSeverity = detected[0]?.severity || 'medium';
        for (const pattern of detected) {
          if (
            severityOrder[pattern.severity] > severityOrder[highestSeverity]
          ) {
            highestSeverity = pattern.severity;
          }
        }

        return {
          tripwireTriggered: true,
          message: `Sensitive data detected: ${detected.map((p) => p.name).join(', ')}`,
          severity: highestSeverity,
          metadata: {
            detectedTypes: detected.map((p) => ({
              type: p.name,
              severity: p.severity,
            })),
            count: detected.length,
            contentLength: content.length,
          },
        };
      }

      return { tripwireTriggered: false };
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

      if (object) {
        return { tripwireTriggered: false };
      } // Object is already valid

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
      const {
        text,
        object,
        usage,
        finishReason,
        generationTimeMs,
        reasoningText,
      } = extractContent(context.result);
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
          reasoningText,
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

type CustomOutputValidationInput = {
  text?: string;
  object?: unknown;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  finishReason?: string;
  generationTimeMs?: number;
};

type CustomOutputValidationFn = (
  payload: CustomOutputValidationInput,
) => boolean;

export const customValidation = (
  name: string,
  validator: CustomOutputValidationFn,
  message: string,
): OutputGuardrail => {
  return createOutputGuardrail(name, (context: OutputGuardrailContext) => {
    const { text, object, usage, finishReason, generationTimeMs } =
      extractContent(context.result);
    const validatorInput: CustomOutputValidationInput = {
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
};

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
          inputTokens:
            (usage as { inputTokens?: number })?.inputTokens ||
            (usage as { promptTokens?: number })?.promptTokens,
          outputTokens:
            (usage as { outputTokens?: number })?.outputTokens ||
            (usage as { completionTokens?: number })?.completionTokens,
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

/**
 * Secret redaction guardrail that detects and blocks output containing sensitive information
 * like API keys, access tokens, AWS ARNs, JWTs, and PEM certificates
 */
export const secretRedaction = createOutputGuardrail(
  'secret-redaction',
  (context: OutputGuardrailContext) => {
    const { text, object } = extractContent(context.result);
    const content = text || (object ? JSON.stringify(object) : '');

    // Define patterns for common secret formats
    const secretPatterns = [
      // API Keys (various formats)
      {
        name: 'API Key',
        pattern:
          /(?:api[_-]?key|apikey|access[_-]?key)\s*[:=]\s*['"]?([a-zA-Z0-9]{20,})['"]?/gi,
      },
      {
        name: 'Generic API Key',
        pattern: /\b[a-zA-Z0-9]{32,}\b/g, // Generic long alphanumeric strings
      },
      // AWS Access Keys
      {
        name: 'AWS Access Key',
        pattern: /AKIA[0-9A-Z]{16}/g,
      },
      // AWS Secret Keys
      {
        name: 'AWS Secret Key',
        pattern: /[A-Za-z0-9/+=]{40}/g,
      },
      // AWS ARNs
      {
        name: 'AWS ARN',
        pattern:
          /arn:aws:[a-zA-Z0-9-]+:[a-zA-Z0-9-]*:[0-9]*:[a-zA-Z0-9-_/.:*]+/g,
      },
      // JWT Tokens
      {
        name: 'JWT Token',
        pattern: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
      },
      // Bearer Tokens
      {
        name: 'Bearer Token',
        pattern: /Bearer\s+[a-zA-Z0-9_.-]+/gi,
      },
      // GitHub Personal Access Tokens
      {
        name: 'GitHub Token',
        pattern: /ghp_[a-zA-Z0-9]{36}/g,
      },
      // Google API Keys
      {
        name: 'Google API Key',
        pattern: /AIza[0-9A-Za-z_-]{35}/g,
      },
      // PEM Certificate/Key blocks
      {
        name: 'PEM Certificate/Key',
        pattern: /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g,
      },
      // SSH Private Keys
      {
        name: 'SSH Private Key',
        pattern:
          /-----BEGIN (RSA|DSA|EC|OPENSSH) PRIVATE KEY-----[\s\S]*?-----END (RSA|DSA|EC|OPENSSH) PRIVATE KEY-----/g,
      },
      // Database Connection Strings
      {
        name: 'Database Connection String',
        pattern:
          /(?:mongodb|postgres|mysql|redis):\/\/[^@\s]+:[^@\s]+@[^/\s]+/gi,
      },
      // Generic tokens/secrets in environment variable format
      {
        name: 'Environment Secret',
        pattern:
          /(?:token|secret|password|key)\s*[:=]\s*['"]?([a-zA-Z0-9_.-]{16,})['"]?/gi,
      },
    ];

    const detectedSecrets: Array<{
      type: string;
      pattern: string;
      position: number;
    }> = [];

    // Check for each pattern
    for (const { name, pattern } of secretPatterns) {
      let match;
      const regex = new RegExp(pattern);
      while ((match = regex.exec(content)) !== null) {
        detectedSecrets.push({
          type: name,
          pattern: match[0].slice(0, 20) + '...',
          position: match.index,
        });
      }
    }

    if (detectedSecrets.length > 0) {
      return {
        tripwireTriggered: true,
        message: `Output contains ${detectedSecrets.length} potential secret(s): ${detectedSecrets.map((s) => s.type).join(', ')}`,
        severity: 'critical' as const,
        metadata: {
          secretsDetected: detectedSecrets.length,
          secretTypes: detectedSecrets.map((s) => s.type),
          contentLength: content.length,
        },
        suggestion: 'Remove sensitive information before sharing output',
      };
    }

    return { tripwireTriggered: false };
  },
);

/**
 * Enhanced unsafe content detector that flags potentially harmful, inappropriate, or prohibited content
 */
export const unsafeContentDetector = createOutputGuardrail(
  'unsafe-content-detector',
  (context: OutputGuardrailContext) => {
    const { text, object } = extractContent(context.result);
    const content = text || (object ? JSON.stringify(object) : '');

    // Define categories of unsafe content
    const unsafePatterns = [
      {
        category: 'Violence',
        patterns: [
          /\b(kill|murder|assassinate|torture|bomb|weapon|gun|knife|explosive)\b/gi,
          /\b(harm|hurt|injure|attack|assault|fight)\s+(someone|people|person)/gi,
          /\b(violence|violent|aggression|aggressive)\b/gi,
        ],
      },
      {
        category: 'Hate Speech',
        patterns: [
          /\b(hate|racist|sexist|homophobic|transphobic|xenophobic)\b/gi,
          /\b(nazi|fascist|supremacist|terrorism|terrorist)\b/gi,
          /\b(discrimination|prejudice|bigotry)\b/gi,
        ],
      },
      {
        category: 'Self-Harm',
        patterns: [
          /\b(suicide|self-harm|self-hurt|cut myself|end my life)\b/gi,
          /\b(want to die|kill myself|harm myself)\b/gi,
          /\b(suicidal|depression|self-destruction)\b/gi,
        ],
      },
      {
        category: 'Illegal Activities',
        patterns: [
          /\b(illegal drugs|drug dealing|money laundering|fraud|scam)\b/gi,
          /\b(hack|crack|pirate|steal|burglary|theft)\b/gi,
          /\b(counterfeit|forgery|blackmail|extortion)\b/gi,
        ],
      },
      {
        category: 'Adult Content',
        patterns: [
          /\b(pornography|explicit sexual|adult content|nsfw)\b/gi,
          /\b(sexual explicit|graphic sexual|sexual imagery)\b/gi,
        ],
      },
      {
        category: 'Personal Information',
        patterns: [
          /\b\d{3}-\d{2}-\d{4}\b/g, // SSN format
          /\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/g, // Credit card format
          /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email
        ],
      },
    ];

    const detectedIssues: Array<{ category: string; matches: number }> = [];

    for (const { category, patterns } of unsafePatterns) {
      let totalMatches = 0;
      for (const pattern of patterns) {
        const matches = content.match(pattern);
        if (matches) {
          totalMatches += matches.length;
        }
      }
      if (totalMatches > 0) {
        detectedIssues.push({ category, matches: totalMatches });
      }
    }

    if (detectedIssues.length > 0) {
      return {
        tripwireTriggered: true,
        message: `Unsafe content detected: ${detectedIssues.map((i) => `${i.category} (${i.matches})`).join(', ')}`,
        severity: 'high' as const,
        metadata: {
          categoriesDetected: detectedIssues.length,
          issues: detectedIssues,
          contentLength: content.length,
        },
        suggestion:
          'Review and modify content to remove potentially harmful material',
      };
    }

    return { tripwireTriggered: false };
  },
);

/**
 * Cost and quota rails guardrail to monitor token usage and costs
 */
export const costQuotaRails = (options: {
  maxTokensPerRequest?: number;
  maxCostPerRequest?: number; // in dollars
  tokenCostPer1K?: number; // cost per 1000 tokens
}): OutputGuardrail =>
  createOutputGuardrail(
    'cost-quota-rails',
    (context: OutputGuardrailContext) => {
      const { text, object, usage } = extractContent(context.result);
      const content = text || (object ? JSON.stringify(object) : '');

      const totalTokens = usage?.totalTokens || 0;
      const estimatedCost = options.tokenCostPer1K
        ? (totalTokens / 1000) * options.tokenCostPer1K
        : 0;

      const issues = [];

      if (
        options.maxTokensPerRequest &&
        totalTokens > options.maxTokensPerRequest
      ) {
        issues.push(
          `Token usage (${totalTokens}) exceeds limit (${options.maxTokensPerRequest})`,
        );
      }

      if (
        options.maxCostPerRequest &&
        estimatedCost > options.maxCostPerRequest
      ) {
        issues.push(
          `Estimated cost ($${estimatedCost.toFixed(4)}) exceeds limit ($${options.maxCostPerRequest})`,
        );
      }

      if (issues.length > 0) {
        return {
          tripwireTriggered: true,
          message: `Cost/quota limits exceeded: ${issues.join(', ')}`,
          severity: 'high' as const,
          metadata: {
            totalTokens,
            estimatedCost,
            maxTokensPerRequest: options.maxTokensPerRequest,
            maxCostPerRequest: options.maxCostPerRequest,
            tokenCostPer1K: options.tokenCostPer1K,
            contentLength: content.length,
          },
          suggestion:
            'Consider reducing request size or adjusting quota limits',
        };
      }

      return { tripwireTriggered: false };
    },
  );

/**
 * Enhanced hallucination/grounding checker with schema constraints and citation validation
 */
export const enhancedHallucinationDetector = (options: {
  requireCitations?: boolean;
  citationFormats?: string[]; // e.g., ['[1]', '(Source:', 'doi:']
  factCheckPatterns?: string[]; // patterns to identify factual claims
  confidenceThreshold?: number; // 0-1, lower is stricter
  schemaConstraints?: {
    requiredFields?: string[];
    allowedValues?: { [field: string]: string[] };
  };
}): OutputGuardrail =>
  createOutputGuardrail(
    'enhanced-hallucination-detector',
    (context: OutputGuardrailContext) => {
      const { text, object } = extractContent(context.result);
      const content = text || (object ? JSON.stringify(object) : '');

      const {
        requireCitations = false,
        citationFormats = ['[', '(', 'doi:', 'url:', 'source:', 'ref:'],
        factCheckPatterns = [
          'according to',
          'studies show',
          'research indicates',
          'data suggests',
          'statistics show',
          'proven fact',
          'scientific evidence',
          'documented',
          'confirmed by',
          'published in',
        ],
        confidenceThreshold = 0.7,
        schemaConstraints,
      } = options;

      const issues: string[] = [];
      let hallucinationScore = 0;

      // Check for factual claims
      const factualClaims = factCheckPatterns.filter((pattern) =>
        content.toLowerCase().includes(pattern.toLowerCase()),
      );

      // Check for citations if required
      const citations = citationFormats.filter((format) =>
        content.toLowerCase().includes(format.toLowerCase()),
      );

      if (
        requireCitations &&
        factualClaims.length > 0 &&
        citations.length === 0
      ) {
        issues.push(
          `${factualClaims.length} factual claims detected without citations`,
        );
        hallucinationScore += 0.4;
      }

      // Check uncertainty indicators
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
        'if i recall correctly',
      ];

      const uncertaintyCount = uncertaintyIndicators.filter((indicator) =>
        content.toLowerCase().includes(indicator),
      ).length;

      if (uncertaintyCount > 0 && factualClaims.length > 0) {
        issues.push(`Uncertainty expressions combined with factual claims`);
        hallucinationScore += uncertaintyCount * 0.1;
      }

      // Check schema constraints for structured output
      if (schemaConstraints && object) {
        const obj = object as Record<string, unknown>;

        // Check required fields
        if (schemaConstraints.requiredFields) {
          const missingFields = schemaConstraints.requiredFields.filter(
            (field) =>
              !(field in obj) ||
              obj[field] === null ||
              obj[field] === undefined,
          );
          if (missingFields.length > 0) {
            issues.push(`Missing required fields: ${missingFields.join(', ')}`);
            hallucinationScore += 0.3;
          }
        }

        // Check allowed values
        if (schemaConstraints.allowedValues) {
          for (const [field, allowedValues] of Object.entries(
            schemaConstraints.allowedValues,
          )) {
            if (field in obj && !allowedValues.includes(String(obj[field]))) {
              issues.push(`Invalid value for field '${field}': ${obj[field]}`);
              hallucinationScore += 0.2;
            }
          }
        }
      }

      // Check for contradictory statements
      const contradictionPatterns = [
        ['always', 'never'],
        ['all', 'none'],
        ['definitely', 'maybe'],
        ['certain', 'uncertain'],
        ['true', 'false'],
      ];

      for (const [pos, neg] of contradictionPatterns) {
        if (
          pos &&
          neg &&
          content.toLowerCase().includes(pos) &&
          content.toLowerCase().includes(neg)
        ) {
          issues.push(`Potential contradiction detected: ${pos}/${neg}`);
          hallucinationScore += 0.15;
        }
      }

      const isHallucination = hallucinationScore > confidenceThreshold;

      if (isHallucination || issues.length > 0) {
        return {
          tripwireTriggered: isHallucination,
          message: `Potential hallucination detected (score: ${hallucinationScore.toFixed(2)}): ${issues.join('; ')}`,
          severity: hallucinationScore > 0.8 ? 'high' : 'medium',
          metadata: {
            hallucinationScore,
            confidenceThreshold,
            issues,
            factualClaimsCount: factualClaims.length,
            citationsCount: citations.length,
            uncertaintyCount,
            contentLength: content.length,
            requireCitations,
          },
          suggestion:
            'Verify factual claims with reliable sources and add citations if making specific claims',
        };
      }

      return { tripwireTriggered: false };
    },
  );

/**
 * Retry-After integration guardrail that handles provider rate limiting and backoff
 */
export const retryAfterIntegration = (options: {
  maxRetryDelayMs?: number;
  defaultBackoffMs?: number;
  jitterFactor?: number; // 0-1, adds randomness to backoff
  trackRateLimits?: boolean;
}): OutputGuardrail =>
  createOutputGuardrail(
    'retry-after-integration',
    (context: OutputGuardrailContext) => {
      const { usage, generationTimeMs } = extractContent(context.result);

      const {
        maxRetryDelayMs = 60_000, // 1 minute max
        defaultBackoffMs = 1000, // 1 second default
        jitterFactor = 0.1,
        trackRateLimits = true,
      } = options;

      // Check for rate limiting indicators in the result
      // Note: In a real implementation, you'd access response headers directly
      const rateLimitIndicators = {
        hasRetryAfter: false,
        retryAfterMs: 0,
        rateLimitExceeded: false,
        requestsRemaining: null as number | null,
        resetTime: null as Date | null,
      };

      // Simulate checking for rate limit headers (in real usage, these would come from provider response)
      // const headers = context.result.response?.headers;
      // if (headers && 'retry-after' in headers) {
      //   rateLimitIndicators.hasRetryAfter = true;
      //   rateLimitIndicators.retryAfterMs = parseInt(headers['retry-after']) * 1000;
      // }

      // Check for high generation time as potential rate limiting indicator
      if (generationTimeMs && generationTimeMs > 5000) {
        rateLimitIndicators.rateLimitExceeded = true;
      }

      // Check usage patterns for potential rate limiting
      const totalTokens = usage?.totalTokens || 0;
      if (totalTokens > 10_000) {
        // High token usage might indicate approaching limits
        rateLimitIndicators.rateLimitExceeded = true;
      }

      let recommendedBackoffMs = defaultBackoffMs;

      if (rateLimitIndicators.hasRetryAfter) {
        recommendedBackoffMs = Math.min(
          rateLimitIndicators.retryAfterMs,
          maxRetryDelayMs,
        );
      } else if (rateLimitIndicators.rateLimitExceeded) {
        // Exponential backoff with jitter
        recommendedBackoffMs = Math.min(
          defaultBackoffMs * 2 +
            Math.random() * jitterFactor * defaultBackoffMs,
          maxRetryDelayMs,
        );
      }

      // Add jitter to prevent thundering herd
      const jitter = Math.random() * jitterFactor * recommendedBackoffMs;
      const finalBackoffMs = Math.round(recommendedBackoffMs + jitter);

      if (
        rateLimitIndicators.hasRetryAfter ||
        rateLimitIndicators.rateLimitExceeded
      ) {
        return {
          tripwireTriggered: true,
          message: `Rate limiting detected, recommended backoff: ${finalBackoffMs}ms`,
          severity: 'medium' as const,
          metadata: {
            ...rateLimitIndicators,
            recommendedBackoffMs: finalBackoffMs,
            originalBackoffMs: recommendedBackoffMs,
            jitterMs: jitter,
            maxRetryDelayMs,
            totalTokens,
            generationTimeMs,
            trackRateLimits,
          },
          suggestion: `Wait ${finalBackoffMs}ms before making the next request to respect rate limits`,
        };
      }

      return {
        tripwireTriggered: false,
        metadata: {
          backoffCalculated: finalBackoffMs,
          rateLimitTracking: trackRateLimits,
          generationTimeMs,
          totalTokens,
        },
      };
    },
  );
