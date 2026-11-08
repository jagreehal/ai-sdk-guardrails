import type { JSONValue } from '@ai-sdk/provider';
import type { LanguageModelUsage } from 'ai';
import { z } from 'zod';
import { createOutputGuardrail } from '../core';
import { assessToxicity } from './toxicity-signals';
import type {
  OutputGuardrail,
  AIResult,
  OutputGuardrailContext,
} from '../types';

import { isObjectLike } from './internal';

/** Members guardrails read from an AI SDK result. All optional; each is checked before use. */
interface ResultFields {
  content?: Array<{ type: string; text?: string }>;
  output?: unknown;
  object?: unknown;
  text?: string;
  usage?: LanguageModelUsage;
  finishReason?: string;
  reasoningText?: string;
  experimental_providerMetadata?: {
    generationTimeMs?: number;
    reasoningText?: string;
  };
  providerMetadata?: {
    generationTimeMs?: number;
  };
}

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

/**
 * A token count is either a number or, in the provider (V3) usage format, an
 * object carrying it in `total`.
 */
const tokenCount = z.union([
  z.number(),
  z.object({ total: z.number() }).transform(({ total }) => total),
]);

function pickTokenCount<U extends Record<string, unknown>>(
  usage: U,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const count = tokenCount.safeParse(usage[key]);

    if (count.success) {
      return count.data;
    }
  }

  return undefined;
}

interface UsageKeys {
  total: string[];
  prompt: string[];
  completion: string[];
}

/** Reads token counts under the given key aliases; computes the total when only parts are present. */
function readUsage<U extends Record<string, unknown>>(
  usage: U | undefined,
  keys: UsageKeys,
): NormalizedUsage | undefined {
  if (!usage) {
    return undefined;
  }

  const totalTokens = pickTokenCount(usage, keys.total);
  const promptTokens = pickTokenCount(usage, keys.prompt);
  const completionTokens = pickTokenCount(usage, keys.completion);

  const computedTotal =
    totalTokens ??
    (promptTokens === undefined || completionTokens === undefined
      ? undefined
      : promptTokens + completionTokens);

  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    computedTotal === undefined
  ) {
    return undefined;
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens: computedTotal,
  };
}

const RESULT_USAGE_KEYS: UsageKeys = {
  total: ['totalTokens'],
  prompt: ['inputTokens', 'promptTokens'],
  completion: ['outputTokens', 'completionTokens'],
};

const PROVIDER_USAGE_KEYS: UsageKeys = {
  total: ['totalTokens', 'total_tokens'],
  prompt: ['inputTokens', 'promptTokens', 'input_tokens', 'prompt_tokens'],
  completion: [
    'outputTokens',
    'completionTokens',
    'output_tokens',
    'completion_tokens',
  ],
};

function extractGenerationTime(result: ResultFields) {
  return (
    result.experimental_providerMetadata?.generationTimeMs ??
    result.providerMetadata?.generationTimeMs ??
    0
  );
}

function extractReasoningText(result: ResultFields) {
  return (
    result.reasoningText ||
    result.experimental_providerMetadata?.reasoningText ||
    undefined
  );
}

function resultContent(
  fields: ResultFields,
  partial: Pick<ContentExtraction, 'text' | 'object'>,
): ContentExtraction {
  return {
    ...EMPTY_CONTENT,
    ...partial,
    usage: readUsage(fields.usage, RESULT_USAGE_KEYS),
    finishReason: fields.finishReason,
    generationTimeMs: extractGenerationTime(fields),
    reasoningText: extractReasoningText(fields),
  };
}

const resultText = z.string();

