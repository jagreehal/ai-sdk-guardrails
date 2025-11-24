/**
 * Streaming Limits Example
 *
 * Demonstrates how to apply guardrails to streaming responses,
 * including length limits and content validation.
 *
 * Note: Guardrails execute after stream completion for full content analysis.
 */

import { streamText } from 'ai';
import { model } from './model';
import { defineOutputGuardrail, withGuardrails } from 'ai-sdk-guardrails';
import { extractContent } from 'ai-sdk-guardrails/guardrails/output';

// Define types for streaming guardrail metadata
// Note: This interface is used implicitly in the guardrail metadata

// Define a length limit guardrail for streaming
const streamLengthGuardrail = defineOutputGuardrail({
  name: 'stream-length-limit',
  description: 'Limits the total length of streamed content',
  execute: async (params) => {
    const { text } = extractContent(params.result);
    const maxLength = 200; // Short limit for demonstration

    if (text.length > maxLength) {
      return {
        tripwireTriggered: true,
        message: `Stream output too long: ${text.length}/${maxLength} characters`,
        severity: 'medium',
        metadata: {
          length: text.length,
          limit: maxLength,
          excess: text.length - maxLength,
        },
      };
    }

    return { tripwireTriggered: false };
  },
});

// Content filter for streaming
const streamContentFilter = defineOutputGuardrail({
  name: 'stream-content-filter',
  description: 'Filters inappropriate content in streams',
  execute: async (params) => {
    const { text } = extractContent(params.result);

    // Check for repetitive patterns (common in streaming issues)
    const words = text.split(/\s+/);
    const wordCounts = new Map<string, number>();

    for (const word of words) {
      const lower = word.toLowerCase();
      wordCounts.set(lower, (wordCounts.get(lower) || 0) + 1);
    }

    // Check if any word repeats too much
    const maxRepetitions = Math.max(...wordCounts.values());
    const totalWords = words.length;

    if (totalWords > 10 && maxRepetitions > totalWords * 0.2) {
      return {
        tripwireTriggered: true,
        message: 'Repetitive content detected in stream',
        severity: 'medium',
        metadata: {
          maxRepetitions,
          totalWords,
          repetitionRatio: Math.round((maxRepetitions / totalWords) * 100),
        },
      };
    }

    return { tripwireTriggered: false };
  },
});

async function demonstrateStreamingWithLimits() {
  console.log('📊 Streaming with Length Limits');
  console.log('================================\n');

  const limitedModel = withGuardrails(model, {
    outputGuardrails: [streamLengthGuardrail],
    throwOnBlocked: false, // Use warning mode for streaming
    onOutputBlocked: (executionSummary) => {
      console.log(
        '\n⚠️  Stream limit warning:',
        executionSummary.blockedResults[0]?.message,
      );
      const metadata = executionSummary.blockedResults[0]?.metadata;
      if (metadata) {
        console.log(
          `   Exceeded by: ${metadata.excess || 'unknown'} characters`,
        );
      }
    },
  });

  // Test 1: Short stream (within limits)
  console.log('Test 1: Short response (should stay within 200 char limit)');
  try {
    const stream = await streamText({
      model: limitedModel,
      prompt: 'Write a one-sentence description of clouds',
    });

    console.log('Streaming: ');
    let fullText = '';
    for await (const chunk of stream.textStream) {
      process.stdout.write(chunk);
      fullText += chunk;
    }
    console.log(`\n✅ Completed (${fullText.length} characters)\n`);
  } catch (error) {
    console.log('❌ Error:', (error as Error).message);
    throw error;
  }

  // Test 2: Long stream (exceeds limits)
  console.log('Test 2: Detailed response (likely to exceed 200 char limit)');
  try {
    const stream = await streamText({
      model: limitedModel,
      prompt: 'Write a detailed paragraph about the history of computers',
    });

    console.log('Streaming: ');
    let fullText = '';
    for await (const chunk of stream.textStream) {
      process.stdout.write(chunk);
      fullText += chunk;
    }
    console.log(`\n✅ Completed (${fullText.length} characters)\n`);
  } catch (error) {
    console.log('❌ Error:', (error as Error).message);
    throw error;
  }
}

