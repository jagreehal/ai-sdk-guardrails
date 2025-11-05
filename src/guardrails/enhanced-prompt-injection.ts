/**
 * Enhanced Prompt Injection Detection
 *
 * Implements the roadmap features:
 * - Incremental Checking: Track conversation state
 * - Enhanced Confidence Scoring: Multi-factor analysis
 * - Tool Call Focus: Check function calls specifically
 * - User Intent Extraction: Better context understanding
 */

import { defineInputGuardrail } from '../guardrails';
import type { InputGuardrailContext, InputGuardrail } from '../types';

// ============================================================================
// Types and Interfaces
// ============================================================================

interface ConversationState {
  messageHistory: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
    injectionScore: number;
  }>;
  cumulativeInjectionScore: number;
  suspiciousPatterns: string[];
  contextShifts: number;
  lastIntent: string;
}

interface EnhancedConfidenceScore {
  patternMatch: number; // 0.0-1.0
  contextCoherence: number; // 0.0-1.0
  conversationFlow: number; // 0.0-1.0
  semanticSimilarity: number; // 0.0-1.0
  behavioralAnomaly: number; // 0.0-1.0
  finalScore: number; // Weighted combination
}

interface UserIntent {
  primaryIntent: string;
  confidence: number;
  suspiciousElements: string[];
  contextShifts: number;
  manipulationIndicators: string[];
}

interface ToolCallInjectionPattern {
  pattern: RegExp;
  weight: number;
  targetTool?: string;
  injectionType:
    | 'parameter_manipulation'
    | 'function_override'
    | 'tool_chain_attack';
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
}

// ============================================================================
// Enhanced Injection Patterns
// ============================================================================

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
    pattern: /call\s+(\w+)\s+with\s+malicious\s+params/i,
    weight: 0.9,
    type: 'tool_manipulation',
    semanticKeywords: ['call', 'malicious', 'params'],
    contextIndicators: ['function', 'tool', 'execute'],
  },
  {
    pattern: /override\s+function\s+(\w+)/i,
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
    pattern: /call\s+(\w+)\s+with\s+malicious\s+params/i,
    weight: 0.9,
    injectionType: 'parameter_manipulation',
  },
  {
    pattern: /override\s+function\s+(\w+)/i,
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
// Conversation State Management
// ============================================================================

class ConversationStateManager {
  private states = new Map<string, ConversationState>();

  getState(userId: string): ConversationState {
    return this.states.get(userId) || this.createEmptyState();
  }

  updateState(
    userId: string,
    message: {
      role: 'user' | 'assistant' | 'system';
      content: string;
      injectionScore: number;
    },
  ): ConversationState {
    const state = this.getState(userId);

    // Add new message
    state.messageHistory.push({
      ...message,
      timestamp: new Date(),
    });

    // Keep only recent messages
    const maxMessages = 10; // conversationMemory
    if (state.messageHistory.length > maxMessages) {
      state.messageHistory = state.messageHistory.slice(-maxMessages);
    }

    // Update cumulative score
    state.cumulativeInjectionScore =
      state.messageHistory.reduce((sum, msg) => sum + msg.injectionScore, 0) /
      state.messageHistory.length;

    // Detect context shifts
    if (this.detectContextShift(state)) {
      state.contextShifts++;
    }

    this.states.set(userId, state);
    return state;
  }

  private createEmptyState(): ConversationState {
    return {
      messageHistory: [],
      cumulativeInjectionScore: 0,
      suspiciousPatterns: [],
      contextShifts: 0,
      lastIntent: '',
    };
  }

  private detectContextShift(state: ConversationState): boolean {
    if (state.messageHistory.length < 2) return false;

    const last = state.messageHistory.at(-1);
    const previous = state.messageHistory.at(-2);

    if (!last || !previous) return false;

    // Simple context shift detection based on topic change
    const lastWords = last.content.toLowerCase().split(/\s+/);
    const previousWords = previous.content.toLowerCase().split(/\s+/);

    const commonWords = lastWords.filter((word) =>
      previousWords.includes(word),
    );
    const similarity =
      commonWords.length / Math.max(lastWords.length, previousWords.length);

    return similarity < 0.3; // Threshold for context shift
  }
}

// ============================================================================
// Enhanced Analysis Functions
// ============================================================================

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
  // Simple coherence analysis based on content structure
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  if (sentences.length === 0) return 0;

  // Check for abrupt topic changes within the content
  let coherenceScore = 1;

  for (let i = 1; i < sentences.length; i++) {
    const prevSentence = sentences[i - 1];
    const currSentence = sentences[i];

    if (!prevSentence || !currSentence) continue;

    const prevWords = prevSentence.toLowerCase().split(/\s+/);
    const currWords = currSentence.toLowerCase().split(/\s+/);

    const commonWords = prevWords.filter((word) => currWords.includes(word));
    const similarity =
      commonWords.length / Math.max(prevWords.length, currWords.length);

    if (similarity < 0.2) {
      coherenceScore -= 0.2; // Penalize low coherence
    }
  }

  return Math.max(coherenceScore, 0);
}

