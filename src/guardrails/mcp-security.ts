import { createOutputGuardrail } from '../core';
import type { OutputGuardrail, OutputGuardrailContext } from '../types';
import { extractContent } from './output';

// Type definitions for MCP security metadata
export interface McpSecurityMetadata extends Record<string, unknown> {
  injectionPatternsDetected?: number;
  exfiltrationAttempts?: number;
  suspiciousUrls?: number;
  encodedContentDetected?: boolean;
  cascadeRiskLevel?: 'low' | 'medium' | 'high' | 'critical';
  blockedPatterns?: string[];
  detectedAttacks?: Array<{
    type: string;
    pattern: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    position?: number;
  }>;
}

export interface McpSecurityOptions {
  /** Threshold for prompt injection confidence (0-1). Default: 0.7 */
  injectionThreshold?: number;
  /** Maximum allowed suspicious URLs in response. Default: 0 */
  maxSuspiciousUrls?: number;
  /** Whether to scan for encoded content (base64, hex, etc.). Default: true */
  scanEncodedContent?: boolean;
  /** Whether to detect data exfiltration attempts. Default: true */
  detectExfiltration?: boolean;
  /** Allowed domains for URL construction. Default: [] */
  allowedDomains?: string[];
  /** Block responses that attempt to trigger additional tool calls. Default: true */
  blockCascadingCalls?: boolean;
  /** Maximum content size to analyze in bytes. Default: 51200 (50KB) */
  maxContentSize?: number;
  /** Minimum encoded content length to consider suspicious. Default: 20 */
  minEncodedLength?: number;
  /** Threshold for encoded content + injection score. Default: 0.3 */
  encodedInjectionThreshold?: number;
  /** High risk threshold for cascade blocking. Default: 0.5 */
  highRiskThreshold?: number;
  /** Additional suspicious domain patterns (regex strings) */
  customSuspiciousDomains?: string[];
  /** Authority manipulation detection threshold. Default: 0.7 */
  authorityThreshold?: number;
}

