import { model } from './model';
import {
  createInputGuardrail,
  generateTextWithGuardrails,
  GuardrailError,
} from '../src/core';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

class SimpleRateLimiter {
  private requests = new Map<string, RateLimitEntry>();

  constructor(
    private maxRequests: number,
    private windowMs: number,
  ) {}

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

    // Within window - check if under limit
    if (entry.count < this.maxRequests) {
      entry.count++;
      return true;
    }

    return false;
  }

  getStatus(identifier: string) {
    const entry = this.requests.get(identifier);
    if (!entry || Date.now() >= entry.resetTime) {
      return {
        remaining: this.maxRequests,
        resetTime: Date.now() + this.windowMs,
        resetIn: this.windowMs,
      };
    }

    return {
      remaining: Math.max(0, this.maxRequests - entry.count),
      resetTime: entry.resetTime,
      resetIn: Math.max(0, entry.resetTime - Date.now()),
    };
  }
}

// ============================================================================
// GUARDRAIL IMPLEMENTATIONS
// ============================================================================

// Simple per-user rate limiting
function createUserRateLimitGuardrail(
  maxRequests: number,
  windowMs: number,
  getUserId: (context: any) => string = () => 'default',
) {
  const limiter = new SimpleRateLimiter(maxRequests, windowMs);

  return createInputGuardrail(
    'user-rate-limit',
    `Rate limit: ${maxRequests} requests per ${windowMs}ms per user`,
    async (context) => {
      const userId = getUserId(context);
      const allowed = limiter.isAllowed(userId);
      const status = limiter.getStatus(userId);

      if (!allowed) {
        return {
          tripwireTriggered: true,
          message: `Rate limit exceeded: ${maxRequests} requests per ${Math.floor(windowMs / 1000)}s. Try again in ${Math.ceil(status.resetIn / 1000)}s`,
          severity: 'high',
          suggestion: 'Please wait before making another request',
          metadata: {
            rateLimitStatus: status,
            userId,
          },
        };
      }

      return {
        tripwireTriggered: false,
        metadata: {
          rateLimitStatus: status,
          userId,
        },
      };
    },
  );
}

// Global rate limiting (across all users)
function createGlobalRateLimitGuardrail(maxRequests: number, windowMs: number) {
  const limiter = new SimpleRateLimiter(maxRequests, windowMs);

  return createInputGuardrail(
    'global-rate-limit',
    `Global rate limit: ${maxRequests} requests per ${windowMs}ms`,
    async () => {
      const allowed = limiter.isAllowed('global');
      const status = limiter.getStatus('global');

      if (!allowed) {
        return {
          tripwireTriggered: true,
          message: `System rate limit exceeded. Please try again in ${Math.ceil(status.resetIn / 1000)}s`,
          severity: 'critical',
          suggestion: 'System is under high load, please retry later',
          metadata: { rateLimitStatus: status },
        };
      }

      return {
        tripwireTriggered: false,
        metadata: { rateLimitStatus: status },
      };
    },
  );
}

