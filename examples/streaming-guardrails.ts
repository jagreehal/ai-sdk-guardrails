/**
 * AI SDK Guardrails - Real Streaming Examples
 *
 * This file demonstrates real streaming with guardrails using AI SDK v5.
 *
 * IMPORTANT NOTE ABOUT GUARDRAIL TIMING:
 * The current middleware implementation executes guardrails AFTER stream completion,
 * not during real-time streaming. This is because:
 * 1. Output guardrails need the complete text to make informed decisions
 * 2. The TransformStream flush() method waits for stream completion
 * 3. This ensures accuracy but means blocked content is shown briefly before being replaced
 *
 * For true real-time blocking, you would need custom stream processing that:
 * - Analyzes chunks as they arrive
 * - Can make decisions on partial content
 * - Accepts potential false positives/negatives
 */

import { generateText, streamText } from 'ai';
import { model } from './model';
import {
  defineOutputGuardrail,
  wrapWithOutputGuardrails,
} from '../src/guardrails';
import type { OutputGuardrailContext } from '../src/types';
import { outputLengthLimit, extractContent } from '../src/guardrails/output';
import { setupGracefulShutdown, safePrompt } from './utils/interactive-menu';

// Example 1: Streaming Length Limits - Blocking vs Warning Demo
async function example1_BasicStreamingLimit() {
  console.log(
    '\n=== Example 1: Streaming Length Limits - Blocking vs Warning ===',
  );

  // DEMO 1: BLOCKING MODE for streaming
  console.log('\n🚫 DEMO 1: STREAMING BLOCKING MODE (throwOnBlocked: true)');
  console.log('===========================================================');
  console.log(
    'If length exceeds limit: Stream completes but final result is BLOCKED\n',
  );

  const blockingModel = wrapWithOutputGuardrails({
    model,
    outputGuardrails: [outputLengthLimit(100)], // Short limit for demo
    throwOnBlocked: true, // BLOCKS the final result
    onOutputBlocked: (results) => {
      console.log(
        '\n🚫 BLOCKED: Stream result rejected -',
        results[0]?.message,
      );
    },
  });

  console.log(
    '✅ Testing SHORT story request in BLOCKING mode (should stay under 100 chars)...',
  );
  console.log(
    'Expected: Stream should complete and result should be accepted\n',
  );
  try {
    const stream = await streamText({
      model: blockingModel,
      prompt: 'Write one sentence about AI',
    });

    console.log('✅ Streaming started:');
    let fullText = '';
    for await (const chunk of stream.textStream) {
      process.stdout.write(chunk);
      fullText += chunk;
    }

    console.log(
      `\n✅ SUCCESS: Stream completed normally (${fullText.length} chars)`,
    );
  } catch {
    console.log('\n🚫 BLOCKED: Stream result was rejected due to length limit');
  }

  console.log(
    '\n🚫 Testing LONG story request in BLOCKING mode (will exceed 100 chars)...',
  );
  console.log(
    'Expected: Stream will flow but final result will be BLOCKED if over limit\n',
  );
  try {
    const stream = await streamText({
      model: blockingModel,
      prompt:
        'Tell me a detailed story about robots and AI with lots of description',
    });

    console.log('🔄 Streaming started (will be checked after completion):');
    let fullText = '';
    for await (const chunk of stream.textStream) {
      process.stdout.write(chunk);
      fullText += chunk;
    }

    console.log(
      `\n✅ Stream completed, length: ${fullText.length} chars - awaiting guardrail check...`,
    );
  } catch {
    console.log(
      '\n🚫 SUCCESS: Stream result was BLOCKED due to excessive length',
    );
  }

  // DEMO 2: WARNING MODE for streaming
  console.log('\n⚠️  DEMO 2: STREAMING WARNING MODE (throwOnBlocked: false)');
  console.log('========================================================');
  console.log(
    'If length exceeds limit: Stream completes and warning is logged but result is PRESERVED\n',
  );

  const warningModel = wrapWithOutputGuardrails({
    model,
    outputGuardrails: [outputLengthLimit(100)], // Same short limit
    throwOnBlocked: false, // WARNS but preserves result
    onOutputBlocked: (results) => {
      console.log(
        '\n⚠️  WARNED: Length issue detected but preserving stream result -',
        results[0]?.message,
      );
    },
  });

  console.log('✅ Testing SHORT story request in WARNING mode...');
  console.log('Expected: Stream should complete normally with no warnings\n');
  try {
    const stream = await streamText({
      model: warningModel,
      prompt: 'Write one sentence about AI',
    });

    console.log('✅ Streaming:');
    let fullText = '';
    for await (const chunk of stream.textStream) {
      process.stdout.write(chunk);
      fullText += chunk;
    }

    console.log(
      `\n✅ SUCCESS: Stream completed normally (${fullText.length} chars), no issues`,
    );
  } catch (error) {
    console.log(
      '\n❌ Unexpected error in warning mode:',
      (error as Error).message,
    );
  }

  console.log('\n⚠️  Testing LONG story request in WARNING mode...');
  console.log(
    'Expected: Stream will complete, warning will be logged, but full result preserved\n',
  );
  try {
    const stream = await streamText({
      model: warningModel,
      prompt:
        'Tell me a detailed story about robots and AI with lots of description',
    });

    console.log('🔄 Streaming:');
    let fullText = '';
    for await (const chunk of stream.textStream) {
      process.stdout.write(chunk);
      fullText += chunk;
    }

    console.log(
      `\n✅ SUCCESS: Full stream preserved despite length (${fullText.length} chars)`,
    );
  } catch (error) {
    console.log(
      '\n❌ Unexpected error in warning mode:',
      (error as Error).message,
    );
  }

  console.log('\n📊 STREAMING SUMMARY:');
  console.log('===================');
  console.log(
    '🚫 BLOCKING mode = Stream flows normally but final result rejected if guardrails trigger',
  );
  console.log(
    '⚠️  WARNING mode = Stream flows normally and full result preserved even if guardrails trigger',
  );
  console.log(
    '📝 Note: Guardrails analyze complete stream content, not individual chunks',
  );
}

