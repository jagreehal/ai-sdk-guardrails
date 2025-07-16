/**
 * Kitchen Sink
 *
 * This example shows multiple usage patterns:
 * 1. One-go usage (zero setup)
 * 2. Reusable guardrails (composable)
 * 3. Pre-configured instances (convenience)
 * 4. Custom guardrails (flexible)
 *
 */

import { model } from './model';
import {
  // One-go functions (zero setup)
  generateTextWithGuardrails,
  generateObjectWithGuardrails,
  streamTextWithGuardrails,

  // Guardrail definitions
  createInputGuardrail,
  createOutputGuardrail,
} from '../src/core';
import {
  contentLengthLimit,
  blockedKeywords,
  extractTextContent,
} from '../src/guardrails/input';
import {
  outputLengthLimit,
  blockedOutputContent,
  confidenceThreshold,
  extractContent,
} from '../src/guardrails/output';
import { z } from 'zod';

// ============================================================================
// PATTERN 1: ONE-GO USAGE (Zero Setup)
// ============================================================================

async function pattern1_OneGoUsage() {
  console.log('\n🚀 Pattern 1: One-Go Usage (Zero Setup)');
  console.log('========================================');

  try {
    // Simple one-liner with guardrails - no complex setup needed!
    const result = await generateTextWithGuardrails(
      {
        model,
        prompt: 'Tell me about cybersecurity',
      },
      {
        inputGuardrails: [
          contentLengthLimit(100),
          blockedKeywords(['hack', 'spam']),
        ],
        outputGuardrails: [outputLengthLimit(300)],
        onInputBlocked: (error) =>
          console.log('❌ Input blocked:', error.reason),
        onOutputBlocked: (error) =>
          console.log('❌ Output blocked:', error.reason),
        throwOnBlocked: false,
      },
    );

    console.log('✅ One-go result:', result.text.slice(0, 150) + '...');
  } catch (error) {
    console.error('Error in one-go pattern:', error);
  }
}

// ============================================================================
// PATTERN 2: REUSABLE GUARDRAILS (Composable)
// ============================================================================

async function pattern2_ReusableGuardrails() {
  console.log('\n🔄 Pattern 2: Reusable Guardrails');
  console.log('==================================');

  // Define reusable guardrail configuration
  const safetyGuardrails = {
    inputGuardrails: [
      contentLengthLimit(200),
      blockedKeywords(['spam', 'malware']),
    ],
    outputGuardrails: [
      outputLengthLimit(400),
      blockedOutputContent(['password', 'secret']),
    ],
    throwOnBlocked: false,
    enablePerformanceMonitoring: true,
  };

  console.log('Using guardrails with generateText...');
  const textResult = await generateTextWithGuardrails(
    {
      model,
      prompt: 'Explain machine learning basics',
    },
    safetyGuardrails,
  );
  console.log(
    '✅ Reusable text result:',
    textResult.text.slice(0, 100) + '...',
  );

  console.log('\nUsing same guardrails with generateObject...');
  const objectResult = await generateObjectWithGuardrails(
    {
      model,
      prompt: 'Create a simple user profile',
      schema: z.object({
        name: z.string(),
        role: z.string(),
        interests: z.array(z.string()),
      }),
    } as any,
    safetyGuardrails,
  );
  console.log('✅ Reusable object result:', objectResult.object);
}

// ============================================================================
// PATTERN 3: PRE-CONFIGURED INSTANCES (Convenience)
// ============================================================================

async function pattern3_PreConfiguredInstances() {
  console.log('\n⚡ Pattern 3: Pre-configured Instances');
  console.log('======================================');

  // Use pre-configured safe AI (zero setup)
  console.log('Using pre-configured safe AI...');
  // const safeResult = await guardedAI.safe.generateText({
  //   model,
  //   prompt: 'Tell me about data security',
  // });
  // console.log('✅ Safe AI result:', safeResult.text.slice(0, 100) + '...');

  // Use pre-configured dev AI (more lenient)
  console.log('\nUsing pre-configured dev AI...');
  // const devResult = await guardedAI.dev.generateText({
  //   model,
  //   prompt: 'Explain database optimization techniques in detail',
  // });
  // console.log('✅ Dev AI result:', devResult.text.slice(0, 100) + '...');

  // Use pre-configured prod AI (strict)
  console.log('\nUsing pre-configured prod AI...');
  // try {
  //   const prodResult = await guardedAI.prod.generateText({
  //     model,
  //     prompt: 'Brief overview of cloud computing',
  //   });
  //   console.log('✅ Prod AI result:', prodResult.text.slice(0, 100) + '...');
  // } catch (error) {
  //   if (error instanceof GuardrailError) {
  //     console.log('🛡️ Prod AI blocked content:', error.getSummary());
  //   }
  // }
}