// Token bucket rate limiting (allows bursts)
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private capacity: number,
    private refillRate: number, // tokens per second
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  consume(tokensRequested: number = 1): boolean {
    this.refill();

    if (this.tokens >= tokensRequested) {
      this.tokens -= tokensRequested;
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

  getStatus() {
    this.refill();
    return {
      tokens: Math.floor(this.tokens),
      capacity: this.capacity,
      refillRate: this.refillRate,
    };
  }
}

function createTokenBucketGuardrail(
  capacity: number,
  refillRate: number,
  tokensPerRequest: number = 1,
) {
  const buckets = new Map<string, TokenBucket>();

  return createInputGuardrail(
    'token-bucket-rate-limit',
    `Token bucket: ${capacity} capacity, ${refillRate} tokens/sec`,
    async (context) => {
      const userId = (context as any).context?.user?.id || 'anonymous';

      if (!buckets.has(userId)) {
        buckets.set(userId, new TokenBucket(capacity, refillRate));
      }

      const bucket = buckets.get(userId)!;
      const allowed = bucket.consume(tokensPerRequest);
      const status = bucket.getStatus();

      if (!allowed) {
        const timeToNextToken = (tokensPerRequest - status.tokens) / refillRate;

        return {
          tripwireTriggered: true,
          message: `Rate limit exceeded. No tokens available. Next token in ${Math.ceil(timeToNextToken)}s`,
          severity: 'medium',
          suggestion: 'Please wait for tokens to refill',
          metadata: {
            bucketStatus: status,
            tokensRequested: tokensPerRequest,
            timeToNextToken,
          },
        };
      }

      return {
        tripwireTriggered: false,
        metadata: {
          bucketStatus: status,
          tokensConsumed: tokensPerRequest,
        },
      };
    },
  );
}

// ============================================================================
// EXAMPLES
// ============================================================================

async function example1_BasicUserRateLimit() {
  console.log('\n=== Example 1: Basic User Rate Limiting ===');

  // 3 requests per 10 seconds per user
  const rateLimitGuardrail = createUserRateLimitGuardrail(3, 10_000);

  console.log('Making rapid requests (should hit rate limit)...');

  for (let i = 1; i <= 5; i++) {
    try {
      void (await generateTextWithGuardrails(
        {
          model,
          prompt: `Request ${i}: What is 2+2?`,
        },
        {
          inputGuardrails: [rateLimitGuardrail],
        },
      ));
      console.log(`✅ Request ${i} succeeded`);
    } catch (error) {
      if (error instanceof GuardrailError) {
        console.log(`❌ Request ${i} blocked:`, error.reason);
      }
    }

    // Small delay between requests
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function example2_GlobalRateLimit() {
  console.log('\n=== Example 2: Global Rate Limiting ===');

  // 2 requests per 5 seconds globally
  const globalRateLimit = createGlobalRateLimitGuardrail(2, 5000);

  console.log('Testing global rate limit...');

  for (let i = 1; i <= 4; i++) {
    try {
      void (await generateTextWithGuardrails(
        {
          model,
          prompt: `Global request ${i}: Tell me a fact`,
        },
        {
          inputGuardrails: [globalRateLimit],
        },
      ));
      console.log(`✅ Global request ${i} succeeded`);
    } catch (error) {
      if (error instanceof GuardrailError) {
        console.log(`❌ Global request ${i} blocked:`, error.reason);
      }
    }
  }
}

async function example3_TokenBucketRateLimit() {
  console.log('\n=== Example 3: Token Bucket Rate Limiting ===');

  // 5 token capacity, 1 token per second refill, 1 token per request
  const tokenBucketGuardrail = createTokenBucketGuardrail(5, 1, 1);

  console.log('Making burst requests (should consume tokens then refill)...');

  // Burst requests
  for (let i = 1; i <= 7; i++) {
    try {
      void (await generateTextWithGuardrails(
        {
          model,
          prompt: `Burst request ${i}: What's the weather like?`,
        },
        {
          inputGuardrails: [tokenBucketGuardrail],
        },
      ));
      console.log(`✅ Burst request ${i} succeeded`);
    } catch (error) {
      if (error instanceof GuardrailError) {
        console.log(`❌ Burst request ${i} blocked:`, error.reason);
      }
    }
  }

  console.log('\nWaiting 3 seconds for tokens to refill...');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Try again after refill
  try {
    void (await generateTextWithGuardrails(
      {
        model,
        prompt: 'After refill: How are you?',
      },
      {
        inputGuardrails: [tokenBucketGuardrail],
      },
    ));
    console.log('✅ After refill request succeeded');
  } catch (error) {
    if (error instanceof GuardrailError) {
      console.log('❌ After refill request blocked:', error.reason);
    }
  }
}

async function example4_CombinedRateLimits() {
  console.log('\n=== Example 4: Combined Rate Limits ===');

  const userRateLimit = createUserRateLimitGuardrail(10, 60_000); // 10 per minute per user
  const globalRateLimit = createGlobalRateLimitGuardrail(50, 60_000); // 50 per minute globally
  const tokenBucket = createTokenBucketGuardrail(3, 0.5, 1); // 3 capacity, 0.5 tokens/sec

  console.log('Testing multiple rate limits together...');

  for (let i = 1; i <= 5; i++) {
    try {
      void (await generateTextWithGuardrails(
        {
          model,
          prompt: `Combined test ${i}: Tell me something interesting`,
        },
        {
          inputGuardrails: [userRateLimit, globalRateLimit, tokenBucket],
        },
      ));
      console.log(`✅ Combined test ${i} succeeded`);
    } catch (error) {
      if (error instanceof GuardrailError) {
        console.log(
          `❌ Combined test ${i} blocked by ${error.guardrailName}:`,
          error.reason,
        );
      }
    }
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log('🚦 Rate Limiting Guardrails Examples');
  console.log('====================================');

  try {
    await example1_BasicUserRateLimit();
    await example2_GlobalRateLimit();
    await example3_TokenBucketRateLimit();
    await example4_CombinedRateLimits();

    console.log('\n✅ All rate limiting examples completed!');
  } catch (error) {
    console.error('❌ Error running examples:', error);
  }
}

// Run automatically
main().catch(console.error);