/** Extracts text, structured output, usage and timing from any AI SDK result shape. */
export function extractContent(result: AIResult): ContentExtraction {
  // SAFETY: ResultFields only lists optional members, and each one is checked
  // for presence (or parsed) below before its value is used.
  const fields = result as ResultFields;
  const { content } = fields;

  if (Array.isArray(content) && content.length > 0) {
    const textContent = content
      .flatMap((item) => (item.type === 'text' && item.text ? [item.text] : []))
      .join('');

    // AI SDK Output.object() results carry both `content` and `output`.
    return resultContent(fields, {
      text: textContent || '',
      object: fields.output ?? fields.object ?? null,
    });
  }

  // Output.object() results carry the serialized text and the parsed `output`;
  // the parsed value wins.
  if (fields.output !== null && fields.output !== undefined) {
    return resultContent(fields, {
      text: fields.text || '',
      object: fields.output,
    });
  }

  if (fields.object !== null && fields.object !== undefined) {
    return resultContent(fields, {
      text: fields.text || '',
      object: fields.object,
    });
  }

  const text = resultText.safeParse(fields.text);

  if (text.success) {
    return resultContent(fields, { text: text.data || '', object: null });
  }

  return { ...EMPTY_CONTENT };
}

/** The text guardrails check: accumulated stream text, else `text`, else the JSON-serialized object. */
export function stringifyContent<T>(
  text?: string,
  object?: T,
  accumulatedText?: string,
): string {
  if (accumulatedText !== undefined) {
    return accumulatedText;
  }

  if (text !== undefined && text !== null && text.length > 0) {
    return text;
  }

  if (object !== null && object !== undefined) {
    return JSON.stringify(object);
  }

  return '';
}

/** Token usage in the unified prompt/completion/total form. */
export type NormalizedUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

/** Normalizes usage from any provider: camelCase, snake_case, and V3 `{ total }` objects. */
export function normalizeUsage<U extends Record<string, unknown>>(
  usage: U | undefined,
): NormalizedUsage | undefined {
  return readUsage(usage, PROVIDER_USAGE_KEYS);
}

export const outputLengthLimit = (maxLength: number): OutputGuardrail =>
  createOutputGuardrail(
    'output-length-limit',
    (context: OutputGuardrailContext, accumulatedText?: string) => {
      const { text, object, usage, finishReason, generationTimeMs } =
        extractContent(context.result);

      const content = stringifyContent(text, object, accumulatedText);
      const normalizedUsage = normalizeUsage(usage);

      return {
        tripwireTriggered: content.length > maxLength,
        message: `Output length ${content.length} exceeds limit of ${maxLength}`,
        severity: 'medium' as const,
        metadata: {
          contentLength: content.length,
          maxLength,
          hasObject: !!object,
          usage: normalizedUsage,
          finishReason,
          generationTimeMs,
          tokensPerMs:
            normalizedUsage?.totalTokens && generationTimeMs
              ? normalizedUsage.totalTokens / generationTimeMs
              : undefined,
        },
        info: {
          guardrailName: 'output-length-limit',
          contentLength: content.length,
          maxLength: maxLength,
          hasObject: !!object,
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
          info: {
            guardrailName: 'output-min-length',
            currentLength: content.length,
            minLength: minLength,
            deficit: minLength - content.length,
            hasObject: !!object,
          },
        };
      }

      return {
        tripwireTriggered: false,
        info: {
          guardrailName: 'output-min-length',
          currentLength: content.length,
          minLength: minLength,
        },
      };
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
          info: {
            guardrailName: 'sensitive-data-filter',
            detectedTypes: detected.map((p) => p.name),
            count: detected.length,
            contentLength: content.length,
          },
        };
      }

      return {
        tripwireTriggered: false,
        info: {
          guardrailName: 'sensitive-data-filter',
        },
      };
    },
  );

export const blockedContent = (words: string[]): OutputGuardrail =>
  createOutputGuardrail(
    'blocked-content',
    (context: OutputGuardrailContext, accumulatedText?: string) => {
      const { text, object } = extractContent(context.result);
      const content = stringifyContent(text, object, accumulatedText);
      const lowerContent = content.toLowerCase();

      const blockedWord = words.find((word) =>
        lowerContent.includes(word.toLowerCase()),
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
        info: {
          guardrailName: 'blocked-content',
          blockedWord: blockedWord,
          allWords: words,
          contentLength: content.length,
        },
      };
    },
  );