// ============================================================================
// PATTERN 4: CUSTOM GUARDRAILS (Flexible)
// ============================================================================

async function pattern4_CustomGuardrails() {
  console.log('\n🎨 Pattern 4: Custom Guardrails');
  console.log('===============================');

  // Create custom input guardrail (no separate agents needed!)
  const codeQualityGuardrail = createInputGuardrail(
    'code-quality-checker',
    'Ensures code-related requests meet quality standards',
    async (context) => {
      const { prompt } = extractTextContent(context);
      const content = (prompt || '').toLowerCase();
      const lowQualityPatterns = [
        'quick fix',
        'dirty hack',
        'temporary solution',
        'copy paste',
      ];

      const hasLowQuality = lowQualityPatterns.some((pattern) =>
        content.includes(pattern),
      );

      return {
        tripwireTriggered: hasLowQuality,
        message: hasLowQuality
          ? 'Request suggests low-quality code practices'
          : undefined,
        severity: hasLowQuality ? 'medium' : 'low',
        suggestion: hasLowQuality
          ? 'Consider asking for best practices and proper solutions'
          : undefined,
        metadata: {
          detectedPatterns: lowQualityPatterns.filter((pattern) =>
            content.includes(pattern),
          ),
          contentLength: content.length,
        },
      };
    },
  );

  // Create custom output guardrail
  const technicalAccuracyGuardrail = createOutputGuardrail(
    'technical-accuracy',
    async (context) => {
      const { text } = extractContent(context.result);
      const content = text || '';
      const uncertaintyPhrases = [
        'i think',
        'maybe',
        'probably',
        'not sure',
        'might be',
      ];

      const hasUncertainty = uncertaintyPhrases.some((phrase) =>
        content.toLowerCase().includes(phrase),
      );

      return {
        tripwireTriggered: hasUncertainty,
        message: hasUncertainty
          ? 'Technical response contains uncertainty'
          : undefined,
        severity: hasUncertainty ? 'medium' : 'low',
        suggestion: hasUncertainty
          ? 'Request more specific or confident technical guidance'
          : undefined,
        metadata: {
          uncertaintyPhrases: uncertaintyPhrases.filter((phrase) =>
            content.toLowerCase().includes(phrase),
          ),
          confidenceLevel: hasUncertainty ? 'low' : 'high',
        },
      };
    },
  );

  // Test custom guardrails
  console.log('Testing custom guardrails...');
  const result = await generateTextWithGuardrails(
    {
      model,
      prompt: 'Give me a quick fix for this database performance issue',
    },
    {
      inputGuardrails: [codeQualityGuardrail],
      outputGuardrails: [technicalAccuracyGuardrail],
      onInputBlocked: (error) => {
        console.log('🔍 Custom input guardrail triggered:', error.reason);
        console.log('💡 Suggestion:', error.reason);
      },
      onOutputBlocked: (error) => {
        console.log('🔍 Custom output guardrail triggered:', error.reason);
        console.log('📊 Metadata:', error.reason);
      },
      throwOnBlocked: false,
    },
  );

  if (result.text) {
    console.log(
      '✅ Custom guardrails result:',
      result.text.slice(0, 100) + '...',
    );
  } else {
    console.log('🚫 Request was blocked by custom guardrails');
  }
}

// ============================================================================
// PATTERN 5: COMPOSITION (Advanced)
// ============================================================================

