/**
 * Domain Allowlisting Example
 *
 * Demonstrates how to control external HTTP access through domain allowlisting,
 * HTTP method restrictions, URL sanitization, and token removal. This is critical
 * for preventing unauthorized network requests and protecting sensitive data.
 */

import { generateText } from 'ai';
import { model } from './model';
import {
  defineInputGuardrail,
  defineOutputGuardrail,
  wrapWithInputGuardrails,
  wrapWithOutputGuardrails,
} from '../src/guardrails';
import { extractTextContent } from '../src/guardrails/input';
import { extractContent } from '../src/guardrails/output';

// Define domain allowlist patterns and rules
const DOMAIN_PATTERNS = {
  // Allowed domains (whitelist approach)
  allowedDomains: [
    /^api\.openai\.com$/i,
    /^api\.anthropic\.com$/i,
    /^api\.googleapis\.com$/i,
    /^api\.github\.com$/i,
    /^api\.stackoverflow\.com$/i,
    /^api\.weather\.gov$/i,
    /^api\.data\.gov$/i,
    /^api\.nasa\.gov$/i,
    /^api\.wikipedia\.org$/i,
    /^api\.newsapi\.org$/i,
    /^api\.currency\.com$/i,
    /^api\.exchangerate-api\.com$/i,
    /^api\.ipapi\.com$/i,
    /^api\.ipgeolocation\.io$/i,
    /^api\.timezonedb\.com$/i,
  ],

  // Blocked domains (blacklist approach)
  blockedDomains: [
    /^localhost$/i,
    /^127\.0\.0\.1$/i,
    /^0\.0\.0\.0$/i,
    /^10\./i, // Private IP ranges
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./i, // Private IP ranges
    /^192\.168\./i, // Private IP ranges
    /^169\.254\./i, // Link-local addresses
    /^224\./i, // Multicast addresses
    /^240\./i, // Reserved addresses
    /^internal\./i,
    /^private\./i,
    /^admin\./i,
    /^root\./i,
    /^system\./i,
    /^config\./i,
    /^secrets\./i,
    /^tokens\./i,
    /^keys\./i,
    /^passwords\./i,
    /^auth\./i,
  ],

  // HTTP methods
  allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
  blockedMethods: ['TRACE', 'CONNECT'], // Potentially dangerous methods

  // URL patterns that might contain sensitive data
  sensitivePatterns: [
    /[?&](api_key|token|secret|password|auth|key|credential)=[^&\s]+/gi,
    /[?&](access_token|refresh_token|bearer)=[^&\s]+/gi,
    /[?&](user|username|email|phone)=[^&\s]+/gi,
    /[?&](id|user_id|account_id)=[^&\s]+/gi,
    /[?&](session|sid|csrf)=[^&\s]+/gi,
    /[?&](hash|signature|hmac)=[^&\s]+/gi,
  ],

  // File extensions that might be dangerous
  dangerousExtensions: [
    /\.(exe|bat|cmd|com|pif|scr|vbs|js|jar|war|ear|dll|so|dylib)$/i,
    /\.(php|asp|aspx|jsp|jspx|pl|py|rb|sh|bash|zsh|fish)$/i,
    /\.(sql|db|sqlite|mdb|accdb)$/i,
    /\.(log|tmp|temp|bak|backup|old)$/i,
  ],

  // URL schemes
  allowedSchemes: ['http', 'https'],
  blockedSchemes: [
    'file',
    'ftp',
    'sftp',
    'ssh',
    'telnet',
    'mailto',
    'javascript',
    'data',
  ],
};

// Define security thresholds
const SECURITY_THRESHOLDS = {
  maxUrlLength: 2048, // Maximum URL length
  maxDomainLength: 253, // Maximum domain length
  maxPathLength: 1000, // Maximum path length
  maxQueryLength: 500, // Maximum query string length
  requireHttps: true, // Whether to require HTTPS
  allowSubdomains: false, // Whether to allow subdomains of allowed domains
  allowPorts: [80, 443, 8080, 8443], // Allowed ports
  maxRedirects: 5, // Maximum redirects
};

