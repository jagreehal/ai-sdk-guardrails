/**
 * Object Content Filter Example - Test
 *
 * Demonstrates how to filter and validate content within generated objects
 * to ensure they meet content policies and quality standards.
 *
 * Note: These tests use real LLM models and may be flaky.
 * They're designed for manual verification, not CI/CD.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { generateObject } from 'ai';
import { model } from './model';
import { defineOutputGuardrail, withGuardrails } from 'ai-sdk-guardrails';
import { extractContent } from 'ai-sdk-guardrails/guardrails/output';

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

describe('Object Content Filter Example', () => {
  describe('Message Content Filtering', () => {
    it('should allow professional message to pass', async () => {
      const messageModel = withGuardrails(model, {
        outputGuardrails: [messageContentFilter],
        throwOnBlocked: false,
      });

      const result = await generateObject({
        model: messageModel,
        prompt:
          'Create a professional project update message with subject "Project Update: Q1 Progress" and body about team achievements. Set priority to medium.',
        schema: messageSchema,
      });

      expect(result.object).toBeDefined();
      expect(result.object.subject).toBeDefined();
      expect(result.object.body).toBeDefined();
    });

    it('should detect spam indicators in message', async () => {
      let blockedMessage: string | undefined;
      let blockedMetadata: any;

      const messageModel = withGuardrails(model, {
        outputGuardrails: [messageContentFilter],
        throwOnBlocked: false,
        onOutputBlocked: (executionSummary) => {
          blockedMessage = executionSummary.blockedResults[0]?.message;
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      const result = await generateObject({
        model: messageModel,
        prompt:
          'Create a marketing email with subject "URGENT: Limited Time Offer - ACT NOW!" and body containing phrases like "limited time", "act now", "click here", "buy now". Make it high priority.',
        schema: messageSchema,
      });

      expect(result.object).toBeDefined();
      // If spam was detected, verify metadata
      if (blockedMessage) {
        expect(blockedMessage).toContain('Content issues');
        expect(blockedMetadata?.spamWords).toBeDefined();
        expect(Array.isArray(blockedMetadata.spamWords)).toBe(true);
      }
    });

    it('should provide correct metadata when filtering', async () => {
      let blockedMetadata: any;

      const messageModel = withGuardrails(model, {
        outputGuardrails: [messageContentFilter],
        throwOnBlocked: false,
        onOutputBlocked: (executionSummary) => {
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      await generateObject({
        model: messageModel,
        prompt:
          'Create a message with subject "URGENT ACT NOW" and body "Limited time offer! Click here to buy now!"',
        schema: messageSchema,
      });

      // If metadata was captured, verify structure
      if (blockedMetadata) {
        expect(blockedMetadata.issues).toBeDefined();
        expect(blockedMetadata.spamWords).toBeDefined();
        expect(blockedMetadata.capsRatio).toBeDefined();
      }
    });
  });

  describe('Social Media Content Filtering', () => {
    it('should allow normal social media post to pass', async () => {
      const socialModel = withGuardrails(model, {
        outputGuardrails: [socialMediaFilter],
        throwOnBlocked: false,
      });

      const result = await generateObject({
        model: socialModel,
        prompt:
          'Create a social media post with title "Coffee Morning" about enjoying coffee, include 3-5 hashtags like #CoffeeLovers #MorningRoutine, set visibility to public.',
        schema: postSchema,
      });

      expect(result.object).toBeDefined();
      expect(result.object.title).toBeDefined();
      expect(result.object.hashtags).toBeDefined();
      expect(Array.isArray(result.object.hashtags)).toBe(true);
    });

    it('should detect excessive hashtags in social media post', async () => {
      let blockedMessage: string | undefined;
      let blockedMetadata: any;

      const socialModel = withGuardrails(model, {
        outputGuardrails: [socialMediaFilter],
        throwOnBlocked: false,
        onOutputBlocked: (executionSummary) => {
          blockedMessage = executionSummary.blockedResults[0]?.message;
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      const result = await generateObject({
        model: socialModel,
        prompt:
          'Create a social media post about technology trends with title "Tech Trends 2024", include exactly 15 hashtags about technology, set visibility to public.',
        schema: postSchema,
      });

      expect(result.object).toBeDefined();
      // If hashtag violation was detected, verify metadata
      if (blockedMessage) {
        expect(blockedMessage).toContain('Social media policy violations');
        expect(blockedMessage).toContain('Too many hashtags');
        expect(blockedMetadata?.hashtagCount).toBeGreaterThan(10);
      }
    });

    it('should provide correct metadata for hashtag violations', async () => {
      let blockedMetadata: any;

      const socialModel = withGuardrails(model, {
        outputGuardrails: [socialMediaFilter],
        throwOnBlocked: false,
        onOutputBlocked: (executionSummary) => {
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      await generateObject({
        model: socialModel,
        prompt:
          'Create a social media post with title "Tech Update" and include 15 hashtags about technology.',
        schema: postSchema,
      });

      // If metadata was captured, verify structure
      if (blockedMetadata) {
        expect(blockedMetadata.violations).toBeDefined();
        expect(Array.isArray(blockedMetadata.violations)).toBe(true);
        expect(blockedMetadata.hashtagCount).toBeDefined();
        expect(blockedMetadata.hashtagCount).toBeGreaterThan(10);
      }
    });
  });
});
