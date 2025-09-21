import { createInputGuardrail, type InputGuardrail } from '../core';
import type { InputGuardrailContext } from '../types';

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

// Simple property checkers
function isEmbedParams(context: InputGuardrailContext): boolean {
  return 'value' in context && !('prompt' in context);
}

function hasContextProperty(
  context: InputGuardrailContext,
): context is InputGuardrailContext & ContextWithUser {
  return 'context' in context;
}

// Helper function to safely extract text content from different input types
export function extractTextContent(context: InputGuardrailContext): {
  prompt: string;
  messages: Array<{ content?: unknown }>;
  system: string;
} {
  // Handle embed params - only has 'value' property
  if (isEmbedParams(context)) {
    const embedContext = context as { value: unknown };
    return {
      prompt: String(embedContext.value || ''),
      messages: [],
      system: '',
    };
  }

  // Handle other AI SDK params that have prompt/messages/system
  const textContext = context as {
    prompt?: string;
    messages?: MessageContent[];
    system?: string;
  };
  return {
    prompt: textContext.prompt || '',
    messages: textContext.messages || [],
    system: textContext.system || '',
  };
}

// Helper function to safely extract metadata from context
export function extractMetadata(context: InputGuardrailContext): {
  model?: unknown;
  temperature?: number;
  maxOutputTokens?: number;
} {
  const contextWithMetadata = context as {
    model?: unknown;
    temperature?: number;
    maxOutputTokens?: number;
  };
  return {
    model: contextWithMetadata.model,
    temperature: contextWithMetadata.temperature,
    maxOutputTokens: contextWithMetadata.maxOutputTokens,
  };
}

export const lengthLimit = (maxLength: number): InputGuardrail =>
  createInputGuardrail(
    'length-limit',
    'Enforces maximum input length limit',
    (context) => {
      const { prompt, messages, system } = extractTextContent(context);
      const { model, temperature, maxOutputTokens } = extractMetadata(context);

      const totalLength =
        prompt.length +
        messages.reduce(
          (sum: number, msg: MessageContent) =>
            sum + String(msg?.content || '').length,
          0,
        ) +
        system.length;

      return {
        tripwireTriggered: totalLength > maxLength,
        message: `Input length ${totalLength} exceeds limit of ${maxLength}`,
        severity: 'medium' as const,
        metadata: {
          totalLength,
          maxLength,
          model: model ? String(model) : undefined,
          temperature,
          maxOutputTokens,
          messageCount: messages.length,
        },
      };
    },
  );

export const blockedWords = (words: string[]): InputGuardrail =>
  createInputGuardrail(
    'blocked-words',
    'Blocks input containing specified words',
    (context) => {
      const { prompt, messages, system } = extractTextContent(context);
      const allText = [
        prompt,
        ...messages.map((msg: MessageContent) => String(msg?.content || '')),
        system,
      ]
        .join(' ')
        .toLowerCase();

      const blockedWord = words.find((word) =>
        allText.includes(word.toLowerCase()),
      );

      return {
        tripwireTriggered: !!blockedWord,
        message: blockedWord
          ? `Blocked word detected: ${blockedWord}`
          : undefined,
        severity: 'high' as const,
        metadata: {
          blockedWord,
          allWords: words,
        },
      };
    },
  );

export const contentLengthLimit = (maxLength: number): InputGuardrail =>
  createInputGuardrail(
    'content-length-limit',
    'Enforces maximum content length limit',
    (context) => {
      const { prompt, messages, system } = extractTextContent(context);
      const totalLength =
        prompt.length +
        messages.reduce(
          (sum: number, msg: MessageContent) =>
            sum + String(msg?.content || '').length,
          0,
        ) +
        system.length;

      return {
        tripwireTriggered: totalLength > maxLength,
        message: `Content length ${totalLength} exceeds limit of ${maxLength}`,
        severity: 'medium' as const,
        metadata: {
          totalLength,
          maxLength,
        },
      };
    },
  );

export const blockedKeywords = (keywords: string[]): InputGuardrail =>
  createInputGuardrail(
    'blocked-keywords',
    'Blocks input containing specified keywords',
    (context) => {
      const { prompt, messages, system } = extractTextContent(context);
      const allText = [
        prompt,
        ...messages.map((msg: MessageContent) => String(msg?.content || '')),
        system,
      ]
        .join(' ')
        .toLowerCase();

      const blockedWord = keywords.find((word) =>
        allText.includes(word.toLowerCase()),
      );

      return {
        tripwireTriggered: !!blockedWord,
        message: blockedWord
          ? `Blocked keyword detected: ${blockedWord}`
          : undefined,
        severity: 'high' as const,
        metadata: {
          blockedWord,
          allKeywords: keywords,
          textLength: allText.length,
        },
      };
    },
  );