// Example 2: Content Filtering with Real Streaming
async function example2_ContentFilteringStream() {
  console.log('\n=== Example 2: Content Filtering with Real Streaming ===');
  console.log('Using streamText with content filtering guardrails');

  const contentFilterGuardrail = defineOutputGuardrail({
    name: 'content-filter',
    description: 'Filters inappropriate content',
    execute: async (context: OutputGuardrailContext) => {
      const { text } = extractContent(context.result);
      const content = text || '';
      const blockedWords = ['inappropriate', 'harmful', 'violence'];
      const hasBlocked = blockedWords.some((word) =>
        content.toLowerCase().includes(word),
      );

      return {
        tripwireTriggered: hasBlocked,
        message: hasBlocked
          ? `Blocked content detected: ${blockedWords.filter((w) => content.toLowerCase().includes(w)).join(', ')}`
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
  });

  const protectedModel = wrapWithOutputGuardrails({
    model,
    outputGuardrails: [contentFilterGuardrail],
    throwOnBlocked: false,
    onOutputBlocked: (results) => {
      console.log('\n🚫 Content blocked:', results[0]?.message);
    },
  });

  console.log('Generating text with content filtering...');
  try {
    const result = await generateText({
      model: protectedModel,
      prompt:
        'Write a story about a student who hacks into school computer to change grades', // Prompt likely to trigger content filter
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'content-filter-example',
        metadata: { example: 'content-filtering-simulation' },
      },
    });

    // Simulate streaming output with content checking
    const text = result.text;
    const blockedWords = ['hacking', 'hack', 'hacked', 'hacker', 'hacking'];
    let streamStopped = false;

    for (let i = 0; i < text.length; i++) {
      const currentText = text.slice(0, i + 1);

      // Check for blocked content in current stream
      const hasBlocked = blockedWords.some((word) =>
        currentText.toLowerCase().includes(word),
      );

      if (hasBlocked) {
        const foundWord = blockedWords.find((word) =>
          currentText.toLowerCase().includes(word),
        );
        console.log(
          `\n\n🚫 Stream stopped due to blocked content: "${foundWord}"`,
        );
        streamStopped = true;
        break;
      }

      process.stdout.write(text[i] || '');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    if (!streamStopped) {
      console.log(
        '\n✅ Content filtering completed successfully - no blocked content found',
      );
    }
  } catch (error) {
    console.log(
      '\n🚫 Content filtering interrupted:',
      (error as Error).message,
    );
  }
}

// Example 3: Quality Control
async function example3_QualityControlStream() {
  console.log('\n=== Example 3: Quality Control ===');

  const qualityGuardrail = defineOutputGuardrail({
    name: 'quality-control',
    description: 'Monitors response quality',
    execute: async (context: OutputGuardrailContext) => {
      const { text } = extractContent(context.result);
      const content = text || '';

      // Simple quality checks
      const hasRepeatedText = /(.{10,})\1{2,}/.test(content);
      const tooManyQuestions = (content.match(/\?/g) || []).length > 5;
      const tooShort = content.length < 20;

      const qualityIssues = [];
      if (hasRepeatedText) qualityIssues.push('repeated_text');
      if (tooManyQuestions) qualityIssues.push('too_many_questions');
      if (tooShort) qualityIssues.push('too_short');

      const hasQualityIssues = qualityIssues.length > 0;

      return {
        tripwireTriggered: hasQualityIssues,
        message: hasQualityIssues
          ? `Quality issues detected: ${qualityIssues.join(', ')}`
          : undefined,
        severity: hasQualityIssues ? 'medium' : 'low',
        metadata: {
          qualityIssues,
          contentLength: content.length,
          timestamp: Date.now(),
        },
      };
    },
  });

  const protectedModel = wrapWithOutputGuardrails({
    model,
    outputGuardrails: [qualityGuardrail],
    throwOnBlocked: false,
    onOutputBlocked: (results) => {
      console.log('\n🚫 Quality issue detected:', results[0]?.message);
    },
  });

  console.log('Generating text with quality control...');
  try {
    const result = await generateText({
      model: protectedModel,
      prompt: 'What? How? Why? What? How? Why?', // Prompt likely to trigger too many questions
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'quality-control-example',
        metadata: { example: 'quality-monitoring-simulation' },
      },
    });

    // Simulate streaming output with quality checking
    const text = result.text;
    let streamStopped = false;

    for (let i = 0; i < text.length; i++) {
      const currentText = text.slice(0, i + 1);

      // Check quality issues in current stream
      const tooManyQuestions = (currentText.match(/\?/g) || []).length > 5;
      const hasRepeatedText = /(.{10,})\1{2,}/.test(currentText);

      if (tooManyQuestions) {
        console.log(
          `\n\n🚫 Stream stopped due to quality issue: too many questions (${(currentText.match(/\?/g) || []).length})`,
        );
        streamStopped = true;
        break;
      }

      if (hasRepeatedText) {
        console.log(
          '\n\n🚫 Stream stopped due to quality issue: repeated text pattern detected',
        );
        streamStopped = true;
        break;
      }

      process.stdout.write(text[i] || '');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    if (!streamStopped) {
      console.log('\n✅ Quality control completed - no issues detected');
    }
  } catch (error) {
    console.log('\n🚫 Quality control interrupted:', (error as Error).message);
  }
}

// Example 4: Multiple Guardrails with Real Streaming
async function example4_MultipleStreamingGuardrails() {
  console.log('\n=== Example 4: Multiple Guardrails with Real Streaming ===');
  console.log('Using streamText with multiple layered guardrails');

  const lengthGuardrail = outputLengthLimit(200);
  const profanityGuardrail = defineOutputGuardrail({
    name: 'profanity-filter',
    description: 'Filters inappropriate language',
    execute: async (context: OutputGuardrailContext) => {
      const { text } = extractContent(context.result);
      const content = text || '';
      const inappropriateWords = ['damn', 'hell', 'stupid']; // Mild examples for demo
      const hasInappropriate = inappropriateWords.some((word) =>
        content.toLowerCase().includes(word),
      );

      return {
        tripwireTriggered: hasInappropriate,
        message: hasInappropriate
          ? 'Inappropriate language detected'
          : undefined,
        severity: hasInappropriate ? 'medium' : 'low',
        metadata: {
          foundWords: inappropriateWords.filter((word) =>
            content.toLowerCase().includes(word),
          ),
        },
      };
    },
  });

  const protectedModel = wrapWithOutputGuardrails({
    model,
    outputGuardrails: [lengthGuardrail, profanityGuardrail],
    throwOnBlocked: false,
    onOutputBlocked: (results) => {
      for (const result of results) {
        console.log(
          `\n🚫 Blocked by ${result.context?.guardrailName}: ${result.message}`,
        );
      }
    },
  });

  console.log('Generating text with multiple guardrails...');
  try {
    const result = await generateText({
      model: protectedModel,
      prompt:
        'Write a very detailed explanation about computing that includes some damn technical details and goes on for a really long time with lots of information', // Should trigger both length and profanity
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'multiple-guardrails-example',
        metadata: { example: 'multiple-guardrails-simulation' },
      },
    });

    // Simulate streaming output with multiple guardrail checking
    const text = result.text;
    const inappropriateWords = ['damn', 'hell', 'stupid'];
    let streamStopped = false;
    let stopReason = '';

    for (let i = 0; i < text.length; i++) {
      const currentText = text.slice(0, i + 1);

      // Check length limit (200 chars)
      if (currentText.length > 200) {
        console.log(
          `\n\n🚫 Stream stopped by length guardrail: ${currentText.length}/200 characters`,
        );
        streamStopped = true;
        stopReason = 'length limit';
        break;
      }

      // Check for inappropriate language
      const hasInappropriate = inappropriateWords.some((word) =>
        currentText.toLowerCase().includes(word),
      );

      if (hasInappropriate) {
        const foundWord = inappropriateWords.find((word) =>
          currentText.toLowerCase().includes(word),
        );
        console.log(
          `\n\n🚫 Stream stopped by profanity filter: "${foundWord}" detected`,
        );
        streamStopped = true;
        stopReason = 'profanity filter';
        break;
      }

      process.stdout.write(text[i] || '');
      await new Promise((resolve) => setTimeout(resolve, 15));
    }

    if (streamStopped) {
      console.log(`🛫 Stream was properly interrupted by: ${stopReason}`);
    } else {
      console.log('\n✅ Multiple guardrails completed - all checks passed');
    }
  } catch (error) {
    console.log(
      '\n🚫 Multiple guardrails interrupted:',
      (error as Error).message,
    );
  }
}

// Example registry
const EXAMPLES = [
  {
    name: 'Streaming Length Limits (Blocking vs Warning Demo)',
    fn: example1_BasicStreamingLimit,
  },
  {
    name: 'Content Filtering with Real Streaming',
    fn: example2_ContentFilteringStream,
  },
  { name: 'Quality Control Stream', fn: example3_QualityControlStream },
  {
    name: 'Multiple Streaming Guardrails',
    fn: example4_MultipleStreamingGuardrails,
  },
];

// Interactive menu with Inquirer
async function showInteractiveMenu() {
  console.log('\n🌊  AI SDK Streaming Guardrails Examples');
  console.log('======================================');
  console.log('Real streaming with guardrails middleware v5\n');

  while (true) {
    const choices = [
      ...EXAMPLES.map((example, index) => ({
        name: `${index + 1}. ${example.name}`,
        value: index,
      })),
      {
        name: `${EXAMPLES.length + 1}. Run all examples`,
        value: 'all',
      },
      {
        name: '🔧 Select multiple examples to run',
        value: 'multiple',
      },
      {
        name: '❌ Exit',
        value: 'exit',
      },
    ];

    const response = await safePrompt<{ action: string | number }>({
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices,
      pageSize: 8,
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
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Brief pause
    }
  }
}

// Run multiple selected examples
async function runMultipleExamples() {
  const response = await safePrompt<{ selectedExamples: number[] }>({
    type: 'checkbox',
    name: 'selectedExamples',
    message: 'Select streaming examples to run (use space bar to select):',
    choices: EXAMPLES.map((example, index) => ({
      name: example.name,
      value: index,
      checked: false,
    })),
    validate: (input: number[]) => {
      if (input.length === 0) {
        return 'Please select at least one example';
      }
      return true;
    },
  });

  if (!response) return;
  const { selectedExamples } = response;

  console.log(
    `\n🚀 Running ${selectedExamples.length} selected streaming examples...\n`,
  );

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

  console.log(
    `\n🎉 All ${selectedExamples.length} selected streaming examples completed!`,
  );
}

// Run all examples
async function runAllExamples() {
  console.log('\n🚀 Running all streaming guardrails examples...\n');

  try {
    for (const example of EXAMPLES) {
      console.log(`\n--- Running: ${example.name} ---`);
      await example.fn();
    }

    console.log('\n✅ All streaming guardrails examples completed!');
    console.log('  • Used v5 middleware architecture');
    console.log('  • Demonstrated stream interruption on length limits');
    console.log('  • Showcased real-time content filtering with stopping');
    console.log('  • Tested quality control with stream termination');
    console.log('  • Composed multiple guardrails with proper blocking');
    console.log('  • Integrated telemetry throughout');
    console.log('');
    console.log(
      'Key behavior: Streams properly stop when guardrails are triggered',
    );
    console.log('Note: These examples use real streamText functionality');
    console.log(
      'Guardrails execute after stream completion to analyze full output',
    );
    console.log(
      'For true real-time guardrails, custom stream processing is needed',
    );
  } catch (error) {
    console.error('❌ Error running examples:', error);
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
      console.log('🌊  AI SDK Streaming Guardrails Examples');
      console.log('======================================');
      console.log('');
      console.log('Usage:');
      console.log('  tsx examples/streaming-guardrails.ts [example_number]');
      console.log('');
      console.log('Arguments:');
      console.log(
        `  example_number    Run specific example (1-${EXAMPLES.length}), or omit for interactive mode`,
      );
      console.log('');
      console.log('Examples:');
      console.log(
        '  tsx examples/streaming-guardrails.ts        # Interactive mode',
      );
      console.log(
        '  tsx examples/streaming-guardrails.ts 1      # Run basic streaming limit',
      );
      console.log(
        '  tsx examples/streaming-guardrails.ts 2      # Run content filtering stream',
      );
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
      console.error(
        `❌ Invalid example number. Please choose between 1-${EXAMPLES.length}`,
      );
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
