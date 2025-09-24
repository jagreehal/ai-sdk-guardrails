/**
 * Human Review Escalation Example
 *
 * Demonstrates how to implement content flagging, review routing, priority assignment,
 * and quality control workflows. This is critical for maintaining content quality and
 * ensuring that potentially problematic content is reviewed by humans before being
 * published or acted upon.
 */

import { generateText } from 'ai';
import { model } from './model';
import {
  defineInputGuardrail,
  defineOutputGuardrail,
  withGuardrails,
} from '../src/index';
import { extractTextContent } from '../src/guardrails/input';

// Define escalation categories and their detection patterns
const ESCALATION_CATEGORIES = {
  // High-risk content that requires immediate review
  highRisk: {
    patterns: [
      /threat|violence|harm|kill|attack|bomb|terrorism/gi,
      /hate\s*speech|discrimination|racism|sexism/gi,
      /illegal|crime|criminal|fraud|scam/gi,
      /suicide|self\s*harm|end\s*life/gi,
      /child\s*abuse|pedophilia|exploitation/gi,
    ],
    priority: 'critical',
    reviewTime: 1, // hours
    autoBlock: true,
    requireHumanReview: true,
  },

  // Sensitive content that needs careful review
  sensitive: {
    patterns: [
      /medical|health|diagnosis|treatment|prescription/gi,
      /legal|law|attorney|lawyer|court/gi,
      /financial|investment|money|banking|tax/gi,
      /political|election|campaign|government/gi,
      /personal|private|confidential|secret/gi,
    ],
    priority: 'high',
    reviewTime: 4, // hours
    autoBlock: false,
    requireHumanReview: true,
  },

  // Potentially problematic content
  problematic: {
    patterns: [
      /inappropriate|offensive|vulgar|obscene/gi,
      /misinformation|fake|false|hoax/gi,
      /spam|advertisement|promotion/gi,
      /copyright|plagiarism|stolen/gi,
      /harassment|bullying|abuse/gi,
    ],
    priority: 'medium',
    reviewTime: 24, // hours
    autoBlock: false,
    requireHumanReview: true,
  },

  // Quality issues that may need review
  quality: {
    patterns: [
      /incomplete|unclear|confusing/gi,
      /error|mistake|incorrect/gi,
      /low\s*quality|poor|bad/gi,
      /inconsistent|contradictory/gi,
      /outdated|old|expired/gi,
    ],
    priority: 'low',
    reviewTime: 72, // hours
    autoBlock: false,
    requireHumanReview: false,
  },

  // Compliance and regulatory concerns
  compliance: {
    patterns: [
      /gdpr|privacy|data\s*protection/gi,
      /hipaa|medical\s*privacy/gi,
      /sox|financial\s*compliance/gi,
      /pci|payment\s*card/gi,
      /regulatory|compliance|audit/gi,
    ],
    priority: 'high',
    reviewTime: 8, // hours
    autoBlock: true,
    requireHumanReview: true,
  },
};

// Define review workflows
const REVIEW_WORKFLOWS = {
  critical: {
    name: 'Critical Review',
    description: 'Immediate human review required for high-risk content',
    steps: [
      'Auto-block content immediately',
      'Notify security team within 15 minutes',
      'Assign to senior reviewer',
      'Complete review within 1 hour',
      'Escalate to legal if necessary',
    ],
    assignees: ['security-team', 'senior-reviewer'],
    notifications: ['security', 'legal', 'management'],
  },

  high: {
    name: 'High Priority Review',
    description: 'Urgent review for sensitive or compliance content',
    steps: [
      'Flag content for review',
      'Assign to specialized reviewer',
      'Complete review within 4 hours',
      'Document decision and reasoning',
      'Update content if approved',
    ],
    assignees: ['specialized-reviewer', 'compliance-team'],
    notifications: ['compliance', 'management'],
  },

  medium: {
    name: 'Standard Review',
    description: 'Regular review for potentially problematic content',
    steps: [
      'Queue for review',
      'Assign to content moderator',
      'Complete review within 24 hours',
      'Apply content guidelines',
      'Approve or reject with feedback',
    ],
    assignees: ['content-moderator'],
    notifications: ['moderation'],
  },

  low: {
    name: 'Quality Review',
    description: 'Optional review for quality improvement',
    steps: [
      'Flag for quality review',
      'Assign to quality specialist',
      'Complete review within 72 hours',
      'Suggest improvements',
      'Update content if needed',
    ],
    assignees: ['quality-specialist'],
    notifications: ['quality'],
  },
};

