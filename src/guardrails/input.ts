import { createInputGuardrail, type InputGuardrail } from '../core';
import type { InputGuardrailContext } from '../types';

// Standardized severity levels
const SEVERITY_LEVELS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;

type SeverityLevel = (typeof SEVERITY_LEVELS)[keyof typeof SEVERITY_LEVELS];

// Standardized metadata schema
interface StandardMetadata {
  ruleId: string;
  ruleVersion: string;
  phase: 'pre-input';
  totalLength: number;
  messageCount: number;
  promptLength: number;
  systemLength: number;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  [key: string]: unknown;
}

// Type definitions for message content
interface MessageContent {
  content?: unknown;
}

interface ContextWithUser {
  context?: {
    user?: { id?: string };
    request?: { ip?: string };
  };
}

// Discriminated union for input types - removed unused interfaces

// Improved type guards
function isEmbedParams(context: InputGuardrailContext): boolean {
  return (
    'value' in context && !('prompt' in context) && !('messages' in context)
  );
}

// cspell:ignore AISDK
function isAISDKParams(context: InputGuardrailContext): boolean {
  return 'prompt' in context || 'messages' in context || 'system' in context;
}

function hasContextProperty(
  context: InputGuardrailContext,
): context is InputGuardrailContext & ContextWithUser {
  return 'context' in context;
}

// Precompiled regexes for performance
const PII_PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone:
    /\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  creditCard: /\b(?:\d{4}[\s-]?){3}\d{4}\b/g,
  ipAddress:
    /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
} as const;

// Utility functions for text processing
function countBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
}

function createStandardMetadata(
  ruleId: string,
  context: InputGuardrailContext,
  additionalData: Record<string, unknown> = {},
): StandardMetadata {
  const { prompt, messages, system } = extractTextContent(context);
  const { model, temperature, maxOutputTokens } = extractMetadata(context);

  return {
    ruleId,
    ruleVersion: '1.0.0',
    phase: 'pre-input',
    totalLength:
      prompt.length +
      system.length +
      messages.reduce((sum, msg) => sum + String(msg?.content || '').length, 0),
    messageCount: messages.length,
    promptLength: prompt.length,
    systemLength: system.length,
    model: model ? String(model) : undefined,
    temperature,
    maxOutputTokens,
    ...additionalData,
  };
}

// Centralized content extraction with caching
const contentCache = new WeakMap<
  InputGuardrailContext,
  ReturnType<typeof extractTextContent>
>();

export function extractTextContent(context: InputGuardrailContext): {
  prompt: string;
  messages: Array<{ content?: unknown }>;
  system: string;
  allText: string;
  allTextLower: string;
  totalBytes: number;
  totalWords: number;
} {
  // Check cache first
  const cached = contentCache.get(context);
  if (cached) return cached;

  let prompt: string;
  let messages: Array<{ content?: unknown }>;
  let system: string;

  // Handle embed params - only has 'value' property
  if (isEmbedParams(context)) {
    const embedContext = context as { value: unknown };
    prompt = String(embedContext.value || '');
    messages = [];
    system = '';
  } else if (isAISDKParams(context)) {
    // Handle AI SDK params that have prompt/messages/system
    const aiContext = context as {
      prompt?: string;
      messages?: MessageContent[];
      system?: string;
    };
    prompt = aiContext.prompt || '';
    messages = aiContext.messages || [];
    system = aiContext.system || '';
  } else {
    // Fallback for unknown types
    prompt = '';
    messages = [];
    system = '';
  }

  const allText = [
    prompt,
    ...messages.map((msg: MessageContent) => String(msg?.content || '')),
    system,
  ].join(' ');

  const result = {
    prompt,
    messages,
    system,
    allText,
    allTextLower: allText.toLowerCase(),
    totalBytes: countBytes(allText),
    totalWords: countWords(allText),
  };

  // Cache the result
  contentCache.set(context, result);
  return result;
}

// Helper function to safely extract metadata from context
export function extractMetadata(context: InputGuardrailContext): {
  model?: unknown;
  temperature?: number;
  maxOutputTokens?: number;
} {
  if (isAISDKParams(context)) {
    const aiContext = context as {
      model?: unknown;
      temperature?: number;
      maxOutputTokens?: number;
    };
    return {
      model: aiContext.model,
      temperature: aiContext.temperature,
      maxOutputTokens: aiContext.maxOutputTokens,
    };
  }
  return {};
}

// Unified length limit with multiple counting methods
export interface LengthLimitOptions {
  maxLength: number;
  countMethod?: 'characters' | 'bytes' | 'words';
  severity?: SeverityLevel;
}