export const rateLimiting = (maxRequestsPerMinute: number): InputGuardrail => {
  const requestCounts = new Map<string, { count: number; resetTime: number }>();

  return createInputGuardrail(
    'rate-limiting',
    'Enforces rate limiting per minute',
    (inputContext) => {
      const { prompt } = extractTextContent(inputContext);
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
      const windowMs = 60_000; // 1 minute

      const current = requestCounts.get(key) || {
        count: 0,
        resetTime: now + windowMs,
      };

      if (now > current.resetTime) {
        current.count = 0;
        current.resetTime = now + windowMs;
      }

      current.count++;
      requestCounts.set(key, current);

      return {
        tripwireTriggered: current.count > maxRequestsPerMinute,
        message: `Rate limit exceeded: ${current.count}/${maxRequestsPerMinute} requests per minute`,
        severity: 'medium' as const,
        metadata: {
          currentCount: current.count,
          maxRequests: maxRequestsPerMinute,
          resetTime: current.resetTime,
          userId: contextData?.user?.id,
          userIp: contextData?.request?.ip,
          model: model ? String(model) : undefined,
          temperature,
          maxOutputTokens,
          promptLength: prompt.length,
        },
      };
    },
  );
};

export const profanityFilter = (customWords: string[] = []): InputGuardrail => {
  const defaultProfanity = ['profanity1', 'profanity2']; // Add actual profanity words
  const allWords = [...defaultProfanity, ...customWords];

  return createInputGuardrail(
    'profanity-filter',
    'Filters profanity and inappropriate language',
    (context) => {
      const { prompt, messages, system } = extractTextContent(context);
      const allText = [
        prompt,
        ...messages.map((msg: MessageContent) => String(msg?.content || '')),
        system,
      ]
        .join(' ')
        .toLowerCase();

      const profaneWord = allWords.find((word: string) =>
        allText.includes(word.toLowerCase()),
      );

      return {
        tripwireTriggered: !!profaneWord,
        message: profaneWord ? `Profanity detected: ${profaneWord}` : undefined,
        severity: 'high' as const,
        metadata: {
          profaneWord,
          allWords,
          textLength: allText.length,
        },
      };
    },
  );
};

type CustomValidationInput = {
  prompt?: string;
  messages?: unknown[];
  system?: string;
  model?: unknown;
  temperature?: number;
  maxOutputTokens?: number;
};

/* eslint-disable no-unused-vars */
type CustomValidationFn = (payload: CustomValidationInput) => boolean;

export const customValidation = (
  name: string,
  description: string,
  validator: CustomValidationFn,
  message: string,
): InputGuardrail => {
  return createInputGuardrail(name, description, (context) => {
    const { prompt, messages, system } = extractTextContent(context);
    const { model, temperature, maxOutputTokens } = extractMetadata(context);

    const validatorInput: CustomValidationInput = {
      prompt,
      messages,
      system,
      model,
      temperature,
      maxOutputTokens,
    };
    const blocked = validator(validatorInput);
    return {
      tripwireTriggered: blocked,
      message: blocked ? message : undefined,
      severity: 'medium' as const,
      metadata: {
        validatorName: name,
        inputKeys: Object.keys(validatorInput),
        model: model ? String(model) : undefined,
        temperature,
        maxOutputTokens,
      },
    };
  });
};

export const promptInjectionDetector = (): InputGuardrail =>
  createInputGuardrail(
    'prompt-injection-detector',
    'Detects potential prompt injection attempts',
    (context) => {
      const { prompt, messages, system } = extractTextContent(context);
      const allText = [
        prompt,
        ...messages.map((msg: MessageContent) => String(msg?.content || '')),
        system,
      ].join(' ');

      const injectionPatterns = [
        /ignore\s+previous\s+instructions/i,
        /system\s*:\s*you\s+are\s+now/i,
        /forget\s+everything\s+above/i,
        /\bDAN\b.*mode/i,
        /jailbreak/i,
        /act\s+as\s+if\s+you\s+are/i,
        /pretend\s+to\s+be/i,
        /role\s*:\s*system/i,
      ];

      const detectedPatterns = injectionPatterns.filter((pattern) =>
        pattern.test(allText),
      );

      return {
        tripwireTriggered: detectedPatterns.length > 0,
        message:
          detectedPatterns.length > 0
            ? `Potential prompt injection detected: ${detectedPatterns.length} suspicious patterns found`
            : undefined,
        severity: 'critical' as const,
        metadata: {
          patternsDetected: detectedPatterns.length,
          textLength: allText.length,
          suspiciousPatterns: detectedPatterns.map((p) => p.source),
        },
        suggestion:
          'Please rephrase your request without system instructions or role-playing elements',
      };
    },
  );