export const jsonValidation = (): OutputGuardrail =>
  createOutputGuardrail(
    'json-validation',
    (context: OutputGuardrailContext, accumulatedText?: string) => {
      const { text, object } = extractContent(context.result);
      const content = stringifyContent(text, object, accumulatedText);

      if (object) {
        return {
          tripwireTriggered: false,
          info: {
            guardrailName: 'json-validation',
            hasObject: true,
          },
        };
      } // Object is already valid

      // Fast-fail non-JSON by prefix check
      const trimmed = content.trim();

      if (
        !trimmed.startsWith('{') &&
        !trimmed.startsWith('[') &&
        !trimmed.startsWith('"')
      ) {
        return {
          tripwireTriggered: true,
          message:
            'Output is not valid JSON - does not start with valid JSON character',
          severity: 'medium' as const,
          metadata: {
            error: 'Invalid JSON prefix',
            textLength: content.length,
            firstChar: trimmed.charAt(0),
          },
          info: {
            guardrailName: 'json-validation',
            error: 'Invalid JSON prefix',
            textLength: content.length,
            firstChar: trimmed.charAt(0),
          },
        };
      }

      try {
        JSON.parse(content);

        return {
          tripwireTriggered: false,
          info: {
            guardrailName: 'json-validation',
          },
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        return {
          tripwireTriggered: true,
          message: `Output is not valid JSON: ${errorMessage}`,
          severity: 'medium' as const,
          metadata: {
            error: errorMessage,
            textLength: content.length,
            validationErrors: [errorMessage],
          },
          info: {
            guardrailName: 'json-validation',
            error: errorMessage,
            textLength: content.length,
            validationErrors: [errorMessage],
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
        info: {
          guardrailName: 'confidence-threshold',
          confidence,
          minConfidence: minConfidence,
          hasUncertainty: hasUncertainty,
          textLength: content.length,
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

      // Phrase-level abuse signals shared with toxicityDetector.
      const assessment = assessToxicity(content);
      const toxicityScore = assessment.score;
      const detectedWords = assessment.matches;
      const categories = assessment.categories;

      return {
        tripwireTriggered: toxicityScore >= threshold,
        message:
          toxicityScore >= threshold
            ? `Content toxicity score ${toxicityScore} exceeds threshold ${threshold}`
            : undefined,
        severity: 'high' as const,
        metadata: {
          toxicityScore,
          threshold,
          detectedWords,
          categories,
          contentLength: content.length,
        },
        info: {
          guardrailName: 'toxicity-filter',
          toxicityScore: toxicityScore,
          threshold,
          detectedWords: detectedWords,
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
      info: {
        guardrailName: name,
        validatorName: name,
        hasText: !!text,
        hasObject: !!object,
      },
    };
  });
};

export const schemaValidation = <T>(schema: {
  parse: (data: JSONValue) => T;
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
          info: {
            guardrailName: 'schema-validation',
            hasObject: false,
          },
        };
      }

      try {
        // SAFETY: structured output objects are parsed from the model's JSON.
        schema.parse(object as JSONValue);

        return {
          tripwireTriggered: false,
          metadata: {
            hasObject: true,
            validationPassed: true,
            usage,
            finishReason,
            generationTimeMs,
          },
          info: {
            guardrailName: 'schema-validation',
            hasObject: true,
            validationPassed: true,
          },
        };
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        return {
          tripwireTriggered: true,
          message: `Schema validation failed: ${errorMessage}`,
          severity: 'high' as const,
          metadata: {
            hasObject: true,
            validationPassed: false,
            error: errorMessage,
            usage,
            finishReason,
            generationTimeMs,
          },
          info: {
            guardrailName: 'schema-validation',
            hasObject: true,
            validationPassed: false,
            error: errorMessage,
          },
        };
      }
    },
  );

/**
 * Per-request token ceiling — trips when a *single* response exceeds `maxTokens`.
 *
 * For a *cumulative* session limit (total tokens/cost across many calls), use
 * {@link budgetGuardrail} with a shared budget instead, so spend is tracked in
 * one place rather than re-summed per request.
 */
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
          inputTokens: usage?.promptTokens,
          outputTokens: usage?.completionTokens,
          contentLength: content.length,
          generationTimeMs,
          tokensPerMs:
            totalTokens && generationTimeMs
              ? totalTokens / generationTimeMs
              : undefined,
        },
        info: {
          guardrailName: 'token-usage-limit',
          totalTokens: totalTokens,
          maxTokens: maxTokens,
          contentLength: content.length,
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
        info: {
          guardrailName: 'performance-monitor',
          generationTimeMs: actualGenerationTimeMs,
          maxGenerationTimeMs: maxGenerationTimeMs,
          contentLength: content.length,
        },
      };
    },
  );