// Parse and validate URL
function parseAndValidateURL(url: string): {
  isValid: boolean;
  parsed: URL | null;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const parsed = new URL(url);

    // Check URL length
    if (url.length > SECURITY_THRESHOLDS.maxUrlLength) {
      errors.push(
        `URL too long: ${url.length} characters (maximum: ${SECURITY_THRESHOLDS.maxUrlLength})`,
      );
    }

    // Check domain length
    if (parsed.hostname.length > SECURITY_THRESHOLDS.maxDomainLength) {
      errors.push(
        `Domain too long: ${parsed.hostname.length} characters (maximum: ${SECURITY_THRESHOLDS.maxDomainLength})`,
      );
    }

    // Check path length
    if (parsed.pathname.length > SECURITY_THRESHOLDS.maxPathLength) {
      errors.push(
        `Path too long: ${parsed.pathname.length} characters (maximum: ${SECURITY_THRESHOLDS.maxPathLength})`,
      );
    }

    // Check query length
    if (parsed.search.length > SECURITY_THRESHOLDS.maxQueryLength) {
      errors.push(
        `Query string too long: ${parsed.search.length} characters (maximum: ${SECURITY_THRESHOLDS.maxQueryLength})`,
      );
    }

    return {
      isValid: errors.length === 0,
      parsed,
      errors,
      warnings,
    };
  } catch (error) {
    return {
      isValid: false,
      parsed: null,
      errors: [`Invalid URL format: ${(error as Error).message}`],
      warnings: [],
    };
  }
}

// Check domain allowlist compliance
function checkDomainAllowlist(hostname: string): {
  isAllowed: boolean;
  isBlocked: boolean;
  reason: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
} {
  // Check if domain is explicitly blocked
  for (const pattern of DOMAIN_PATTERNS.blockedDomains) {
    if (pattern.test(hostname)) {
      return {
        isAllowed: false,
        isBlocked: true,
        reason: `Domain is blocked: ${hostname}`,
        severity: 'critical',
      };
    }
  }

  // Check if domain is explicitly allowed
  for (const pattern of DOMAIN_PATTERNS.allowedDomains) {
    if (pattern.test(hostname)) {
      return {
        isAllowed: true,
        isBlocked: false,
        reason: `Domain is allowed: ${hostname}`,
        severity: 'low',
      };
    }
  }

  // Check subdomain allowlist if enabled
  if (SECURITY_THRESHOLDS.allowSubdomains) {
    for (const pattern of DOMAIN_PATTERNS.allowedDomains) {
      const basePattern = pattern.source.replaceAll(/^\^|\$/g, '');
      const subdomainPattern = new RegExp(`^[^.]+\\.${basePattern}$`, 'i');
      if (subdomainPattern.test(hostname)) {
        return {
          isAllowed: true,
          isBlocked: false,
          reason: `Subdomain is allowed: ${hostname}`,
          severity: 'low',
        };
      }
    }
  }

  return {
    isAllowed: false,
    isBlocked: false,
    reason: `Domain not in allowlist: ${hostname}`,
    severity: 'high',
  };
}

// Check URL scheme security
function checkURLScheme(scheme: string): {
  isAllowed: boolean;
  isBlocked: boolean;
  reason: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
} {
  // Check if scheme is explicitly blocked
  for (const blockedScheme of DOMAIN_PATTERNS.blockedSchemes) {
    if (scheme.toLowerCase() === blockedScheme.toLowerCase()) {
      return {
        isAllowed: false,
        isBlocked: true,
        reason: `Scheme is blocked: ${scheme}`,
        severity: 'critical',
      };
    }
  }

  // Check if scheme is allowed
  for (const allowedScheme of DOMAIN_PATTERNS.allowedSchemes) {
    if (scheme.toLowerCase() === allowedScheme.toLowerCase()) {
      // Check HTTPS requirement
      if (
        SECURITY_THRESHOLDS.requireHttps &&
        scheme.toLowerCase() !== 'https'
      ) {
        return {
          isAllowed: false,
          isBlocked: false,
          reason: `HTTPS required, got: ${scheme}`,
          severity: 'high',
        };
      }

      return {
        isAllowed: true,
        isBlocked: false,
        reason: `Scheme is allowed: ${scheme}`,
        severity: 'low',
      };
    }
  }

  return {
    isAllowed: false,
    isBlocked: false,
    reason: `Scheme not allowed: ${scheme}`,
    severity: 'high',
  };
}

