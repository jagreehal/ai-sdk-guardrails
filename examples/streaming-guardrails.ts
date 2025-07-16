import { model } from './model';
import { streamTextWithGuardrails, createOutputGuardrail } from '../src/core';
import { outputLengthLimit, extractContent } from '../src/guardrails/output';

// Example 1: Basic Streaming with Output Length Limit
async function example1_BasicStreamingLimit() {
  console.log('\n=== Example 1: Streaming with Output Length Limit ===');

  console.log('Starting stream with length limit...');
  const result = await streamTextWithGuardrails(
    {
      model,
      prompt: 'Tell me a short story about a robot that is over 250 words',
    },
    {
      outputGuardrails: [outputLengthLimit(15)],
    },
  );

  const reader = result.textStream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      process.stdout.write(value);
    }
  } catch (error) {
    console.log('\n🚫 Stream was interrupted:', (error as Error).message);
  } finally {
    reader.releaseLock();
  }

  console.log('\n📊 Stream completed');
}

// Example 2: Content Filtering During Streaming
async function example2_ContentFilteringStream() {
  console.log('\n=== Example 2: Content Filtering During Streaming ===');

  const contentFilterGuardrail = createOutputGuardrail(
    'content-filter',
    async (context, accumulatedText) => {
      const { text } = extractContent(context.result);
      const content = accumulatedText || text || '';
      const blockedWords = ['donkey', 'inappropriate', 'harmful'];
      const hasBlocked = blockedWords.some((word) =>
        content.toLowerCase().includes(word),
      );

      return {
        tripwireTriggered: hasBlocked,
        message: hasBlocked
          ? `Blocked content detected: ${content}`
          : undefined,
        severity: hasBlocked ? 'high' : 'low',
        metadata: {
          blockedWords: blockedWords.filter((word) =>
            content.toLowerCase().includes(word),
          ),
          contentLength: content.length,
        },
      };
    },
  );

  console.log('Starting stream with content filtering...');
  const result = await streamTextWithGuardrails(
    {
      model,
      prompt: 'Write a 100 words story about a donkey called Donkey',
    },
    {
      outputGuardrails: [contentFilterGuardrail],
    },
  );

  const reader = result.textStream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      process.stdout.write(value);
    }
  } catch (error) {
    console.log(
      '\n🚫 Stream was interrupted for content filtering:',
      (error as Error).message,
    );
  } finally {
    reader.releaseLock();
  }

  console.log('\n✅ Stream completed successfully');
}

// Example 3: Rate-Limited Streaming
async function example3_RateLimitedStream() {
  console.log('\n=== Example 3: Rate-Limited Streaming ===');

  const rateLimitGuardrail = createOutputGuardrail('rate-limiter', async () => {
    // For now, simple implementation without metadata
    const shouldBlock = Math.random() > 0.8;

    return {
      tripwireTriggered: shouldBlock,
      message: shouldBlock ? 'Rate limit reached' : undefined,
      severity: shouldBlock ? 'medium' : 'low',
      metadata: {
        randomValue: Math.random(),
        timestamp: Date.now(),
      },
    };
  });

  console.log('Starting stream with rate limiting...');
  const result = await streamTextWithGuardrails(
    {
      model,
      prompt: 'Explain how computers work',
    },
    {
      outputGuardrails: [rateLimitGuardrail],
    },
  );

  const reader = result.textStream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      process.stdout.write(value);
    }
  } catch (error) {
    console.log('\n🚫 Stream was interrupted:', (error as Error).message);
  } finally {
    reader.releaseLock();
  }

  console.log('\n✅ Stream completed');
}

// Main execution
async function main() {
  console.log('🌊 AI SDK Streaming Guardrails Examples');
  console.log('=========================================');

  try {
    await example1_BasicStreamingLimit();
    await example2_ContentFilteringStream();
    await example3_RateLimitedStream();

    console.log('\n✅ All streaming examples completed successfully!');
  } catch (error) {
    console.error('❌ Error running streaming examples:', error);
  }
}

// Run automatically
main().catch(console.error);
