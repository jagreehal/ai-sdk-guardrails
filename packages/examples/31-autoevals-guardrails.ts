import { generateText } from 'ai';
import { model, MODEL_NAME } from './model';
import { defineOutputGuardrail, withGuardrails } from 'ai-sdk-guardrails';
import type {
  OutputGuardrailContext,
  GuardrailExecutionSummary,
  OutputGuardrail,
} from '../src/types';
import { extractTextContent } from 'ai-sdk-guardrails/guardrails/input';
import { extractContent } from 'ai-sdk-guardrails/guardrails/output';
import { Factuality, init } from 'autoevals';
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama',
});

// @ts-expect-error - OpenAI is not typed correctly
init({ client });

// Factuality Guardrail using Autoevals
function createFactualityGuardrail({
  expected,
  minScore,
}: {
  expected: string;
  minScore: number;
}) {
  return defineOutputGuardrail({
    name: 'factuality-check',
    description: 'Evaluates factual accuracy using Autoevals',
    execute: async (context: OutputGuardrailContext) => {
      const { text } = extractContent(context.result);

      if (!text) {
        return {
          tripwireTriggered: true,
          message: 'No text to evaluate for factuality',
          severity: 'high',
        };
      }

      try {
        // Extract prompt from input context
        const { prompt } = extractTextContent(context.input);

        const factualityPayload = {
          output: text,
          expected,
          input: prompt || '',
          model: MODEL_NAME,
        };

        console.log('🔍 Running factuality evaluation...', {
          expected,
          minScore,
          outputLength: text.length,
        });

        const evalResult = await Factuality(factualityPayload);

        console.log(`📊 Factuality score: ${evalResult.score}`);
        console.log(
          `💭 Rationale: ${evalResult.metadata?.rationale || 'No rationale provided'}`,
        );

        const isFactual = (evalResult.score || 0) >= minScore;

        return {
          tripwireTriggered: !isFactual,
          message: isFactual
            ? `Factual content (score: ${evalResult.score})`
            : `Factual accuracy too low (score: ${evalResult.score}, required: ${minScore})`,
          severity: isFactual ? 'low' : 'high',
          metadata: {
            factualityScore: evalResult.score,
            rationale: evalResult.metadata?.rationale,
            expected,
            minScore,
          },
          suggestion: isFactual
            ? undefined
            : 'Please provide more accurate information',
        };
      } catch (error) {
        console.error('❌ Factuality evaluation error:', error);
        return {
          tripwireTriggered: true,
          message: `Factuality evaluation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          severity: 'high',
        };
      }
    },
  });
}

// Example 1: Factuality Check with Correct Answer
async function example1_FactualityCorrect() {
  console.log('\n=== Example 1: Factuality Check (Correct Answer) ===');

  const factualityGuardrail = createFactualityGuardrail({
    expected: 'China',
    minScore: 0.4,
  });

  const protectedModel = withGuardrails(model, {
    outputGuardrails: [factualityGuardrail],
    throwOnBlocked: false,
    onOutputBlocked: (executionSummary: GuardrailExecutionSummary) => {
      const blockedResult = executionSummary.blockedResults[0];
      console.log(
        '❌ Response blocked for factuality:',
        blockedResult?.message,
      );
      console.log(
        '📊 Factuality score:',
        blockedResult?.metadata?.factualityScore,
      );
    },
  });

  console.log('🧪 Testing with correct answer...');
  try {
    const result = await generateText({
      model: protectedModel,
      prompt: 'Which country has the highest population? Answer in one word.',
    });

    if (result.text) {
      console.log('✅ Factual response passed:', result.text);
    } else {
      console.log('✅ Response was processed by factuality guardrail');
    }
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

// Example 2: Factuality Check with Blocking (Throws Error)
async function example2_FactualityIncorrect() {
  console.log(
    '\n=== Example 2: Factuality Check with Blocking (Different Question) ===',
  );

  const factualityGuardrail = createFactualityGuardrail({
    expected: 'China', // Still expecting China
    minScore: 0.4,
  });

  const protectedModel = withGuardrails(model, {
    outputGuardrails: [factualityGuardrail],
    throwOnBlocked: true, // Will throw error when factuality check fails
  });

  console.log(
    '🧪 Testing with unrelated question (expecting to be blocked)...',
  );
  console.log('📝 Question: "Why do Italians not like pineapple on pizza?"');
  console.log('📝 Expected answer: "China" (intentional mismatch)');
  console.log('');

  try {
    const result = await generateText({
      model: protectedModel,
      prompt: 'Why do Italians not like pineapple on pizza?',
    });

    // This should not be reached if factuality check fails
    console.log('❌ UNEXPECTED: Response was not blocked:', result.text);
  } catch (error: unknown) {
    console.log('✅ Response correctly blocked by guardrail!');
    console.log(
      '🛡️ Block reason:',
      error instanceof Error ? error.message : String(error),
    );
  }
}

// Example 3: Factuality Check with Non-Blocking (Logs Only)
async function example3_FactualityNonBlocking() {
  console.log('\n=== Example 3: Factuality Check Non-Blocking (Logs Only) ===');

  const factualityGuardrail = createFactualityGuardrail({
    expected: 'China',
    minScore: 0.4,
  });

  const protectedModel = withGuardrails(model, {
    outputGuardrails: [factualityGuardrail],
    throwOnBlocked: false, // Only logs, doesn't block
    onOutputBlocked: (executionSummary: GuardrailExecutionSummary) => {
      const blockedResult = executionSummary.blockedResults[0];
      console.log('\n⚠️  GUARDRAIL TRIGGERED (Non-blocking mode):');
      console.log('   - Message:', blockedResult?.message);
      console.log('   - Score:', blockedResult?.metadata?.factualityScore);
      console.log('   - Rationale:', blockedResult?.metadata?.rationale);
      console.log('   - Action: Response allowed through (non-blocking)\n');
    },
  });

  console.log('🧪 Testing non-blocking mode...');
  console.log('📝 Question: "What is the capital of France?"');
  console.log('📝 Expected answer: "China" (intentional mismatch)');
  console.log('📝 Mode: Non-blocking (logs warnings but allows response)');
  console.log('');

  try {
    const result = await generateText({
      model: protectedModel,
      prompt: 'What is the capital of France? Answer in one word.',
    });

    if (result.text) {
      console.log('✅ Response allowed through (non-blocking):', result.text);
      console.log('ℹ️  Note: Check logs above for guardrail warnings');
    }
  } catch (error) {
    console.error('❌ Unexpected error:', error);
    throw error;
  }
}

// Example 4: Multiple Factuality Checks
async function example4_MultipleFactuality() {
  console.log('\n=== Example 4: Multiple Factuality Guardrails ===');

  const populationGuardrail = createFactualityGuardrail({
    expected: 'China',
    minScore: 0.6,
  });

  const capitalGuardrail = defineOutputGuardrail({
    name: 'capital-city-check',
    description: 'Checks if capital city answers are reasonable',
    execute: async (context: OutputGuardrailContext) => {
      const { text } = extractContent(context.result);
      const commonCapitals = [
        'london',
        'paris',
        'tokyo',
        'beijing',
        'washington',
        'berlin',
        'rome',
      ];

      const hasCapital = commonCapitals.some((capital) =>
        text.toLowerCase().includes(capital),
      );

      if (!hasCapital && text.length > 0) {
        return {
          tripwireTriggered: true,
          message: 'Response does not contain a recognized capital city',
          severity: 'medium',
          suggestion: 'Please provide a valid capital city name',
        };
      }

      return { tripwireTriggered: false };
    },
  });

  const protectedModel = withGuardrails(model, {
    outputGuardrails: [
      populationGuardrail,
      capitalGuardrail,
    ] as OutputGuardrail<Record<string, unknown>>[],
    throwOnBlocked: false,
    onOutputBlocked: (executionSummary: GuardrailExecutionSummary) => {
      for (const result of executionSummary.blockedResults) {
        console.log(
          `❌ Blocked by ${result.context?.guardrailName}:`,
          result.message,
        );
      }
    },
  });

  // Test population question
  console.log('🧪 Testing population question...');
  try {
    const result1 = await generateText({
      model: protectedModel,
      prompt: 'What country has the most people? One word answer.',
    });

    if (result1.text) {
      console.log('✅ Population result:', result1.text);
    } else {
      console.log('✅ Population response processed by guardrails');
    }
  } catch (error) {
    console.error('❌ Population error:', error);
  }

  // Test capital question
  console.log('\n🧪 Testing capital question...');
  try {
    const result2 = await generateText({
      model: protectedModel,
      prompt: 'What is the capital of France? One word answer.',
    });

    if (result2.text) {
      console.log('✅ Capital result:', result2.text);
    } else {
      console.log('✅ Capital response processed by guardrails');
    }
  } catch (error) {
    console.error('❌ Capital error:', error);
  }
}

// Example 5: Custom Evaluation Guardrail
async function example5_CustomEvaluation() {
  console.log('\n=== Example 5: Custom Evaluation Logic ===');

  const responseQualityGuardrail = defineOutputGuardrail({
    name: 'response-quality',
    description: 'Evaluates response quality and completeness',
    execute: async (context: OutputGuardrailContext) => {
      const { text } = extractContent(context.result);

      // Simple quality checks
      const minLength = 10;
      const hasProperSentence =
        text.includes('.') || text.includes('!') || text.includes('?');
      const isNotTooShort = text.length >= minLength;
      const isNotEmpty = text.trim().length > 0;

      const qualityChecks = {
        hasProperSentence,
        isNotTooShort,
        isNotEmpty,
      };

      const passedChecks = Object.values(qualityChecks).filter(Boolean).length;
      const totalChecks = Object.keys(qualityChecks).length;
      const qualityScore = passedChecks / totalChecks;

      const isHighQuality = qualityScore >= 0.8;

      return {
        tripwireTriggered: !isHighQuality,
        message: isHighQuality
          ? `High quality response (score: ${qualityScore.toFixed(2)})`
          : `Low quality response (score: ${qualityScore.toFixed(2)})`,
        severity: isHighQuality ? 'low' : 'medium',
        metadata: {
          qualityScore,
          checks: qualityChecks,
          textLength: text.length,
        },
        suggestion: isHighQuality
          ? undefined
          : 'Response needs to be more complete and well-formed',
      };
    },
  });

  const protectedModel = withGuardrails(model, {
    outputGuardrails: [responseQualityGuardrail],
    throwOnBlocked: false,
    onOutputBlocked: (executionSummary: GuardrailExecutionSummary) => {
      const result = executionSummary.blockedResults[0];
      console.log('❌ Quality check failed:', result?.message);
      console.log('📊 Quality score:', result?.metadata?.qualityScore);
      console.log('💡 Suggestion:', result?.suggestion);
    },
  });

  console.log('🧪 Testing response quality evaluation...');
  try {
    const result = await generateText({
      model: protectedModel,
      prompt: 'Explain artificial intelligence in simple terms.',
    });

    if (result.text) {
      console.log('✅ Quality response:', result.text.slice(0, 150) + '...');
    } else {
      console.log('✅ Response was processed by quality guardrail');
    }
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

// Main execution
async function main() {
  console.log('🤖 Autoevals + Guardrails Examples');
  console.log('==================================');
  console.log('AI quality evaluation as guardrails using autoevals');
  console.log('');

  // Run all examples
  await example1_FactualityCorrect();
  await example2_FactualityIncorrect();
  await example3_FactualityNonBlocking();
  await example4_MultipleFactuality();
  await example5_CustomEvaluation();

  console.log('\n✅ All examples completed!');
  console.log('\n📚 Key Learnings:');
  console.log('  • throwOnBlocked: true  → Throws error, stops execution');
  console.log(
    '  • throwOnBlocked: false → Logs warning, allows response through',
  );
  console.log('  • Autoevals provides AI-powered factuality scoring');
  console.log('  • Custom evaluation logic can be implemented');
  console.log('  • Multiple guardrails can be chained together');
}

// Export for testing
export { main };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