export const inputLengthLimit = (
  options: LengthLimitOptions | number,
): InputGuardrail => {
  const opts =
    typeof options === 'number'
      ? {
          maxLength: options,
          countMethod: 'characters' as const,
          severity: SEVERITY_LEVELS.MEDIUM,
        }
      : {
          countMethod: 'characters' as const,
          severity: SEVERITY_LEVELS.MEDIUM,
          ...options,
        };

  return createInputGuardrail(
    'input-length-limit',
    `Enforces maximum input ${opts.countMethod} limit`,
    (context) => {
      const content = extractTextContent(context);

      let currentLength: number;
      let unit: string;

      switch (opts.countMethod) {
        case 'bytes': {
          currentLength = content.totalBytes;
          unit = 'bytes';
          break;
        }
        case 'words': {
          currentLength = content.totalWords;
          unit = 'words';
          break;
        }
        default: {
          currentLength = content.allText.length;
          unit = 'characters';
        }
      }

      const metadata = createStandardMetadata('GR-IN-001', context, {
        currentLength,
        maxLength: opts.maxLength,
        countMethod: opts.countMethod,
        unit,
      });

      return {
        tripwireTriggered: currentLength > opts.maxLength,
        message:
          currentLength > opts.maxLength
            ? `Input ${unit} count ${currentLength} exceeds limit of ${opts.maxLength}`
            : undefined,
        severity: opts.severity,
        metadata,
      };
    },
  );
};

// Backward compatibility
export const lengthLimit = (maxLength: number): InputGuardrail =>
  inputLengthLimit({ maxLength, countMethod: 'characters' });

// Improved blocked words with word boundaries and allowlist support
export interface BlockedWordsOptions {
  words: string[];
  allowlist?: string[];
  useWordBoundaries?: boolean;
  severity?: SeverityLevel;
}

function createWordBoundaryRegex(word: string): RegExp {
  // Escape special regex characters and create word boundary pattern
  const escaped = word.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(String.raw`\b${escaped}\b`, 'i');
}

