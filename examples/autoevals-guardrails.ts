import { model, MODEL_NAME } from './model';
import {
  createOutputGuardrail,
  generateTextWithGuardrails,
  GuardrailError,
} from '../src/core';
import { extractContent } from '../src/guardrails/output';
import { extractTextContent } from '../src/guardrails/input';
import { Factuality, init } from 'autoevals';
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama',
});

// @ts-expect-error - OpenAI is not typed correctly
init({ client });

function createFactualityGuardrail({
  expected,
  minScore,
}: {
  expected: string;
  minScore: number;
}) {
  return createOutputGuardrail('factuality-check', async (context) => {
    const { text } = extractContent(context.result);
    if (!text) {
      return {
        tripwireTriggered: true,
        message: 'No text to evaluate for factuality',
        severity: 'high',
      };
    }

    try {
      const { prompt } = extractTextContent(context.input);
      const factuallyPayload = {
        output: text,
        expected,
        input: prompt || '',
        model: MODEL_NAME,
      };

      console.log('🔍 Running factuality evaluation...', factuallyPayload);

      const evalResult = await Factuality(factuallyPayload);

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
  });
}

async function example1_FactualityCheck() {
  console.log('\n=== Example 1: Factuality Guardrail ===');

  const factualityGuardrail = createFactualityGuardrail({
    expected: 'China',
    minScore: 0.4,
  });

  // Test with correct answer
  console.log('\n🧪 Testing with correct answer...');
  try {
    const result1 = await generateTextWithGuardrails(
      {
        model,
        prompt: 'Which country has the highest population? Answer in one word.',
      },
      {
        outputGuardrails: [factualityGuardrail],
      },
    );
    console.log('✅ Factual response passed:', result1.text);
  } catch (error) {
    if (error instanceof GuardrailError) {
      console.log('❌ Response blocked:', error.reason);
    }
  }

  // Test with incorrect answer
  console.log('\n🧪 Testing with natural model response...');
  try {
    const result2 = await generateTextWithGuardrails(
      {
        model,
        prompt:
          'Which country had the smallest population? Answer in one word.',
      },
      {
        outputGuardrails: [factualityGuardrail], // Still expecting "China"
      },
    );
    console.log('✅ Response passed:', result2.text);
  } catch (error) {
    if (error instanceof GuardrailError) {
      console.log('❌ Response blocked for factuality:', error.reason);
    }
  }
}

async function main() {
  console.log('🤖 Autoevals + Guardrails Examples');
  console.log('==================================');
  console.log('Demonstrating AI quality evaluation as guardrails');

  try {
    await example1_FactualityCheck();

    console.log('\n✅ All autoevals example completed!');
  } catch (error) {
    console.error('❌ Error running examples:', error);
  }
}

// Run automatically
main().catch(console.error);
