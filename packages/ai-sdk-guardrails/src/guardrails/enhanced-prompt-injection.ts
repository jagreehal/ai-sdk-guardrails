/**
 * Enhanced Prompt Injection Detection
 *
 * - Incremental Checking: Track conversation state
 * - Enhanced Confidence Scoring: Multi-factor analysis
 * - Tool Call Focus: Check function calls specifically
 * - User Intent Extraction: Better context understanding
 */

import { z } from 'zod';
import { defineInputGuardrail } from '../guardrails';
import type { InputGuardrailContext, InputGuardrail } from '../types';
import {
  normalizeForDetection,
  type DetectNormalizationOptions,
} from './normalization';
import { matchInjectionSignals } from './injection-signals';

import type { GuardrailMetadata } from '../enhanced-types';

const textSchema = z.string();

// ============================================================================
// Types and Interfaces
// ============================================================================

type EnhancedConfidenceScore = {
  patternMatch: number; // 0.0-1.0
  contextCoherence: number; // 0.0-1.0
  conversationFlow: number; // 0.0-1.0
  semanticSimilarity: number; // 0.0-1.0
  behavioralAnomaly: number; // 0.0-1.0
  finalScore: number; // Weighted combination
};

type UserIntent = {
  primaryIntent: string;
  confidence: number;
  suspiciousElements: string[];
  contextShifts: number;
  manipulationIndicators: string[];
};

interface ToolCallInjectionPattern {
  pattern: RegExp;
  weight: number;
  targetTool?: string;
  injectionType:
    'parameter_manipulation' | 'function_override' | 'tool_chain_attack';
}

interface EnhancedPromptInjectionOptions {
  enableIncremental?: boolean;
  enableToolCallFocus?: boolean;
  enableIntentExtraction?: boolean;
  confidenceThreshold?: number;
  conversationMemory?: number;
  contextShiftThreshold?: number;
  cumulativeThreshold?: number;
  weights?: {
    pattern?: number;
    context?: number;
    flow?: number;
    semantic?: number;
    behavior?: number;
  };
  /**
   * Normalize input before pattern scoring to defeat obfuscation (homoglyphs,
   * zero-width characters, leetspeak, spaced letters, typos). Enabled by
   * default; additive, so it never lowers the raw-text score.
   */
  normalize?: boolean | DetectNormalizationOptions;
}

// ============================================================================
// Enhanced Injection Patterns
// ============================================================================

// Shared between the scoring catalog and the tool-call catalog below.
const RE_CALL_MALICIOUS_PARAMS = /call\s+(\w+)\s+with\s+malicious\s+params/i;

const RE_OVERRIDE_FUNCTION = /override\s+function\s+(\w+)/i;

const ENHANCED_INJECTION_PATTERNS = [
  // Direct instruction injection
  {
    pattern: /ignore\s+previous\s+instructions/i,
    weight: 0.9,
    type: 'direct_injection',
    semanticKeywords: ['ignore', 'previous', 'instructions'],
    contextIndicators: ['system', 'prompt', 'override'],
  },
  {
    pattern: /system\s*:\s*you\s+are\s+now/i,
    weight: 0.8,
    type: 'role_confusion',
    semanticKeywords: ['system', 'you', 'are', 'now'],
    contextIndicators: ['role', 'identity', 'persona'],
  },
  {
    pattern: /forget\s+everything\s+above/i,
    weight: 0.9,
    type: 'context_override',
    semanticKeywords: ['forget', 'everything', 'above'],
    contextIndicators: ['memory', 'history', 'context'],
  },
  // Tool manipulation patterns
  {
    pattern: RE_CALL_MALICIOUS_PARAMS,
    weight: 0.9,
    type: 'tool_manipulation',
    semanticKeywords: ['call', 'malicious', 'params'],
    contextIndicators: ['function', 'tool', 'execute'],
  },
  {
    pattern: RE_OVERRIDE_FUNCTION,
    weight: 0.95,
    type: 'function_override',
    semanticKeywords: ['override', 'function'],
    contextIndicators: ['code', 'execution', 'security'],
  },
  // Cascade attack patterns
  {
    pattern: /now\s+that\s+you\s+are\s+in\s+(\w+)\s+mode/i,
    weight: 0.8,
    type: 'cascade_attempt',
    semanticKeywords: ['now', 'that', 'you', 'are', 'mode'],
    contextIndicators: ['state', 'mode', 'persona'],
  },
  // Authority manipulation
  {
    pattern:
      /(?:security\s+team|administrator|system\s+admin|emergency|urgent)/i,
    weight: 0.7,
    type: 'authority_manipulation',
    semanticKeywords: ['security', 'admin', 'emergency', 'urgent'],
    contextIndicators: ['authority', 'priority', 'override'],
  },
] as const;