const plainObject = z.looseObject({});

const headerValue = z.string();

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
        (plainObject.safeParse(object).success
          ? JSON.stringify(object)
          : text || '');

      // Heuristic: uncertainty indicators, alone and alongside factual claims.
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
        info: {
          guardrailName: 'hallucination-detector',
          hallucinationScore: hallucinationScore,
          confidenceThreshold: confidenceThreshold,
          uncertaintyCount: uncertaintyCount,
          factualClaimCount: factualClaimCount,
          contentLength: content.length,
        },
      };
    },
  );

export const biasDetector = (): OutputGuardrail =>
  createOutputGuardrail('bias-detector', (context: OutputGuardrailContext) => {
    const { text, object } = extractContent(context.result);
    const content = text || (object ? JSON.stringify(object) : '');
    const lowerContent = content.toLowerCase();

    // Bias indicator patterns
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
      info: {
        guardrailName: 'bias-detector',
        biasCategories: detectedBias,
        biasPatterns: matches,
        contentLength: content.length,
      },
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
        info: {
          guardrailName: 'factual-accuracy-checker',
          factualClaimCount: factualClaimCount,
          sourceCitationCount: sourceCitationCount,
          requireSources: requireSources,
          contentLength: content.length,
        },
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
        info: {
          guardrailName: 'privacy-leakage-detector',
          leakageCategories: detectedLeakage,
          matchCount: matches.length,
          contentLength: content.length,
        },
      };
    },
  );

export const contentConsistencyChecker = (
  referenceContent?: string,
): OutputGuardrail =>
  createOutputGuardrail(
    'content-consistency-checker',
    (context: OutputGuardrailContext) => {
      if (!referenceContent) {
        return {
          tripwireTriggered: false,
          info: {
            guardrailName: 'content-consistency-checker',
          },
        };
      }

      const { text, object } = extractContent(context.result);
      const content = text || (object ? JSON.stringify(object) : '');

      // Consistency is the share of words the output has in common with the reference.
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
        info: {
          guardrailName: 'content-consistency-checker',
          consistencyScore: consistencyScore,
          contentLength: content.length,
          referenceLength: referenceContent.length,
          commonWordCount: commonWords.length,
        },
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

      const compliancePatterns = new Map(
        Object.entries({
          gdpr: ['personal data', 'data processing', 'consent', 'data subject'],
          hipaa: [
            'patient',
            'medical',
            'health information',
            'protected health',
          ],
          pci: ['credit card', 'payment', 'cardholder', 'card number'],
          sox: [
            'financial',
            'audit',
            'internal controls',
            'financial reporting',
          ],
          coppa: ['children', 'under 13', 'parental consent', 'minor'],
        }),
      );

      const environment = z
        .string()
        .optional()
        .catch(undefined)
        .parse(
          isObjectLike(context.input) && 'environment' in context.input
            ? context.input.environment
            : undefined,
        );

      const violations = [];

      for (const regulation of regulations) {
        const patterns = compliancePatterns.get(regulation.toLowerCase());

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
          environment,
        },
        suggestion: 'Review output for compliance with applicable regulations',
        info: {
          guardrailName: 'compliance-checker',
          violations,
          regulations,
          contentLength: content.length,
          environment,
        },
      };
    },
  );

/**
 * Secret redaction guardrail that detects and blocks output containing sensitive information
 * like API keys, access tokens, AWS ARNs, JWTs, and PEM certificates
 */