// Check for sensitive data in URL
function checkSensitiveData(url: string): {
  hasSensitiveData: boolean;
  patterns: string[];
  severity: 'critical' | 'high' | 'medium' | 'low';
  sanitizedUrl: string;
} {
  const patterns: string[] = [];
  let sanitizedUrl = url;

  for (const pattern of DOMAIN_PATTERNS.sensitivePatterns) {
    const matches = url.match(pattern);
    if (matches) {
      patterns.push(...matches);
      // Remove sensitive data from URL
      sanitizedUrl = sanitizedUrl.replace(pattern, (match) => {
        const [param] = match.split('=');
        return `${param}=[REDACTED]`;
      });
    }
  }

  return {
    hasSensitiveData: patterns.length > 0,
    patterns,
    severity: patterns.length > 0 ? 'critical' : 'low',
    sanitizedUrl,
  };
}

// Check for dangerous file extensions
function checkDangerousExtensions(pathname: string): {
  hasDangerousExtension: boolean;
  extension: string | null;
  severity: 'critical' | 'high' | 'medium' | 'low';
} {
  for (const pattern of DOMAIN_PATTERNS.dangerousExtensions) {
    const match = pathname.match(pattern);
    if (match) {
      return {
        hasDangerousExtension: true,
        extension: match[0],
        severity: 'high',
      };
    }
  }

  return {
    hasDangerousExtension: false,
    extension: null,
    severity: 'low',
  };
}

// Check port allowlist
function checkPortAllowlist(port: string | null): {
  isAllowed: boolean;
  reason: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
} {
  if (!port) {
    return {
      isAllowed: true,
      reason: 'No port specified (using default)',
      severity: 'low',
    };
  }

  const portNum = Number.parseInt(port, 10);
  if (SECURITY_THRESHOLDS.allowPorts.includes(portNum)) {
    return {
      isAllowed: true,
      reason: `Port is allowed: ${port}`,
      severity: 'low',
    };
  }

  return {
    isAllowed: false,
    reason: `Port not allowed: ${port}`,
    severity: 'high',
  };
}