async function pattern5_Composition() {
  console.log('\n🧩 Pattern 5: Guardrail Composition');
  console.log('===================================');

  // Create multiple guardrail configurations
  const securityGuardrails = {
    inputGuardrails: [blockedKeywords(['hack', 'exploit', 'vulnerability'])],
    outputGuardrails: [blockedOutputContent(['password', 'secret', 'token'])],
  };

  const qualityGuardrails = {
    inputGuardrails: [contentLengthLimit(500)],
    outputGuardrails: [outputLengthLimit(800), confidenceThreshold(0.7)],
  };

  // Compose guardrails (much easier than OpenAI Agents JS!)
  // const composedGuardrails = composeGuardrails(securityGuardrails, qualityGuardrails);

  // Create conditional guardrails
  // const conditionalGuardrailConfig = conditionalGuardrails(
  //   (params) => params.prompt?.includes('production') || false,
  //   {
  //     inputGuardrails: [
  //       rateLimiting(10), // Strict rate limiting for production
  //     ],
  //     outputGuardrails: [
  //       outputLengthLimit(300), // Shorter outputs for production
  //     ],
  //   }
  // );

  // Combine all guardrails
  // const fullGuardrails = composeGuardrails(composedGuardrails, conditionalGuardrailConfig);

  // For now, use basic configuration
  const fullGuardrails = {
    inputGuardrails: [
      ...securityGuardrails.inputGuardrails,
      ...qualityGuardrails.inputGuardrails,
    ],
    outputGuardrails: [
      ...securityGuardrails.outputGuardrails,
      ...qualityGuardrails.outputGuardrails,
    ],
  };

  // Test composed guardrails
  console.log('Testing composed guardrails...');
  const result = await generateTextWithGuardrails(
    {
      model,
      prompt: 'Explain best practices for production deployment',
    },
    {
      ...fullGuardrails,
      onInputBlocked: (error) =>
        console.log('🔒 Composed guardrail blocked input:', error.getSummary()),
      onOutputBlocked: (error) =>
        console.log(
          '🔒 Composed guardrail blocked output:',
          error.getSummary(),
        ),
      throwOnBlocked: false,
    },
  );
  console.log(
    '✅ Composed guardrails result:',
    result.text.slice(0, 100) + '...',
  );
}

// ============================================================================
// PATTERN 6: STREAMING WITH GUARDRAILS (Real-time)
// ============================================================================

async function pattern6_StreamingGuardrails() {
  console.log('\n🌊 Pattern 6: Streaming Guardrails');
  console.log('==================================');

  console.log('Starting streaming with real-time guardrails...');

  const streamResult = await streamTextWithGuardrails(
    {
      model,
      prompt: 'Explain how to build a secure web application',
    },
    {
      outputGuardrails: [
        outputLengthLimit(500),
        blockedOutputContent(['password', 'secret']),
      ],
      onOutputBlocked: (error) => {
        console.log('\n⏸️ Stream blocked:', error.reason);
      },
      throwOnBlocked: false,
    },
  );

  let streamContent = '';
  const reader = streamResult.textStream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      process.stdout.write(value);
      streamContent += value;
    }
  } catch (error) {
    console.log('\n🚫 Stream was interrupted:', (error as Error).message);
  } finally {
    reader.releaseLock();
  }

  console.log('\n✅ Stream completed, total length:', streamContent.length);
}

// ============================================================================
// MAIN DEMO
// ============================================================================

async function main() {
  console.log('🛡️  AI SDK Guardrails - Superior API Demo');
  console.log('==========================================');

  console.log('✨ Key advantages over OpenAI Agents JS:');
  console.log('- Zero-config defaults (no complex agent setup)');
  console.log('- No performance overhead (no separate agents)');
  console.log('- Universal support (works with any AI SDK function)');
  console.log('- Minimal boilerplate (much simpler API)');
  console.log('- Better composition (easy to combine guardrails)');
  console.log('- Streaming support (real-time guardrails)');
  console.log('- Better error handling (rich error objects)');

  try {
    await pattern1_OneGoUsage();
    await pattern2_ReusableGuardrails();
    await pattern3_PreConfiguredInstances();
    await pattern4_CustomGuardrails();
    await pattern5_Composition();
    await pattern6_StreamingGuardrails();

    console.log('\n🎉 All patterns completed successfully!');
    console.log(
      'This demonstrates our SUPERIOR developer experience over OpenAI Agents JS!',
    );
  } catch (error) {
    console.error('❌ Error in demo:', error as Error);
  }
}

// Run automatically
main().catch(console.error);