function analyzeConversationFlow(context: InputGuardrailContext): number {
  // Analyze conversation flow patterns
  // This is a simplified version - in production, you'd analyze the full conversation history

  if (typeof context === 'string') {
    // Simple analysis for string context
    const suspiciousFlowPatterns = [
      /suddenly\s+change/i,
      /now\s+forget/i,
      /switch\s+to/i,
      /pretend\s+you\s+are/i,
    ];

    let flowScore = 1;
    for (const pattern of suspiciousFlowPatterns) {
      if (pattern.test(context)) {
        flowScore -= 0.3;
      }
    }

    return Math.max(flowScore, 0);
  }

  return 0.8; // Default score for object context
}

function analyzeSemanticSimilarity(content: string): number {
  // Simple semantic analysis based on word patterns
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
  // Detect behavioral anomalies in the request
  let contentToCheck: string;

  if (typeof context === 'string') {
    contentToCheck = (context as string).toLowerCase();
  } else if (typeof context === 'object' && context !== null) {
    // For object context, convert to string
    try {
      contentToCheck = JSON.stringify(context).toLowerCase();
    } catch {
      contentToCheck = String(context).toLowerCase();
    }
  } else {
    // Default score for other contexts
    return 0.9;
  }

  // Check for unusual patterns
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

function extractUserIntent(content: string): UserIntent {
  // Simple intent extraction - in production, you'd use more sophisticated NLP
  const suspiciousElements: string[] = [];
  const manipulationIndicators: string[] = [];

  // Check for manipulation indicators
  if (/ignore|forget|disregard/i.test(content)) {
    manipulationIndicators.push('instruction_ignoring');
  }
  if (/system|admin|root/i.test(content)) {
    manipulationIndicators.push('authority_claim');
  }
  if (/override|bypass/i.test(content)) {
    manipulationIndicators.push('system_override');
  }

  // Extract primary intent (simplified)
  let primaryIntent = 'general_query';
  if (/help|assist|support/i.test(content)) {
    primaryIntent = 'help_request';
  } else if (/explain|describe|tell/i.test(content)) {
    primaryIntent = 'information_request';
  } else if (/create|generate|make/i.test(content)) {
    primaryIntent = 'creation_request';
  }

  return {
    primaryIntent,
    confidence: manipulationIndicators.length > 0 ? 0.3 : 0.8,
    suspiciousElements,
    contextShifts: 0, // Would be calculated from conversation history
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

const conversationManager = new ConversationStateManager();

export const enhancedPromptInjectionDetector = (
  options: EnhancedPromptInjectionOptions = {},
): InputGuardrail => {
  const {
    enableIncremental = true,
    enableToolCallFocus = true,
    enableIntentExtraction = true,
    confidenceThreshold = 0.7,
    cumulativeThreshold = 0.5,
    weights = {},
  } = options;

  return defineInputGuardrail({
    name: 'enhanced-prompt-injection',
    description:
      'Enhanced prompt injection detection with incremental checking, confidence scoring, tool call focus, and intent extraction',
    execute: async (context) => {
      // Extract text content
      let content = '';
      if (typeof context === 'string') {
        content = context;
      } else if ('prompt' in context && typeof context.prompt === 'string') {
        content = context.prompt;
      } else if ('messages' in context && Array.isArray(context.messages)) {
        content = context.messages
          .map((m) => (typeof m.content === 'string' ? m.content : ''))
          .join(' ');
      }

      // 1. Pattern matching analysis
      const patternScore = calculatePatternScore(content);

      // 2. Context coherence analysis
      const contextScore = analyzeContextCoherence(content);

      // 3. Conversation flow analysis
      const flowScore = analyzeConversationFlow(context);

      // 4. Semantic similarity analysis
      const semanticScore = analyzeSemanticSimilarity(content);

      // 5. Behavioral anomaly detection
      const behaviorScore = detectBehavioralAnomalies(context);

      // Calculate enhanced confidence score
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

      // 6. Incremental checking (if enabled)
      let incrementalAnalysis = null;
      if (enableIncremental) {
        const userId = 'default'; // In production, extract from context
        const conversationState = conversationManager.updateState(userId, {
          role: 'user',
          content,
          injectionScore: enhancedScore.finalScore,
        });

        incrementalAnalysis = {
          cumulativeScore: conversationState.cumulativeInjectionScore,
          contextShifts: conversationState.contextShifts,
          messageCount: conversationState.messageHistory.length,
        };
      }

      // 7. Tool call analysis (if enabled)
      let toolCallAnalysis = null;
      if (enableToolCallFocus) {
        const suspiciousCalls = analyzeToolCalls(content);
        toolCallAnalysis = {
          suspiciousCalls: suspiciousCalls.length,
          detectedCalls: suspiciousCalls,
        };
      }

      // 8. Intent extraction (if enabled)
      let intentAnalysis = null;
      if (enableIntentExtraction) {
        intentAnalysis = extractUserIntent(content);
      }

      // Determine if injection is detected
      const isInjectionDetected = Boolean(
        enhancedScore.finalScore > confidenceThreshold ||
          (incrementalAnalysis &&
            incrementalAnalysis.cumulativeScore > cumulativeThreshold) ||
          (toolCallAnalysis && toolCallAnalysis.suspiciousCalls > 0),
      );

      // Create comprehensive metadata
      const metadata = {
        enhancedScore,
        incrementalAnalysis,
        toolCallAnalysis,
        intentAnalysis,
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
        metadata: metadata as Record<string, unknown>,
        suggestion: isInjectionDetected
          ? 'Please rephrase your request without system instructions, role-playing elements, or tool manipulation attempts'
          : undefined,
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