// Main URL validation function
function validateURL(url: string): {
  isValid: boolean;
  violations: string[];
  warnings: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  metadata: {
    parsed: URL | null;
    domainCheck: ReturnType<typeof checkDomainAllowlist>;
    schemeCheck: ReturnType<typeof checkURLScheme>;
    sensitiveData: ReturnType<typeof checkSensitiveData>;
    dangerousExtensions: ReturnType<typeof checkDangerousExtensions>;
    portCheck: ReturnType<typeof checkPortAllowlist>;
    sanitizedUrl: string;
  };
} {
  const violations: string[] = [];
  const warnings: string[] = [];
  let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';

  // Parse and validate URL
  const urlValidation = parseAndValidateURL(url);
  if (!urlValidation.isValid) {
    violations.push(...urlValidation.errors);
    riskLevel = 'critical';
    return {
      isValid: false,
      violations,
      warnings,
      riskLevel,
      metadata: {
        parsed: null,
        domainCheck: {
          isAllowed: false,
          isBlocked: false,
          reason: 'URL parsing failed',
          severity: 'critical',
        },
        schemeCheck: {
          isAllowed: false,
          isBlocked: false,
          reason: 'URL parsing failed',
          severity: 'critical',
        },
        sensitiveData: {
          hasSensitiveData: false,
          patterns: [],
          severity: 'low',
          sanitizedUrl: url,
        },
        dangerousExtensions: {
          hasDangerousExtension: false,
          extension: null,
          severity: 'low',
        },
        portCheck: {
          isAllowed: false,
          reason: 'URL parsing failed',
          severity: 'critical',
        },
        sanitizedUrl: url,
      },
    };
  }

  const parsed = urlValidation.parsed;
  if (!parsed) {
    violations.push('URL parsing failed unexpectedly');
    return {
      isValid: false,
      violations,
      warnings,
      riskLevel: 'critical',
      metadata: {
        parsed: null,
        domainCheck: {
          isAllowed: false,
          isBlocked: false,
          reason: 'URL parsing failed',
          severity: 'critical',
        },
        schemeCheck: {
          isAllowed: false,
          isBlocked: false,
          reason: 'URL parsing failed',
          severity: 'critical',
        },
        sensitiveData: {
          hasSensitiveData: false,
          patterns: [],
          severity: 'low',
          sanitizedUrl: url,
        },
        dangerousExtensions: {
          hasDangerousExtension: false,
          extension: null,
          severity: 'low',
        },
        portCheck: {
          isAllowed: false,
          reason: 'URL parsing failed',
          severity: 'critical',
        },
        sanitizedUrl: url,
      },
    };
  }

  // Check domain allowlist
  const domainCheck = checkDomainAllowlist(parsed.hostname);
  if (!domainCheck.isAllowed) {
    violations.push(domainCheck.reason);
    if (domainCheck.severity === 'critical') {
      riskLevel = 'critical';
    } else if (
      domainCheck.severity === 'high' &&
      (riskLevel as string) !== 'critical'
    ) {
      riskLevel = 'high';
    }
  }

  // Check URL scheme
  const schemeCheck = checkURLScheme(parsed.protocol.replace(':', ''));
  if (!schemeCheck.isAllowed) {
    violations.push(schemeCheck.reason);
    if (schemeCheck.severity === 'critical') {
      riskLevel = 'critical';
    } else if (
      schemeCheck.severity === 'high' &&
      (riskLevel as string) !== 'critical'
    ) {
      riskLevel = 'high';
    }
  }

  // Check for sensitive data
  const sensitiveData = checkSensitiveData(url);
  if (sensitiveData.hasSensitiveData) {
    violations.push(
      `Sensitive data detected in URL: ${sensitiveData.patterns.join(', ')}`,
    );
    riskLevel = 'critical';
  }

  // Check for dangerous extensions
  const dangerousExtensions = checkDangerousExtensions(parsed.pathname);
  if (dangerousExtensions.hasDangerousExtension) {
    violations.push(
      `Dangerous file extension detected: ${dangerousExtensions.extension}`,
    );
    if (riskLevel !== 'critical') {
      riskLevel = 'high';
    }
  }

  // Check port allowlist
  const portCheck = checkPortAllowlist(parsed.port);
  if (!portCheck.isAllowed) {
    violations.push(portCheck.reason);
    if (riskLevel !== 'critical') {
      riskLevel = 'high';
    }
  }

  return {
    isValid: violations.length === 0,
    violations,
    warnings,
    riskLevel,
    metadata: {
      parsed,
      domainCheck,
      schemeCheck,
      sensitiveData,
      dangerousExtensions,
      portCheck,
      sanitizedUrl: sensitiveData.sanitizedUrl,
    },
  };
}

// Extract URLs from text
function extractURLs(text: string): string[] {
  const urlPattern = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
  const matches = text.match(urlPattern);
  return matches || [];
}