export const piiDetector = (): InputGuardrail =>
  createInputGuardrail(
    'pii-detector',
    'Detects personally identifiable information in input',
    (context) => {
      const { prompt, messages, system } = extractTextContent(context);
      const allText = [
        prompt,
        ...messages.map((msg: MessageContent) => String(msg?.content || '')),
        system,
      ].join(' ');

      const piiPatterns = {
        email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
        phone:
          /\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g,
        ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
        creditCard: /\b(?:\d{4}[\s-]?){3}\d{4}\b/g,
        ipAddress:
          /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
      };

      const detectedPII = [];
      const matches = [];

      for (const [type, pattern] of Object.entries(piiPatterns)) {
        const found = allText.match(pattern);
        if (found) {
          detectedPII.push(type);
          matches.push(...found);
        }
      }

      return {
        tripwireTriggered: detectedPII.length > 0,
        message:
          detectedPII.length > 0
            ? `PII detected: ${detectedPII.join(', ')}`
            : undefined,
        severity: 'critical' as const,
        metadata: {
          piiTypes: detectedPII,
          matchCount: matches.length,
          textLength: allText.length,
        },
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

export const mathHomeworkDetector = (): InputGuardrail =>
  createInputGuardrail(
    'math-homework-detector',
    'Detects potential math homework requests',
    (context) => {
      const { prompt, messages, system } = extractTextContent(context);
      const allText = [
        prompt,
        ...messages.map((msg: MessageContent) => String(msg?.content || '')),
        system,
      ].join(' ');

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

      const keywordMatches = mathKeywords.filter((keyword) =>
        allText.toLowerCase().includes(keyword),
      );
      const patternMatches = mathPatterns.filter((pattern) =>
        pattern.test(allText),
      );

      const isMathHomework =
        keywordMatches.length >= 2 || patternMatches.length > 0;

      return {
        tripwireTriggered: isMathHomework,
        message: isMathHomework ? 'Math homework request detected' : undefined,
        severity: 'high' as const,
        metadata: {
          keywordMatches,
          patternMatches: patternMatches.length,
          textLength: allText.length,
          confidence: isMathHomework ? 0.85 : 0.15,
        },
        suggestion:
          'Try asking about learning concepts instead of solving specific problems',
      };
    },
  );

export const codeGenerationLimiter = (
  allowedLanguages: string[] = [],
): InputGuardrail =>
  createInputGuardrail(
    'code-generation-limiter',
    'Limits code generation to specified languages',
    (context) => {
      const { prompt, messages, system } = extractTextContent(context);
      const allText = [
        prompt,
        ...messages.map((msg: MessageContent) => String(msg?.content || '')),
        system,
      ]
        .join(' ')
        .toLowerCase();

      const codeKeywords = [
        'write code',
        'generate code',
        'create function',
        'implement',
        'script',
      ];
      const languagePatterns = {
        javascript: /\b(javascript|js|node|react|angular|vue)\b/gi,
        python: /\b(python|py|django|flask|pandas)\b/gi,
        java: /\b(java|spring|hibernate)\b/gi,
        cpp: /\b(c\+\+|cpp|c plus plus)\b/gi,
        csharp: /\b(c#|csharp|dotnet|asp\.net)\b/gi,
        php: /\b(php|laravel|symfony)\b/gi,
        ruby: /\b(ruby|rails|gem)\b/gi,
        go: /\b(golang|go)\b/gi,
        rust: /\b(rust|cargo)\b/gi,
        sql: /\b(sql|mysql|postgresql|oracle)\b/gi,
      };

      const hasCodeRequest = codeKeywords.some((keyword) =>
        allText.includes(keyword),
      );
      const detectedLanguages = [];

      for (const [lang, pattern] of Object.entries(languagePatterns)) {
        if (pattern.test(allText)) {
          detectedLanguages.push(lang);
        }
      }

      const hasRestrictedLanguage =
        hasCodeRequest &&
        detectedLanguages.length > 0 &&
        !detectedLanguages.some((lang) => allowedLanguages.includes(lang));

      return {
        tripwireTriggered: hasRestrictedLanguage,
        message: hasRestrictedLanguage
          ? `Code generation requested for restricted language(s): ${detectedLanguages.join(', ')}`
          : undefined,
        severity: 'medium' as const,
        metadata: {
          hasCodeRequest,
          detectedLanguages,
          allowedLanguages,
          textLength: allText.length,
        },
        suggestion:
          allowedLanguages.length > 0
            ? `Please request code only in allowed languages: ${allowedLanguages.join(', ')}`
            : 'Code generation is not allowed',
      };
    },
  );
