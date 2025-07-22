import { generateText, wrapLanguageModel } from 'ai';
import { model } from './model';
import {
  createInputGuardrailsMiddleware,
  defineInputGuardrail,
} from '../src/guardrails';
import type { InputGuardrailContext } from '../src/types';
import { extractTextContent } from '../src/guardrails/input';
import inquirer from 'inquirer';
import { setupGracefulShutdown, safePrompt } from './utils/interactive-menu';

// ============================================================================
// RATE LIMITING IMPLEMENTATIONS
// ============================================================================

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

// ============================================================================
// GUARDRAIL FACTORIES
// ============================================================================

// Simple per-user rate limiting
function createUserRateLimitGuardrail(
  maxRequests: number,
  windowMs: number,
  getUserId: (context: InputGuardrailContext) => string = () => 'default',
) {
  const limiter = new SimpleRateLimiter(maxRequests, windowMs);

  return defineInputGuardrail({
    name: 'user-rate-limit',
    description: `Rate limit: ${maxRequests} requests per ${windowMs}ms per user`,
    execute: async (context: InputGuardrailContext) => {
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
  });
}

// Global rate limiting (across all users)
function createGlobalRateLimitGuardrail(maxRequests: number, windowMs: number) {
  const limiter = new SimpleRateLimiter(maxRequests, windowMs);

  return defineInputGuardrail({
    name: 'global-rate-limit',
    description: `Global rate limit: ${maxRequests} requests per ${windowMs}ms`,
    execute: async () => {
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
  });
}

// Token bucket rate limiting (allows bursts)
function createTokenBucketGuardrail(
  capacity: number,
  refillRate: number,
  tokensPerRequest: number = 1,
) {
  const buckets = new Map<string, TokenBucket>();

  return defineInputGuardrail({
    name: 'token-bucket-rate-limit',
    description: `Token bucket: ${capacity} capacity, ${refillRate} tokens/sec`,
    execute: async (context: InputGuardrailContext) => {
      // Simple user identification - in real apps, extract from headers/auth
      const userId = 'anonymous';

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
  });
}

// ============================================================================
// EXAMPLES
// ============================================================================

async function example1_BasicUserRateLimit() {
  console.log('\n=== Example 1: Rate Limiting - Blocking vs Warning Demo ===');

  // DEMO 1: BLOCKING MODE - Strict Rate Limiting
  console.log('\n🚫 DEMO 1: BLOCKING MODE (throwOnBlocked: true)');
  console.log('===============================================');
  console.log('Rate limit violations completely block requests - no responses generated\n');

  // 3 requests per 10 seconds per user
  const rateLimitGuardrail = createUserRateLimitGuardrail(3, 10_000);

  const blockingRateLimitedModel = wrapLanguageModel({
    model,
    middleware: [
      createInputGuardrailsMiddleware({
        inputGuardrails: [rateLimitGuardrail],
        throwOnBlocked: true, // BLOCKS excess requests
        onInputBlocked: (results) => {
          const result = results[0];
          console.log(`🚫 BLOCKED: Request rejected - ${result?.message}`);
          console.log(`📊 Rate limit status:`, result?.metadata?.rateLimitStatus);
        }
      })
    ]
  });

  console.log('🔥 Making 5 rapid requests in BLOCKING mode (limit: 3 per 10 seconds)...');
  console.log('Expected: First 3 should succeed, requests 4-5 should be BLOCKED\n');

  for (let i = 1; i <= 5; i++) {
    console.log(`📋 BLOCKING TEST ${i}:`);
    try {
      const result = await generateText({
        model: blockingRateLimitedModel,
        prompt: `Request ${i}: What is 2+2?`
      });
      
      console.log(`✅ SUCCESS: Request ${i} completed - ${result.text.slice(0, 50)}...`);
    } catch (error) {
      console.log(`🚫 SUCCESS: Request ${i} was BLOCKED by rate limiter`);
    }

    // Small delay between requests
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // DEMO 2: WARNING MODE - Flexible Rate Limiting
  console.log('\n⚠️  DEMO 2: WARNING MODE (throwOnBlocked: false)');
  console.log('=============================================');
  console.log('Rate limit violations logged as warnings but requests still processed\n');

  const warningRateLimitedModel = wrapLanguageModel({
    model,
    middleware: [
      createInputGuardrailsMiddleware({
        inputGuardrails: [createUserRateLimitGuardrail(3, 10_000)], // Fresh rate limiter
        throwOnBlocked: false, // WARNS but continues
        onInputBlocked: (results) => {
          const result = results[0];
          console.log(`⚠️  WARNED: Rate limit concern but continuing - ${result?.message}`);
          console.log(`📊 Rate limit status:`, result?.metadata?.rateLimitStatus);
        }
      })
    ]
  });

  console.log('🔥 Making 5 rapid requests in WARNING mode (same limit: 3 per 10 seconds)...');
  console.log('Expected: All requests should complete, but warnings logged for excess requests\n');

  for (let i = 1; i <= 5; i++) {
    console.log(`📋 WARNING TEST ${i}:`);
    try {
      const result = await generateText({
        model: warningRateLimitedModel,
        prompt: `Request ${i}: What is 3+3?`
      });
      
      console.log(`✅ SUCCESS: Request ${i} completed despite any rate concerns - ${result.text.slice(0, 50)}...`);
    } catch (error) {
      console.log(`❌ UNEXPECTED: Warning mode should not throw - ${(error as Error).message}`);
    }

    // Small delay between requests  
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log('\n📋 RATE LIMITING SUMMARY:');
  console.log('=========================');
  console.log('🚫 BLOCKING mode = Rate limit violations prevent response generation entirely');
  console.log('⚠️  WARNING mode = Rate limit violations logged but responses still generated');
  console.log('📝 Use BLOCKING for strict enforcement, WARNING for monitoring and gradual rollout');
}

async function example2_GlobalRateLimit() {
  console.log('\n=== Example 2: Global Rate Limiting ===');

  // 2 requests per 5 seconds globally
  const globalRateLimit = createGlobalRateLimitGuardrail(2, 5000);

  const globallyLimitedModel = wrapLanguageModel({
    model,
    middleware: [
      createInputGuardrailsMiddleware({
        inputGuardrails: [globalRateLimit],
        throwOnBlocked: false,
        onInputBlocked: (results) => {
          const result = results[0];
          console.log(`❌ Global request blocked: ${result?.message}`);
        }
      })
    ]
  });

  console.log('Testing global rate limit...');

  for (let i = 1; i <= 4; i++) {
    try {
      const result = await generateText({
        model: globallyLimitedModel,
        prompt: `Global request ${i}: Tell me a fact`
      });
      
      if (result.text) {
        console.log(`✅ Global request ${i} succeeded:`, result.text.slice(0, 50));
      } else {
        console.log(`✅ Global request ${i} processed by rate limiter`);
      }
    } catch (error) {
      console.log(`✅ Global request ${i} handled by rate limiting`);
    }
  }
}

async function example3_TokenBucketRateLimit() {
  console.log('\n=== Example 3: Token Bucket Rate Limiting ===');

  // 5 token capacity, 1 token per second refill, 1 token per request
  const tokenBucketGuardrail = createTokenBucketGuardrail(5, 1, 1);

  const tokenBucketModel = wrapLanguageModel({
    model,
    middleware: [
      createInputGuardrailsMiddleware({
        inputGuardrails: [tokenBucketGuardrail],
        throwOnBlocked: false,
        onInputBlocked: (results) => {
          const result = results[0];
          console.log(`❌ Burst request blocked: ${result?.message}`);
          console.log(`🪣 Bucket status:`, result?.metadata?.bucketStatus);
        }
      })
    ]
  });

  console.log('Making burst requests (should consume tokens then refill)...');

  // Burst requests
  for (let i = 1; i <= 7; i++) {
    try {
      const result = await generateText({
        model: tokenBucketModel,
        prompt: `Burst request ${i}: What's the weather like?`,
        experimental_telemetry: {
          isEnabled: true,
          functionId: 'token-bucket-example',
          metadata: { pattern: 'token-bucket-rate-limiting' }
        },
      });
      
      if (result.text) {
        console.log(`✅ Burst request ${i} succeeded:`, result.text.slice(0, 50));
      } else {
        console.log(`✅ Burst request ${i} processed by token bucket`);
      }
    } catch (error) {
      console.log(`✅ Burst request ${i} handled by token bucket`);
    }
  }

  console.log('\nWaiting 3 seconds for tokens to refill...');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Try again after refill
  try {
    const result = await generateText({
      model: tokenBucketModel,
      prompt: 'After refill: How are you?',
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'token-bucket-example',
        metadata: { pattern: 'token-bucket-rate-limiting' }
      },
    });
    
    if (result.text) {
      console.log('✅ After refill request succeeded:', result.text.slice(0, 50));
    } else {
      console.log('✅ After refill request processed');
    }
  } catch (error) {
    console.log('✅ After refill request handled by rate limiting');
  }
}

async function example4_CombinedRateLimits() {
  console.log('\n=== Example 4: Combined Rate Limits ===');

  const userRateLimit = createUserRateLimitGuardrail(10, 60_000); // 10 per minute per user
  const globalRateLimit = createGlobalRateLimitGuardrail(50, 60_000); // 50 per minute globally
  const tokenBucket = createTokenBucketGuardrail(3, 0.5, 1); // 3 capacity, 0.5 tokens/sec

  const combinedModel = wrapLanguageModel({
    model,
    middleware: [
      createInputGuardrailsMiddleware({
        inputGuardrails: [userRateLimit, globalRateLimit, tokenBucket],
        throwOnBlocked: false,
        onInputBlocked: (results) => {
          results.forEach(result => {
            console.log(`❌ Combined test blocked by ${result.context?.guardrailName}: ${result.message}`);
          });
        }
      })
    ]
  });

  console.log('Testing multiple rate limits together...');

  for (let i = 1; i <= 5; i++) {
    try {
      const result = await generateText({
        model: combinedModel,
        prompt: `Combined test ${i}: Tell me something interesting`,
        experimental_telemetry: {
          isEnabled: true,
          functionId: 'combined-rate-limits',
          metadata: { 
            pattern: 'combined-rate-limiting',
            guardrails: ['user-rate-limit', 'global-rate-limit', 'token-bucket']
          }
        },
      });
      
      if (result.text) {
        console.log(`✅ Combined test ${i} succeeded:`, result.text.slice(0, 50));
      } else {
        console.log(`✅ Combined test ${i} processed by rate limiters`);
      }
    } catch (error) {
      console.log(`✅ Combined test ${i} handled by rate limiting`);
    }
  }
}

async function example5_SmartRateLimit() {
  console.log('\n=== Example 5: Smart Rate Limiting with Context ===');

  const smartRateLimitGuardrail = defineInputGuardrail({
    name: 'smart-rate-limit',
    description: 'Context-aware rate limiting',
    execute: async (context: InputGuardrailContext) => {
      const { prompt } = extractTextContent(context);
      
      // Different limits based on content type
      let limit = 5; // default
      let window = 60000; // 1 minute
      
      if (typeof prompt === 'string') {
        if (prompt.toLowerCase().includes('urgent') || prompt.toLowerCase().includes('emergency')) {
          limit = 10; // Higher limit for urgent requests
        } else if (prompt.length > 500) {
          limit = 2; // Lower limit for long requests
        }
      }

      // Simple implementation - in real apps, use more sophisticated tracking
      const requestCount = Math.floor(Math.random() * (limit + 2));
      
      if (requestCount > limit) {
        return {
          tripwireTriggered: true,
          message: `Smart rate limit exceeded (${requestCount}/${limit} requests)`,
          severity: 'medium',
          metadata: { 
            requestCount, 
            limit, 
            window,
            contentType: typeof prompt === 'string' && prompt.toLowerCase().includes('urgent') ? 'urgent' : 'normal'
          }
        };
      }

      return {
        tripwireTriggered: false,
        metadata: { requestCount, limit, window }
      };
    }
  });

  const smartModel = wrapLanguageModel({
    model,
    middleware: [
      createInputGuardrailsMiddleware({
        inputGuardrails: [smartRateLimitGuardrail],
        throwOnBlocked: false,
        onInputBlocked: (results) => {
          const result = results[0];
          console.log(`❌ Smart rate limit: ${result?.message}`);
          console.log(`🧠 Context:`, result?.metadata);
        }
      })
    ]
  });

  const testPrompts = [
    'Normal question about AI',
    'URGENT: Need help with production issue immediately!',
    'This is a very long and detailed question that contains a lot of information and context about a complex technical problem that requires extensive analysis and detailed explanation of multiple interconnected systems and their various components.',
    'Quick question about weather'
  ];

  for (let i = 0; i < testPrompts.length; i++) {
    console.log(`\nTesting smart rate limit with prompt type ${i + 1}...`);
    try {
      const result = await generateText({
        model: smartModel,
        prompt: testPrompts[i],
        experimental_telemetry: {
          isEnabled: true,
          functionId: 'smart-rate-limit',
          metadata: { pattern: 'context-aware-rate-limiting' }
        },
      });
      
      if (result.text) {
        console.log(`✅ Smart test ${i + 1} succeeded:`, result.text.slice(0, 50));
      } else {
        console.log(`✅ Smart test ${i + 1} processed by smart rate limiter`);
      }
    } catch (error) {
      console.log(`✅ Smart test ${i + 1} handled by smart rate limiting`);
    }
  }
}

// ============================================================================
// EXAMPLE REGISTRY AND INTERACTIVE MENU
// ============================================================================

// Example registry
const EXAMPLES = [
  { name: 'User Rate Limiting (Blocking vs Warning Demo)', fn: example1_BasicUserRateLimit },
  { name: 'Global Rate Limiting', fn: example2_GlobalRateLimit },
  { name: 'Token Bucket Rate Limiting', fn: example3_TokenBucketRateLimit },
  { name: 'Combined Rate Limits', fn: example4_CombinedRateLimits },
  { name: 'Smart Rate Limiting with Context', fn: example5_SmartRateLimit },
];

// Interactive menu with Inquirer
async function showInteractiveMenu() {
  console.log('\n🚦  Rate Limiting Guardrails Examples');
  console.log('===================================');
  console.log('Prevent API abuse with intelligent rate limiting\n');

  while (true) {
    const choices = [
      ...EXAMPLES.map((example, index) => ({
        name: `${index + 1}. ${example.name}`,
        value: index
      })),
      {
        name: `${EXAMPLES.length + 1}. Run all examples`,
        value: 'all'
      },
      {
        name: '🔧 Select multiple examples to run',
        value: 'multiple'
      },
      {
        name: '❌ Exit',
        value: 'exit'
      }
    ];

    const response = await safePrompt<{ action: string | number }>({
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices,
      pageSize: 9
    });

    if (!response) return;
    const { action } = response;

    if (action === 'exit') {
      console.log('\n👋 Goodbye!');
      return;
    }
    
    if (action === 'all') {
      await runAllExamples();
    } else if (action === 'multiple') {
      await runMultipleExamples();
    } else if (typeof action === 'number') {
      const example = EXAMPLES[action];
      if (!example) continue;
      console.log(`\n🚀 Running: ${example.name}\n`);
      try {
        await example.fn();
        console.log(`\n✅ ${example.name} completed successfully!`);
      } catch (error) {
        console.error(`❌ Error running ${example.name}:`, error);
      }
    }

    // Automatically return to main menu after running examples
    if (action !== 'exit') {
      console.log('\n↩️  Returning to main menu...\n');
      await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause
    }
  }
}

// Run multiple selected examples
async function runMultipleExamples() {
  const response = await safePrompt<{ selectedExamples: number[] }>({
    type: 'checkbox',
    name: 'selectedExamples',
    message: 'Select rate limiting examples to run (use space bar to select):',
    choices: EXAMPLES.map((example, index) => ({
      name: example.name,
      value: index,
      checked: false
    })),
    validate: (input: number[]) => {
      if (input.length === 0) {
        return 'Please select at least one example';
      }
      return true;
    }
  });

  if (!response) return;
  const { selectedExamples } = response;

  console.log(`\n🚀 Running ${selectedExamples.length} selected rate limiting examples...\n`);
  
  for (const exampleIndex of selectedExamples) {
    const example = EXAMPLES[exampleIndex];
    if (!example) continue;
    console.log(`\n--- Running: ${example.name} ---`);
    try {
      await example.fn();
      console.log(`✅ ${example.name} completed successfully!`);
    } catch (error) {
      console.error(`❌ Error running ${example.name}:`, error);
    }
  }

  console.log(`\n🎉 All ${selectedExamples.length} selected rate limiting examples completed!`);
}

// Run all examples
async function runAllExamples() {
  console.log('\n🚀 Running all rate limiting examples...\n');
  
  try {
    for (const example of EXAMPLES) {
      console.log(`\n--- Running: ${example.name} ---`);
      await example.fn();
    }

    console.log('\n✅ All rate limiting examples completed!');
    console.log('  • Basic user rate limiting');
    console.log('  • Global system rate limiting');
    console.log('  • Token bucket with burst support');
    console.log('  • Combined rate limiting strategies');
    console.log('  • Context-aware smart rate limiting');
  } catch (error) {
    console.error('❌ Error running rate limiting examples:', error);
  }
}

// Main execution
async function main() {
  setupGracefulShutdown();
  const args = process.argv.slice(2);
  
  // Check for specific example number argument
  if (args.length > 0) {
    const exampleArg = args[0];
    
    if (exampleArg === '--help' || exampleArg === '-h') {
      console.log('🚦  Rate Limiting Guardrails Examples');
      console.log('===================================');
      console.log('');
      console.log('Usage:');
      console.log('  tsx examples/rate-limit-guardrail.ts [example_number]');
      console.log('');
      console.log('Arguments:');
      console.log(`  example_number    Run specific example (1-${EXAMPLES.length}), or omit for interactive mode`);
      console.log('');
      console.log('Examples:');
      console.log('  tsx examples/rate-limit-guardrail.ts        # Interactive mode');
      console.log('  tsx examples/rate-limit-guardrail.ts 1      # Run basic user rate limiting');
      console.log('  tsx examples/rate-limit-guardrail.ts 3      # Run token bucket rate limiting');
      console.log('');
      console.log('Available examples:');
      for (const [index, example] of EXAMPLES.entries()) {
        console.log(`  ${index + 1}. ${example.name}`);
      }
      return;
    }

    const exampleNum = Number.parseInt(exampleArg || '', 10);
    
    if (Number.isNaN(exampleNum)) {
      console.error('❌ Invalid example number. Please provide a number.');
      console.log('💡 Use --help to see available options.');
      return;
    }

    if (exampleNum < 1 || exampleNum > EXAMPLES.length) {
      console.error(`❌ Invalid example number. Please choose between 1-${EXAMPLES.length}`);
      console.log('\nAvailable examples:');
      for (const [index, example] of EXAMPLES.entries()) {
        console.log(`  ${index + 1}. ${example.name}`);
      }
      return;
    }

    const selectedExample = EXAMPLES[exampleNum - 1];
    if (!selectedExample) {
      console.error('❌ Example not found.');
      return;
    }
    
    console.log(`🚀 Running: ${selectedExample.name}\n`);
    
    try {
      await selectedExample.fn();
      console.log(`\n✅ ${selectedExample.name} completed successfully!`);
    } catch (error) {
      console.error(`❌ Error running ${selectedExample.name}:`, error);
      throw error;
    }
  } else {
    // No arguments, show interactive menu
    await showInteractiveMenu();
  }
}

// Export for testing
export { main };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    if (error?.name !== 'ExitPromptError') {
      console.error(error);
    }
  });
}