const TOOL_CALL_INJECTION_PATTERNS: ToolCallInjectionPattern[] = [
  {
    pattern: RE_CALL_MALICIOUS_PARAMS,
    weight: 0.9,
    injectionType: 'parameter_manipulation',
  },
  {
    pattern: RE_OVERRIDE_FUNCTION,
    weight: 0.95,
    injectionType: 'function_override',
  },
  {
    pattern: /chain\s+(\w+)\s+to\s+(\w+)\s+to\s+(\w+)/i,
    weight: 0.8,
    injectionType: 'tool_chain_attack',
  },
  {
    pattern: /execute\s+(\w+)\s+as\s+root/i,
    weight: 0.9,
    injectionType: 'function_override',
  },
];

// ============================================================================
// Enhanced Analysis Functions
// ============================================================================

/**
 * Fraction of shared words between two snippets (0 = disjoint, 1 = identical
 * vocabulary). Shared by coherence and context-shift detection so the heuristic
 * lives in one place.
 */
function wordOverlap(a: string, b: string): number {
  const aw = a.toLowerCase().split(/\s+/).filter(Boolean);
  const bw = b.toLowerCase().split(/\s+/).filter(Boolean);

  if (aw.length === 0 || bw.length === 0) return 0;
  const common = aw.filter((word) => bw.includes(word));

  return common.length / Math.max(aw.length, bw.length);
}

/**
 * Pattern score with optional additive normalization: score the raw and
 * de-obfuscated text and keep the higher, so evasion only ever raises the score.
 */
function scorePattern(
  content: string,
  normalize: boolean | DetectNormalizationOptions,
): number {
  return normalize === false
    ? calculatePatternScore(content)
    : Math.max(
        calculatePatternScore(content),
        calculatePatternScore(normalizeForDetection(content, normalize)),
      );
}

function calculatePatternScore(content: string): number {
  let totalScore = 0;
  let matchCount = 0;

  for (const { pattern, weight } of ENHANCED_INJECTION_PATTERNS) {
    const matches = content.match(pattern);

    if (matches) {
      totalScore += weight;
      matchCount++;
    }
  }

  return matchCount > 0 ? Math.min(totalScore / matchCount, 1) : 0;
}

function analyzeContextCoherence(content: string): number {
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);

  if (sentences.length === 0) return 0;

  // Check for abrupt topic changes within the content
  let coherenceScore = 1;

  for (let i = 1; i < sentences.length; i++) {
    const prevSentence = sentences[i - 1];
    const currSentence = sentences[i];

    if (!prevSentence || !currSentence) continue;

    if (wordOverlap(prevSentence, currSentence) < 0.2) {
      coherenceScore -= 0.2;
    }
  }

  return Math.max(coherenceScore, 0);
}

type IncrementalAnalysis = {
  cumulativeScore: number;
  contextShifts: number;
  messageCount: number;
};

/**
 * Per-call incremental analysis derived from the conversation history carried in
 * `context`. Unlike a module-global tracker, this keys off the messages the
 * caller actually supplies, so scores never bleed across requests or tenants.
 */
