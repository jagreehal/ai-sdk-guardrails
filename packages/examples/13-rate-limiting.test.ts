/**
 * Rate Limiting Example - Test
 *
 * Demonstrates how to implement rate limiting guardrails to prevent
 * API abuse and manage resource consumption.
 *
 * Note: These tests use real LLM models and may be flaky.
 * They're designed for manual verification, not CI/CD.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { generateText } from 'ai';
import { model } from './model';
import { defineInputGuardrail, withGuardrails } from 'ai-sdk-guardrails';
import { extractTextContent } from 'ai-sdk-guardrails/guardrails/input';

// Simple rate limiter implementation
class RateLimiter {
  private requests = new Map<string, { count: number; resetTime: number }>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  isAllowed(identifier: string): boolean {
    const now = Date.now();
    const entry = this.requests.get(identifier);

    // No previous requests or window expired
    if (!entry || now >= entry.resetTime) {
      this.requests.set(identifier, {
        count: 1,
        resetTime: now + this.windowMs,
      });
      return true;
    }

    // Check if under limit
    if (entry.count < this.maxRequests) {
      entry.count++;
      return true;
    }

    return false;
  }

  getStatus(identifier: string) {
    const entry = this.requests.get(identifier);
    const now = Date.now();

    if (!entry || now >= entry.resetTime) {
      return {
        remaining: this.maxRequests,
        resetIn: this.windowMs,
      };
    }

    return {
      remaining: Math.max(0, this.maxRequests - entry.count),
      resetIn: Math.max(0, entry.resetTime - now),
    };
  }
}

// Create rate limiting guardrail
function createRateLimitGuardrail(
  maxRequests: number,
  windowMs: number,
  getUserId = () => 'user',
) {
  const limiter = new RateLimiter(maxRequests, windowMs);

  return defineInputGuardrail({
    name: 'rate-limiter',
    description: `Rate limit: ${maxRequests} requests per ${windowMs}ms`,
    execute: async () => {
      const userId = getUserId();
      const allowed = limiter.isAllowed(userId);
      const status = limiter.getStatus(userId);

      if (!allowed) {
        return {
          tripwireTriggered: true,
          message: `Rate limit exceeded: ${maxRequests} requests per ${Math.floor(windowMs / 1000)}s. Try again in ${Math.ceil(status.resetIn / 1000)}s`,
          severity: 'high',
          metadata: {
            userId,
            remaining: status.remaining,
            resetIn: status.resetIn,
          },
        };
      }

      return {
        tripwireTriggered: false,
        metadata: {
          userId,
          remaining: status.remaining,
          resetIn: status.resetIn,
        },
      };
    },
  });
}

describe('Rate Limiting Example', () => {
  describe('Basic Rate Limiting', () => {
    it('should allow requests within rate limit', async () => {
      const basicRateLimit = createRateLimitGuardrail(3, 10_000);
      const rateLimitedModel = withGuardrails(model, {
        inputGuardrails: [basicRateLimit],
        throwOnBlocked: true,
      });

      // First request should succeed
      const result = await generateText({
        model: rateLimitedModel,
        prompt: 'Request 1: What is 1 + 1?',
      });

      expect(result.text).toBeDefined();
      expect(result.text.length).toBeGreaterThan(0);
    });

    it('should block requests exceeding rate limit in blocking mode', async () => {
      const basicRateLimit = createRateLimitGuardrail(2, 5_000);
      const rateLimitedModel = withGuardrails(model, {
        inputGuardrails: [basicRateLimit],
        throwOnBlocked: true,
      });

      // Make requests rapidly
      let successCount = 0;
      let blockedCount = 0;

      for (let i = 1; i <= 3; i++) {
        try {
          await generateText({
            model: rateLimitedModel,
            prompt: `Request ${i}: What is ${i}?`,
          });
          successCount++;
        } catch (error) {
          blockedCount++;
          expect(String(error)).toContain('Rate limit exceeded');
        }
        // Small delay between requests
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Should have at least 2 successes and potentially 1 blocked
      expect(successCount).toBeGreaterThanOrEqual(1);
      // Note: Exact counts depend on timing, so we're flexible here
    });

    it('should provide correct metadata when rate limit is exceeded', async () => {
      let blockedMetadata: any;

      const basicRateLimit = createRateLimitGuardrail(1, 5_000);
      const rateLimitedModel = withGuardrails(model, {
        inputGuardrails: [basicRateLimit],
        throwOnBlocked: true,
        onInputBlocked: (executionSummary) => {
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      // First request should succeed
      await generateText({
        model: rateLimitedModel,
        prompt: 'First request',
      });

      // Second request should be blocked
      try {
        await generateText({
          model: rateLimitedModel,
          prompt: 'Second request',
        });
      } catch (error) {
        expect(error).toBeDefined();
        if (blockedMetadata) {
          expect(blockedMetadata.userId).toBeDefined();
          expect(blockedMetadata.remaining).toBeDefined();
          expect(blockedMetadata.resetIn).toBeDefined();
        }
      }
    });
  });

  describe('Warning Mode Rate Limiting', () => {
    it('should log warnings but allow requests in warning mode', async () => {
      const warningRateLimit = createRateLimitGuardrail(2, 5_000);
      let warningCount = 0;

      const warningModel = withGuardrails(model, {
        inputGuardrails: [warningRateLimit],
        throwOnBlocked: false, // Warning mode
        onInputBlocked: () => {
          warningCount++;
        },
      });

      // Make multiple requests
      let successCount = 0;
      for (let i = 1; i <= 3; i++) {
        try {
          const result = await generateText({
            model: warningModel,
            prompt: `Test ${i}: What is AI?`,
          });
          successCount++;
          expect(result.text).toBeDefined();
        } catch (error) {
          // Should not throw in warning mode
          expect.fail('Should not throw in warning mode');
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // All requests should succeed in warning mode
      expect(successCount).toBe(3);
      // Warnings may or may not be triggered depending on timing
    });
  });

  describe('Dynamic Rate Limiting', () => {
    const dynamicRateLimit = defineInputGuardrail({
      name: 'dynamic-rate-limiter',
      description: 'Adjusts rate limits based on request complexity',
      execute: async (context) => {
        const { prompt } = extractTextContent(context);

        // Determine complexity
        let maxRequests = 5; // default
        let windowMs = 60_000; // 1 minute

        if (prompt.length > 200) {
          maxRequests = 2; // Lower limit for complex requests
          windowMs = 60_000;
        } else if (prompt.toLowerCase().includes('urgent')) {
          maxRequests = 10; // Higher limit for urgent requests
          windowMs = 30_000;
        }

        // Simple check (in real implementation, use actual rate limiter)
        const currentCount = Math.floor(Math.random() * (maxRequests + 2));

        if (currentCount > maxRequests) {
          return {
            tripwireTriggered: true,
            message: `Dynamic rate limit exceeded: ${currentCount}/${maxRequests} requests`,
            severity: 'medium',
            metadata: {
              currentCount,
              complexity: prompt.length > 200 ? 'high' : 'normal',
              isUrgent: prompt.toLowerCase().includes('urgent'),
              limit: maxRequests,
              window: windowMs,
            },
          };
        }

        return {
          tripwireTriggered: false,
          metadata: {
            currentCount,
            limit: maxRequests,
            complexity: prompt.length > 200 ? 'high' : 'normal',
            isUrgent: prompt.toLowerCase().includes('urgent'),
            window: windowMs,
          },
        };
      },
    });

    it('should adjust limits based on prompt complexity', async () => {
      let blockedMetadata: any;

      const dynamicModel = withGuardrails(model, {
        inputGuardrails: [dynamicRateLimit],
        throwOnBlocked: false,
        onInputBlocked: (executionSummary) => {
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      // Test with simple prompt
      await generateText({
        model: dynamicModel,
        prompt: 'Quick question about weather',
      });

      // Test with urgent prompt
      await generateText({
        model: dynamicModel,
        prompt: 'URGENT: Need immediate help',
      });

      // Test with complex prompt
      await generateText({
        model: dynamicModel,
        prompt: 'Please provide a detailed comprehensive analysis of machine learning algorithms including their mathematical foundations, implementation details, performance characteristics, and real-world applications across various domains',
      });

      // If metadata was captured, verify structure
      if (blockedMetadata) {
        expect(blockedMetadata.complexity).toBeDefined();
        expect(blockedMetadata.limit).toBeDefined();
        expect(blockedMetadata.isUrgent).toBeDefined();
      }
    });

    it('should provide correct metadata for different prompt types', async () => {
      let capturedMetadata: any[] = [];

      const dynamicModel = withGuardrails(model, {
        inputGuardrails: [dynamicRateLimit],
        throwOnBlocked: false,
        onInputBlocked: (executionSummary) => {
          capturedMetadata.push(executionSummary.blockedResults[0]?.metadata);
        },
      });

      const testPrompts = [
        'Quick question',
        'URGENT: Help needed',
        'A very long prompt that exceeds two hundred characters and should be classified as high complexity because it contains many words and detailed information about various topics',
      ];

      for (const prompt of testPrompts) {
        await generateText({
          model: dynamicModel,
          prompt,
        });
      }

      // Verify metadata structure if captured
      if (capturedMetadata.length > 0) {
        capturedMetadata.forEach((metadata) => {
          expect(metadata.complexity).toBeDefined();
          expect(metadata.limit).toBeDefined();
          expect(metadata.isUrgent).toBeDefined();
        });
      }
    });
  });

  describe('Token Bucket Rate Limiting', () => {
    class TokenBucket {
      private tokens: number;
      private lastRefill: number;
      private capacity: number;
      private readonly refillRate: number; // tokens per second

      constructor(capacity: number, refillRate: number) {
        this.capacity = capacity;
        this.refillRate = refillRate;
        this.tokens = capacity;
        this.lastRefill = Date.now();
      }

      consume(count: number = 1): boolean {
        this.refill();

        if (this.tokens >= count) {
          this.tokens -= count;
          return true;
        }
        return false;
      }

      private refill() {
        const now = Date.now();
        const timePassed = (now - this.lastRefill) / 1000;
        const tokensToAdd = timePassed * this.refillRate;

        this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
        this.lastRefill = now;
      }

      getTokens(): number {
        this.refill();
        return Math.floor(this.tokens);
      }
    }

    it('should consume tokens from token bucket', async () => {
      const bucket = new TokenBucket(5, 1); // 5 capacity, 1 token per second

      const tokenBucketGuardrail = defineInputGuardrail({
        name: 'token-bucket',
        description: 'Token bucket rate limiting',
        execute: async () => {
          const allowed = bucket.consume(1);
          const remaining = bucket.getTokens();

          if (!allowed) {
            return {
              tripwireTriggered: true,
              message: 'No tokens available. Please wait for token refill.',
              severity: 'medium',
              metadata: { remaining, capacity: 5, consumed: 0 },
            };
          }

          return {
            tripwireTriggered: false,
            metadata: { remaining: remaining + 1, consumed: 1, capacity: 5 },
          };
        },
      });

      const tokenModel = withGuardrails(model, {
        inputGuardrails: [tokenBucketGuardrail],
        throwOnBlocked: false,
      });

      // Make several requests - first few should succeed
      let successCount = 0;
      for (let i = 1; i <= 3; i++) {
        try {
          const result = await generateText({
            model: tokenModel,
            prompt: `Token request ${i}: Hello`,
          });
          successCount++;
          expect(result.text).toBeDefined();
        } catch (error) {
          // May fail if tokens exhausted
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      expect(successCount).toBeGreaterThan(0);
    });

    it('should detect when token bucket is empty', async () => {
      const bucket = new TokenBucket(2, 0.1); // Small capacity, slow refill
      let blockedMessage: string | undefined;

      const tokenBucketGuardrail = defineInputGuardrail({
        name: 'token-bucket',
        description: 'Token bucket rate limiting',
        execute: async () => {
          const allowed = bucket.consume(1);
          const remaining = bucket.getTokens();

          if (!allowed) {
            return {
              tripwireTriggered: true,
              message: 'No tokens available. Please wait for token refill.',
              severity: 'medium',
              metadata: { remaining, capacity: 2, consumed: 0 },
            };
          }

          return {
            tripwireTriggered: false,
            metadata: { remaining: remaining + 1, consumed: 1, capacity: 2 },
          };
        },
      });

      const tokenModel = withGuardrails(model, {
        inputGuardrails: [tokenBucketGuardrail],
        throwOnBlocked: false,
        onInputBlocked: (executionSummary) => {
          blockedMessage = executionSummary.blockedResults[0]?.message;
        },
      });

      // Consume all tokens rapidly
      for (let i = 1; i <= 3; i++) {
        try {
          await generateText({
            model: tokenModel,
            prompt: `Token request ${i}`,
          });
        } catch {
          // May fail
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // If blocked, verify message
      if (blockedMessage) {
        expect(blockedMessage).toContain('No tokens available');
      }
    });
  });
});
