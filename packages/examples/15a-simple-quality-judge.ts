/**
 * Simple Quality Judge Example
 *
 * Basic demonstration of using an LLM to evaluate response quality.
 * This is a focused example showing the core concept simply.
 */

import { generateText } from 'ai';
import { model } from './model';
import { defineOutputGuardrail, withGuardrails } from 'ai-sdk-guardrails';
import { extractContent } from 'ai-sdk-guardrails/guardrails/output';

// Simple quality evaluation guardrail
const qualityJudgeGuardrail = defineOutputGuardrail<{
  qualityScore: number;
  passed: boolean;
  evaluatedText: string;
  judgeError?: string;
  fallbackApproved: boolean;
}>({
  name: 'quality-judge',
  description: 'Uses LLM to evaluate response quality',
  execute: async (context) => {
    const { text } = extractContent(context.result);

    // Skip evaluation for very short responses
    if (text.length < 10) {
      return {
        tripwireTriggered: false,
        metadata: {
          qualityScore: 10,
          passed: true,
          evaluatedText: text,
          fallbackApproved: false,
        },
      };
    }

    try {
      // Use the same model as a judge
      const judgmentResult = await generateText({
        model,
        prompt: `Rate this response on a scale of 1-10 for quality and helpfulness:

"${text}"

Respond with just a number (1-10):`,
      });

      // Extract the score
      const score = Number.parseInt(judgmentResult.text.trim());

      // Check if score is valid and acceptable
      if (Number.isNaN(score) || score < 6) {
        return {
          tripwireTriggered: true,
          message: `Response quality too low (score: ${Number.isNaN(score) ? 'invalid' : score}/10)`,
          severity: score < 4 ? 'high' : 'medium',
          metadata: {
            qualityScore: Number.isNaN(score) ? 0 : score,
            evaluatedText: text.slice(0, 100) + '...',
            passed: false,
            judgeError: undefined,
            fallbackApproved: false,
          },
        };
      }

      return {
        tripwireTriggered: false,
        metadata: {
          qualityScore: score,
          passed: true,
          evaluatedText: text.slice(0, 100) + '...',
          judgeError: undefined,
          fallbackApproved: false,
        },
      };
    } catch (error) {
      // If judge fails, allow the response but log the error
      return {
        tripwireTriggered: false,
        metadata: {
          qualityScore: 5, // Default neutral score
          passed: true, // Fallback approval
          evaluatedText: text.slice(0, 100) + '...',
          judgeError: (error as Error).message,
          fallbackApproved: true,
        },
      };
    }
  },
});

console.log('⚖️ Simple Quality Judge Example\n');

// Create a protected model with quality checking
const judgedModel = withGuardrails(model, {
  outputGuardrails: [qualityJudgeGuardrail],
  throwOnBlocked: false, // Warning mode
  onOutputBlocked: (executionSummary) => {
    const result = executionSummary.blockedResults[0];
    console.log('⚠️  Quality concern:', result?.message);
    if (result?.metadata?.qualityScore) {
      console.log(`   Score: ${result.metadata.qualityScore}/10`);
    }
  },
});

// Test 1: Good quality request
console.log('Test 1: Request for detailed explanation');
try {
  const result = await generateText({
    model: judgedModel,
    prompt: 'Explain the water cycle in a clear and informative way',
  });
  console.log('✅ Response evaluated by quality judge');
  console.log(`Response: ${result.text.slice(0, 150)}...\n`);
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
  throw error;
}

// Test 2: Request for brief response (might get low quality score)
console.log('Test 2: Request for very brief response');
try {
  const result = await generateText({
    model: judgedModel,
    prompt: 'Say just "yes" or "no" - nothing else',
  });
  console.log('✅ Response processed (check quality evaluation above)');
  console.log(`Response: "${result.text}"\n`);
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
  throw error;
}

// Test 3: Normal informational request
console.log('Test 3: Normal informational request');
try {
  const result = await generateText({
    model: judgedModel,
    prompt: 'What are three benefits of regular exercise?',
  });
  console.log('✅ Response evaluated');
  console.log(`Response: ${result.text.slice(0, 150)}...\n`);
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
  throw error;
}

console.log('🎯 Summary:');
console.log('• LLM judges provide automated quality assessment');
console.log('• Simple scoring system (1-10) is easy to understand');
console.log('• Fallback handling ensures reliability');
console.log('• Warning mode allows monitoring without blocking\n');