const PLACEHOLDER =
  /x{6,}|X{6,}|EXAMPLE|YOUR[_-]|<[^>]+>|REPLACE|PLACEHOLDER|CHANGEME|\*{4,}|\.{3}|\b(?:USER|USERNAME):(?:PASS|PASSWORD)@|\$\{|\{\{/;

function isSecretPlaceholder(value: string): boolean {
  return PLACEHOLDER.test(value) || /(.)\1{9,}/.test(value);
}

export const secretRedaction = createOutputGuardrail(
  'secret-redaction',
  (context: OutputGuardrailContext) => {
    const { text, object } = extractContent(context.result);
    const content = text || (object ? JSON.stringify(object) : '');

    // Precompiled patterns for common secret formats
    const secretPatterns = [
      // API Keys (various formats) - more specific patterns to reduce false positives
      {
        name: 'API Key',
        pattern:
          /(?:api[_-]?key|apikey|access[_-]?key)\s*[:=]\s*['"]?([a-zA-Z0-9]{20,})['"]?/gi,
      },
      // AWS Access Keys
      {
        name: 'AWS Access Key',
        pattern: /AKIA[0-9A-Z]{16}/g,
      },
      // AWS Secret Keys
      // Exactly 40 base64 chars with mixed case and a digit: excludes git SHAs
      // (lowercase hex) and longer hashes like npm `sha512-…` integrity values.
      {
        name: 'AWS Secret Key',
        pattern:
          /(?<![A-Za-z0-9/+=])(?=[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=]))(?=[a-z0-9/+=]*[A-Z])(?=[A-Z0-9/+=]*[a-z])(?=[A-Za-z/+=]*\d)[A-Za-z0-9/+=]{40}/g,
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
        pattern:
          /\b(?:gh[pousr]_[a-zA-Z0-9]{36,}|github_pat_[a-zA-Z0-9_]{60,})\b/g,
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
          /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mariadb|rediss?|amqps?|mssql|sqlserver|ftp|sftp|smtp|ldap):\/\/[^:@\s/]+:[^@\s]+@[^/\s]+/gi,
      },
      {
        name: 'Connection String Password',
        pattern: /\b(?:Password|Pwd)\s*=\s*[^;\s]{4,};/gi,
      },
      // Passwords written in prose: "password is X", "with password X", "pw: X"
      {
        name: 'Password',
        pattern:
          /\b(?:password|passphrase|passwd|pwd)\b(?:\s+(?:for|on|of)\s+[\w ]{1,40}?)?(?:\s+(?:is|was|is still|=|:)|\s*[:=])?\s+(?:still\s+)?["'“]?(?=[^\s"'”]*[\d!@#$%^&*_-])([^\s"'”]{6,})/gi,
      },
      {
        name: 'Password',
        pattern:
          /\b(?:login|user(?:name)?)\s*:\s*\S+\s*\/\s*(?=\S*[\d!@#$%^&*])\S{6,}/gi,
      },
      // Environment variables with secrets (more specific to reduce false positives)
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

    for (const { name, pattern } of secretPatterns) {
      if (pattern.global) {
        pattern.lastIndex = 0;
      }

      let match;

      while ((match = pattern.exec(content)) !== null) {
        // Documented placeholders ("ghp_xxxx…", "AKIA…EXAMPLE", "USER:PASSWORD")
        // are not leaks.
        if (isSecretPlaceholder(match[0])) {
          if (match[0].length === 0) pattern.lastIndex++;
          continue;
        }

        const maskedSecret =
          match[0].length > 20
            ? match[0].slice(0, 8) + '...' + match[0].slice(-4)
            : match[0].slice(0, 4) + '...';

        detectedSecrets.push({
          type: name,
          pattern: maskedSecret,
          position: match.index,
        });

        // Prevent infinite loops on zero-length matches
        if (match[0].length === 0) {
          pattern.lastIndex++;
        }
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
        info: {
          guardrailName: 'secret-redaction',
          secretsDetected: detectedSecrets.length,
          secretTypes: detectedSecrets.map((s) => s.type),
          contentLength: content.length,
        },
      };
    }

    return {
      tripwireTriggered: false,
      info: {
        guardrailName: 'secret-redaction',
      },
    };
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
        info: {
          guardrailName: 'unsafe-content-detector',
          categoriesDetected: detectedIssues.length,
          issues: detectedIssues,
          contentLength: content.length,
        },
      };
    }

    return {
      tripwireTriggered: false,
      info: {
        guardrailName: 'unsafe-content-detector',
      },
    };
  },
);

/**
 * Cost and quota rails guardrail to monitor token usage and costs
 */
/**
 * Per-request cost/token quota — trips when a *single* response exceeds the
 * given per-request limits.
 *
 * For a *cumulative* session budget (total cost/tokens across the whole run, with
 * an abort-signal kill-switch), use {@link budgetGuardrail} — it feeds each
 * call's usage into one shared budget (autotel-genai's `GenAiGuard` or the
 * built-in {@link createGuardrailBudget}), avoiding double-tracking.
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
          info: {
            guardrailName: 'cost-quota-rails',
            totalTokens: totalTokens,
            estimatedCost: estimatedCost,
            maxTokensPerRequest: options.maxTokensPerRequest,
            maxCostPerRequest: options.maxCostPerRequest,
            contentLength: content.length,
          },
        };
      }

      return {
        tripwireTriggered: false,
        info: {
          guardrailName: 'cost-quota-rails',
        },
      };
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

      const factualClaims = factCheckPatterns.filter((pattern) =>
        content.toLowerCase().includes(pattern.toLowerCase()),
      );

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

      if (schemaConstraints && object) {
        const fields = new Map(Object.entries(object));

        if (schemaConstraints.requiredFields) {
          const missingFields = schemaConstraints.requiredFields.filter(
            (field) =>
              fields.get(field) === null || fields.get(field) === undefined,
          );

          if (missingFields.length > 0) {
            issues.push(`Missing required fields: ${missingFields.join(', ')}`);
            hallucinationScore += 0.3;
          }
        }

        if (schemaConstraints.allowedValues) {
          for (const [field, allowedValues] of Object.entries(
            schemaConstraints.allowedValues,
          )) {
            if (
              !fields.has(field) ||
              allowedValues.includes(String(fields.get(field)))
            ) {
              continue;
            }

            issues.push(
              `Invalid value for field '${field}': ${fields.get(field)}`,
            );
            hallucinationScore += 0.2;
          }
        }
      }

      const contradictionPatterns = [
        ['always', 'never'],
        ['all', 'none'],
        ['definitely', 'maybe'],
        ['certain', 'uncertain'],
        ['true', 'false'],
      ];

      for (const [pos, neg] of contradictionPatterns) {
        if (!(
          pos &&
          neg &&
          content.toLowerCase().includes(pos) &&
          content.toLowerCase().includes(neg)
        )) {
          continue;
        }

        issues.push(`Potential contradiction detected: ${pos}/${neg}`);
        hallucinationScore += 0.15;
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
          info: {
            guardrailName: 'enhanced-hallucination-detector',
            hallucinationScore: hallucinationScore,
            confidenceThreshold: confidenceThreshold,
            issues,
            factualClaimsCount: factualClaims.length,
            citationsCount: citations.length,
            uncertaintyCount: uncertaintyCount,
            contentLength: content.length,
          },
        };
      }

      return {
        tripwireTriggered: false,
        info: {
          guardrailName: 'enhanced-hallucination-detector',
        },
      };
    },
  );

/** Parse `retry-after` (delta-seconds or HTTP-date) / `retry-after-ms` / `x-ratelimit-reset-*` ("1s", "6m0s", "250ms", seconds) into ms. */
export function parseRetryAfterMs(
  value: string | undefined,
  now = Date.now(),
): number | undefined {
  if (value === undefined) return undefined;
  const v = value.trim();

  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);

  const duration =
    /^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+)ms)?$/.exec(v);

  if (duration && v !== '') {
    const [, h = '0', m = '0', sec = '0', ms = '0'] = duration;

    return Math.round(
      Number(h) * 3_600_000 +
        Number(m) * 60_000 +
        Number(sec) * 1000 +
        Number(ms),
    );
  }

  const date = Date.parse(v);

  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * Reads the provider's rate-limit response headers (`retry-after`,
 * `retry-after-ms`, `x-ratelimit-remaining-{requests,tokens}` and the matching
 * `x-ratelimit-reset-*`) and trips when the provider asks you to back off or a
 * remaining quota is at or below `minRemaining`. The result carries a jittered
 * `recommendedBackoffMs` capped at `maxRetryDelayMs`. Passes when the provider
 * sends no such headers.
 */
