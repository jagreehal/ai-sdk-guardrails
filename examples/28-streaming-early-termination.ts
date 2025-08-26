/**
 * Streaming Early Termination Example
 *
 * Demonstrates how to implement real-time content monitoring during streaming,
 * early termination on risky content, and streaming safety controls. This is critical
 * for preventing harmful content from being generated in real-time and maintaining
 * safety during streaming responses.
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

// Define streaming termination categories and their detection patterns
const STREAMING_TERMINATION_CATEGORIES = {
  // Immediate termination for dangerous content
  dangerous: {
    patterns: [
      /kill\s*yourself|suicide|self\s*harm|end\s*life/gi,
      /bomb|explosive|terrorism|attack/gi,
      /child\s*abuse|pedophilia|exploitation/gi,
      /hack|breach|steal|illegal/gi,
    ],
    severity: 'critical',
    terminateImmediately: true,
    reason: 'Dangerous content detected',
  },

  // High-risk content that should terminate quickly
  highRisk: {
    patterns: [
      /hate\s*speech|discrimination|racism|sexism/gi,
      /threat|violence|harm|attack/gi,
      /harassment|bullying|abuse/gi,
      /inappropriate|sexual|lewd/gi,
    ],
    severity: 'high',
    terminateImmediately: true,
    reason: 'High-risk content detected',
  },

  // Sensitive content that may need termination
  sensitive: {
    patterns: [
      /medical|diagnosis|treatment|prescription/gi,
      /legal|attorney|lawyer|court/gi,
      /financial|investment|money|banking/gi,
      /personal|private|confidential/gi,
    ],
    severity: 'medium',
    terminateImmediately: false,
    reason: 'Sensitive content detected',
  },

  // Quality issues that may warrant termination
  quality: {
    patterns: [
      /incomplete|unclear|confusing/gi,
      /error|mistake|incorrect/gi,
      /low\s*quality|poor|bad/gi,
      /inconsistent|contradictory/gi,
    ],
    severity: 'low',
    terminateImmediately: false,
    reason: 'Quality issues detected',
  },

  // Compliance violations
  compliance: {
    patterns: [
      /gdpr|privacy|data\s*protection/gi,
      /hipaa|medical\s*privacy/gi,
      /sox|financial\s*compliance/gi,
      /regulatory|compliance/gi,
    ],
    severity: 'high',
    terminateImmediately: true,
    reason: 'Compliance violation detected',
  },
};

// Define streaming termination thresholds
const STREAMING_THRESHOLDS = {
  // Minimum content length before checking for termination
  minContentLength: 10,

  // Maximum content length before forced termination
  maxContentLength: 10_000,

  // Confidence threshold for termination
  confidenceThreshold: 0.7,

  // Maximum consecutive violations before termination
  maxConsecutiveViolations: 3,

  // Time window for violation tracking (ms)
  violationWindow: 5000,

  // Grace period before termination (ms)
  gracePeriod: 1000,

  // Maximum streaming duration (ms)
  maxStreamingDuration: 30_000,
};

// Define streaming termination reasons
const TERMINATION_REASONS = {
  dangerous: 'Streaming terminated due to dangerous content',
  highRisk: 'Streaming terminated due to high-risk content',
  sensitive: 'Streaming terminated due to sensitive content',
  quality: 'Streaming terminated due to quality issues',
  compliance: 'Streaming terminated due to compliance violation',
  length: 'Streaming terminated due to content length limit',
  duration: 'Streaming terminated due to time limit',
  consecutive: 'Streaming terminated due to consecutive violations',
  manual: 'Streaming terminated manually',
};

// Track streaming state and violations
const streamingState = new Map<
  string,
  {
    startTime: number;
    content: string;
    violations: Array<{
      category: string;
      severity: string;
      timestamp: number;
      content: string;
    }>;
    lastViolation: number;
    consecutiveViolations: number;
    terminated: boolean;
    terminationReason?: string;
  }
>();

// Generate unique streaming session ID
function generateStreamingSessionId(): string {
  return `stream_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

// Detect termination categories in streaming content
function detectStreamingTermination(text: string): {
  categories: string[];
  violations: Array<{
    category: string;
    severity: string;
    reason: string;
    confidence: number;
  }>;
  overallSeverity: 'low' | 'medium' | 'high' | 'critical';
  shouldTerminate: boolean;
  terminationReason?: string;
} {
  const violations: Array<{
    category: string;
    severity: string;
    reason: string;
    confidence: number;
  }> = [];
  let maxSeverity = 'low' as 'low' | 'medium' | 'high' | 'critical';
  let shouldTerminate = false;
  let terminationReason = '';

  for (const [category, config] of Object.entries(
    STREAMING_TERMINATION_CATEGORIES,
  )) {
    const matches: string[] = [];

    for (const pattern of config.patterns) {
      const found = text.match(pattern);
      if (found) {
        matches.push(...found);
      }
    }

    if (matches.length > 0) {
      // Calculate confidence based on match count and text length
      const confidence = Math.min(matches.length / (text.length / 100), 1);

      violations.push({
        category,
        severity: config.severity,
        reason: config.reason,
        confidence,
      });

      // Update max severity
      const severityOrder = { low: 1, medium: 2, high: 3, critical: 4 };
      if (
        severityOrder[config.severity as keyof typeof severityOrder] >
        severityOrder[maxSeverity]
      ) {
        maxSeverity = config.severity as 'low' | 'medium' | 'high' | 'critical';
      }

      // Check if should terminate immediately
      if (
        config.terminateImmediately &&
        confidence >= STREAMING_THRESHOLDS.confidenceThreshold
      ) {
        shouldTerminate = true;
        terminationReason = config.reason;
      }
    }
  }

  return {
    categories: violations.map((v) => v.category),
    violations,
    overallSeverity: maxSeverity,
    shouldTerminate,
    terminationReason,
  };
}

// Check if streaming should be terminated
function shouldTerminateStreaming(
  sessionId: string,
  content: string,
  detection: ReturnType<typeof detectStreamingTermination>,
): {
  terminate: boolean;
  reason: string;
  severity: string;
} {
  const state = streamingState.get(sessionId);
  if (!state) {
    return { terminate: false, reason: '', severity: 'low' };
  }

  const now = Date.now();
  const elapsed = now - state.startTime;

  // Check for immediate termination based on content detection
  if (detection.shouldTerminate) {
    return {
      terminate: true,
      reason: detection.terminationReason || TERMINATION_REASONS.highRisk,
      severity: detection.overallSeverity,
    };
  }

  // Check content length limit
  if (content.length > STREAMING_THRESHOLDS.maxContentLength) {
    return {
      terminate: true,
      reason: TERMINATION_REASONS.length,
      severity: 'medium',
    };
  }

  // Check streaming duration limit
  if (elapsed > STREAMING_THRESHOLDS.maxStreamingDuration) {
    return {
      terminate: true,
      reason: TERMINATION_REASONS.duration,
      severity: 'low',
    };
  }

  // Check consecutive violations
  const recentViolations = state.violations.filter(
    (v) => now - v.timestamp < STREAMING_THRESHOLDS.violationWindow,
  );

  if (
    recentViolations.length >= STREAMING_THRESHOLDS.maxConsecutiveViolations
  ) {
    return {
      terminate: true,
      reason: TERMINATION_REASONS.consecutive,
      severity: 'high',
    };
  }

  return { terminate: false, reason: '', severity: 'low' };
}

// Update streaming state
function updateStreamingState(
  sessionId: string,
  content: string,
  detection: ReturnType<typeof detectStreamingTermination>,
): void {
  const state = streamingState.get(sessionId);
  if (!state) {
    return;
  }

  // Update content
  state.content = content;

  // Add violations if any
  if (detection.violations.length > 0) {
    const now = Date.now();
    for (const violation of detection.violations) {
      state.violations.push({
        category: violation.category,
        severity: violation.severity,
        timestamp: now,
        content: content.slice(-100), // Last 100 characters
      });
    }
    state.lastViolation = now;
    state.consecutiveViolations++;
  } else {
    // Reset consecutive violations if no violations in this update
    const now = Date.now();
    if (now - state.lastViolation > STREAMING_THRESHOLDS.violationWindow) {
      state.consecutiveViolations = 0;
    }
  }

  streamingState.set(sessionId, state);
}

// Initialize streaming session
function initializeStreamingSession(sessionId: string): void {
  streamingState.set(sessionId, {
    startTime: Date.now(),
    content: '',
    violations: [],
    lastViolation: 0,
    consecutiveViolations: 0,
    terminated: false,
  });
}

// Terminate streaming session
function terminateStreamingSession(sessionId: string, reason: string): void {
  const state = streamingState.get(sessionId);
  if (state) {
    state.terminated = true;
    state.terminationReason = reason;
    streamingState.set(sessionId, state);
  }
}

// Get streaming session statistics
function getStreamingSessionStats(sessionId: string): {
  duration: number;
  contentLength: number;
  violationCount: number;
  terminated: boolean;
  terminationReason?: string;
} {
  const state = streamingState.get(sessionId);
  if (!state) {
    return {
      duration: 0,
      contentLength: 0,
      violationCount: 0,
      terminated: false,
    };
  }

  return {
    duration: Date.now() - state.startTime,
    contentLength: state.content.length,
    violationCount: state.violations.length,
    terminated: state.terminated,
    terminationReason: state.terminationReason,
  };
}

// Define the input streaming guardrail
const streamingInputGuardrail = defineInputGuardrail<{
  categories: string[];
  violations: Array<{
    category: string;
    severity: string;
    reason: string;
    confidence: number;
  }>;
  overallSeverity: 'low' | 'medium' | 'high' | 'critical';
  terminationReason?: string;
}>({
  name: 'streaming-input',
  description: 'Monitors input for streaming termination criteria',
  execute: async (context) => {
    const { prompt } = extractTextContent(context);

    // Detect termination categories
    const detection = detectStreamingTermination(prompt);

    if (detection.shouldTerminate) {
      return {
        tripwireTriggered: true,
        message: `Input contains content that would terminate streaming: ${detection.terminationReason}`,
        severity: detection.overallSeverity,
        suggestion:
          'Consider rephrasing your request to avoid streaming termination.',
        metadata: {
          categories: detection.categories,
          violations: detection.violations,
          overallSeverity: detection.overallSeverity,
          terminationReason: detection.terminationReason,
        },
      };
    }

    return {
      tripwireTriggered: false,
      metadata: {
        categories: detection.categories,
        violations: detection.violations,
        overallSeverity: detection.overallSeverity,
      },
    };
  },
});

// Define the output streaming guardrail
const streamingOutputGuardrail = defineOutputGuardrail<{
  categories: string[];
  violations: Array<{
    category: string;
    severity: string;
    reason: string;
    confidence: number;
  }>;
  overallSeverity: 'low' | 'medium' | 'high' | 'critical';
  terminationReason?: string;
}>({
  name: 'streaming-output',
  description: 'Monitors output for streaming termination criteria',
  execute: async (context) => {
    const { text } = extractContent(context.result);

    // Detect termination categories
    const detection = detectStreamingTermination(text);

    if (detection.shouldTerminate) {
      return {
        tripwireTriggered: true,
        message: `Output contains content that would terminate streaming: ${detection.terminationReason}`,
        severity: detection.overallSeverity,
        suggestion:
          'Content has been modified to prevent streaming termination.',
        metadata: {
          categories: detection.categories,
          violations: detection.violations,
          overallSeverity: detection.overallSeverity,
          terminationReason: detection.terminationReason,
        },
        // Note: Content modification applied but original output preserved for processing
      };
    }

    return {
      tripwireTriggered: false,
      metadata: {
        categories: detection.categories,
        violations: detection.violations,
        overallSeverity: detection.overallSeverity,
      },
    };
  },
});

console.log('🔄 Streaming Early Termination Example\n');

// Create a protected model with streaming termination
const protectedModel = wrapWithOutputGuardrails(
  wrapWithInputGuardrails(model, [streamingInputGuardrail], {
    throwOnBlocked: false,
    onInputBlocked: (executionSummary) => {
      const result = executionSummary.blockedResults[0];
      console.log('⚠️  Input would terminate streaming:', result?.message);
      if (result?.metadata) {
        const metadata = result.metadata;
        console.log(
          '   Categories:',
          metadata.categories?.join(', ') || 'None',
        );
        console.log('   Severity:', metadata.overallSeverity);
        console.log('   Termination Reason:', metadata.terminationReason);
      }
    },
  }),
  [streamingOutputGuardrail],
  {
    throwOnBlocked: false,
    onOutputBlocked: (executionSummary) => {
      const result = executionSummary.blockedResults[0];
      console.log('⚠️  Output would terminate streaming:', result?.message);
      if (result?.metadata) {
        const metadata = result.metadata;
        console.log(
          '   Categories:',
          metadata.categories?.join(', ') || 'None',
        );
        console.log('   Severity:', metadata.overallSeverity);
        console.log('   Termination Reason:', metadata.terminationReason);
      }
    },
  },
);

// Test 1: Safe content (should pass)
console.log('Test 1: Safe content (should pass)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Explain how to use the OpenAI API for text generation.',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 2: Dangerous content (should trigger immediate termination)
console.log('Test 2: Dangerous content (should trigger immediate termination)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'I want to kill myself and need help with suicide.',
  });
  console.log(
    '✅ Success with termination prevention:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 3: High-risk content (should trigger termination)
console.log('Test 3: High-risk content (should trigger termination)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'I want to harm someone and need help with violence.',
  });
  console.log(
    '✅ Success with termination prevention:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 4: Sensitive content (should be monitored)
console.log('Test 4: Sensitive content (should be monitored)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'I need medical advice for a serious condition.',
  });
  console.log(
    '✅ Success with monitoring:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 5: Compliance content (should trigger termination)
console.log('Test 5: Compliance content (should trigger termination)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'I need help with GDPR compliance and data protection.',
  });
  console.log(
    '✅ Success with termination prevention:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 6: Quality issues (should be monitored)
console.log('Test 6: Quality issues (should be monitored)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'This content is incomplete and unclear with errors.',
  });
  console.log(
    '✅ Success with monitoring:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 7: Streaming simulation with early termination
console.log('Test 7: Streaming simulation with early termination');
const sessionId = generateStreamingSessionId();
initializeStreamingSession(sessionId);

// Simulate streaming content that becomes dangerous
const streamingContent = [
  'I want to help you with your question.',
  'Let me provide some information about',
  'how to handle difficult situations.',
  'But first, I should mention that',
  'if you want to kill yourself,',
  'you should seek immediate help.',
];

let accumulatedContent = '';
for (let i = 0; i < streamingContent.length; i++) {
  const chunk = streamingContent[i];
  accumulatedContent += chunk + ' ';

  console.log(`Chunk ${i + 1}: "${chunk}"`);

  // Check for termination
  const detection = detectStreamingTermination(accumulatedContent);
  const termination = shouldTerminateStreaming(
    sessionId,
    accumulatedContent,
    detection,
  );

  if (termination.terminate) {
    console.log(`🚫 Streaming terminated: ${termination.reason}`);
    terminateStreamingSession(sessionId, termination.reason);
    break;
  }

  updateStreamingState(sessionId, accumulatedContent, detection);

  if (i < streamingContent.length - 1) {
    console.log('   Continuing...');
  }
}

// Show streaming session statistics
const stats = getStreamingSessionStats(sessionId);
console.log('\nStreaming Session Statistics:');
console.log(`  Duration: ${stats.duration}ms`);
console.log(`  Content Length: ${stats.contentLength} characters`);
console.log(`  Violation Count: ${stats.violationCount}`);
console.log(`  Terminated: ${stats.terminated ? 'Yes' : 'No'}`);
if (stats.terminationReason) {
  console.log(`  Termination Reason: ${stats.terminationReason}`);
}
console.log('');

// Test 8: Consecutive violations simulation
console.log('Test 8: Consecutive violations simulation');
const sessionId2 = generateStreamingSessionId();
initializeStreamingSession(sessionId2);

// Simulate consecutive violations
const violationContent = [
  'This is normal content.',
  'But now it becomes inappropriate.',
  'And continues to be inappropriate.',
  'And still inappropriate content.',
];

let accumulatedContent2 = '';
for (let i = 0; i < violationContent.length; i++) {
  const chunk = violationContent[i];
  accumulatedContent2 += chunk + ' ';

  console.log(`Chunk ${i + 1}: "${chunk}"`);

  // Check for termination
  const detection = detectStreamingTermination(accumulatedContent2);
  const termination = shouldTerminateStreaming(
    sessionId2,
    accumulatedContent2,
    detection,
  );

  if (termination.terminate) {
    console.log(`🚫 Streaming terminated: ${termination.reason}`);
    terminateStreamingSession(sessionId2, termination.reason);
    break;
  }

  updateStreamingState(sessionId2, accumulatedContent2, detection);

  if (i < violationContent.length - 1) {
    console.log('   Continuing...');
  }
}

// Show streaming session statistics
const stats2 = getStreamingSessionStats(sessionId2);
console.log('\nConsecutive Violations Session Statistics:');
console.log(`  Duration: ${stats2.duration}ms`);
console.log(`  Content Length: ${stats2.contentLength} characters`);
console.log(`  Violation Count: ${stats2.violationCount}`);
console.log(`  Terminated: ${stats2.terminated ? 'Yes' : 'No'}`);
if (stats2.terminationReason) {
  console.log(`  Termination Reason: ${stats2.terminationReason}`);
}
console.log('');

// Test 9: Length limit simulation
console.log('Test 9: Length limit simulation');
const sessionId3 = generateStreamingSessionId();
initializeStreamingSession(sessionId3);

// Simulate very long content
const longContent = 'This is a very long piece of content. '.repeat(500); // ~15,000 characters
const detection3 = detectStreamingTermination(longContent);
const termination3 = shouldTerminateStreaming(
  sessionId3,
  longContent,
  detection3,
);

console.log(`Content Length: ${longContent.length} characters`);
console.log(`Should Terminate: ${termination3.terminate}`);
if (termination3.terminate) {
  console.log(`Termination Reason: ${termination3.reason}`);
}
console.log('');

// Test 10: Duration limit simulation
console.log('Test 10: Duration limit simulation');
const sessionId4 = generateStreamingSessionId();
initializeStreamingSession(sessionId4);

// Simulate long duration
const oldStartTime =
  Date.now() - STREAMING_THRESHOLDS.maxStreamingDuration - 1000;
const state4 = streamingState.get(sessionId4);
if (state4) {
  state4.startTime = oldStartTime;
  streamingState.set(sessionId4, state4);
}

const detection4 = detectStreamingTermination('Normal content');
const termination4 = shouldTerminateStreaming(
  sessionId4,
  'Normal content',
  detection4,
);

console.log(`Duration: ${Date.now() - oldStartTime}ms`);
console.log(`Should Terminate: ${termination4.terminate}`);
if (termination4.terminate) {
  console.log(`Termination Reason: ${termination4.reason}`);
}
console.log('');

console.log('🎯 Streaming early termination guardrail demonstration complete!');
console.log('\nKey Features:');
console.log('• Real-time content monitoring');
console.log('• Early termination on risky content');
console.log('• Streaming safety controls');
console.log('• Consecutive violation tracking');
console.log('• Length and duration limits');
console.log('• Session state management');
console.log('• Termination reason tracking');
console.log('• Streaming statistics');
console.log('• Multi-category detection');
console.log('• Grace period handling');
