/**
 * Object Content Filter Example
 *
 * Demonstrates how to filter and validate content within generated objects
 * to ensure they meet content policies and quality standards.
 *
 * NOTE: For generateText with Output.object() scenarios, the recommended approach is to use
 * executeOutputGuardrails() after generation for reliable validation.
 */

import { z } from 'zod';
import { generateText, Output } from 'ai';
import { model as defaultModel, mistralModel } from './model';
import { defineOutputGuardrail, withGuardrails } from 'ai-sdk-guardrails';
import { extractContent } from 'ai-sdk-guardrails/guardrails/output';

// Prefer Mistral when configured; otherwise use local Ollama model
const model = process.env.MISTRAL_API_KEY ? mistralModel : defaultModel;

// Define types for object content filter metadata
// Note: These interfaces are used implicitly in the guardrail metadata

// Schema for a message object
const messageSchema = z.object({
  subject: z.string(),
  body: z.string(),
  priority: z.enum(['low', 'medium', 'high']),
  tags: z.array(z.string()).optional(),
});

// Schema for a social media post
const postSchema = z.object({
  title: z.string(),
  content: z.string(),
  hashtags: z.array(z.string()),
  visibility: z.enum(['public', 'private', 'friends']),
});

// Content filter for message objects
const messageContentFilter = defineOutputGuardrail({
  name: 'message-content-filter',
  description: 'Filters inappropriate content in messages',
  execute: async (context) => {
    const { object } = extractContent(context.result);

    // Allow null/undefined objects to pass through - they may be generated later
    if (!object || object === null) {
      return {
        tripwireTriggered: false,
        metadata: {
          issues: [],
          spamWords: [],
          capsRatio: 0,
        },
      };
    }

    const message = object as Record<string, unknown>;
    const issues: string[] = [];

    // Check for spam indicators
    const spamWords = [
      'urgent',
      'act now',
      'limited time',
      'click here',
      'buy now',
    ];
    const contentToCheck =
      `${message.subject || ''} ${message.body || ''}`.toLowerCase();

    const foundSpamWords = spamWords.filter((word) =>
      contentToCheck.includes(word),
    );

    if (foundSpamWords.length > 0) {
      issues.push(`Spam indicators: ${foundSpamWords.join(', ')}`);
    }

    // Check for ALL CAPS (shouting)
    const capsRatio =
      (contentToCheck.match(/[A-Z]/g) || []).length /
      (contentToCheck.match(/[a-zA-Z]/g) || []).length;

    if (capsRatio > 0.3 && contentToCheck.length > 20) {
      issues.push('Excessive capitalization');
    }

    // Check message length
    if (
      message.body &&
      typeof message.body === 'string' &&
      message.body.length < 10
    ) {
      issues.push('Message body too short');
    }

    // Check priority abuse
    if (
      message.priority === 'high' &&
      !contentToCheck.includes('important') &&
      !contentToCheck.includes('critical')
    ) {
      issues.push('High priority without justification');
    }

    if (issues.length > 0) {
      return {
        tripwireTriggered: true,
        message: `Content issues: ${issues.join('; ')}`,
        severity: foundSpamWords.length > 2 ? 'high' : 'medium',
        metadata: {
          issues,
          spamWords: foundSpamWords,
          capsRatio: Math.round(capsRatio * 100),
        },
      };
    }

    return {
      tripwireTriggered: false,
      metadata: {
        issues: [],
        spamWords: [],
        capsRatio: Math.round(capsRatio * 100),
      },
    };
  },
});

// Content filter for social media posts
const socialMediaFilter = defineOutputGuardrail({
  name: 'social-media-filter',
  description: 'Ensures social media posts meet platform guidelines',
  execute: async (context) => {
    const { object } = extractContent(context.result);

    // Allow null/undefined objects to pass through - they may be generated later
    if (!object || object === null) {
      return {
        tripwireTriggered: false,
        metadata: {
          violations: [],
          hashtagCount: 0,
        },
      };
    }

    const post = object as Record<string, unknown>;
    const violations: string[] = [];

    // Check hashtag spam
    if (Array.isArray(post.hashtags) && post.hashtags.length > 10) {
      violations.push(`Too many hashtags: ${post.hashtags.length}`);
    }

    if (violations.length > 0) {
      return {
        tripwireTriggered: true,
        message: `Social media policy violations: ${violations.join('; ')}`,
        severity: 'medium',
        metadata: {
          violations,
          hashtagCount: Array.isArray(post.hashtags) ? post.hashtags.length : 0,
        },
      };
    }

    return {
      tripwireTriggered: false,
      metadata: {
        violations: [],
        hashtagCount: Array.isArray(post.hashtags) ? post.hashtags.length : 0,
      },
    };
  },
});

