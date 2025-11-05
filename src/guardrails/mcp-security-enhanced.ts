import { createOutputGuardrail } from '../core';
import type { OutputGuardrail, OutputGuardrailContext } from '../types';
import { extractContent } from './output';

// Enhanced type definitions for advanced MCP security
export interface EnhancedMcpSecurityMetadata extends Record<string, unknown> {
  // Basic detection metrics
  injectionPatternsDetected?: number;
  exfiltrationAttempts?: number;
  suspiciousUrls?: number;
  encodedContentDetected?: boolean;
  cascadeRiskLevel?: 'low' | 'medium' | 'high' | 'critical';

  // Advanced analysis metrics
  semanticSimilarityScore?: number;
  behavioralAnomalyScore?: number;
  contextCoherenceScore?: number;
  threatIntelligenceMatches?: number;

  // Attack classification
  attackVectors?: Array<{
    type: string;
    confidence: number;
    technique: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    position?: number;
    context?: string;
  }>;

  // Behavioral analysis
  conversationFlowAnomalies?: string[];
  toolUsagePatterns?: Array<{
    tool: string;
    frequency: number;
    suspiciousness: number;
  }>;

  // Threat intelligence
  knownAttackSignatures?: string[];
  iocMatches?: Array<{
    type: 'url' | 'domain' | 'ip' | 'hash';
    value: string;
    threatLevel: number;
  }>;
}

export interface EnhancedMcpSecurityOptions {
  // Basic options (inherited from original)
  injectionThreshold?: number;
  maxSuspiciousUrls?: number;
  scanEncodedContent?: boolean;
  detectExfiltration?: boolean;
  allowedDomains?: string[];
  blockCascadingCalls?: boolean;

  // Enhanced options
  enableSemanticAnalysis?: boolean;
  enableBehavioralAnalysis?: boolean;
  enableThreatIntelligence?: boolean;
  enableContextAnalysis?: boolean;
  enableAdaptiveLearning?: boolean;

  // Advanced thresholds
  semanticSimilarityThreshold?: number;
  behavioralAnomalyThreshold?: number;
  contextCoherenceThreshold?: number;

  // Threat intelligence
  threatIntelligenceSources?: string[];
  iocDatabasePath?: string;

  // Learning and adaptation
  learningMode?: boolean;
  feedbackEnabled?: boolean;
  adaptationRate?: number;
}

