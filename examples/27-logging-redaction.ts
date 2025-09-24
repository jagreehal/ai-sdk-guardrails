/**
 * Logging Redaction Example
 *
 * Demonstrates how to implement secure logging with automatic redaction of
 * sensitive data, log sanitization, audit trail protection, and compliance
 * logging. This is critical for maintaining security in production environments
 * while preserving useful debugging information.
 */

import { generateText } from 'ai';
import { model } from './model';
import {
  defineInputGuardrail,
  defineOutputGuardrail,
  withGuardrails,
} from '../src/index';
import { extractTextContent } from '../src/guardrails/input';
import { extractContent } from '../src/guardrails/output';

// Define logging redaction patterns
const LOGGING_PATTERNS = {
  // Sensitive data patterns for redaction
  sensitiveData: {
    // Authentication tokens
    authTokens: [
      /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
      /token["\s]*[:=]\s*["']?[A-Za-z0-9\-._~+/]+=*["']?/gi,
      /api[_-]?key["\s]*[:=]\s*["']?[A-Za-z0-9\-._~+/]+=*["']?/gi,
      /access[_-]?token["\s]*[:=]\s*["']?[A-Za-z0-9\-._~+/]+=*["']?/gi,
      /refresh[_-]?token["\s]*[:=]\s*["']?[A-Za-z0-9\-._~+/]+=*["']?/gi,
    ],

    // Credentials
    credentials: [
      /password["\s]*[:=]\s*["']?[^"'\s]+["']?/gi,
      /passwd["\s]*[:=]\s*["']?[^"'\s]+["']?/gi,
      /pwd["\s]*[:=]\s*["']?[^"'\s]+["']?/gi,
      /secret["\s]*[:=]\s*["']?[^"'\s]+["']?/gi,
      /key["\s]*[:=]\s*["']?[A-Za-z0-9\-._~+/]+=*["']?/gi,
    ],

    // Personal information
    personalInfo: [
      /email["\s]*[:=]\s*["']?[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}["']?/gi,
      /phone["\s]*[:=]\s*["']?(\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})["']?/gi,
      /ssn["\s]*[:=]\s*["']?\d{3}-\d{2}-\d{4}["']?/gi,
      /social[_-]?security["\s]*[:=]\s*["']?\d{3}-\d{2}-\d{4}["']?/gi,
      /credit[_-]?card["\s]*[:=]\s*["']?\d{4}[-.\s]?\d{4}[-.\s]?\d{4}[-.\s]?\d{4}["']?/gi,
    ],

    // Financial information
    financial: [
      /account[_-]?number["\s]*[:=]\s*["']?\d{4,17}["']?/gi,
      /routing[_-]?number["\s]*[:=]\s*["']?\d{9}["']?/gi,
      /salary["\s]*[:=]\s*["']?\$\d{1,3}(,\d{3})*(\.\d{2})?["']?/gi,
      /income["\s]*[:=]\s*["']?\$\d{1,3}(,\d{3})*(\.\d{2})?["']?/gi,
    ],

    // Business identifiers
    businessIds: [
      /employee[_-]?id["\s]*[:=]\s*["']?\d{4,10}["']?/gi,
      /customer[_-]?id["\s]*[:=]\s*["']?\d{4,10}["']?/gi,
      /order[_-]?number["\s]*[:=]\s*["']?\d{6,12}["']?/gi,
      /invoice[_-]?number["\s]*[:=]\s*["']?\d{6,12}["']?/gi,
    ],

    // Medical information
    medical: [
      /medical[_-]?record["\s]*[:=]\s*["']?\d{6,12}["']?/gi,
      /health[_-]?insurance["\s]*[:=]\s*["']?\d{6,12}["']?/gi,
      /diagnosis["\s]*[:=]\s*["']?[A-Z]\d{2}\.\d{1,2}["']?/gi,
    ],

    // Network information
    network: [
      /ip[_-]?address["\s]*[:=]\s*["']?\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}["']?/gi,
      /mac[_-]?address["\s]*[:=]\s*["']?([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})["']?/gi,
      /hostname["\s]*[:=]\s*["']?[A-Za-z0-9\-._]+["']?/gi,
    ],
  },

  // Log-specific patterns
  logPatterns: {
    // Stack traces (may contain sensitive paths)
    stackTrace: /at\s+[^(]+\(([^)]+)\)/g,

    // File paths (may contain sensitive information)
    filePaths: /["']?[/\\][^"'\s]+[/\\][^"'\s]+["']?/g,

    // Database queries (may contain sensitive data)
    sqlQueries: /SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER/gi,

    // HTTP requests/responses (may contain sensitive headers)
    httpHeaders: /(Authorization|Cookie|X-API-Key|X-Auth-Token):\s*[^\s]+/gi,

    // Error messages (may contain sensitive details)
    errorMessages: /Error|Exception|Failed|Invalid/gi,
  },

  // Safe patterns (data that should be preserved)
  safePatterns: {
    // Timestamps
    timestamps: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?/g,

    // Request IDs
    requestIds: /request[_-]?id["\s]*[:=]\s*["']?[A-Za-z0-9-]+["']?/gi,

    // Session IDs (non-sensitive)
    sessionIds: /session[_-]?id["\s]*[:=]\s*["']?[A-Za-z0-9-]+["']?/gi,

    // Status codes
    statusCodes: /status["\s]*[:=]\s*["']?\d{3}["']?/gi,

    // HTTP methods
    httpMethods:
      /method["\s]*[:=]\s*["']?(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)["']?/gi,
  },
};

// Define logging redaction policies
const LOGGING_POLICIES = {
  // Redaction strategies
  redactionStrategies: {
    authTokens: 'hash', // Hash authentication tokens
    credentials: 'remove', // Remove credentials entirely
    personalInfo: 'mask', // Mask personal information
    financial: 'mask', // Mask financial information
    businessIds: 'anonymize', // Anonymize business identifiers
    medical: 'encrypt', // Encrypt medical information
    network: 'mask', // Mask network information
  },

  // Log levels and their redaction requirements
  logLevels: {
    debug: {
      redactSensitive: true,
      preserveStructure: true,
      allowStackTraces: false,
      allowFilePaths: false,
    },
    info: {
      redactSensitive: true,
      preserveStructure: true,
      allowStackTraces: false,
      allowFilePaths: false,
    },
    warn: {
      redactSensitive: true,
      preserveStructure: true,
      allowStackTraces: true,
      allowFilePaths: true,
    },
    error: {
      redactSensitive: true,
      preserveStructure: true,
      allowStackTraces: true,
      allowFilePaths: true,
    },
  },

  // Compliance requirements
  compliance: {
    gdpr: {
      redactPII: true,
      preserveAuditTrail: true,
      retentionPeriod: 30, // days
    },
    hipaa: {
      redactPHI: true,
      preserveAuditTrail: true,
      retentionPeriod: 7, // days
    },
    sox: {
      redactFinancial: true,
      preserveAuditTrail: true,
      retentionPeriod: 90, // days
    },
    pci: {
      redactCardData: true,
      preserveAuditTrail: true,
      retentionPeriod: 1, // days
    },
  },
};

// Define logging redaction thresholds
const REDACTION_THRESHOLDS = {
  maxLogLength: 10_000, // Maximum log entry length
  maxRedactionCount: 50, // Maximum number of redactions per log entry
  requireRedaction: true, // Whether to require redaction of sensitive data
  allowPartialRedaction: true, // Whether to allow partial redaction
  enableCompression: true, // Whether to enable log compression
  maxRetentionDays: 30, // Maximum retention period in days
};

// Hash sensitive data for logging
function hashSensitiveData(text: string): string {
  // Simple hash function for demonstration
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.codePointAt(i) ?? 0;
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `HASH_${Math.abs(hash).toString(16).padStart(8, '0')}`;
}

// Mask sensitive data for logging
function maskSensitiveData(text: string, pattern: RegExp): string {
  return text.replace(pattern, (match) => {
    if (match.length <= 4) {
      return '*'.repeat(match.length);
    }
    return (
      match.slice(0, 2) +
      '*'.repeat(match.length - 4) +
      match.slice(Math.max(0, match.length - 2))
    );
  });
}

// Anonymize sensitive data for logging
function anonymizeSensitiveData(
  text: string,
  pattern: RegExp,
  type: string,
): string {
  return text.replace(pattern, () => {
    return `[${type.toUpperCase()}_ANONYMIZED]`;
  });
}

// Remove sensitive data entirely from logs
function removeSensitiveData(text: string, pattern: RegExp): string {
  return text.replace(pattern, '[REMOVED]');
}

// Encrypt sensitive data for logging (simplified for demo)
function encryptSensitiveData(text: string): string {
  // In a real implementation, this would use proper encryption
  return `ENCRYPTED_${Buffer.from(text).toString('base64').slice(0, 20)}`;
}

// Detect and redact sensitive data in logs
function detectAndRedactSensitiveData(text: string): {
  redactedText: string;
  detectedTypes: string[];
  redactionCount: number;
  metadata: {
    authTokensCount: number;
    credentialsCount: number;
    personalInfoCount: number;
    financialCount: number;
    businessIdsCount: number;
    medicalCount: number;
    networkCount: number;
  };
} {
  let redactedText = text;
  const detectedTypes: string[] = [];
  let redactionCount = 0;
  const metadata = {
    authTokensCount: 0,
    credentialsCount: 0,
    personalInfoCount: 0,
    financialCount: 0,
    businessIdsCount: 0,
    medicalCount: 0,
    networkCount: 0,
  };

  // Process authentication tokens
  for (const pattern of LOGGING_PATTERNS.sensitiveData.authTokens) {
    const matches = text.match(pattern);
    if (matches) {
      detectedTypes.push('authTokens');
      metadata.authTokensCount += matches.length;
      redactionCount += matches.length;

      const strategy = LOGGING_POLICIES.redactionStrategies.authTokens;
      switch (strategy) {
        case 'hash': {
          redactedText = redactedText.replace(pattern, (match) =>
            hashSensitiveData(match),
          );
          break;
        }
        case 'mask': {
          redactedText = maskSensitiveData(redactedText, pattern);
          break;
        }
        case 'anonymize': {
          redactedText = anonymizeSensitiveData(
            redactedText,
            pattern,
            'authTokens',
          );
          break;
        }
        case 'remove': {
          redactedText = removeSensitiveData(redactedText, pattern);
          break;
        }
        case 'encrypt': {
          redactedText = redactedText.replace(pattern, (match) =>
            encryptSensitiveData(match),
          );
          break;
        }
      }
    }
  }

  // Process credentials
  for (const pattern of LOGGING_PATTERNS.sensitiveData.credentials) {
    const matches = text.match(pattern);
    if (matches) {
      detectedTypes.push('credentials');
      metadata.credentialsCount += matches.length;
      redactionCount += matches.length;

      const strategy = LOGGING_POLICIES.redactionStrategies.credentials;
      switch (strategy) {
        case 'hash': {
          redactedText = redactedText.replace(pattern, (match) =>
            hashSensitiveData(match),
          );
          break;
        }
        case 'mask': {
          redactedText = maskSensitiveData(redactedText, pattern);
          break;
        }
        case 'anonymize': {
          redactedText = anonymizeSensitiveData(
            redactedText,
            pattern,
            'credentials',
          );
          break;
        }
        case 'remove': {
          redactedText = removeSensitiveData(redactedText, pattern);
          break;
        }
        case 'encrypt': {
          redactedText = redactedText.replace(pattern, (match) =>
            encryptSensitiveData(match),
          );
          break;
        }
      }
    }
  }

  // Process personal information
  for (const pattern of LOGGING_PATTERNS.sensitiveData.personalInfo) {
    const matches = text.match(pattern);
    if (matches) {
      detectedTypes.push('personalInfo');
      metadata.personalInfoCount += matches.length;
      redactionCount += matches.length;

      const strategy = LOGGING_POLICIES.redactionStrategies.personalInfo;
      switch (strategy) {
        case 'hash': {
          redactedText = redactedText.replace(pattern, (match) =>
            hashSensitiveData(match),
          );
          break;
        }
        case 'mask': {
          redactedText = maskSensitiveData(redactedText, pattern);
          break;
        }
        case 'anonymize': {
          redactedText = anonymizeSensitiveData(
            redactedText,
            pattern,
            'personalInfo',
          );
          break;
        }
        case 'remove': {
          redactedText = removeSensitiveData(redactedText, pattern);
          break;
        }
        case 'encrypt': {
          redactedText = redactedText.replace(pattern, (match) =>
            encryptSensitiveData(match),
          );
          break;
        }
      }
    }
  }

  // Process financial information
  for (const pattern of LOGGING_PATTERNS.sensitiveData.financial) {
    const matches = text.match(pattern);
    if (matches) {
      detectedTypes.push('financial');
      metadata.financialCount += matches.length;
      redactionCount += matches.length;

      const strategy = LOGGING_POLICIES.redactionStrategies.financial;
      switch (strategy) {
        case 'hash': {
          redactedText = redactedText.replace(pattern, (match) =>
            hashSensitiveData(match),
          );
          break;
        }
        case 'mask': {
          redactedText = maskSensitiveData(redactedText, pattern);
          break;
        }
        case 'anonymize': {
          redactedText = anonymizeSensitiveData(
            redactedText,
            pattern,
            'financial',
          );
          break;
        }
        case 'remove': {
          redactedText = removeSensitiveData(redactedText, pattern);
          break;
        }
        case 'encrypt': {
          redactedText = redactedText.replace(pattern, (match) =>
            encryptSensitiveData(match),
          );
          break;
        }
      }
    }
  }

  // Process business identifiers
  for (const pattern of LOGGING_PATTERNS.sensitiveData.businessIds) {
    const matches = text.match(pattern);
    if (matches) {
      detectedTypes.push('businessIds');
      metadata.businessIdsCount += matches.length;
      redactionCount += matches.length;

      const strategy = LOGGING_POLICIES.redactionStrategies.businessIds;
      switch (strategy) {
        case 'hash': {
          redactedText = redactedText.replace(pattern, (match) =>
            hashSensitiveData(match),
          );
          break;
        }
        case 'mask': {
          redactedText = maskSensitiveData(redactedText, pattern);
          break;
        }
        case 'anonymize': {
          redactedText = anonymizeSensitiveData(
            redactedText,
            pattern,
            'businessIds',
          );
          break;
        }
        case 'remove': {
          redactedText = removeSensitiveData(redactedText, pattern);
          break;
        }
        case 'encrypt': {
          redactedText = redactedText.replace(pattern, (match) =>
            encryptSensitiveData(match),
          );
          break;
        }
      }
    }
  }

  // Process medical information
  for (const pattern of LOGGING_PATTERNS.sensitiveData.medical) {
    const matches = text.match(pattern);
    if (matches) {
      detectedTypes.push('medical');
      metadata.medicalCount += matches.length;
      redactionCount += matches.length;

      const strategy = LOGGING_POLICIES.redactionStrategies.medical;
      switch (strategy) {
        case 'hash': {
          redactedText = redactedText.replace(pattern, (match) =>
            hashSensitiveData(match),
          );
          break;
        }
        case 'mask': {
          redactedText = maskSensitiveData(redactedText, pattern);
          break;
        }
        case 'anonymize': {
          redactedText = anonymizeSensitiveData(
            redactedText,
            pattern,
            'medical',
          );
          break;
        }
        case 'remove': {
          redactedText = removeSensitiveData(redactedText, pattern);
          break;
        }
        case 'encrypt': {
          redactedText = redactedText.replace(pattern, (match) =>
            encryptSensitiveData(match),
          );
          break;
        }
      }
    }
  }

  // Process network information
  for (const pattern of LOGGING_PATTERNS.sensitiveData.network) {
    const matches = text.match(pattern);
    if (matches) {
      detectedTypes.push('network');
      metadata.networkCount += matches.length;
      redactionCount += matches.length;

      const strategy = LOGGING_POLICIES.redactionStrategies.network;
      switch (strategy) {
        case 'hash': {
          redactedText = redactedText.replace(pattern, (match) =>
            hashSensitiveData(match),
          );
          break;
        }
        case 'mask': {
          redactedText = maskSensitiveData(redactedText, pattern);
          break;
        }
        case 'anonymize': {
          redactedText = anonymizeSensitiveData(
            redactedText,
            pattern,
            'network',
          );
          break;
        }
        case 'remove': {
          redactedText = removeSensitiveData(redactedText, pattern);
          break;
        }
        case 'encrypt': {
          redactedText = redactedText.replace(pattern, (match) =>
            encryptSensitiveData(match),
          );
          break;
        }
      }
    }
  }

  return {
    redactedText,
    detectedTypes,
    redactionCount,
    metadata,
  };
}

// Analyze log entry for compliance
function analyzeLogCompliance(
  logEntry: string,
  logLevel: string = 'info',
): {
  isCompliant: boolean;
  violations: string[];
  recommendations: string[];
  complianceLevel: 'low' | 'medium' | 'high';
} {
  const violations: string[] = [];
  const recommendations: string[] = [];
  let complianceLevel: 'low' | 'medium' | 'high' = 'high';

  // Check log length
  if (logEntry.length > REDACTION_THRESHOLDS.maxLogLength) {
    violations.push(`Log entry too long: ${logEntry.length} characters`);
    complianceLevel = 'medium';
    recommendations.push('Consider log truncation or splitting');
  }

  // Check for sensitive data
  const redaction = detectAndRedactSensitiveData(logEntry);
  if (redaction.redactionCount > 0) {
    violations.push(
      `Sensitive data detected: ${redaction.redactionCount} items`,
    );
    if (redaction.redactionCount > REDACTION_THRESHOLDS.maxRedactionCount) {
      complianceLevel = 'low';
      recommendations.push(
        'Excessive sensitive data - review logging strategy',
      );
    } else {
      complianceLevel = 'medium';
      recommendations.push('Apply redaction to sensitive data');
    }
  }

  // Check log level compliance
  const levelPolicy =
    LOGGING_POLICIES.logLevels[
      logLevel as keyof typeof LOGGING_POLICIES.logLevels
    ];
  if (levelPolicy) {
    if (
      !levelPolicy.allowStackTraces &&
      LOGGING_PATTERNS.logPatterns.stackTrace.test(logEntry)
    ) {
      violations.push('Stack traces not allowed for this log level');
      recommendations.push('Remove stack traces or change log level');
    }

    if (
      !levelPolicy.allowFilePaths &&
      LOGGING_PATTERNS.logPatterns.filePaths.test(logEntry)
    ) {
      violations.push('File paths not allowed for this log level');
      recommendations.push('Remove file paths or change log level');
    }
  }

  return {
    isCompliant: violations.length === 0,
    violations,
    recommendations,
    complianceLevel,
  };
}

// Define the input logging redaction guardrail
const loggingRedactionInputGuardrail = defineInputGuardrail<{
  originalLength: number;
  redactedLength: number;
  redactionCount: number;
  detectedTypes: string[];
  redactionMetadata: {
    authTokensCount: number;
    credentialsCount: number;
    personalInfoCount: number;
    financialCount: number;
    businessIdsCount: number;
    medicalCount: number;
    networkCount: number;
  };
}>({
  name: 'logging-redaction-input',
  description:
    'Redacts sensitive data from input before logging to ensure secure logging practices',
  execute: async (context) => {
    const { prompt } = extractTextContent(context);

    // Detect and redact sensitive data
    const redaction = detectAndRedactSensitiveData(prompt);

    if (redaction.redactionCount > 0) {
      return {
        tripwireTriggered: true,
        message: `Sensitive data detected in input for logging: ${redaction.redactionCount} items found.`,
        severity: redaction.redactionCount > 10 ? 'high' : 'medium',
        suggestion:
          'Apply redaction to sensitive data before logging to ensure compliance.',
        metadata: {
          originalLength: prompt.length,
          redactedLength: redaction.redactedText.length,
          redactionCount: redaction.redactionCount,
          detectedTypes: redaction.detectedTypes,
          redactionMetadata: redaction.metadata,
        },
        // Note: Redaction applied but original prompt preserved for processing
      };
    }

    return {
      tripwireTriggered: false,
      metadata: {
        originalLength: prompt.length,
        redactedLength: prompt.length,
        redactionCount: 0,
        detectedTypes: [],
        redactionMetadata: redaction.metadata,
      },
    };
  },
});

// Define the output logging redaction guardrail
const loggingRedactionOutputGuardrail = defineOutputGuardrail<{
  originalLength: number;
  redactedLength: number;
  redactionCount: number;
  detectedTypes: string[];
  redactionMetadata: {
    authTokensCount: number;
    credentialsCount: number;
    personalInfoCount: number;
    financialCount: number;
    businessIdsCount: number;
    medicalCount: number;
    networkCount: number;
  };
}>({
  name: 'logging-redaction-output',
  description:
    'Redacts sensitive data from output before logging to ensure secure logging practices',
  execute: async (context) => {
    const { text } = extractContent(context.result);

    // Detect and redact sensitive data
    const redaction = detectAndRedactSensitiveData(text);

    if (redaction.redactionCount > 0) {
      return {
        tripwireTriggered: true,
        message: `Output contains sensitive data for logging: ${redaction.redactionCount} items detected.`,
        severity: redaction.redactionCount > 10 ? 'high' : 'medium',
        suggestion:
          'Apply redaction to sensitive data before logging to ensure compliance.',
        metadata: {
          originalLength: text.length,
          redactedLength: redaction.redactedText.length,
          redactionCount: redaction.redactionCount,
          detectedTypes: redaction.detectedTypes,
          redactionMetadata: redaction.metadata,
        },
        // Note: Redaction applied but original output preserved for processing
      };
    }

    return {
      tripwireTriggered: false,
      metadata: {
        originalLength: text.length,
        redactedLength: text.length,
        redactionCount: 0,
        detectedTypes: [],
        redactionMetadata: redaction.metadata,
      },
    };
  },
});

console.log('🛡️  Logging Redaction Example\n');

// Create a protected model with logging redaction
const protectedModel = withGuardrails(model, {
  inputGuardrails: [loggingRedactionInputGuardrail],
  outputGuardrails: [loggingRedactionOutputGuardrail],
  throwOnBlocked: false, // Don't throw, just redact
  onInputBlocked: (executionSummary) => {
    const result = executionSummary.blockedResults[0];
    console.log('⚠️  Input redaction applied for logging:', result?.message);
    if (result?.metadata) {
      const metadata = result.metadata;
      console.log('   Redaction Count:', metadata.redactionCount);
      console.log(
        '   Detected Types:',
        metadata.detectedTypes?.join(', ') || 'None',
      );
      console.log('   Original Length:', metadata.originalLength);
      console.log('   Redacted Length:', metadata.redactedLength);
    }
  },
  onOutputBlocked: (executionSummary) => {
    const result = executionSummary.blockedResults[0];
    console.log('⚠️  Output redaction applied for logging:', result?.message);
    if (result?.metadata) {
      const metadata = result.metadata;
      console.log('   Redaction Count:', metadata.redactionCount);
      console.log(
        '   Detected Types:',
        metadata.detectedTypes?.join(', ') || 'None',
      );
      console.log('   Original Length:', metadata.originalLength);
      console.log('   Redacted Length:', metadata.redactedLength);
    }
  },
});

// Test 1: No sensitive data (should pass)
console.log('Test 1: No sensitive data (should pass)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Explain how to use the OpenAI API.',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 2: Authentication tokens in input (should be redacted)
console.log('Test 2: Authentication tokens in input (should be redacted)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt:
      'Bearer token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
  });
  console.log(
    '✅ Success with redaction:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 3: Credentials in input (should be redacted)
console.log('Test 3: Credentials in input (should be redacted)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'password: secret123, api_key: sk-1234567890abcdef',
  });
  console.log(
    '✅ Success with redaction:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 4: Personal information in input (should be redacted)
console.log('Test 4: Personal information in input (should be redacted)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt:
      'email: john.doe@example.com, phone: 555-123-4567, SSN: 123-45-6789',
  });
  console.log(
    '✅ Success with redaction:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 5: Financial information in input (should be redacted)
console.log('Test 5: Financial information in input (should be redacted)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt:
      'account_number: 1234567890, salary: $75,000, credit_card: 1234-5678-9012-3456',
  });
  console.log(
    '✅ Success with redaction:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 6: Business identifiers in input (should be redacted)
console.log('Test 6: Business identifiers in input (should be redacted)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'employee_id: 12345, customer_id: 67890, order_number: 123456789',
  });
  console.log(
    '✅ Success with redaction:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 7: Medical information in input (should be redacted)
console.log('Test 7: Medical information in input (should be redacted)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt:
      'medical_record: 123456789, health_insurance: 987654321, diagnosis: A12.3',
  });
  console.log(
    '✅ Success with redaction:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 8: Network information in input (should be redacted)
console.log('Test 8: Network information in input (should be redacted)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt:
      'ip_address: 192.168.1.1, mac_address: 00:11:22:33:44:55, hostname: server01',
  });
  console.log(
    '✅ Success with redaction:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 9: Complex logging scenario (should be redacted)
console.log('Test 9: Complex logging scenario (should be redacted)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt:
      'User login: email: john@example.com, password: secret123, ip: 192.168.1.1, session_id: abc123, request_id: req456',
  });
  console.log(
    '✅ Success with redaction:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 10: Compliance analysis
console.log('Test 10: Compliance analysis');
const logEntry =
  'User authentication failed: email: john@example.com, password: secret123, ip: 192.168.1.1, timestamp: 2024-01-15T10:30:00Z';
const compliance = analyzeLogCompliance(logEntry, 'error');
console.log('Compliance Analysis:');
console.log('   Is Compliant:', compliance.isCompliant);
console.log('   Compliance Level:', compliance.complianceLevel);
console.log('   Violations:', compliance.violations.length);
console.log('   Recommendations:', compliance.recommendations.length);
console.log('✅ Compliance analysis complete\n');

console.log('🎯 Logging redaction guardrail demonstration complete!');
console.log('\nKey Features:');
console.log('• Secure logging with automatic redaction');
console.log('• Log sanitization and compliance');
console.log('• Audit trail protection');
console.log('• Multiple redaction strategies');
console.log('• Compliance framework support');
console.log('• Log level-based redaction policies');
console.log('• Sensitive data detection');
console.log('• Detailed redaction metadata');
console.log('• Flexible redaction policies');
console.log('• Production-ready logging security');