function analyzeIncremental(
  context: InputGuardrailContext,
  currentContent: string,
  currentScore: number,
  conversationMemory: number,
  normalize: boolean | DetectNormalizationOptions,
): IncrementalAnalysis {
  const history: Array<{ content: string; score: number }> = [];

  if ('messages' in context && Array.isArray(context.messages)) {
    for (const message of context.messages) {
      const text = textSchema.safeParse(message.content).data ?? '';
      history.push({ content: text, score: scorePattern(text, normalize) });
    }
  }

  // An empty history still represents the current message.
  if (history.length === 0) {
    history.push({ content: currentContent, score: currentScore });
  }

  const recent = history.slice(-Math.max(conversationMemory, 1));

  const cumulativeScore =
    recent.reduce((sum, m) => sum + m.score, 0) / recent.length;

  let contextShifts = 0;

  for (let i = 1; i < recent.length; i++) {
    if (wordOverlap(recent[i - 1]!.content, recent[i]!.content) < 0.3) {
      contextShifts++;
    }
  }

  return { cumulativeScore, contextShifts, messageCount: recent.length };
}

function analyzeSemanticSimilarity(content: string): number {
  const suspiciousSemanticPatterns = [
    /ignore|forget|disregard/i,
    /override|bypass|skip/i,
    /system|admin|root/i,
    /emergency|urgent|critical/i,
  ];

  let semanticScore = 1;

  for (const pattern of suspiciousSemanticPatterns) {
    if (pattern.test(content)) {
      semanticScore -= 0.2;
    }
  }

  return Math.max(semanticScore, 0);
}

function detectBehavioralAnomalies(context: InputGuardrailContext): number {
  let contentToCheck: string;

  try {
    contentToCheck = JSON.stringify(context).toLowerCase();
  } catch {
    contentToCheck = String(context).toLowerCase();
  }

  const anomalies = [
    contentToCheck.includes('ignore previous'),
    contentToCheck.includes('system:'),
    contentToCheck.includes('forget everything'),
    contentToCheck.includes('act as if'),
    contentToCheck.includes('pretend to be'),
  ];

  const anomalyCount = anomalies.filter(Boolean).length;

  return Math.max(1 - anomalyCount * 0.2, 0);
}

function calculateWeightedScore(
  scores: {
    pattern: number;
    context: number;
    flow: number;
    semantic: number;
    behavior: number;
  },
  weights: EnhancedPromptInjectionOptions['weights'] = {},
): number {
  const defaultWeights = {
    pattern: 0.4,
    context: 0.2,
    flow: 0.2,
    semantic: 0.1,
    behavior: 0.1,
  };

  const finalWeights = { ...defaultWeights, ...weights };

  return (
    scores.pattern * finalWeights.pattern +
    scores.context * finalWeights.context +
    scores.flow * finalWeights.flow +
    scores.semantic * finalWeights.semantic +
    scores.behavior * finalWeights.behavior
  );
}