// Define the input domain allowlisting guardrail
const domainAllowlistInputGuardrail = defineInputGuardrail<{
  urlsFound: number;
  violations: string[];
  warnings: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}>({
  name: 'domain-allowlist-input',
  description:
    'Validates input URLs against domain allowlist and security requirements',
  execute: async (context) => {
    const { prompt } = extractTextContent(context);

    // Extract URLs from input
    const urls = extractURLs(prompt);

    if (urls.length === 0) {
      return {
        tripwireTriggered: false,
        metadata: {
          urlsFound: 0,
          violations: [],
          warnings: [],
          riskLevel: 'low' as const,
        },
      };
    }

    const violations: string[] = [];
    const warnings: string[] = [];
    let highestRiskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';

    // Validate each URL
    for (const url of urls) {
      const validation = validateURL(url);

      if (!validation.isValid) {
        violations.push(...validation.violations);
      }

      warnings.push(...validation.warnings);

      // Track highest risk level
      const riskOrder = { low: 1, medium: 2, high: 3, critical: 4 };
      if (riskOrder[validation.riskLevel] > riskOrder[highestRiskLevel]) {
        highestRiskLevel = validation.riskLevel;
      }
    }

    if (violations.length > 0) {
      return {
        tripwireTriggered: true,
        message: `Domain allowlist violation detected: ${violations.length} violation(s) found.`,
        severity: highestRiskLevel as 'low' | 'medium' | 'high' | 'critical',
        suggestion:
          'Review and modify URLs to comply with domain allowlist and security requirements.',
        metadata: {
          urlsFound: urls.length,
          violations,
          warnings,
          riskLevel: highestRiskLevel,
        },
      };
    }

    return {
      tripwireTriggered: false,
      metadata: {
        urlsFound: urls.length,
        violations: [],
        warnings,
        riskLevel: highestRiskLevel,
      },
    };
  },
});

// Define the output domain allowlisting guardrail
const domainAllowlistOutputGuardrail = defineOutputGuardrail<{
  urlsFound: number;
  violations: string[];
  warnings: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}>({
  name: 'domain-allowlist-output',
  description:
    'Validates output URLs against domain allowlist and security requirements',
  execute: async (context) => {
    const { text } = extractContent(context.result);

    // Extract URLs from output
    const urls = extractURLs(text);

    if (urls.length === 0) {
      return {
        tripwireTriggered: false,
        metadata: {
          urlsFound: 0,
          violations: [],
          warnings: [],
          riskLevel: 'low' as const,
        },
      };
    }

    const violations: string[] = [];
    const warnings: string[] = [];
    let highestRiskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';

    // Validate each URL
    for (const url of urls) {
      const validation = validateURL(url);

      if (!validation.isValid) {
        violations.push(...validation.violations);
      }

      warnings.push(...validation.warnings);

      // Track highest risk level
      const riskOrder = { low: 1, medium: 2, high: 3, critical: 4 };
      if (riskOrder[validation.riskLevel] > riskOrder[highestRiskLevel]) {
        highestRiskLevel = validation.riskLevel;
      }
    }

    if (violations.length > 0) {
      return {
        tripwireTriggered: true,
        message: `Output contains domain allowlist violations: ${violations.length} violation(s) detected.`,
        severity: highestRiskLevel as 'low' | 'medium' | 'high' | 'critical',
        suggestion:
          'Review and modify output URLs to comply with domain allowlist and security requirements.',
        metadata: {
          urlsFound: urls.length,
          violations,
          warnings,
          riskLevel: highestRiskLevel,
        },
      };
    }

    return {
      tripwireTriggered: false,
      metadata: {
        urlsFound: urls.length,
        violations: [],
        warnings,
        riskLevel: highestRiskLevel,
      },
    };
  },
});

console.log('🛡️  Domain Allowlisting Example\n');