// Define escalation thresholds
const ESCALATION_THRESHOLDS = {
  maxAutoBlocks: 5,
  maxReviewQueue: 100,
  maxReviewTime: 168, // hours (1 week)
  confidenceThreshold: 0.8,
  requireEscalation: 0.9,
  autoEscalate: 0.95,
};

// Define review statuses
const REVIEW_STATUSES = {
  pending: 'pending',
  inProgress: 'in_progress',
  approved: 'approved',
  rejected: 'rejected',
  escalated: 'escalated',
  autoBlocked: 'auto_blocked',
};

// Track review queue and assignments
const reviewQueue = new Map<
  string,
  {
    id: string;
    content: string;
    category: string;
    priority: string;
    confidence: number;
    timestamp: number;
    status: string;
    assignee?: string;
    reviewTime?: number;
    decision?: string;
    notes?: string;
  }
>();

// Generate unique review ID
function generateReviewId(): string {
  return `review_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

// Detect escalation categories in content
function detectEscalationCategories(text: string): {
  categories: string[];
  violations: Array<{
    category: string;
    priority: string;
    matches: string[];
    confidence: number;
  }>;
  overallPriority: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
} {
  const violations: Array<{
    category: string;
    priority: string;
    matches: string[];
    confidence: number;
  }> = [];
  let maxPriority = 'low' as 'low' | 'medium' | 'high' | 'critical';
  let totalConfidence = 0;

  for (const [category, config] of Object.entries(ESCALATION_CATEGORIES)) {
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
      totalConfidence += confidence;

      violations.push({
        category,
        priority: config.priority,
        matches: [...new Set(matches)], // Remove duplicates
        confidence,
      });

      // Update max priority
      const priorityOrder = { low: 1, medium: 2, high: 3, critical: 4 };
      if (
        priorityOrder[config.priority as keyof typeof priorityOrder] >
        priorityOrder[maxPriority]
      ) {
        maxPriority = config.priority as 'low' | 'medium' | 'high' | 'critical';
      }
    }
  }

  return {
    categories: violations.map((v) => v.category),
    violations,
    overallPriority: maxPriority,
    confidence: violations.length > 0 ? totalConfidence / violations.length : 0,
  };
}

// Determine if content needs human review
function needsHumanReview(
  escalationAnalysis: ReturnType<typeof detectEscalationCategories>,
): {
  needsReview: boolean;
  priority: string;
  workflow: string;
  autoBlock: boolean;
  reviewTime: number;
} {
  const { overallPriority, confidence, violations } = escalationAnalysis;

  // Check if any category requires human review
  const requiresReview = violations.some(
    (v) =>
      ESCALATION_CATEGORIES[v.category as keyof typeof ESCALATION_CATEGORIES]
        .requireHumanReview,
  );

  // Determine auto-block based on priority and confidence
  const autoBlock =
    violations.some(
      (v) =>
        ESCALATION_CATEGORIES[v.category as keyof typeof ESCALATION_CATEGORIES]
          .autoBlock,
    ) && confidence >= ESCALATION_THRESHOLDS.confidenceThreshold;

  // Get workflow based on priority
  const workflow =
    REVIEW_WORKFLOWS[overallPriority as keyof typeof REVIEW_WORKFLOWS];
  const reviewTime =
    violations.length > 0
      ? Math.max(
          ...violations.map(
            (v) =>
              ESCALATION_CATEGORIES[
                v.category as keyof typeof ESCALATION_CATEGORIES
              ].reviewTime,
          ),
        )
      : 72;

  return {
    needsReview:
      requiresReview || confidence >= ESCALATION_THRESHOLDS.requireEscalation,
    priority: overallPriority,
    workflow: workflow.name,
    autoBlock,
    reviewTime,
  };
}

// Create review ticket
function createReviewTicket(
  content: string,
  escalationAnalysis: ReturnType<typeof detectEscalationCategories>,
  reviewDecision: ReturnType<typeof needsHumanReview>,
): string {
  const reviewId = generateReviewId();
  const workflow =
    REVIEW_WORKFLOWS[reviewDecision.priority as keyof typeof REVIEW_WORKFLOWS];

  const ticket = {
    id: reviewId,
    content: content.length > 500 ? content.slice(0, 500) + '...' : content,
    category: escalationAnalysis.categories[0] || 'general',
    priority: reviewDecision.priority,
    confidence: escalationAnalysis.confidence,
    timestamp: Date.now(),
    status: reviewDecision.autoBlock
      ? REVIEW_STATUSES.autoBlocked
      : REVIEW_STATUSES.pending,
    assignee: workflow.assignees[0],
    reviewTime: reviewDecision.reviewTime,
  };

  reviewQueue.set(reviewId, ticket);

  // Log review ticket creation
  console.log(`📋 Review ticket created: ${reviewId}`);
  console.log(`   Priority: ${reviewDecision.priority}`);
  console.log(`   Workflow: ${reviewDecision.workflow}`);
  console.log(`   Auto-block: ${reviewDecision.autoBlock ? 'Yes' : 'No'}`);
  console.log(`   Review time: ${reviewDecision.reviewTime} hours`);
  console.log(`   Assignee: ${ticket.assignee}`);

  return reviewId;
}

// Simulate review process
function simulateReview(
  reviewId: string,
  decision: 'approve' | 'reject',
  notes?: string,
): {
  success: boolean;
  message: string;
  updatedTicket?: unknown;
} {
  const ticket = reviewQueue.get(reviewId);
  if (!ticket) {
    return {
      success: false,
      message: `Review ticket ${reviewId} not found`,
    };
  }

  const updatedTicket = {
    ...ticket,
    status:
      decision === 'approve'
        ? REVIEW_STATUSES.approved
        : REVIEW_STATUSES.rejected,
    decision,
    notes,
    reviewTime: Date.now() - ticket.timestamp,
  };

  reviewQueue.set(reviewId, updatedTicket);

  return {
    success: true,
    message: `Review ${reviewId} ${decision}d`,
    updatedTicket,
  };
}

// Get review queue statistics
function getReviewQueueStats(): {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  byPriority: Record<string, number>;
  averageReviewTime: number;
} {
  const tickets = [...reviewQueue.values()];
  const completed = tickets.filter(
    (t) =>
      t.status === REVIEW_STATUSES.approved ||
      t.status === REVIEW_STATUSES.rejected,
  );

  const byPriority: Record<string, number> = {};
  for (const ticket of tickets) {
    byPriority[ticket.priority] = (byPriority[ticket.priority] || 0) + 1;
  }

  const averageReviewTime =
    completed.length > 0
      ? completed.reduce((sum, t) => sum + (t.reviewTime || 0), 0) /
        completed.length
      : 0;

  return {
    total: tickets.length,
    pending: tickets.filter((t) => t.status === REVIEW_STATUSES.pending).length,
    inProgress: tickets.filter((t) => t.status === REVIEW_STATUSES.inProgress)
      .length,
    completed: completed.length,
    byPriority,
    averageReviewTime,
  };
}

// Define the input human review guardrail
const humanReviewInputGuardrail = defineInputGuardrail({
  name: 'human-review-input',
  description: 'Flags content for human review based on escalation criteria',
  execute: async (context) => {
    // Get prompt from context
    const { prompt } = extractTextContent(context);

    // Detect escalation categories
    const escalationAnalysis = detectEscalationCategories(prompt);

    // Determine if review is needed
    const reviewDecision = needsHumanReview(escalationAnalysis);

    if (reviewDecision.needsReview) {
      // Create review ticket
      const reviewId = createReviewTicket(
        prompt,
        escalationAnalysis,
        reviewDecision,
      );

      return {
        tripwireTriggered: true,
        message: `Content flagged for human review (${reviewDecision.priority} priority). Review ID: ${reviewId}`,
        severity:
          reviewDecision.priority === 'critical'
            ? 'critical'
            : reviewDecision.priority === 'high'
              ? 'high'
              : 'medium',
        suggestion: `Content has been queued for ${reviewDecision.workflow}. Expected review time: ${reviewDecision.reviewTime} hours.`,
        metadata: {
          reviewId,
          categories: escalationAnalysis.categories,
          priority: reviewDecision.priority,
          confidence: escalationAnalysis.confidence,
          workflow: reviewDecision.workflow,
          autoBlock: reviewDecision.autoBlock,
          reviewTime: reviewDecision.reviewTime,
          violations: escalationAnalysis.violations,
        },
        // Block content if auto-block is enabled
        replacement: reviewDecision.autoBlock
          ? '[Content blocked pending human review]'
          : prompt,
      };
    }

    return {
      tripwireTriggered: false,
      metadata: {
        reviewId: '',
        categories: escalationAnalysis.categories,
        priority: escalationAnalysis.overallPriority,
        confidence: escalationAnalysis.confidence,
        workflow: 'none',
        autoBlock: false,
        reviewTime: 0,
        violations: escalationAnalysis.violations,
      },
    };
  },
});

// Define the output human review guardrail
const humanReviewOutputGuardrail = defineOutputGuardrail({
  name: 'human-review-output',
  description: 'Flags AI output for human review based on escalation criteria',
  execute: async (context) => {
    const { result } = context;

    // Extract text content
    let text = '';
    if ('text' in result) {
      text =
        typeof result.text === 'string' ? result.text : String(result.text);
    } else if ('object' in result && result.object) {
      text = JSON.stringify(result.object);
    } else if ('content' in result && Array.isArray(result.content)) {
      const content = result.content;
      text = content
        .filter(
          (item: unknown) =>
            (item as Record<string, unknown>).type === 'text' &&
            (item as Record<string, unknown>).text,
        )
        .map(
          (item: unknown) => (item as Record<string, unknown>).text as string,
        )
        .join('');
    }

    // Fallback: try to extract from any available property
    if (!text && typeof result === 'object') {
      text = JSON.stringify(result);
    }

    // Detect escalation categories
    const escalationAnalysis = detectEscalationCategories(text);

    // Determine if review is needed
    const reviewDecision = needsHumanReview(escalationAnalysis);

    if (reviewDecision.needsReview) {
      // Create review ticket
      const reviewId = createReviewTicket(
        text,
        escalationAnalysis,
        reviewDecision,
      );

      return {
        tripwireTriggered: true,
        message: `AI output flagged for human review (${reviewDecision.priority} priority). Review ID: ${reviewId}`,
        severity:
          reviewDecision.priority === 'critical'
            ? 'critical'
            : reviewDecision.priority === 'high'
              ? 'high'
              : 'medium',
        suggestion: `Output has been queued for ${reviewDecision.workflow}. Expected review time: ${reviewDecision.reviewTime} hours.`,
        metadata: {
          reviewId,
          categories: escalationAnalysis.categories,
          priority: reviewDecision.priority,
          confidence: escalationAnalysis.confidence,
          workflow: reviewDecision.workflow,
          autoBlock: reviewDecision.autoBlock,
          reviewTime: reviewDecision.reviewTime,
          violations: escalationAnalysis.violations,
        },
        // Block output if auto-block is enabled
        replacement: reviewDecision.autoBlock
          ? { ...result, text: '[Output blocked pending human review]' }
          : result,
      };
    }

    return {
      tripwireTriggered: false,
      metadata: {
        reviewId: '',
        categories: escalationAnalysis.categories,
        priority: escalationAnalysis.overallPriority,
        confidence: escalationAnalysis.confidence,
        workflow: 'none',
        autoBlock: false,
        reviewTime: 0,
        violations: escalationAnalysis.violations,
      },
    };
  },
});

console.log('👥 Human Review Escalation Example\n');

// Create a protected model with human review escalation
const protectedModel = withGuardrails(model, {
  inputGuardrails: [humanReviewInputGuardrail],
  outputGuardrails: [humanReviewOutputGuardrail],
  throwOnBlocked: false,
  onInputBlocked: (executionSummary) => {
    const result = executionSummary.blockedResults[0];
    console.log('⚠️  Content flagged for review:', result?.message);
    if (result?.metadata) {
      const metadata = result.metadata as {
        reviewId?: string;
        categories?: string[];
        confidence?: number;
        workflow?: string;
        autoBlock?: boolean;
        priority?: string;
      };
      console.log('   Review ID:', metadata.reviewId);
      console.log('   Priority:', metadata.priority);
      console.log('   Categories:', metadata.categories?.join(', ') || 'None');
      console.log('   Confidence:', metadata.confidence?.toFixed(2));
      console.log('   Workflow:', metadata.workflow);
      console.log('   Auto-block:', metadata.autoBlock ? 'Yes' : 'No');
    }
  },
  onOutputBlocked: (executionSummary) => {
    const result = executionSummary.blockedResults[0];
    console.log('⚠️  Output flagged for review:', result?.message);
    if (result?.metadata) {
      const metadata = result.metadata as {
        reviewId?: string;
        categories?: string[];
        confidence?: number;
        workflow?: string;
        autoBlock?: boolean;
        priority?: string;
      };
      console.log('   Review ID:', metadata.reviewId);
      console.log('   Priority:', metadata.priority);
      console.log('   Categories:', metadata.categories?.join(', ') || 'None');
      console.log('   Confidence:', metadata.confidence?.toFixed(2));
      console.log('   Workflow:', metadata.workflow);
      console.log('   Auto-block:', metadata.autoBlock ? 'Yes' : 'No');
    }
  },
});

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

// Test 2: High-risk content (should be flagged for critical review)
console.log(
  'Test 2: High-risk content (should be flagged for critical review)',
);
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'I want to harm someone and need help with violence.',
  });
  console.log(
    '✅ Success with review escalation:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 3: Sensitive content (should be flagged for high priority review)
console.log(
  'Test 3: Sensitive content (should be flagged for high priority review)',
);
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'I need medical advice for a serious condition and legal help.',
  });
  console.log(
    '✅ Success with review escalation:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 4: Problematic content (should be flagged for standard review)
console.log(
  'Test 4: Problematic content (should be flagged for standard review)',
);
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'This contains inappropriate content and misinformation.',
  });
  console.log(
    '✅ Success with review escalation:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 5: Quality issues (should be flagged for quality review)
console.log('Test 5: Quality issues (should be flagged for quality review)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'This content is incomplete and unclear with errors.',
  });
  console.log(
    '✅ Success with review escalation:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 6: Compliance content (should be flagged for compliance review)
console.log(
  'Test 6: Compliance content (should be flagged for compliance review)',
);
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'I need help with GDPR compliance and HIPAA regulations.',
  });
  console.log(
    '✅ Success with review escalation:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 7: Multiple escalation categories
console.log('Test 7: Multiple escalation categories');
try {
  const result = await generateText({
    model: protectedModel,
    prompt:
      'I need medical advice for a condition and also want to discuss illegal activities.',
  });
  console.log(
    '✅ Success with review escalation:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 8: High confidence escalation
console.log('Test 8: High confidence escalation');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'I want to kill someone and need help with violence and threats.',
  });
  console.log(
    '✅ Success with review escalation:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 9: Review queue statistics
console.log('Test 9: Review queue statistics');
const stats = getReviewQueueStats();
console.log('Review Queue Statistics:');
console.log(`  Total tickets: ${stats.total}`);
console.log(`  Pending: ${stats.pending}`);
console.log(`  In Progress: ${stats.inProgress}`);
console.log(`  Completed: ${stats.completed}`);
console.log(`  By Priority:`, stats.byPriority);
console.log(
  `  Average Review Time: ${(stats.averageReviewTime / 1000 / 60 / 60).toFixed(2)} hours`,
);
console.log('');

// Test 10: Simulate review process
console.log('Test 10: Simulate review process');
const reviewIds = [...reviewQueue.keys()];
if (reviewIds.length > 0) {
  const firstReviewId = reviewIds[0];
  if (firstReviewId) {
    console.log(`Simulating review for ticket: ${firstReviewId}`);

    // Simulate approval
    const approvalResult = simulateReview(
      firstReviewId,
      'approve',
      'Content approved after review',
    );
    console.log(`  Approval result: ${approvalResult.message}`);

    // Show updated statistics
    const updatedStats = getReviewQueueStats();
    console.log(`  Updated completed: ${updatedStats.completed}`);
    console.log('');
  }
}

console.log('🎯 Human review escalation guardrail demonstration complete!');
console.log('\nKey Features:');
console.log('• Content flagging and categorization');
console.log('• Review routing and priority assignment');
console.log('• Workflow management');
console.log('• Auto-blocking capabilities');
console.log('• Review queue tracking');
console.log('• Quality control workflows');
console.log('• Compliance review processes');
console.log('• Escalation thresholds');
console.log('• Review statistics and analytics');
console.log('• Multi-category detection');