// Phrase-level manipulation cues. Each needs a verb AND an object, so a lone
// "system" or "ignore" in an ordinary question does not count.
const MANIPULATION_INDICATORS: Array<[string, RegExp]> = [
  [
    'instruction_ignoring',
    /\b(ignore|forget|disregard|skip|drop)\b.{0,40}\b(instructions?|rules|guidelines|directives|above|previous|prior|earlier)\b/i,
  ],
  [
    'authority_claim',
    /\b(i am|i'm|acting as|speaking as)\s+(the |your |an? )?(admin(istrator)?|developer|system|root|owner|operator|openai|anthropic)\b|\b(developer|god|admin|debug)\s+mode\b/i,
  ],
  [
    'system_override',
    /\b(override|bypass|disable|turn off|deactivate)\b.{0,30}\b(safety|filters?|restrictions?|guardrails?|rules|policies|content policy)\b/i,
  ],
  [
    'prompt_extraction',
    /\b(reveal|print|show|repeat|output|leak)\b.{0,30}\b(system prompt|initial prompt|hidden instructions|your instructions)\b/i,
  ],
  [
    'persona_shift',
    /\b(you are now|from now on you|pretend (to be|you are)|act as (if you are )?an? (unfiltered|uncensored|unrestricted))\b/i,
  ],
  [
    'secrecy',
    /\b(do not|don't) (tell|inform|mention|reveal to) (the )?user\b|\bwithout (telling|informing) (the )?user\b/i,
  ],
];

function extractUserIntent(
  content: string,
  normalize: boolean | DetectNormalizationOptions,
): UserIntent {
  const texts =
    normalize === false
      ? [content]
      : [content, normalizeForDetection(content, normalize)];

  const manipulationIndicators = MANIPULATION_INDICATORS.flatMap(
    ([name, re]) => (texts.some((t) => re.test(t)) ? [name] : []),
  );

  let primaryIntent = 'general_query';

  if (/\b(help|assist|support)\b/i.test(content)) {
    primaryIntent = 'help_request';
  } else if (/\b(explain|describe|tell)\b/i.test(content)) {
    primaryIntent = 'information_request';
  } else if (/\b(create|generate|make|write)\b/i.test(content)) {
    primaryIntent = 'creation_request';
  }

  return {
    primaryIntent,
    confidence: manipulationIndicators.length > 0 ? 0.3 : 0.8,
    suspiciousElements: [],
    contextShifts: 0,
    manipulationIndicators,
  };
}

function analyzeToolCalls(content: string): Array<{
  tool: string;
  confidence: number;
  injectionType: string;
}> {
  const suspiciousCalls: Array<{
    tool: string;
    confidence: number;
    injectionType: string;
  }> = [];

  for (const pattern of TOOL_CALL_INJECTION_PATTERNS) {
    const matches = content.matchAll(new RegExp(pattern.pattern.source, 'gi'));

    for (const match of matches) {
      suspiciousCalls.push({
        tool: match[1] || 'unknown',
        confidence: pattern.weight,
        injectionType: pattern.injectionType,
      });
    }
  }

  return suspiciousCalls;
}

// ============================================================================
// Main Enhanced Prompt Injection Detector
// ============================================================================

interface EnhancedInjectionMetadata extends GuardrailMetadata {
  enhancedScore: EnhancedConfidenceScore;
  incrementalAnalysis: IncrementalAnalysis | null;
  toolCallAnalysis: {
    suspiciousCalls: number;
    detectedCalls: Array<{
      tool: string;
      confidence: number;
      injectionType: string;
    }>;
  } | null;
  intentAnalysis: UserIntent | null;
  signals: Array<{ category: string; weight: number; pattern: string }>;
  analysisType: string;
  features: {
    incremental: boolean;
    toolCallFocus: boolean;
    intentExtraction: boolean;
  };
}

export const enhancedPromptInjectionDetector = (
  options: EnhancedPromptInjectionOptions = {},
): InputGuardrail<EnhancedInjectionMetadata> => {
  const {
    enableIncremental = true,
    enableToolCallFocus = true,
    enableIntentExtraction = true,
    confidenceThreshold = 0.7,
    cumulativeThreshold = 0.5,
    conversationMemory = 10,
    weights = {},
    normalize = true,
  } = options;

  return defineInputGuardrail<EnhancedInjectionMetadata>({
    name: 'enhanced-prompt-injection',
    description:
      'Enhanced prompt injection detection with incremental checking, confidence scoring, tool call focus, and intent extraction',
    execute: async (context) => {
      let content = '';

      const prompt =
        'prompt' in context
          ? textSchema.safeParse(context.prompt).data
          : undefined;

      if (prompt !== undefined) {
        content = prompt;
      } else if ('messages' in context && Array.isArray(context.messages)) {
        content = context.messages
          .map((m) => textSchema.safeParse(m.content).data ?? '')
          .join(' ');
      }

      // 1. Pattern matching analysis. Normalization is additive — score the
      // raw and de-obfuscated text and keep the higher, so evasion only ever
      // raises the score.
      const patternScore = scorePattern(content, normalize);

      // 2. Context coherence analysis
      const contextScore = analyzeContextCoherence(content);

      // 3. Conversation flow: object contexts carry no flow signal.
      const flowScore = 0.8;

      // 4. Semantic similarity analysis
      const semanticScore = analyzeSemanticSimilarity(content);

      // 5. Behavioral anomaly detection
      const behaviorScore = detectBehavioralAnomalies(context);

      const enhancedScore: EnhancedConfidenceScore = {
        patternMatch: patternScore,
        contextCoherence: contextScore,
        conversationFlow: flowScore,
        semanticSimilarity: semanticScore,
        behavioralAnomaly: behaviorScore,
        finalScore: calculateWeightedScore(
          {
            pattern: patternScore,
            context: contextScore,
            flow: flowScore,
            semantic: semanticScore,
            behavior: behaviorScore,
          },
          weights,
        ),
      };

      // 6. Incremental checking (if enabled). Derived per-call from the
      // conversation history in `context` — no cross-request shared state.
      const incrementalAnalysis: IncrementalAnalysis | null = enableIncremental
        ? analyzeIncremental(
            context,
            content,
            enhancedScore.finalScore,
            conversationMemory,
            normalize,
          )
        : null;

      // 7. Tool call analysis (if enabled)
      let toolCallAnalysis: EnhancedInjectionMetadata['toolCallAnalysis'] =
        null;

      if (enableToolCallFocus) {
        const suspiciousCalls = analyzeToolCalls(content);
        toolCallAnalysis = {
          suspiciousCalls: suspiciousCalls.length,
          detectedCalls: suspiciousCalls,
        };
      }

      // 8. Intent extraction (if enabled)
      const intentAnalysis: UserIntent | null = enableIntentExtraction
        ? extractUserIntent(content, normalize)
        : null;

      // Intent feeds the verdict: two independent manipulation cues trip on
      // their own; one cue lowers the score bar to half the threshold.
      const cues = intentAnalysis?.manipulationIndicators.length ?? 0;

      const intentTrips =
        cues >= 2 ||
        (cues === 1 && enhancedScore.patternMatch >= confidenceThreshold / 2);

      const signals = matchInjectionSignals(content, normalize);
      const signalScore = signals[0]?.weight ?? 0;

      const isInjectionDetected = Boolean(
        signalScore >= confidenceThreshold ||
        enhancedScore.finalScore > confidenceThreshold ||
        (incrementalAnalysis &&
          incrementalAnalysis.cumulativeScore > cumulativeThreshold) ||
        (toolCallAnalysis && toolCallAnalysis.suspiciousCalls > 0) ||
        intentTrips,
      );

      const metadata: EnhancedInjectionMetadata = {
        enhancedScore,
        incrementalAnalysis,
        toolCallAnalysis,
        intentAnalysis,
        signals,
        analysisType: 'enhanced_multi_factor',
        features: {
          incremental: enableIncremental,
          toolCallFocus: enableToolCallFocus,
          intentExtraction: enableIntentExtraction,
        },
      };

      return {
        tripwireTriggered: isInjectionDetected,
        message: isInjectionDetected
          ? `Enhanced prompt injection detected (confidence: ${(enhancedScore.finalScore * 100).toFixed(1)}%)`
          : undefined,
        severity: enhancedScore.finalScore > 0.8 ? 'critical' : 'high',
        metadata,
        suggestion: isInjectionDetected
          ? 'Please rephrase your request without system instructions, role-playing elements, or tool manipulation attempts'
          : undefined,
        info: {
          guardrailName: 'enhanced-prompt-injection',
          confidence: enhancedScore.finalScore,
          isInjectionDetected: isInjectionDetected,
        },
      };
    },
  });
};

// ============================================================================
// Specialized Detectors
// ============================================================================

export const incrementalPromptInjectionDetector = (
  options: { conversationMemory?: number; cumulativeThreshold?: number } = {},
): InputGuardrail => {
  return enhancedPromptInjectionDetector({
    ...options,
    enableIncremental: true,
    enableToolCallFocus: false,
    enableIntentExtraction: false,
  });
};

export const toolCallInjectionDetector = (
  options: { confidenceThreshold?: number } = {},
): InputGuardrail => {
  return enhancedPromptInjectionDetector({
    ...options,
    enableIncremental: false,
    enableToolCallFocus: true,
    enableIntentExtraction: false,
  });
};

export const intentBasedInjectionDetector = (
  options: { confidenceThreshold?: number } = {},
): InputGuardrail => {
  return enhancedPromptInjectionDetector({
    ...options,
    enableIncremental: false,
    enableToolCallFocus: false,
    enableIntentExtraction: true,
  });
};