export const blockedWords = (
  options: BlockedWordsOptions | string[],
): InputGuardrail => {
  const opts = Array.isArray(options)
    ? {
        words: options,
        useWordBoundaries: true,
        severity: SEVERITY_LEVELS.HIGH,
      }
    : { useWordBoundaries: true, severity: SEVERITY_LEVELS.HIGH, ...options };

  // Precompile regexes for performance
  const wordPatterns = opts.words.map((word) => ({
    word,
    pattern: opts.useWordBoundaries
      ? createWordBoundaryRegex(word)
      : new RegExp(
          word.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`),
          'i',
        ),
  }));

  return createInputGuardrail(
    'blocked-words',
    'Blocks input containing specified words with word boundary detection',
    (context) => {
      const content = extractTextContent(context);

      // Check allowlist first
      if (opts.allowlist) {
        const allowlistMatch = opts.allowlist.some((phrase) =>
          content.allTextLower.includes(phrase.toLowerCase()),
        );
        if (allowlistMatch) {
          return {
            tripwireTriggered: false,
            metadata: createStandardMetadata('GR-IN-002', context, {
              allowlistMatched: true,
              blockedWords: opts.words,
            }),
          };
        }
      }

      const blockedWord = wordPatterns.find(({ pattern }) =>
        pattern.test(content.allText),
      );

      const metadata = createStandardMetadata('GR-IN-002', context, {
        blockedWord: blockedWord?.word,
        allWords: opts.words,
        allowlist: opts.allowlist,
        useWordBoundaries: opts.useWordBoundaries,
      });

      return {
        tripwireTriggered: !!blockedWord,
        message: blockedWord
          ? `Blocked word detected: ${blockedWord.word}`
          : undefined,
        severity: opts.severity,
        metadata,
      };
    },
  );
};

// Deprecated - use inputLengthLimit instead
export const contentLengthLimit = (maxLength: number): InputGuardrail =>
  inputLengthLimit({ maxLength, countMethod: 'characters' });

// Alias for blockedWords with different default behavior
export const blockedKeywords = (keywords: string[]): InputGuardrail =>
  blockedWords({
    words: keywords,
    useWordBoundaries: false, // Keywords can be partial matches
    severity: SEVERITY_LEVELS.HIGH,
  });

// Enhanced rate limiting with server hints and backoff recommendations
export interface RateLimitingOptions {
  maxRequestsPerMinute: number;
  windowMs?: number;
  privacyMode?: boolean;
  includeServerHints?: boolean;
}

export const rateLimiting = (
  options: RateLimitingOptions | number,
): InputGuardrail => {
  const opts =
    typeof options === 'number'
      ? {
          maxRequestsPerMinute: options,
          windowMs: 60_000,
          privacyMode: true,
          includeServerHints: true,
        }
      : {
          windowMs: 60_000,
          privacyMode: true,
          includeServerHints: true,
          ...options,
        };

  const requestCounts = new Map<
    string,
    { count: number; resetTime: number; firstRequest: number }
  >();

  return createInputGuardrail(
    'rate-limiting',
    'Enforces rate limiting with server hints and backoff recommendations',
    (inputContext) => {
      const { model, temperature, maxOutputTokens } =
        extractMetadata(inputContext);

      let contextData:
        | { user?: { id?: string }; request?: { ip?: string } }
        | undefined;
      if (hasContextProperty(inputContext)) {
        contextData = inputContext.context;
      }

      const key =
        contextData?.user?.id || contextData?.request?.ip || 'default';
      const now = Date.now();
      const windowMs = opts.windowMs;

      const current = requestCounts.get(key) || {
        count: 0,
        resetTime: now + windowMs,
        firstRequest: now,
      };

      if (now > current.resetTime) {
        current.count = 0;
        current.resetTime = now + windowMs;
        current.firstRequest = now;
      }

      current.count++;
      requestCounts.set(key, current);

      const isRateLimited = current.count > opts.maxRequestsPerMinute;
      const timeUntilReset = Math.max(0, current.resetTime - now);
      const recommendedBackoff = Math.min(timeUntilReset + 1000, 30_000); // Add 1s jitter, max 30s

      const metadata = createStandardMetadata('GR-IN-006', inputContext, {
        currentCount: current.count,
        maxRequests: opts.maxRequestsPerMinute,
        resetTime: current.resetTime,
        timeUntilReset,
        recommendedBackoff,
        windowMs,
        userId: opts.privacyMode ? undefined : contextData?.user?.id,
        userIp: opts.privacyMode ? undefined : contextData?.request?.ip,
        model: model ? String(model) : undefined,
        temperature,
        maxOutputTokens,
      });

      const serverHints = opts.includeServerHints
        ? {
            'Retry-After': Math.ceil(timeUntilReset / 1000),
            'X-RateLimit-Limit': opts.maxRequestsPerMinute,
            'X-RateLimit-Remaining': Math.max(
              0,
              opts.maxRequestsPerMinute - current.count,
            ),
            'X-RateLimit-Reset': Math.ceil(current.resetTime / 1000),
          }
        : {};

      return {
        tripwireTriggered: isRateLimited,
        message: isRateLimited
          ? `Rate limit exceeded: ${current.count}/${opts.maxRequestsPerMinute} requests per minute. Try again in ${Math.ceil(timeUntilReset / 1000)} seconds.`
          : undefined,
        severity: isRateLimited ? SEVERITY_LEVELS.MEDIUM : SEVERITY_LEVELS.LOW,
        metadata: {
          ...metadata,
          ...(opts.includeServerHints && { serverHints }),
        },
        suggestion: isRateLimited
          ? `Please wait ${Math.ceil(recommendedBackoff / 1000)} seconds before making another request`
          : undefined,
      };
    },
  );
};

// Improved profanity filter with categories and severity mapping
export interface ProfanityCategory {
  words: string[];
  severity: SeverityLevel;
  category: string;
}

export interface ProfanityFilterOptions {
  categories?: ProfanityCategory[];
  customWords?: string[];
  locale?: string;
  useWordBoundaries?: boolean;
}

// Default profanity categories (externalized for easy configuration)
const DEFAULT_PROFANITY_CATEGORIES: ProfanityCategory[] = [
  {
    category: 'mild',
    severity: SEVERITY_LEVELS.MEDIUM,
    words: ['damn', 'hell', 'crap'], // Add actual mild profanity
  },
  {
    category: 'strong',
    severity: SEVERITY_LEVELS.HIGH,
    words: ['profanity1', 'profanity2'], // Add actual strong profanity
  },
  {
    category: 'extreme',
    severity: SEVERITY_LEVELS.CRITICAL,
    words: ['extreme1', 'extreme2'], // Add actual extreme profanity
  },
];

export const profanityFilter = (
  options: ProfanityFilterOptions | string[] = {},
): InputGuardrail => {
  const opts = Array.isArray(options)
    ? { customWords: options, useWordBoundaries: true }
    : { useWordBoundaries: true, ...options };

  const categories = opts.categories || DEFAULT_PROFANITY_CATEGORIES;
  const customWords = opts.customWords || [];

  // Precompile all patterns for performance
  const allPatterns: Array<{
    word: string;
    category: string;
    severity: SeverityLevel;
    pattern: RegExp;
  }> = [];

  for (const cat of categories) {
    for (const word of cat.words) {
      allPatterns.push({
        word,
        category: cat.category,
        severity: cat.severity,
        pattern: opts.useWordBoundaries
          ? createWordBoundaryRegex(word)
          : new RegExp(
              word.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`),
              'i',
            ),
      });
    }
  }

  for (const word of customWords) {
    allPatterns.push({
      word,
      category: 'custom',
      severity: SEVERITY_LEVELS.HIGH,
      pattern: opts.useWordBoundaries
        ? createWordBoundaryRegex(word)
        : new RegExp(
            word.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`),
            'i',
          ),
    });
  }

  return createInputGuardrail(
    'profanity-filter',
    'Filters profanity and inappropriate language with category-based severity',
    (context) => {
      const content = extractTextContent(context);

      const detectedProfanity = allPatterns.find(({ pattern }) =>
        pattern.test(content.allText),
      );

      const metadata = createStandardMetadata('GR-IN-003', context, {
        profaneWord: detectedProfanity?.word,
        category: detectedProfanity?.category,
        locale: opts.locale,
        totalCategories: categories.length,
        customWordsCount: customWords.length,
      });

      return {
        tripwireTriggered: !!detectedProfanity,
        message: detectedProfanity
          ? `Profanity detected (${detectedProfanity.category}): ${detectedProfanity.word}`
          : undefined,
        severity: detectedProfanity?.severity || SEVERITY_LEVELS.HIGH,
        metadata,
        suggestion: 'Please use respectful and appropriate language',
      };
    },
  );
};

// Enhanced custom validation with clear contract and reason codes
export interface CustomValidationInput {
  prompt: string;
  messages: Array<{ content?: unknown }>;
  system: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  allText: string;
  allTextLower: string;
  totalBytes: number;
  totalWords: number;
}

export interface CustomValidationResult {
  isValid: boolean;
  reasonCode?: string;
  details?: Record<string, unknown>;
}

type CustomValidationFn = (
  payload: CustomValidationInput,
) => CustomValidationResult | boolean;

export interface CustomValidationOptions {
  name: string;
  description: string;
  validator: CustomValidationFn;
  message?: string;
  severity?: SeverityLevel;
  reasonCode?: string;
}

export const customValidation = (
  options:
    | CustomValidationOptions
    | [string, string, CustomValidationFn, string],
): InputGuardrail => {
  const opts = Array.isArray(options)
    ? {
        name: options[0],
        description: options[1],
        validator: options[2],
        message: options[3],
        severity: SEVERITY_LEVELS.MEDIUM,
      }
    : { severity: SEVERITY_LEVELS.MEDIUM, ...options };

  return createInputGuardrail(opts.name, opts.description, (context) => {
    const content = extractTextContent(context);
    const { model, temperature, maxOutputTokens } = extractMetadata(context);

    const validatorInput: CustomValidationInput = {
      prompt: content.prompt,
      messages: content.messages,
      system: content.system,
      model: model ? String(model) : undefined,
      temperature,
      maxOutputTokens,
      allText: content.allText,
      allTextLower: content.allTextLower,
      totalBytes: content.totalBytes,
      totalWords: content.totalWords,
    };

    const result = opts.validator(validatorInput);

    // Handle both boolean and object results for backward compatibility
    const isValid = typeof result === 'boolean' ? result : result.isValid;
    const reasonCode =
      typeof result === 'object' ? result.reasonCode : opts.reasonCode;
    const details = typeof result === 'object' ? result.details : {};

    const metadata = createStandardMetadata('GR-IN-009', context, {
      validatorName: opts.name,
      reasonCode,
      validationDetails: details,
      inputKeys: Object.keys(validatorInput),
    });

    return {
      tripwireTriggered: !isValid,
      message: isValid
        ? undefined
        : opts.message ||
          `Custom validation failed: ${reasonCode || 'unknown reason'}`,
      severity: opts.severity,
      metadata,
    };
  });
};

// Prompt injection patterns with confidence scoring
export interface PromptInjectionOptions {
  threshold?: number;
  includeExamples?: boolean;
}

export const promptInjectionDetector = (
  options: PromptInjectionOptions = {},
): InputGuardrail => {
  const { threshold = 0.5, includeExamples = false } = options;

  // Precompiled patterns with confidence weights
  const injectionPatterns = [
    {
      pattern: /ignore\s+previous\s+instructions/i,
      weight: 0.9,
      example: 'ignore previous instructions',
    },
    {
      pattern: /system\s*:\s*you\s+are\s+now/i,
      weight: 0.8,
      example: 'system: you are now',
    },
    {
      pattern: /forget\s+everything\s+above/i,
      weight: 0.9,
      example: 'forget everything above',
    },
    { pattern: /\bDAN\b.*mode/i, weight: 0.7, example: 'DAN mode' },
    { pattern: /jailbreak/i, weight: 0.8, example: 'jailbreak' },
    {
      pattern: /act\s+as\s+if\s+you\s+are/i,
      weight: 0.6,
      example: 'act as if you are',
    },
    { pattern: /pretend\s+to\s+be/i, weight: 0.6, example: 'pretend to be' },
    { pattern: /role\s*:\s*system/i, weight: 0.7, example: 'role: system' },
    {
      pattern: /\boverride\s+system\s+prompt\b/i,
      weight: 0.9,
      example: 'override system prompt',
    },
    {
      pattern: /\bignore\s+all\s+previous\s+instructions\b/i,
      weight: 0.9,
      example: 'ignore all previous instructions',
    },
    {
      pattern: /\bnew\s+instructions\s*:\s*/i,
      weight: 0.8,
      example: 'new instructions:',
    },
    {
      pattern: /\bact\s+as\s+a\s+different\s+ai\b/i,
      weight: 0.7,
      example: 'act as a different ai',
    },
    {
      pattern: /\bchain\s+of\s+thought\s+baiting/i,
      weight: 0.6,
      example: 'chain of thought baiting',
    },
    {
      pattern: /\bfile\s+system\s+override/i,
      weight: 0.8,
      example: 'file system override',
    },
    // MCP-specific injection patterns
    {
      pattern:
        /(?:call|use|invoke|execute)\s+(?:the\s+)?(?:[\w.-]+\s+)?(?:mcp|tool|function)/i,
      weight: 0.8,
      example: 'call mcp tool',
    },
    {
      pattern: /mcp\s*:\s*(?:ignore|override|bypass)/i,
      weight: 0.9,
      example: 'mcp: ignore previous',
    },
    {
      pattern: /tool\s+response\s*:\s*(?:ignore|system|admin)/i,
      weight: 0.85,
      example: 'tool response: system override',
    },
    {
      pattern: /(?:from|via)\s+mcp.*?(?:ignore|forget|override)/i,
      weight: 0.8,
      example: 'from mcp server: ignore instructions',
    },
    {
      pattern: /server\s+says?\s*:\s*(?:ignore|override|system)/i,
      weight: 0.85,
      example: 'server says: override system',
    },
    {
      pattern:
        /(?:after|then)\s+(?:calling|using)\s+(?:the\s+)?(?:[\w.-]+\s+)?(?:tool|mcp)/i,
      weight: 0.7,
      example: 'after calling tool, ignore',
    },
    {
      pattern: /\btool\s+output\s*:\s*(?:system|admin|root)/i,
      weight: 0.8,
      example: 'tool output: system message',
    },
    {
      pattern: /contextual\s+(?:override|injection|manipulation)/i,
      weight: 0.9,
      example: 'contextual override via tool',
    },
    {
      pattern: /(?:cascade|chain|sequence)\s+(?:attack|injection|exploit)/i,
      weight: 0.85,
      example: 'cascade attack through tools',
    },
    {
      pattern: /\bhidden\s+in\s+(?:response|output|result)/i,
      weight: 0.7,
      example: 'hidden in tool response',
    },
  ] as const;

  return createInputGuardrail(
    'prompt-injection-detector',
    'Detects potential prompt injection attempts with confidence scoring',
    (context) => {
      const content = extractTextContent(context);

      const detectedPatterns = injectionPatterns
        .filter(({ pattern }) => pattern.test(content.allText))
        .map(({ pattern, weight, example }) => ({
          pattern: pattern.source,
          weight,
          example: includeExamples ? example : undefined,
        }));

      let confidence = 0;
      if (detectedPatterns.length > 0) {
        let totalWeight = 0;
        for (const p of detectedPatterns) {
          totalWeight += p.weight;
        }
        confidence = Math.min(totalWeight / detectedPatterns.length, 1);
      }

      const metadata = createStandardMetadata('GR-IN-005', context, {
        patternsDetected: detectedPatterns.length,
        confidence,
        threshold,
        suspiciousPatterns: detectedPatterns.map((p) => p.pattern),
        examples: includeExamples
          ? detectedPatterns.map((p) => p.example).filter(Boolean)
          : undefined,
      });

      return {
        tripwireTriggered: confidence > threshold,
        message:
          confidence > threshold
            ? `Potential prompt injection detected (confidence: ${(confidence * 100).toFixed(1)}%): ${detectedPatterns.length} suspicious patterns found`
            : undefined,
        severity:
          confidence > 0.8 ? SEVERITY_LEVELS.CRITICAL : SEVERITY_LEVELS.HIGH,
        metadata,
        suggestion:
          'Please rephrase your request without system instructions or role-playing elements',
      };
    },
  );
};

// cspell:ignore Luhn
// Luhn algorithm for credit card validation
// cspell:ignore luhn
function luhnCheck(cardNumber: string): boolean {
  const digits = cardNumber.replaceAll(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let isEven = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number.parseInt(digits[i]!, 10);

    if (isEven) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }

    sum += digit;
    isEven = !isEven;
  }

  return sum % 10 === 0;
}

// Mask sensitive data for logging
function maskSensitiveData(text: string, type: string): string {
  switch (type) {
    case 'email': {
      return text.replace(/(.{2}).*(@.*)/, '$1***$2');
    }
    case 'phone': {
      return text.replace(/(\d{3})\d{3}(\d{4})/, '$1***$2');
    }
    case 'ssn': {
      return text.replace(/(\d{3})-\d{2}-(\d{4})/, '$1-**-$2');
    }
    case 'creditCard': {
      return text.replace(/(\d{4})\d{8,12}(\d{4})/, '$1****$2');
    }
    default: {
      return text.slice(0, 4) + '***' + text.slice(-4);
    }
  }
}

export const piiDetector = (): InputGuardrail =>
  createInputGuardrail(
    'pii-detector',
    'Detects personally identifiable information in input with validation',
    (context) => {
      const content = extractTextContent(context);

      const detectedPII: Array<{
        type: string;
        matches: string[];
        maskedMatches: string[];
      }> = [];

      // Check each PII type
      for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
        const matches = content.allText.match(pattern);
        if (matches) {
          let validMatches = [...matches];

          // Additional validation for credit cards
          if (type === 'creditCard') {
            validMatches = validMatches.filter((match) => luhnCheck(match));
          }

          // Filter out emails in URLs
          if (type === 'email') {
            validMatches = validMatches.filter(
              (match) => !match.includes('http'),
            );
          }

          if (validMatches.length > 0) {
            detectedPII.push({
              type,
              matches: validMatches,
              maskedMatches: validMatches.map((match) =>
                maskSensitiveData(match, type),
              ),
            });
          }
        }
      }

      let totalMatches = 0;
      const maskedMatches: Record<string, string[]> = {};

      for (const pii of detectedPII) {
        totalMatches += pii.matches.length;
        maskedMatches[pii.type] = pii.maskedMatches;
      }

      const metadata = createStandardMetadata('GR-IN-004', context, {
        piiTypes: detectedPII.map((pii) => pii.type),
        totalMatches,
        maskedMatches,
      });

      return {
        tripwireTriggered: detectedPII.length > 0,
        message:
          detectedPII.length > 0
            ? `PII detected: ${detectedPII.map((pii) => `${pii.type} (${pii.matches.length})`).join(', ')}`
            : undefined,
        severity: SEVERITY_LEVELS.CRITICAL,
        metadata,
        suggestion:
          'Please remove any personal information (emails, phone numbers, SSNs, etc.) from your input',
      };
    },
  );

export const toxicityDetector = (threshold: number = 0.7): InputGuardrail =>
  createInputGuardrail(
    'toxicity-detector',
    'Detects toxic and harmful content in input',
    (context) => {
      const { prompt, messages, system } = extractTextContent(context);
      const allText = [
        prompt,
        ...messages.map((msg: MessageContent) => String(msg?.content || '')),
        system,
      ]
        .join(' ')
        .toLowerCase();

      // Simple toxicity detection - in production, use a proper toxicity API
      const toxicWords = [
        'hate',
        'kill',
        'die',
        'stupid',
        'idiot',
        'moron',
        'toxic',
        'harmful',
      ];
      const detectedWords = toxicWords.filter((word) => allText.includes(word));
      const toxicityScore = detectedWords.length * 0.3;

      return {
        tripwireTriggered: toxicityScore > threshold,
        message:
          toxicityScore > threshold
            ? `Toxic content detected (score: ${toxicityScore})`
            : undefined,
        severity: toxicityScore > 0.8 ? 'critical' : 'high',
        metadata: {
          toxicityScore,
          threshold,
          detectedWords,
          textLength: allText.length,
        },
        suggestion: 'Please use respectful and constructive language',
      };
    },
  );

// Policy-based math homework detector (opt-in)
export interface MathHomeworkOptions {
  enabled?: boolean;
  strictMode?: boolean;
  allowedContexts?: string[];
  severity?: SeverityLevel;
}

export const mathHomeworkDetector = (
  options: MathHomeworkOptions = {},
): InputGuardrail => {
  const {
    enabled = false,
    strictMode = false,
    allowedContexts = [],
    severity = SEVERITY_LEVELS.MEDIUM,
  } = options;

  // Only create the guardrail if explicitly enabled
  if (!enabled) {
    return createInputGuardrail(
      'math-homework-detector',
      'Math homework detection (disabled)',
      () => ({ tripwireTriggered: false }),
    );
  }

  const mathKeywords = [
    'solve',
    'calculate',
    'equation',
    'homework',
    'assignment',
    'problem set',
  ];

  const mathPatterns = [
    /\b\d+\s*[+\-*/]\s*\d+/g,
    /\b[xy]\s*[+\-*/=]\s*\d+/g,
    /\b(derivative|integral|limit|theorem|proof)/gi,
    /find\s+the\s+(value|solution|answer)/i,
  ];

  // Educational contexts that should be allowed
  const educationalContexts = [
    'learning',
    'teaching',
    'education',
    'tutorial',
    'explanation',
    'concept',
    'theory',
    'understanding',
    'study',
    'research',
  ];

  return createInputGuardrail(
    'math-homework-detector',
    'Policy-based detection of math homework requests',
    (context) => {
      const content = extractTextContent(context);

      // Check if context suggests educational use
      const hasEducationalContext = educationalContexts.some((ctx) =>
        content.allTextLower.includes(ctx),
      );

      const hasAllowedContext = allowedContexts.some((ctx) =>
        content.allTextLower.includes(ctx.toLowerCase()),
      );

      // Skip detection if educational context is present
      if (hasEducationalContext || hasAllowedContext) {
        return {
          tripwireTriggered: false,
          metadata: createStandardMetadata('GR-IN-007', context, {
            educationalContext: hasEducationalContext,
            allowedContext: hasAllowedContext,
            policy: 'educational-use-allowed',
          }),
        };
      }

      const keywordMatches = mathKeywords.filter((keyword) =>
        content.allTextLower.includes(keyword),
      );
      const patternMatches = mathPatterns.filter((pattern) =>
        pattern.test(content.allText),
      );

      // Adjust detection logic based on strict mode
      const isMathHomework = strictMode
        ? keywordMatches.length >= 2 && patternMatches.length > 0
        : keywordMatches.length >= 2 || patternMatches.length > 0;

      const metadata = createStandardMetadata('GR-IN-007', context, {
        keywordMatches,
        patternMatches: patternMatches.length,
        strictMode,
        confidence: isMathHomework ? 0.85 : 0.15,
        policy: 'homework-detection',
      });

      return {
        tripwireTriggered: isMathHomework,
        message: isMathHomework ? 'Math homework request detected' : undefined,
        severity,
        metadata,
        suggestion:
          'Try asking about learning concepts instead of solving specific problems',
      };
    },
  );
};

// Enhanced code generation limiter with canonical language names and modes
export type CodeGenerationMode = 'deny' | 'allow-only';

export interface CodeGenerationOptions {
  allowedLanguages?: string[];
  deniedLanguages?: string[];
  mode?: CodeGenerationMode;
  severity?: SeverityLevel;
}

// cspell:ignore cplusplus aspnet laravel symfony
// Canonical language mapping
const LANGUAGE_ALIASES: Record<string, string> = {
  javascript: 'javascript',
  js: 'javascript',
  node: 'javascript',
  react: 'javascript',
  angular: 'javascript',
  vue: 'javascript',
  python: 'python',
  py: 'python',
  django: 'python',
  flask: 'python',
  pandas: 'python',
  java: 'java',
  spring: 'java',
  hibernate: 'java',
  'c++': 'cpp',
  cpp: 'cpp',
  'c plus plus': 'cpp',
  cplusplus: 'cpp',
  'c#': 'csharp',
  csharp: 'csharp',
  dotnet: 'csharp',
  'asp.net': 'csharp',
  aspnet: 'csharp',
  php: 'php',
  laravel: 'php',
  symfony: 'php',
  ruby: 'ruby',
  rails: 'ruby',
  gem: 'ruby',
  go: 'go',
  golang: 'go',
  rust: 'rust',
  cargo: 'rust',
  sql: 'sql',
  mysql: 'sql',
  postgresql: 'sql',
  oracle: 'sql',
  typescript: 'typescript',
  ts: 'typescript',
  html: 'html',
  css: 'css',
  scss: 'css',
  sass: 'css',
};

function normalizeLanguageName(input: string): string {
  return LANGUAGE_ALIASES[input.toLowerCase()] || input.toLowerCase();
}

export const codeGenerationLimiter = (
  options: CodeGenerationOptions | string[] = {},
): InputGuardrail => {
  const opts = Array.isArray(options)
    ? {
        allowedLanguages: options,
        mode: 'allow-only' as const,
        severity: SEVERITY_LEVELS.MEDIUM,
      }
    : {
        mode: 'allow-only' as const,
        severity: SEVERITY_LEVELS.MEDIUM,
        ...options,
      };

  const codeKeywords = [
    'write code',
    'generate code',
    'create function',
    'implement',
    'script',
    'code example',
    'show me code',
    'write a function',
    'create a class',
  ];

  const languagePatterns = {
    javascript: /\b(javascript|js|node|react|angular|vue|typescript|ts)\b/gi,
    python: /\b(python|py|django|flask|pandas)\b/gi,
    java: /\b(java|spring|hibernate)\b/gi,
    cpp: /\b(c\+\+|cpp|c plus plus|cplusplus)\b/gi,
    csharp: /\b(c#|csharp|dotnet|asp\.net|aspnet)\b/gi,
    php: /\b(php|laravel|symfony)\b/gi,
    ruby: /\b(ruby|rails|gem)\b/gi,
    go: /\b(golang|go)\b/gi,
    rust: /\b(rust|cargo)\b/gi,
    sql: /\b(sql|mysql|postgresql|oracle)\b/gi,
    html: /\b(html|htm)\b/gi,
    css: /\b(css|scss|sass)\b/gi,
  };

  return createInputGuardrail(
    'code-generation-limiter',
    'Limits code generation with canonical language names and policy modes',
    (context) => {
      const content = extractTextContent(context);

      const hasCodeRequest = codeKeywords.some((keyword) =>
        content.allTextLower.includes(keyword),
      );

      if (!hasCodeRequest) {
        return {
          tripwireTriggered: false,
          metadata: createStandardMetadata('GR-IN-008', context, {
            hasCodeRequest: false,
            mode: opts.mode,
          }),
        };
      }

      const detectedLanguages: string[] = [];
      for (const [lang, pattern] of Object.entries(languagePatterns)) {
        if (pattern.test(content.allText)) {
          detectedLanguages.push(normalizeLanguageName(lang));
        }
      }

      const uniqueLanguages = [...new Set(detectedLanguages)];

      let isBlocked = false;
      let blockedLanguages: string[] = [];

      if (opts.mode === 'deny') {
        // Deny mode: block if any detected language is in denied list
        blockedLanguages = uniqueLanguages.filter((lang) =>
          opts.deniedLanguages?.includes(lang),
        );
        isBlocked = blockedLanguages.length > 0;
      } else {
        // Allow-only mode: block if any detected language is not in allowed list
        blockedLanguages = uniqueLanguages.filter(
          (lang) => !opts.allowedLanguages?.includes(lang),
        );
        isBlocked = blockedLanguages.length > 0;
      }

      const metadata = createStandardMetadata('GR-IN-008', context, {
        hasCodeRequest,
        detectedLanguages: uniqueLanguages,
        blockedLanguages,
        allowedLanguages: opts.allowedLanguages,
        deniedLanguages: opts.deniedLanguages,
        mode: opts.mode,
      });

      return {
        tripwireTriggered: isBlocked,
        message: isBlocked
          ? `Code generation blocked for language(s): ${blockedLanguages.join(', ')}`
          : undefined,
        severity: opts.severity,
        metadata,
        suggestion:
          opts.mode === 'deny'
            ? `Please avoid requesting code in these languages: ${opts.deniedLanguages?.join(', ')}`
            : `Please request code only in allowed languages: ${opts.allowedLanguages?.join(', ')}`,
      };
    },
  );
};

/**
 * Allowed tools guardrail that validates tool calls against allowed/denied lists
 * This guardrail works with the AI SDK's tool system to prevent unauthorized tool usage
 */
export interface AllowedToolsOptions {
  /** List of explicitly allowed tool names - REQUIRED for security */
  allowedTools: string[];
  /** List of explicitly denied tool names (takes precedence over allowed) */
  deniedTools?: string[];
  /** Custom tool validation function */
  customValidator?: (
    toolName: string,
    context: InputGuardrailContext,
  ) => boolean;
  /** Whether to detect tool calls in natural language requests */
  detectNaturalLanguageTools?: boolean;
  /** Custom tool name patterns to detect in natural language */
  toolPatterns?: RegExp[];
}

// Helper function to extract tool calls from AI SDK context
function extractToolCalls(context: InputGuardrailContext): string[] {
  const { messages } = extractTextContent(context);
  const toolCalls: string[] = [];

  // Look for tool calls in messages (AI SDK pattern)
  for (const message of messages) {
    if (message && typeof message === 'object' && 'toolCalls' in message) {
      const messageWithToolCalls = message as {
        toolCalls?: Array<{ toolName?: string }>;
      };
      const toolCallsArray = messageWithToolCalls.toolCalls;
      if (Array.isArray(toolCallsArray)) {
        for (const toolCall of toolCallsArray) {
          if (
            toolCall &&
            typeof toolCall === 'object' &&
            'toolName' in toolCall
          ) {
            toolCalls.push(String(toolCall.toolName));
          }
        }
      }
    }
  }

  return toolCalls;
}

// Helper function to detect tool usage in natural language
function detectNaturalLanguageToolRequests(
  text: string,
  patterns: RegExp[],
): string[] {
  const detectedTools: string[] = [];

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      for (const match of matches) {
        // Extract tool name from match - more precise extraction
        const toolMatch = match.match(/(\w+)/);
        if (toolMatch && toolMatch[1]) {
          const toolName = toolMatch[1].toLowerCase();
          // Filter out common English words that aren't tools
          const commonWords = new Set([
            'the',
            'and',
            'or',
            'but',
            'in',
            'on',
            'at',
            'to',
            'for',
            'of',
            'with',
            'by',
            'use',
            'call',
            'run',
            'execute',
            'get',
            'set',
            'make',
            'take',
            'give',
            'put',
          ]);
          if (!commonWords.has(toolName) && toolName.length > 2) {
            detectedTools.push(toolName);
          }
        }
      }
    }
  }

  return [...new Set(detectedTools)]; // Remove duplicates
}

export const allowedToolsGuardrail = (
  options: AllowedToolsOptions,
): InputGuardrail => {
  const {
    allowedTools,
    deniedTools = [],
    customValidator,
    detectNaturalLanguageTools = false, // Default to false for security
    toolPatterns = [
      // More specific patterns that indicate actual tool usage
      /use\s+the\s+(\w+)\s+tool/gi,
      /call\s+the\s+(\w+)\s+function/gi,
      /execute\s+(\w+)/gi,
      /run\s+(\w+)/gi,
      /invoke\s+(\w+)/gi,
      /trigger\s+(\w+)/gi,
    ],
  } = options;

  // Validate required configuration
  if (!allowedTools || allowedTools.length === 0) {
    throw new Error(
      'allowedToolsGuardrail requires a non-empty allowedTools array for security',
    );
  }

  return createInputGuardrail(
    'allowed-tools-guardrail',
    'Validates tool usage against allowed/denied lists',
    (context) => {
      const { prompt, messages, system } = extractTextContent(context);
      const allText = [
        prompt,
        ...messages.map((msg: MessageContent) => String(msg?.content || '')),
        system,
      ].join(' ');

      // Extract tool calls from AI SDK context
      const contextToolCalls = extractToolCalls(context);

      // Detect natural language tool requests if enabled
      const naturalLanguageTools = detectNaturalLanguageTools
        ? detectNaturalLanguageToolRequests(allText, toolPatterns)
        : [];

      // Combine all detected tools
      const allDetectedTools = [
        ...new Set([...contextToolCalls, ...naturalLanguageTools]),
      ];

      if (allDetectedTools.length === 0) {
        return {
          tripwireTriggered: false,
          metadata: {
            detectedTools: [],
            allowedTools,
            deniedTools,
            detectionMethod: 'none',
          },
        };
      }

      const violations: string[] = [];
      const blockedTools: string[] = [];

      for (const toolName of allDetectedTools) {
        // Check denied tools first (takes precedence)
        if (deniedTools.includes(toolName)) {
          violations.push(`Tool '${toolName}' is explicitly denied`);
          blockedTools.push(toolName);
          continue;
        }

        // Check custom validator
        if (customValidator && !customValidator(toolName, context)) {
          violations.push(`Tool '${toolName}' failed custom validation`);
          blockedTools.push(toolName);
          continue;
        }

        // Check allowed tools list (required - no default allow)
        if (!allowedTools.includes(toolName)) {
          violations.push(
            `Tool '${toolName}' is not in the allowed tools list`,
          );
          blockedTools.push(toolName);
          continue;
        }
      }

      if (violations.length > 0) {
        return {
          tripwireTriggered: true,
          message: `Unauthorized tool usage detected: ${violations.join('; ')}`,
          severity: blockedTools.some((tool) => deniedTools.includes(tool))
            ? 'critical'
            : 'high',
          metadata: {
            detectedTools: allDetectedTools,
            blockedTools,
            violations,
            allowedTools,
            deniedTools,
            contextToolCalls,
            naturalLanguageTools,
            textLength: allText.length,
          },
          suggestion:
            'Remove unauthorized tool calls or update the allowed tools configuration',
        };
      }

      return {
        tripwireTriggered: false,
        metadata: {
          detectedTools: allDetectedTools,
          allToolsAllowed: true,
          allowedTools,
          deniedTools,
          contextToolCalls,
          naturalLanguageTools,
        },
      };
    },
  );
};