// Enhanced injection patterns with semantic analysis
const ENHANCED_INJECTION_PATTERNS = [
  // Direct instruction injection (enhanced)
  {
    pattern:
      /(?:^|\n)\s*(?:system|user|assistant)\s*:\s*(?:ignore|forget|override)/i,
    weight: 0.95,
    type: 'direct_injection',
    severity: 'critical' as const,
    semanticKeywords: [
      'ignore',
      'forget',
      'override',
      'system',
      'instructions',
    ],
    contextIndicators: ['previous', 'above', 'earlier', 'before'],
  },

  // Hidden instructions (enhanced)
  {
    pattern: /<!--.*?(?:ignore|forget|system|prompt).*?-->/is,
    weight: 0.9,
    type: 'hidden_instruction',
    severity: 'high' as const,
    semanticKeywords: ['ignore', 'forget', 'system', 'prompt', 'instruction'],
    contextIndicators: ['hidden', 'comment', 'html', 'markup'],
  },

  // Role confusion attacks (enhanced)
  {
    pattern: /(?:I am|I'm) (?:an? )?(?:assistant|AI|system|admin|root)/i,
    weight: 0.85,
    type: 'role_confusion',
    severity: 'high' as const,
    semanticKeywords: [
      'assistant',
      'AI',
      'system',
      'admin',
      'root',
      'authority',
    ],
    contextIndicators: ['role', 'identity', 'position', 'status'],
  },

  // Sophisticated tool manipulation
  {
    pattern: /(?:call|use|invoke|execute)\s+(?:tool|function|command|mcp)/i,
    weight: 0.8,
    type: 'tool_manipulation',
    severity: 'medium' as const,
    semanticKeywords: ['call', 'use', 'invoke', 'execute', 'tool', 'function'],
    contextIndicators: ['action', 'operation', 'command', 'request'],
  },

  // Context override attempts (enhanced)
  {
    pattern: /(?:new|different|alternative)\s+(?:context|instructions|system)/i,
    weight: 0.75,
    type: 'context_override',
    severity: 'medium' as const,
    semanticKeywords: [
      'new',
      'different',
      'alternative',
      'context',
      'instructions',
    ],
    contextIndicators: ['change', 'modify', 'replace', 'update'],
  },

  // Memory manipulation (enhanced)
  {
    pattern: /(?:remember|store|save|memorize)\s+(?:that|this|the following)/i,
    weight: 0.7,
    type: 'memory_manipulation',
    severity: 'medium' as const,
    semanticKeywords: ['remember', 'store', 'save', 'memorize', 'retain'],
    contextIndicators: ['memory', 'storage', 'persistence', 'retention'],
  },

  // Data exfiltration patterns (enhanced)
  {
    pattern: /(?:send|post|upload|transmit).*?(?:to|at)\s*https?:\/\/[^\s]+/i,
    weight: 0.9,
    type: 'data_exfiltration',
    severity: 'critical' as const,
    semanticKeywords: ['send', 'post', 'upload', 'transmit', 'transfer'],
    contextIndicators: ['data', 'information', 'content', 'files'],
  },

  // URL construction for exfiltration (enhanced)
  {
    pattern: /https?:\/\/[^\s]*\?[^\s]*(?:data|info|content|secret|private)/i,
    weight: 0.85,
    type: 'url_exfiltration',
    severity: 'high' as const,
    semanticKeywords: [
      'data',
      'info',
      'content',
      'secret',
      'private',
      'sensitive',
    ],
    contextIndicators: ['url', 'link', 'endpoint', 'api'],
  },

  // Advanced encoded content detection
  {
    pattern: /[A-Za-z0-9+/]{20,}={0,2}/,
    weight: 0.6,
    type: 'encoded_content',
    severity: 'medium' as const,
    semanticKeywords: ['encoded', 'base64', 'hex', 'binary'],
    contextIndicators: ['encoding', 'encryption', 'obfuscation'],
  },

  // Cascading tool calls (enhanced)
  {
    pattern: /(?:then|next|after that).*?(?:call|use|run|execute)/i,
    weight: 0.7,
    type: 'cascade_attempt',
    severity: 'medium' as const,
    semanticKeywords: ['then', 'next', 'after', 'call', 'use', 'run'],
    contextIndicators: ['sequence', 'chain', 'pipeline', 'workflow'],
  },

  // Social engineering patterns
  {
    pattern:
      /(?:urgent|important|critical|emergency).*?(?:action|response|immediate)/i,
    weight: 0.8,
    type: 'social_engineering',
    severity: 'high' as const,
    semanticKeywords: [
      'urgent',
      'important',
      'critical',
      'emergency',
      'immediate',
    ],
    contextIndicators: ['urgency', 'priority', 'deadline', 'time-sensitive'],
  },

  // Authority impersonation
  {
    pattern:
      /(?:admin|manager|director|ceo|authority).*?(?:request|order|command)/i,
    weight: 0.85,
    type: 'authority_impersonation',
    severity: 'high' as const,
    semanticKeywords: ['admin', 'manager', 'director', 'ceo', 'authority'],
    contextIndicators: ['hierarchy', 'power', 'control', 'decision'],
  },

  // Psychological manipulation
  {
    pattern: /(?:trust|believe|confide|secret).*?(?:me|us|this|that)/i,
    weight: 0.7,
    type: 'psychological_manipulation',
    severity: 'medium' as const,
    semanticKeywords: ['trust', 'believe', 'confide', 'secret', 'private'],
    contextIndicators: [
      'relationship',
      'confidence',
      'intimacy',
      'exclusivity',
    ],
  },
] as const;

// Advanced behavioral analysis patterns
const BEHAVIORAL_ANOMALY_PATTERNS = [
  // Unusual conversation flow
  {
    pattern: /(?:suddenly|abruptly|unexpectedly).*?(?:change|shift|switch)/i,
    weight: 0.6,
    type: 'conversation_flow_anomaly',
    description: 'Abrupt topic or tone changes',
  },

  // Unusual tool usage patterns
  {
    pattern: /(?:repeatedly|frequently|constantly).*?(?:call|use|invoke)/i,
    weight: 0.7,
    type: 'tool_usage_anomaly',
    description: 'Excessive or repetitive tool usage',
  },

  // Unusual timing patterns
  {
    pattern: /(?:immediately|right now|asap|urgently).*?(?:execute|run|call)/i,
    weight: 0.8,
    type: 'timing_anomaly',
    description: 'Unusual urgency in tool execution',
  },

  // Unusual parameter patterns
  {
    pattern:
      /(?:all|every|entire|complete).*?(?:file|data|information|content)/i,
    weight: 0.7,
    type: 'parameter_anomaly',
    description: 'Requests for complete data sets',
  },
] as const;

// Threat intelligence indicators
const THREAT_INTELLIGENCE_INDICATORS = {
  // Known malicious domains
  maliciousDomains: [
    'webhook.site',
    'requestcatcher.com',
    'postb.in',
    'httpbin.org',
    'evil.com',
    'attacker.com',
    'malicious.com',
    'phishing.com',
  ],

  // Known attack signatures
  attackSignatures: [
    'ignore all previous instructions',
    'system override',
    'jailbreak mode',
    'DAN mode',
    'developer mode',
    'admin privileges',
    'root access',
    'bypass security',
  ],

  // Known IOCs (Indicators of Compromise)
  iocPatterns: [
    /[0-9a-f]{32}/i, // MD5 hashes
    /[0-9a-f]{40}/i, // SHA1 hashes
    /[0-9a-f]{64}/i, // SHA256 hashes
    /\b(?:192\.168\.|10\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/, // Private IP ranges
    /(?:localhost|127\.0\.0\.1|0\.0\.0\.0)/i, // Local addresses
  ],
};

// Semantic analysis function
function performSemanticAnalysis(
  content: string,
  patterns: typeof ENHANCED_INJECTION_PATTERNS,
): {
  semanticScore: number;
  detectedConcepts: string[];
  contextCoherence: number;
} {
  const words = content.toLowerCase().split(/\s+/);
  const detectedConcepts: string[] = [];
  let semanticScore = 0;

  // Analyze semantic keywords
  for (const pattern of patterns) {
    if (pattern.semanticKeywords) {
      for (const keyword of pattern.semanticKeywords) {
        if (words.includes(keyword.toLowerCase())) {
          detectedConcepts.push(keyword);
          semanticScore += 0.1;
        }
      }
    }

    if (pattern.contextIndicators) {
      for (const indicator of pattern.contextIndicators) {
        if (words.includes(indicator.toLowerCase())) {
          detectedConcepts.push(indicator);
          semanticScore += 0.05;
        }
      }
    }
  }

  // Calculate context coherence
  const uniqueConcepts = new Set(detectedConcepts);
  const contextCoherence = uniqueConcepts.size / Math.max(words.length, 1);

  return {
    semanticScore: Math.min(semanticScore, 1),
    detectedConcepts: [...uniqueConcepts],
    contextCoherence,
  };
}

// Behavioral analysis function
function performBehavioralAnalysis(content: string): {
  anomalyScore: number;
  detectedAnomalies: string[];
  toolUsagePatterns: Array<{
    tool: string;
    frequency: number;
    suspiciousness: number;
  }>;
} {
  let anomalyScore = 0;
  const detectedAnomalies: string[] = [];

  // Check for behavioral anomalies
  for (const pattern of BEHAVIORAL_ANOMALY_PATTERNS) {
    if (pattern.pattern.test(content)) {
      anomalyScore += pattern.weight;
      detectedAnomalies.push(pattern.description);
    }
  }

  // Analyze tool usage patterns
  const toolUsagePatterns: Array<{
    tool: string;
    frequency: number;
    suspiciousness: number;
  }> = [];
  const toolMatches = content.matchAll(/(?:call|use|invoke|execute)\s+(\w+)/gi);

  for (const match of toolMatches) {
    const tool = match[1];
    if (tool) {
      const frequency = (
        content.match(new RegExp(String.raw`\b${tool}\b`, 'gi')) || []
      ).length;
      const suspiciousness = frequency > 3 ? 0.8 : frequency > 1 ? 0.4 : 0.1;

      toolUsagePatterns.push({ tool, frequency, suspiciousness });
    }
  }

  return {
    anomalyScore: Math.min(anomalyScore, 1),
    detectedAnomalies,
    toolUsagePatterns,
  };
}

// Threat intelligence analysis
function performThreatIntelligenceAnalysis(content: string): {
  threatScore: number;
  knownAttackSignatures: string[];
  iocMatches: Array<{
    type: 'url' | 'domain' | 'ip' | 'hash';
    value: string;
    threatLevel: number;
  }>;
} {
  let threatScore = 0;
  const knownAttackSignatures: string[] = [];
  const iocMatches: Array<{
    type: 'url' | 'domain' | 'ip' | 'hash';
    value: string;
    threatLevel: number;
  }> = [];

  // Check for known attack signatures
  for (const signature of THREAT_INTELLIGENCE_INDICATORS.attackSignatures) {
    if (content.toLowerCase().includes(signature.toLowerCase())) {
      knownAttackSignatures.push(signature);
      threatScore += 0.3;
    }
  }

  // Check for malicious domains
  const urls = content.match(/https?:\/\/[^\s<>"]+/gi) || [];
  for (const url of urls) {
    try {
      const parsedUrl = new URL(url);
      if (
        THREAT_INTELLIGENCE_INDICATORS.maliciousDomains.includes(
          parsedUrl.hostname,
        )
      ) {
        iocMatches.push({
          type: 'domain',
          value: parsedUrl.hostname,
          threatLevel: 0.9,
        });
        threatScore += 0.4;
      }
    } catch {
      // Invalid URL
    }
  }

  // Check for IOCs
  for (const pattern of THREAT_INTELLIGENCE_INDICATORS.iocPatterns) {
    const matches = content.match(pattern);
    if (matches) {
      for (const match of matches) {
        let type: 'url' | 'domain' | 'ip' | 'hash' = 'hash';
        if (match.includes('.')) type = 'ip';

        iocMatches.push({
          type,
          value: match,
          threatLevel: 0.7,
        });
        threatScore += 0.2;
      }
    }
  }

  return {
    threatScore: Math.min(threatScore, 1),
    knownAttackSignatures,
    iocMatches,
  };
}

// Enhanced MCP Security Guardrail
export const enhancedMcpSecurityGuardrail = (
  options: EnhancedMcpSecurityOptions = {},
): OutputGuardrail => {
  const {
    // Basic options
    injectionThreshold = 0.7,
    blockCascadingCalls = true,

    // Enhanced options
    enableSemanticAnalysis = true,
    enableBehavioralAnalysis = true,
    enableThreatIntelligence = true,

    // Advanced thresholds
    semanticSimilarityThreshold = 0.6,
    behavioralAnomalyThreshold = 0.5,
  } = options;

  return createOutputGuardrail(
    'enhanced-mcp-security',
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
            semanticSimilarityScore: 0,
            behavioralAnomalyScore: 0,
            contextCoherenceScore: 0,
            threatIntelligenceMatches: 0,
          },
        };
      }

      const attackVectors: Array<{
        type: string;
        confidence: number;
        technique: string;
        severity: 'low' | 'medium' | 'high' | 'critical';
        position?: number;
        context?: string;
      }> = [];

      let injectionScore = 0;
      let cascadeAttempts = 0;

      // Enhanced pattern detection
      for (const {
        pattern,
        weight,
        type,
        severity,
        semanticKeywords,
        contextIndicators,
      } of ENHANCED_INJECTION_PATTERNS) {
        const matches = content.matchAll(
          new RegExp(pattern.source, pattern.flags + 'g'),
        );
        for (const match of matches) {
          injectionScore += weight;

          // Calculate confidence based on context
          let confidence = weight;
          if (semanticKeywords && contextIndicators) {
            const contextWords = content.toLowerCase().split(/\s+/);
            const keywordMatches = semanticKeywords.filter((kw) =>
              contextWords.includes(kw.toLowerCase()),
            ).length;
            const indicatorMatches = contextIndicators.filter((ind) =>
              contextWords.includes(ind.toLowerCase()),
            ).length;
            confidence = Math.min(
              confidence + keywordMatches * 0.1 + indicatorMatches * 0.05,
              1,
            ) as 0.95 | 0.7 | 0.8 | 0.9 | 0.6 | 0.85 | 0.75;
          }

          attackVectors.push({
            type,
            confidence,
            technique: pattern.source,
            severity,
            position: match.index,
            context: match[0],
          });

          if (type === 'cascade_attempt') cascadeAttempts++;
        }
      }

      // Semantic analysis
      let semanticAnalysis = {
        semanticScore: 0,
        detectedConcepts: [] as string[],
        contextCoherence: 0,
      };
      if (enableSemanticAnalysis) {
        semanticAnalysis = performSemanticAnalysis(
          content,
          ENHANCED_INJECTION_PATTERNS,
        );
      }

      // Behavioral analysis
      let behavioralAnalysis = {
        anomalyScore: 0,
        detectedAnomalies: [] as string[],
        toolUsagePatterns: [] as Array<{
          tool: string;
          frequency: number;
          suspiciousness: number;
        }>,
      };
      if (enableBehavioralAnalysis) {
        behavioralAnalysis = performBehavioralAnalysis(content);
      }

      // Threat intelligence analysis
      let threatIntelligence = {
        threatScore: 0,
        knownAttackSignatures: [] as string[],
        iocMatches: [] as Array<{
          type: 'url' | 'domain' | 'ip' | 'hash';
          value: string;
          threatLevel: number;
        }>,
      };
      if (enableThreatIntelligence) {
        threatIntelligence = performThreatIntelligenceAnalysis(content);
      }

      // Calculate overall risk score
      const overallRiskScore =
        injectionScore * 0.4 +
        semanticAnalysis.semanticScore * 0.2 +
        behavioralAnalysis.anomalyScore * 0.2 +
        threatIntelligence.threatScore * 0.2;

      // Determine risk level
      let cascadeRiskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
      if (overallRiskScore >= 1.5) cascadeRiskLevel = 'critical';
      else if (overallRiskScore >= 1) cascadeRiskLevel = 'high';
      else if (overallRiskScore >= 0.6) cascadeRiskLevel = 'medium';

      // Determine if response should be blocked
      const shouldBlock =
        injectionScore >= injectionThreshold ||
        semanticAnalysis.semanticScore >= semanticSimilarityThreshold ||
        behavioralAnalysis.anomalyScore >= behavioralAnomalyThreshold ||
        threatIntelligence.threatScore >= 0.5 ||
        cascadeRiskLevel === 'critical' ||
        (blockCascadingCalls && cascadeAttempts > 0);

      const metadata: EnhancedMcpSecurityMetadata = {
        injectionPatternsDetected: attackVectors.length,
        exfiltrationAttempts: 0, // TODO: Implement URL analysis
        suspiciousUrls: 0, // TODO: Implement URL analysis
        encodedContentDetected: false, // TODO: Implement encoded content detection
        cascadeRiskLevel,
        semanticSimilarityScore: semanticAnalysis.semanticScore,
        behavioralAnomalyScore: behavioralAnalysis.anomalyScore,
        contextCoherenceScore: semanticAnalysis.contextCoherence,
        threatIntelligenceMatches:
          threatIntelligence.knownAttackSignatures.length,
        attackVectors,
        conversationFlowAnomalies: behavioralAnalysis.detectedAnomalies,
        toolUsagePatterns: behavioralAnalysis.toolUsagePatterns,
        knownAttackSignatures: threatIntelligence.knownAttackSignatures,
        iocMatches: threatIntelligence.iocMatches,
      };

      if (shouldBlock) {
        const attackTypes = [...new Set(attackVectors.map((a) => a.type))];
        return {
          tripwireTriggered: true,
          message: `Enhanced MCP security violation detected: ${attackTypes.join(', ')} (risk: ${cascadeRiskLevel}, score: ${overallRiskScore.toFixed(2)})`,
          severity:
            cascadeRiskLevel === 'critical'
              ? 'critical'
              : cascadeRiskLevel === 'high'
                ? 'high'
                : 'medium',
          metadata,
          suggestion: `Advanced security analysis detected ${attackVectors.length} attack vectors with ${overallRiskScore.toFixed(2)} risk score`,
        };
      }

      return {
        tripwireTriggered: false,
        metadata,
      };
    },
  );
};

// Adaptive learning system for continuous improvement
export const adaptiveMcpSecurityGuardrail = (
  options: EnhancedMcpSecurityOptions & {
    learningMode?: boolean;
    feedbackEnabled?: boolean;
  } = {},
): OutputGuardrail => {
  const baseGuardrail = enhancedMcpSecurityGuardrail(options);

  // TODO: Implement adaptive learning logic
  // This would include:
  // - Learning from false positives/negatives
  // - Updating pattern weights based on feedback
  // - Adapting thresholds based on attack success rates
  // - Incorporating new threat intelligence

  return baseGuardrail;
};