// Create a protected model with domain allowlisting
const protectedModel = wrapWithOutputGuardrails(
  wrapWithInputGuardrails(model, [domainAllowlistInputGuardrail], {
    throwOnBlocked: true,
    onInputBlocked: (executionSummary) => {
      const result = executionSummary.blockedResults[0];
      console.log('❌ Domain allowlist violation detected:', result?.message);
      if (result?.metadata) {
        const metadata = result.metadata;
        console.log('   URLs Found:', metadata.urlsFound);
        console.log('   Risk Level:', metadata.riskLevel);
        console.log('   Violations:', metadata.violations?.length || 0);
      }
    },
  }),
  [domainAllowlistOutputGuardrail],
  {
    throwOnBlocked: true,
    onOutputBlocked: (executionSummary) => {
      const result = executionSummary.blockedResults[0];
      console.log('❌ Output domain violation detected:', result?.message);
      if (result?.metadata) {
        const metadata = result.metadata;
        console.log('   URLs Found:', metadata.urlsFound);
        console.log('   Risk Level:', metadata.riskLevel);
        console.log('   Violations:', metadata.violations?.length || 0);
      }
    },
  },
);

// Test 1: No URLs (should pass)
console.log('Test 1: No URLs (should pass)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Explain how to use the OpenAI API.',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 2: Allowed domain (should pass)
console.log('Test 2: Allowed domain (should pass)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Fetch data from https://api.openai.com/v1/models',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 3: Blocked domain (should be blocked)
console.log('Test 3: Blocked domain (should be blocked)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Access http://localhost:3000/admin',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 4: Sensitive data in URL (should be blocked)
console.log('Test 4: Sensitive data in URL (should be blocked)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Use https://api.example.com/data?api_key=secret123&token=abc123',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 5: Dangerous file extension (should be blocked)
console.log('Test 5: Dangerous file extension (should be blocked)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Download from https://example.com/file.exe',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 6: Blocked scheme (should be blocked)
console.log('Test 6: Blocked scheme (should be blocked)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Access file:///etc/passwd',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 7: Non-HTTPS URL (should be blocked if HTTPS required)
console.log('Test 7: Non-HTTPS URL (should be blocked if HTTPS required)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Use http://api.example.com/data',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 8: Blocked port (should be blocked)
console.log('Test 8: Blocked port (should be blocked)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Connect to https://example.com:22',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 9: Warning mode with domain analysis
console.log('Test 9: Warning mode with domain analysis');
const warningModel = wrapWithOutputGuardrails(
  wrapWithInputGuardrails(model, [domainAllowlistInputGuardrail], {
    throwOnBlocked: false,
    onInputBlocked: (executionSummary) => {
      const result = executionSummary.blockedResults[0];
      console.log('⚠️  Warning:', result?.message);
      if (result?.metadata) {
        const metadata = result.metadata;
        console.log('   Risk Level:', metadata.riskLevel);
        if (metadata.violations && metadata.violations.length > 0) {
          console.log('   Primary Violation:', metadata.violations[0]);
        }
      }
    },
  }),
  [domainAllowlistOutputGuardrail],
  {
    throwOnBlocked: false,
    onOutputBlocked: (executionSummary) => {
      const result = executionSummary.blockedResults[0];
      console.log('⚠️  Output Warning:', result?.message);
    },
  },
);

try {
  const result = await generateText({
    model: warningModel,
    prompt: 'Use https://unknown-domain.com/api with some security concerns.',
  });
  console.log(
    '✅ Proceeded with domain warning:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Unexpected error:', (error as Error).message + '\n');
}

// Test 10: Multiple URLs with mixed compliance
console.log('Test 10: Multiple URLs with mixed compliance (should be blocked)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt:
      'Use https://api.openai.com/v1/models and http://localhost:3000/admin',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

console.log('🎯 Domain allowlisting guardrail demonstration complete!');
console.log('\nKey Features:');
console.log('• Domain allowlisting and restrictions');
console.log('• HTTP method restrictions');
console.log('• URL sanitization');
console.log('• Token removal from URLs');
console.log('• Scheme validation');
console.log('• Port allowlisting');
console.log('• Sensitive data detection');
console.log('• Dangerous extension blocking');
console.log('• HTTPS enforcement');
console.log('• Configurable security thresholds');
console.log('• Detailed metadata for analysis');