async function demonstrateStreamingContentFilter() {
  console.log('🔍 Streaming Content Filtering');
  console.log('==============================\n');

  const filteredModel = withGuardrails(model, {
    outputGuardrails: [streamContentFilter],
    throwOnBlocked: false,
    onOutputBlocked: (executionSummary) => {
      console.log(
        '\n⚠️  Content issue:',
        executionSummary.blockedResults[0]?.message,
      );
      const metadata = executionSummary.blockedResults[0]?.metadata;
      if (metadata) {
        console.log(`   Repetition ratio: ${metadata.repetitionRatio}%`);
      }
    },
  });

  console.log('Test: Stream with content quality check');
  try {
    const stream = await streamText({
      model: filteredModel,
      prompt: 'Describe a forest scene with variety and detail',
    });

    console.log('Streaming: ');
    for await (const chunk of stream.textStream) {
      process.stdout.write(chunk);
    }
    console.log('\n✅ Stream completed\n');
  } catch (error) {
    console.log('❌ Error:', (error as Error).message);
    throw error;
  }
}

async function demonstrateBlockingMode() {
  console.log('🚫 Streaming with Blocking Mode');
  console.log('================================');
  console.log(
    'Note: Stream completes, then guardrails evaluate the full content\n',
  );

  const blockingModel = withGuardrails(model, {
    outputGuardrails: [streamLengthGuardrail],
    throwOnBlocked: true, // Blocking mode
    onOutputBlocked: (executionSummary) => {
      console.log(
        '\n🚫 Stream blocked after completion:',
        executionSummary.blockedResults[0]?.message,
      );
    },
  });

  console.log('Test: Long stream with blocking mode');
  try {
    const stream = await streamText({
      model: blockingModel,
      prompt: 'Write a very detailed explanation about artificial intelligence',
    });

    console.log('Streaming (will check after completion): ');
    let fullText = '';
    for await (const chunk of stream.textStream) {
      process.stdout.write(chunk);
      fullText += chunk;
    }

    // Guardrails check happens here
    console.log(`\n✅ Stream allowed (${fullText.length} characters)\n`);
  } catch (error) {
    console.log('\n❌ Stream was blocked:', (error as Error).message);
  }
}

async function demonstrateProgressiveStreaming() {
  console.log('📈 Progressive Stream Monitoring');
  console.log('=================================');
  console.log('Simulate chunk-by-chunk monitoring (for demonstration)\n');

  // This demonstrates how you might implement custom progressive checking
  // Note: This is not using the guardrail system, but custom logic
  let totalLength = 0;
  const maxTotalLength = 200;

  try {
    const stream = await streamText({
      model, // Using base model for custom handling
      prompt: 'Tell a story about a robot learning to paint',
    });

    console.log('Progressive streaming with custom checks:\n');

    for await (const chunk of stream.textStream) {
      totalLength += chunk.length;

      // Custom progressive check
      if (totalLength > maxTotalLength) {
        console.log('\n\n⛔ Stream interrupted: Exceeded length limit');
        console.log(`   Total length: ${totalLength}/${maxTotalLength}`);
        break; // Stop processing stream
      }

      // Display with visual feedback
      process.stdout.write(chunk);

      // Show progress indicator every N characters
      if (totalLength % 50 === 0) {
        process.stdout.write(` [${totalLength}]`);
      }
    }

    console.log(
      `\n\n✅ Stream completed within limits (${totalLength} characters)\n`,
    );
  } catch (error) {
    console.log('❌ Error:', (error as Error).message);
    throw error;
  }
}

console.log('🌊 Streaming Limits Example\n');
console.log(
  'This example shows how guardrails work with streaming responses.\n',
);
console.log('Key points:');
console.log('• Guardrails evaluate complete stream content');
console.log('• Use warning mode to allow streams to complete');
console.log('• Blocking mode prevents returning over-limit content');
console.log('• Custom logic needed for real-time stream interruption\n');
console.log('='.repeat(60) + '\n');

await demonstrateStreamingWithLimits();
console.log('='.repeat(60) + '\n');

await demonstrateStreamingContentFilter();
console.log('='.repeat(60) + '\n');

await demonstrateBlockingMode();
console.log('='.repeat(60) + '\n');

await demonstrateProgressiveStreaming();

console.log('='.repeat(60));
console.log('\n📊 Summary:');
console.log('• Streaming guardrails work on complete content');
console.log('• Warning mode: Stream completes, issues logged');
console.log('• Blocking mode: Stream completes, then blocked if needed');
console.log('• For real-time interruption, use custom stream processing\n');