export const retryAfterIntegration = (
  options: {
    maxRetryDelayMs?: number;
    defaultBackoffMs?: number;
    /** 0-1, randomness added to the backoff. */
    jitterFactor?: number;
    /** Trip when a remaining-requests/tokens header is at or below this. Default 0. */
    minRemaining?: number;
    /** @deprecated No effect; rate-limit headers are always read. */
    trackRateLimits?: boolean;
  } = {},
): OutputGuardrail =>
  createOutputGuardrail('retry-after-integration', (context) => {
    const {
      maxRetryDelayMs = 60_000,
      defaultBackoffMs = 1000,
      jitterFactor = 0.1,
      minRemaining = 0,
    } = options;

    // SAFETY: only `response.headers` is read, and it is parsed before use.
    const raw = (context.result as { response?: { headers?: unknown } })
      .response?.headers;

    const headers: Record<string, string> = {};
    const rawHeaders = plainObject.safeParse(raw);

    if (rawHeaders.success) {
      for (const [k, v] of Object.entries(rawHeaders.data)) {
        const value = headerValue.safeParse(v);

        if (value.success) headers[k.toLowerCase()] = value.data;
      }
    }

    const msHeader = Number(headers['retry-after-ms']);

    const retryAfterMs =
      headers['retry-after-ms'] !== undefined && Number.isFinite(msHeader)
        ? msHeader
        : parseRetryAfterMs(headers['retry-after']);

    const remaining = (['requests', 'tokens'] as const).flatMap((kind) => {
      const n = Number(headers[`x-ratelimit-remaining-${kind}`]);

      return headers[`x-ratelimit-remaining-${kind}`] !== undefined &&
        Number.isFinite(n)
        ? [
            {
              kind,
              remaining: n,
              resetMs: parseRetryAfterMs(headers[`x-ratelimit-reset-${kind}`]),
            },
          ]
        : [];
    });

    const exhausted = remaining.filter((r) => r.remaining <= minRemaining);

    if (retryAfterMs === undefined && exhausted.length === 0) {
      return {
        tripwireTriggered: false,
        metadata: { remaining },
        info: { guardrailName: 'retry-after-integration' },
      };
    }

    const baseMs =
      retryAfterMs ??
      Math.max(...exhausted.map((r) => r.resetMs ?? defaultBackoffMs));

    const cappedMs = Math.min(baseMs, maxRetryDelayMs);
    const jitterMs = Math.random() * jitterFactor * cappedMs;

    const recommendedBackoffMs = Math.min(
      Math.round(cappedMs + jitterMs),
      maxRetryDelayMs,
    );

    const reason =
      retryAfterMs === undefined
        ? `${exhausted.map((r) => `${r.kind} remaining ${r.remaining}`).join(', ')}`
        : `provider sent retry-after ${retryAfterMs}ms`;

    return {
      tripwireTriggered: true,
      message: `Rate limited (${reason}); back off ${recommendedBackoffMs}ms`,
      severity: 'medium' as const,
      metadata: { retryAfterMs, remaining, recommendedBackoffMs },
      suggestion: `Wait ${recommendedBackoffMs}ms before the next request`,
      info: {
        guardrailName: 'retry-after-integration',
        retryAfterMs,
        recommendedBackoffMs,
      },
    };
  });
