/**
 * Rate Limiting Example
 *
 * Demonstrates how to implement rate limiting guardrails to prevent
 * API abuse and manage resource consumption.
 */

import { generateText } from 'ai';
import { model } from './model';
import { defineInputGuardrail, withGuardrails } from '../src/index';
import { extractTextContent } from '../src/guardrails/input';

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

console.log('🚦 Rate Limiting Example\n');

// Example 1: Basic rate limiting
console.log('Example 1: Basic Rate Limiting (3 requests per 10 seconds)');
console.log('============================================================\n');

const basicRateLimit = createRateLimitGuardrail(3, 10_000);

const rateLimitedModel = withGuardrails(model, {
  inputGuardrails: [basicRateLimit],
  throwOnBlocked: true,
  onInputBlocked: (executionSummary) => {
    console.log(
      '🚫 Rate limit exceeded:',
      executionSummary.blockedResults[0]?.message,
    );
    const metadata = executionSummary.blockedResults[0]?.metadata;
    if (metadata) {
      console.log(`   Remaining: ${metadata.remaining}`);
      console.log(`   Reset in: ${Math.ceil(metadata.resetIn / 1000)}s`);
    }
  },
});

// Make several rapid requests
console.log('Making 5 rapid requests (should allow first 3, block last 2):\n');
for (let i = 1; i <= 5; i++) {
  console.log(`Request ${i}:`);
  try {
    const result = await generateText({
      model: rateLimitedModel,
      prompt: `Request ${i}: What is ${i} + ${i}?`,
    });
    console.log(`✅ Success: ${result.text.trim()}\n`);
  } catch (error) {
    console.log(`❌ Blocked: ${(error as Error).message}\n`);
  }

  // Small delay between requests
  await new Promise((resolve) => setTimeout(resolve, 100));
}

// Example 2: Warning mode rate limiting
console.log("Example 2: Warning Mode (logs but doesn't block)");
console.log('=================================================\n');

const warningRateLimit = createRateLimitGuardrail(2, 5000);

const warningModel = withGuardrails(model, {
  inputGuardrails: [warningRateLimit],
  throwOnBlocked: false, // Warning mode
  onInputBlocked: (executionSummary) => {
    console.log(
      '⚠️  Rate limit warning:',
      executionSummary.blockedResults[0]?.message,
    );
  },
});

console.log('Making 4 requests with warning mode:\n');
for (let i = 1; i <= 4; i++) {
  console.log(`Warning test ${i}:`);
  try {
    const result = await generateText({
      model: warningModel,
      prompt: `Test ${i}: What is AI?`,
    });
    console.log(`✅ Completed: ${result.text.slice(0, 50)}...\n`);
  } catch (error) {
    console.log(`❌ Error: ${(error as Error).message}\n`);
  }

  await new Promise((resolve) => setTimeout(resolve, 100));
}

// Example 3: Dynamic rate limiting
console.log('Example 3: Dynamic Rate Limiting (based on prompt complexity)');
console.log('==============================================================\n');

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

const dynamicModel = withGuardrails(model, {
  inputGuardrails: [dynamicRateLimit],
  throwOnBlocked: false,
  onInputBlocked: (executionSummary) => {
    console.log(
      '📊 Dynamic limit triggered:',
      executionSummary.blockedResults[0]?.message,
    );
    const metadata = executionSummary.blockedResults[0]?.metadata;
    if (metadata) {
      console.log(`   Complexity: ${metadata.complexity}`);
      console.log(`   Urgent: ${metadata.isUrgent ? 'Yes' : 'No'}`);
      console.log(`   Limit: ${metadata.limit} requests`);
    }
  },
});

const testPrompts = [
  'Quick question about weather',
  'URGENT: Need immediate help with server issue',
  'Please provide a detailed comprehensive analysis of machine learning algorithms including their mathematical foundations, implementation details, performance characteristics, and real-world applications across various domains',
  'What is 2+2?',
];

console.log('Testing dynamic rate limiting:\n');
for (const [i, testPrompt] of testPrompts.entries()) {
  console.log(`Dynamic test ${i + 1}: "${testPrompt.slice(0, 50)}..."`);
  try {
    await generateText({
      model: dynamicModel,
      prompt: testPrompt,
    });
    console.log('✅ Processed successfully\n');
  } catch (error) {
    console.log(`❌ Error: ${(error as Error).message}\n`);
  }
}

// Example 4: Token bucket rate limiting
console.log('Example 4: Token Bucket Pattern (allows bursts)');
console.log('===============================================\n');

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
  onInputBlocked: (executionSummary) => {
    console.log(
      '🪣 Token bucket blocked:',
      executionSummary.blockedResults[0]?.message,
    );
    const metadata = executionSummary.blockedResults[0]?.metadata;
    if (metadata) {
      console.log(`   Remaining tokens: ${metadata.remaining}`);
    }
  },
});

console.log('Making burst requests (should consume tokens):\n');
for (let i = 1; i <= 7; i++) {
  console.log(`Token test ${i}:`);
  try {
    const result = await generateText({
      model: tokenModel,
      prompt: `Token request ${i}: Hello`,
    });
    console.log(`✅ Success: ${result.text.slice(0, 30)}...\n`);
  } catch (error) {
    console.log(`❌ Error: ${(error as Error).message}\n`);
  }
}

console.log('Waiting 3 seconds for token refill...\n');
await new Promise((resolve) => setTimeout(resolve, 3000));

console.log('Trying again after refill:');
try {
  const result = await generateText({
    model: tokenModel,
    prompt: 'After refill: How are you?',
  });
  console.log(`✅ Success after refill: ${result.text.slice(0, 50)}...\n`);
} catch (error) {
  console.log(`❌ Error: ${(error as Error).message}\n`);
}

console.log('📊 Summary:');
console.log('• Rate limiting prevents API abuse');
console.log('• Blocking mode stops excess requests');
console.log('• Warning mode logs but allows requests');
console.log('• Dynamic limits adjust based on context');
console.log('• Token buckets allow controlled bursts\n');