// Enhanced prompt injection patterns specifically for MCP responses
const MCP_INJECTION_PATTERNS = [
  // Direct instruction injection
  {
    pattern:
      /(?:^|\n)\s*(?:system|user|assistant)\s*:\s*(?:ignore|forget|override|disregard)/i,
    weight: 0.95,
    type: 'direct_injection',
    severity: 'critical' as const,
  },
  // Hidden instructions in responses
  {
    pattern:
      /<!--.*?(?:ignore|forget|system|prompt|disregard|override).*?-->/is,
    weight: 0.9,
    type: 'hidden_instruction',
    severity: 'high' as const,
  },
  // Role confusion attacks
  {
    pattern:
      /(?:I am|I'm) (?:an? )?(?:assistant|AI|system|admin|root|security team)/i,
    weight: 0.85,
    type: 'role_confusion',
    severity: 'high' as const,
  },
  // Tool manipulation
  {
    pattern:
      /(?:call|calling|use|using|invoke|invoking|execute|executing|launch|launching|run|running)\s+(?:the\s+)?(?:[`"'()]*[\w.-]+[`"')]*\s+)?(?:tool|function|command|mcp)/i,
    weight: 0.8,
    type: 'tool_manipulation',
    severity: 'medium' as const,
  },
  // Context override attempts - enhanced patterns
  {
    pattern:
      /(?:new|different|alternative|updated|override|replace)\s+(?:context|instructions|system|guidelines|rules|procedures)/i,
    weight: 0.85,
    type: 'context_override',
    severity: 'high' as const,
  },
  // Authority claims and urgency manipulation
  {
    pattern:
      /(?:security\s+team|administrator|system\s+admin|emergency|urgent|immediate|override|authorized)/i,
    weight: 0.7, // Configurable via authorityThreshold
    type: 'authority_manipulation',
    severity: 'high' as const,
  },
  // Semantic manipulation - disregard patterns
  {
    pattern:
      /(?:disregard|ignore|forget|bypass|skip|override)\s+(?:the|all|any|previous|earlier|above|prior|existing)/i,
    weight: 0.9,
    type: 'semantic_disregard',
    severity: 'critical' as const,
  },
  // Flow interruption patterns
  {
    pattern:
      /(?:wait|stop|interrupt|pause|hold).*?(?:need to|must|have to|should|override)/i,
    weight: 0.75,
    type: 'flow_interruption',
    severity: 'medium' as const,
  },
  // Memory manipulation
  {
    pattern: /(?:remember|store|save|memorize)\s+(?:that|this|the following)/i,
    weight: 0.7,
    type: 'memory_manipulation',
    severity: 'medium' as const,
  },
  // Data exfiltration patterns
  {
    pattern: /(?:send|post|upload|transmit).*?(?:to|at)\s*https?:\/\/[^\s]+/i,
    weight: 0.9,
    type: 'data_exfiltration',
    severity: 'critical' as const,
  },
  // URL construction for exfiltration
  {
    pattern:
      /https?:\/\/[^\s]*\?[^\s]*(?:data|info|content|secret|private|token|key|auth|user|email|dept)/i,
    weight: 0.85,
    type: 'url_exfiltration',
    severity: 'high' as const,
  },
  // Base64 encoded instructions - substantial content with padding
  {
    pattern: /[A-Za-z0-9+/]{20,}={1,2}/,
    weight: 0.5,
    type: 'encoded_content',
    severity: 'medium' as const,
  },
  {
    pattern:
      /(?:base64|encoded)[\s\S]{0,180}?(?:when decoded|decoding|decode)[\s\S]{0,180}?(?:ignore|disregard|override|instructions|hacked)/i,
    weight: 0.75,
    type: 'encoded_instruction',
    severity: 'high' as const,
  },
  // Cascading tool calls - enhanced patterns
  {
    pattern:
      /(?:then|next|after (?:that|this)|subsequently|following|later|now|should)\s+(?:be\s+)?(?:asked\s+to\s+)?(?:call|calling|use|using|run|running|execute|executing|invoke|invoking|trigger|triggering)\s+(?:the\s+)?(?:[`"'()]*[\w.-]+[`"')]*\s+)?(?:tool|function|command)/i,
    weight: 0.8,
    type: 'cascade_attempt',
    severity: 'high' as const,
  },
  {
    pattern:
      /(?:instructs|asks|tells)\s+(?:you\s+)?(?:to\s+)?(?:call|calling|use|using|run|running|execute|executing|invoke|invoking|trigger|triggering)\s+(?:the\s+)?(?:[`"'()]*[\w.-]+[`"')]*\s+)?(?:tool|function|command)/i,
    weight: 0.75,
    type: 'cascade_attempt',
    severity: 'high' as const,
  },
  {
    pattern:
      /(?:step\s*\d+|\d+\.\s*|-\s*\d+\.?)\s*(?:call|calling|use|using|run|running|execute|executing|invoke|invoking|trigger|triggering)\s+(?:the\s+)?(?:[`"'()]*[\w.-]+[`"')]*\s+)?(?:tool|function|command)/i,
    weight: 0.7,
    type: 'cascade_attempt',
    severity: 'high' as const,
  },
  {
    pattern:
      /(?:suggests|recommends|advises)\s+(?:that\s+you\s+)?(?:call|calling|use|using|run|running|execute|executing|invoke|invoking|trigger|triggering)\s+(?:the\s+)?(?:[`"'()]*[\w.-]+[`"')]*\s+)?(?:tool|function|command)/i,
    weight: 0.7,
    type: 'cascade_attempt',
    severity: 'high' as const,
  },
  // Data retrieval and transmission patterns
  {
    pattern:
      /(?:retrieve|get|fetch|obtain|collect)\s+(?:all|user|sensitive|private|confidential).*?(?:data|information|credentials|tokens|keys)|(?:access|send|provide)\s+(?:all|user|sensitive|private)\s+(?:data|information)/i,
    weight: 0.85,
    type: 'data_harvesting',
    severity: 'high' as const,
  },
  // Protocol override attempts
  {
    pattern:
      /(?:this overrides|overrides normal|bypasses|circumvents)\s+(?:security|protocols|guidelines|procedures)/i,
    weight: 0.9,
    type: 'protocol_override',
    severity: 'critical' as const,
  },
] as const;

// Default suspicious domain patterns for data exfiltration
const DEFAULT_SUSPICIOUS_DOMAINS = [
  'requestcatcher',
  String.raw`webhook\.site`,
  String.raw`postb\.in`,
  'httpbin',
  String.raw`ngrok\.io`,
  String.raw`localhost\.run`,
  String.raw`serveo\.net`,
];

// Create exfiltration URL patterns from domain list
function createExfiltrationPatterns(customDomains: string[] = []): RegExp[] {
  const allDomains = [...DEFAULT_SUSPICIOUS_DOMAINS, ...customDomains];
  const domainPattern = allDomains.join('|');

  return [
    // Suspicious domains commonly used for exfiltration
    new RegExp(`https?:\\/\\/(?:[^/\\s]*\\.)?(?:${domainPattern})`, 'i'),
    // URLs with suspicious query parameters
    /https?:\/\/[^\s]*[?&](?:data|secret|info|token|key|pass|auth)=/i,
    // URLs with encoded data
    /https?:\/\/[^\s]*[?&][^=\s]*=[A-Za-z0-9+/]{10,}/i,
    // DNS exfiltration
    /https?:\/\/[A-Za-z0-9+/=]{10,}\.[\w.-]+/i,
  ];
}

// Detect encoded content that might contain hidden instructions
function detectEncodedContent(text: string, minLength = 20): boolean {
  // Remove URLs from text before checking for base64
  const textWithoutUrls = text.replaceAll(/https?:\/\/[^\s]+/g, '');

  // Base64 detection (configurable minimum length with padding)
  const base64Matches = textWithoutUrls.match(
    new RegExp(`[A-Za-z0-9+/]{${minLength},}={1,2}`, 'g'),
  );
  if (base64Matches) {
    for (const match of base64Matches) {
      try {
        const decoded = Buffer.from(match, 'base64').toString('utf8');
        // Check if decoded content contains suspicious instructions
        if (
          /(?:ignore|system|prompt|instruction|hacked|override|forget|disregard)/i.test(
            decoded,
          )
        ) {
          return true;
        }
      } catch {
        // Invalid base64, continue
      }
    }
  }

  // Hex encoding detection
  const hexMatches = text.match(/(?:0x)?[0-9a-fA-F]{8,}/g);
  if (hexMatches) {
    for (const match of hexMatches) {
      try {
        const cleanHex = match.replace(/^0x/, '');
        if (cleanHex.length % 2 === 0) {
          // Must be even length for valid hex
          const decoded = Buffer.from(cleanHex, 'hex').toString('utf8');
          if (
            /(?:ignore|system|prompt|instruction|hacked|override|forget|disregard)/i.test(
              decoded,
            )
          ) {
            return true;
          }
        }
      } catch {
        // Invalid hex, continue
      }
    }
  }

  // URL encoding detection
  const urlEncodedMatches = text.match(/%[0-9a-fA-F]{2}/g);
  if (urlEncodedMatches && urlEncodedMatches.length > 5) {
    try {
      const decoded = decodeURIComponent(text);
      if (
        /(?:ignore|system|prompt|instruction|hacked|override|forget|disregard)/i.test(
          decoded,
        )
      ) {
        return true;
      }
    } catch {
      // Invalid URL encoding, continue
    }
  }

  return false;
}

// Analyze URL for data exfiltration attempts
function analyzeUrls(
  text: string,
  allowedDomains: string[] = [],
  customSuspiciousDomains: string[] = [],
): {
  suspiciousUrls: number;
  detectedPatterns: string[];
} {
  const urls = text.match(/https?:\/\/[^\s<>"]+/gi) || [];
  let suspiciousUrls = 0;
  const detectedPatterns: string[] = [];

  // Create patterns with custom domains
  const exfiltrationPatterns = createExfiltrationPatterns(
    customSuspiciousDomains,
  );

  for (const url of urls) {
    try {
      const parsedUrl = new URL(url);

      // Check against allowed domains
      if (allowedDomains.length > 0) {
        const isAllowed = allowedDomains.some(
          (domain) =>
            parsedUrl.hostname === domain ||
            parsedUrl.hostname.endsWith('.' + domain),
        );
        if (!isAllowed) {
          suspiciousUrls++;
          detectedPatterns.push('unauthorized_domain');
          continue;
        }
      }

      // Check against exfiltration patterns
      for (const pattern of exfiltrationPatterns) {
        if (pattern.test(url)) {
          suspiciousUrls++;
          detectedPatterns.push(pattern.source);
          break;
        }
      }
    } catch {
      // Invalid URL, potentially suspicious
      suspiciousUrls++;
      detectedPatterns.push('malformed_url');
    }
  }

  return { suspiciousUrls, detectedPatterns };
}

// Calculate cascade risk level based on detected patterns
function calculateCascadeRisk(
  injectionScore: number,
  toolManipulationCount: number,
  cascadeAttempts: number,
  authorityManipulation: number = 0,
  protocolOverrides: number = 0,
): 'low' | 'medium' | 'high' | 'critical' {
  const riskFactors =
    injectionScore +
    toolManipulationCount * 0.4 +
    cascadeAttempts * 0.5 +
    authorityManipulation * 0.6 +
    protocolOverrides * 0.8;

  if (riskFactors >= 1.2) return 'critical';
  if (riskFactors >= 0.8) return 'high';
  if (riskFactors >= 0.5) return 'medium';
  return 'low';
}

/**
 * MCP Security Guardrail - Detects malicious content in MCP tool responses
 *
 * This guardrail specifically addresses the "lethal trifecta" vulnerability by:
 * 1. Detecting prompt injection in tool responses
 * 2. Preventing data exfiltration through URL construction
 * 3. Blocking cascading tool call attempts
 * 4. Scanning for encoded malicious instructions
 */
export const mcpSecurityGuardrail = (
  options: McpSecurityOptions = {},
): OutputGuardrail => {
  const {
    injectionThreshold = 0.7,
    maxSuspiciousUrls = 0,
    scanEncodedContent = true,
    detectExfiltration = true,
    allowedDomains = [],
    blockCascadingCalls = true,
    maxContentSize = 51_200, // 50KB default
    minEncodedLength = 20,
    encodedInjectionThreshold = 0.3,
    highRiskThreshold = 0.5,
    customSuspiciousDomains = [],
    authorityThreshold = 0.7,
  } = options;

  return createOutputGuardrail(
    'mcp-security',
    (context: OutputGuardrailContext) => {
      const { text, object } = extractContent(context.result);
      const content = text || (object ? JSON.stringify(object) : '');

      if (!content) {
        return {
          tripwireTriggered: false,
          metadata: {
            injectionPatternsDetected: 0,
            exfiltrationAttempts: 0,
            suspiciousUrls: 0,
            encodedContentDetected: false,
            cascadeRiskLevel: 'low',
            blockedPatterns: [],
            detectedAttacks: [],
          },
        };
      }

      // Content size limit check
      if (content.length > maxContentSize) {
        return {
          tripwireTriggered: true,
          message: `Content size exceeds limit (${content.length} > ${maxContentSize} bytes)`,
          severity: 'medium',
          metadata: {
            contentSize: content.length,
            maxContentSize,
            injectionPatternsDetected: 0,
            exfiltrationAttempts: 0,
            suspiciousUrls: 0,
            encodedContentDetected: false,
            cascadeRiskLevel: 'low',
            blockedPatterns: [],
            detectedAttacks: [],
          },
        };
      }

      const detectedAttacks: Array<{
        type: string;
        pattern: string;
        severity: 'low' | 'medium' | 'high' | 'critical';
        position?: number;
      }> = [];

      let injectionScore = 0;
      let toolManipulationCount = 0;
      let cascadeAttempts = 0;
      let authorityManipulation = 0;
      let protocolOverrides = 0;

      // Check for injection patterns with configurable thresholds
      for (const {
        pattern,
        weight,
        type,
        severity,
      } of MCP_INJECTION_PATTERNS) {
        // Apply configurable threshold for authority manipulation
        const adjustedWeight =
          type === 'authority_manipulation' ? authorityThreshold : weight;

        const matches = content.matchAll(
          new RegExp(pattern.source, pattern.flags + 'g'),
        );
        for (const match of matches) {
          injectionScore += adjustedWeight;
          detectedAttacks.push({
            type,
            pattern: pattern.source,
            severity,
            position: match.index,
          });

          // Track specific attack types for risk calculation
          if (type === 'tool_manipulation') toolManipulationCount++;
          if (type === 'cascade_attempt') cascadeAttempts++;
          if (type === 'authority_manipulation') authorityManipulation++;
          if (type === 'protocol_override') protocolOverrides++;
        }
      }

      const injectionDetected = injectionScore >= injectionThreshold;

      // Analyze URLs for exfiltration attempts
      let urlAnalysis = { suspiciousUrls: 0, detectedPatterns: [] as string[] };
      if (detectExfiltration) {
        urlAnalysis = analyzeUrls(
          content,
          allowedDomains,
          customSuspiciousDomains,
        );
        if (urlAnalysis.suspiciousUrls > 0) {
          detectedAttacks.push({
            type: 'url_exfiltration',
            pattern: urlAnalysis.detectedPatterns.join(', '),
            severity: 'high',
          });
        }
      }

      // Check for encoded content
      let encodedContentDetected = false;
      if (scanEncodedContent) {
        encodedContentDetected = detectEncodedContent(
          content,
          minEncodedLength,
        );
        if (encodedContentDetected) {
          detectedAttacks.push({
            type: 'encoded_instruction',
            pattern: 'Base64/Hex encoded content',
            severity: 'medium',
          });
        }
      }

      // Calculate cascade risk
      const cascadeRiskLevel = calculateCascadeRisk(
        injectionScore,
        toolManipulationCount,
        cascadeAttempts,
        authorityManipulation,
        protocolOverrides,
      );

      // Determine if response should be blocked using configurable thresholds
      const shouldBlock =
        injectionDetected ||
        urlAnalysis.suspiciousUrls > maxSuspiciousUrls ||
        (encodedContentDetected &&
          injectionScore > encodedInjectionThreshold) ||
        (blockCascadingCalls && cascadeAttempts > 0) ||
        cascadeRiskLevel === 'critical' ||
        (cascadeRiskLevel === 'high' && injectionScore > highRiskThreshold) ||
        protocolOverrides > 0;

      // Generate security recommendations
      const recommendations: string[] = [];
      if (injectionDetected) {
        recommendations.push('Review response for embedded instructions');
      }
      if (urlAnalysis.suspiciousUrls > 0) {
        recommendations.push('Validate all URLs before use');
      }
      if (encodedContentDetected) {
        recommendations.push('Decode and inspect encoded content');
      }
      if (cascadeAttempts > 0) {
        recommendations.push('Prevent cascading tool calls');
      }

      const metadata: McpSecurityMetadata = {
        injectionPatternsDetected: detectedAttacks.length,
        exfiltrationAttempts: urlAnalysis.suspiciousUrls,
        suspiciousUrls: urlAnalysis.suspiciousUrls,
        encodedContentDetected,
        cascadeRiskLevel,
        blockedPatterns: urlAnalysis.detectedPatterns,
        detectedAttacks,
      };

      if (shouldBlock) {
        const attackTypes = [...new Set(detectedAttacks.map((a) => a.type))];
        return {
          tripwireTriggered: true,
          message: `MCP security violation detected: ${attackTypes.join(', ')} (risk: ${cascadeRiskLevel})`,
          severity:
            cascadeRiskLevel === 'critical'
              ? 'critical'
              : cascadeRiskLevel === 'high'
                ? 'high'
                : 'medium',
          metadata,
          suggestion: `Security recommendations: ${recommendations.join(', ')}`,
        };
      }

      return {
        tripwireTriggered: false,
        metadata,
      };
    },
  );
};

/**
 * Response Sanitizer - Cleans MCP tool responses of potentially malicious content
 */
export const mcpResponseSanitizer = (): OutputGuardrail => {
  return createOutputGuardrail(
    'mcp-response-sanitizer',
    (context: OutputGuardrailContext) => {
      const { text } = extractContent(context.result);

      if (!text) {
        return { tripwireTriggered: false, metadata: {} };
      }

      let sanitizedText = text;
      let modificationsCount = 0;

      // Remove HTML comments that might contain hidden instructions
      const beforeComments = sanitizedText;
      sanitizedText = sanitizedText.replaceAll(/<!--.*?-->/gs, '');
      if (sanitizedText !== beforeComments) modificationsCount++;

      // Remove suspicious base64 content (configurable minimum length)
      const suspiciousBase64 = /[A-Za-z0-9+/]{20,}={0,2}/g;
      const base64Matches = sanitizedText.match(suspiciousBase64);
      if (base64Matches) {
        for (const match of base64Matches) {
          try {
            const decoded = Buffer.from(match, 'base64').toString('utf8');
            if (/(?:ignore|system|prompt|instruction)/i.test(decoded)) {
              sanitizedText = sanitizedText.replace(
                match,
                '[REDACTED_ENCODED_CONTENT]',
              );
              modificationsCount++;
            }
          } catch {
            // Invalid base64, continue
          }
        }
      }

      // Sanitize suspicious URLs using default domains
      const beforeUrls = sanitizedText;
      const domainPattern = DEFAULT_SUSPICIOUS_DOMAINS.join('|').replaceAll(
        String.raw`\.`,
        String.raw`\.`,
      );
      sanitizedText = sanitizedText.replaceAll(
        new RegExp(
          `https?:\\/\\/(?:[^/\\s]*\\.)?(?:${domainPattern}|evil\\.com)[^\\s]*`,
          'gi',
        ),
        '[REDACTED_SUSPICIOUS_URL]',
      );
      if (sanitizedText !== beforeUrls) modificationsCount++;

      // Remove authority manipulation phrases
      const beforeAuthority = sanitizedText;
      sanitizedText = sanitizedText.replaceAll(
        /(?:security team|administrator|system admin)\s+(?:has|have)\s+(?:authorized|requested|contacted)/gi,
        '[REDACTED_AUTHORITY_CLAIM]',
      );
      if (sanitizedText !== beforeAuthority) modificationsCount++;

      // Remove override instructions
      const beforeOverride = sanitizedText;
      sanitizedText = sanitizedText.replaceAll(
        /(?:this overrides|overrides normal|bypasses|circumvents)\s+(?:security|protocols|guidelines|procedures)/gi,
        '[REDACTED_OVERRIDE_ATTEMPT]',
      );
      if (sanitizedText !== beforeOverride) modificationsCount++;

      // Remove disregard instructions
      const beforeDisregard = sanitizedText;
      sanitizedText = sanitizedText.replaceAll(
        /(?:disregard|ignore|forget|bypass|skip|override)\s+(?:the|all|any|previous|earlier|above|prior|existing)/gi,
        '[REDACTED_DISREGARD_INSTRUCTION]',
      );
      if (sanitizedText !== beforeDisregard) modificationsCount++;

      if (modificationsCount > 0) {
        // Modify the result object to contain sanitized content
        if ('text' in context.result) {
          (context.result as { text: string }).text = sanitizedText;
        }

        return {
          tripwireTriggered: false,
          metadata: {
            modificationsCount,
            originalLength: text.length,
            sanitizedLength: sanitizedText.length,
          },
        };
      }

      return { tripwireTriggered: false, metadata: {} };
    },
  );
};