// Create protected models with guardrails
const messageModel = withGuardrails({
  model,
  outputGuardrails: [messageContentFilter],
  throwOnBlocked: false, // Warning mode to see all issues
  onOutputBlocked: (executionSummary) => {
    console.log(
      '📧 Message Filter:',
      executionSummary.blockedResults[0]?.message,
    );
    const metadata = executionSummary.blockedResults[0]?.metadata;
    if (metadata) {
      if (metadata.spamWords?.length > 0) {
        console.log(`   Spam words found: ${metadata.spamWords.join(', ')}`);
      }
      if (metadata.capsRatio > 30) {
        console.log(`   Caps ratio: ${metadata.capsRatio}%`);
      }
    }
  },
});

const socialModel = withGuardrails({
  model,
  outputGuardrails: [socialMediaFilter],
  throwOnBlocked: false,
  onOutputBlocked: (executionSummary) => {
    console.log(
      '📱 Social Media Filter:',
      executionSummary.blockedResults[0]?.message,
    );
    const metadata = executionSummary.blockedResults[0]?.metadata;
    if (metadata && metadata.hashtagCount > 10) {
      console.log(`   #️⃣ Hashtag count: ${metadata.hashtagCount}`);
    }
  },
});

console.log('🔍 Object Content Filter Example\n');

// Example 1: Message filtering
console.log('Example 1: Email/Message Content Filtering');
console.log('==========================================\n');

// Test 1: Clean message
console.log('Test 1: Professional message');
try {
  const result = await generateText({
    model: messageModel,
    prompt:
      'Create a professional project update message with subject "Project Update: Q1 Progress" and body about team achievements. Set priority to medium.',
    output: Output.object({
      schema: messageSchema,
    }),
  });
  console.log('✅ Message generated:', JSON.stringify(result.output, null, 2));
} catch (error) {
  console.log('❌ Error:', (error as Error).message);
  throw error;
}

// Test 2: Spammy message
console.log('\nTest 2: Marketing/spam-like message');
try {
  const result = await generateText({
    model: messageModel,
    prompt:
      'Create a marketing email with subject "URGENT: Limited Time Offer - ACT NOW!" and body containing phrases like "limited time", "act now", "click here", "buy now". Make it high priority.',
    output: Output.object({
      schema: messageSchema,
    }),
  });
  console.log(
    '✅ Message generated (check warnings):',
    JSON.stringify(result.output, null, 2),
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message);
  throw error;
}

// Example 2: Social media content filtering
console.log('\n\nExample 2: Social Media Content Filtering');
console.log('=========================================\n');

// Test 1: Normal post
console.log('Test 1: Regular social media post');
try {
  const result = await generateText({
    model: socialModel,
    prompt:
      'Create a social media post with title "Coffee Morning" about enjoying coffee, include 3-5 hashtags like #CoffeeLovers #MorningRoutine, set visibility to public.',
    output: Output.object({
      schema: postSchema,
    }),
  });
  console.log('✅ Post generated:', JSON.stringify(result.output, null, 2));
} catch (error) {
  console.log('❌ Error:', (error as Error).message);
  throw error;
}

// Test 2: Over-hashtagged post
console.log('\nTest 2: Post with many hashtags');
try {
  const result = await generateText({
    model: socialModel,
    prompt:
      'Create a social media post about technology trends with title "Tech Trends 2024", include exactly 15 hashtags about technology, set visibility to public.',
    output: Output.object({
      schema: postSchema,
    }),
  });
  console.log(
    '✅ Post generated (check warnings):',
    JSON.stringify(result.output, null, 2),
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message);
  throw error;
}

console.log('\n📊 Summary:');
console.log(
  '• Use executeOutputGuardrails() for generateText + Output.object() validation',
);
console.log('• Filter object content for spam, inappropriate language');
console.log('• Check for platform-specific violations');
console.log('• Validate content quality and authenticity');
console.log('• Use metadata to track specific issues\n');
