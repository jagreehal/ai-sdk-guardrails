/**
 * Response Consistency Validation Example
 *
 * Demonstrates how to ensure AI responses are consistent across multiple
 * requests and maintain coherent information. This is critical for maintaining
 * trust and preventing contradictory information in conversational AI systems.
 */

import { generateText } from 'ai';
import { model } from './model';
import { defineOutputGuardrail, withGuardrails } from '../src/index';
import { extractContent } from '../src/guardrails/output';

// Define types for response consistency metadata
interface ResponseConsistencyMetadata extends Record<string, unknown> {
  topic?: string;
  contradictions?: string[];
  issues?: string[];
  factsExtracted?: number;
  historyChecked?: number;
}

// Store recent responses for consistency checking
const responseHistory: Array<{
  prompt: string;
  response: string;
  timestamp: number;
  topic: string;
  facts: string[];
}> = [];

// Extract key facts from a response
function extractKeyFacts(text: string): string[] {
  const facts: string[] = [];

  // Extract numbered facts or claims
  const numberedFacts = text.match(/\d+\.\s+[^.!?]+[.!?]/g) || [];
  facts.push(...numberedFacts.map((f) => f.replace(/^\d+\.\s+/, '').trim()));

  // Extract statements with "is", "are", "was", "were"
  const statements =
    text.match(/[A-Z][^.!?]*\b(is|are|was|were|has|have|had)\b[^.!?]+[.!?]/g) ||
    [];
  facts.push(...statements.map((s) => s.trim()));

  // Extract dates and numbers
  const dataPoints =
    text.match(
      /\b(\d{4}|\d+%|\$\d+|\d+\s+(years?|months?|days?|hours?))\b[^.!?]*[.!?]/g,
    ) || [];
  facts.push(...dataPoints.map((d) => d.trim()));

  return [...new Set(facts)]; // Remove duplicates
}

// Detect topic from prompt and response
function detectTopic(prompt: string, response: string): string {
  const text = `${prompt} ${response}`.toLowerCase();

  // Simple topic detection based on keywords
  const topics = {
    technology: [
      'ai',
      'computer',
      'software',
      'technology',
      'digital',
      'internet',
      'algorithm',
    ],
    science: [
      'science',
      'research',
      'experiment',
      'theory',
      'hypothesis',
      'discovery',
    ],
    health: [
      'health',
      'medical',
      'disease',
      'treatment',
      'medicine',
      'doctor',
      'patient',
    ],
    business: [
      'business',
      'company',
      'market',
      'economy',
      'finance',
      'investment',
      'profit',
    ],
    history: [
      'history',
      'historical',
      'past',
      'ancient',
      'century',
      'war',
      'civilization',
    ],
    environment: [
      'environment',
      'climate',
      'nature',
      'pollution',
      'ecosystem',
      'sustainability',
    ],
  };

  for (const [topic, keywords] of Object.entries(topics)) {
    if (keywords.some((keyword) => text.includes(keyword))) {
      return topic;
    }
  }

  return 'general';
}

// Check for contradictions between facts
function findContradictions(facts1: string[], facts2: string[]): string[] {
  const contradictions: string[] = [];

  for (const fact1 of facts1) {
    for (const fact2 of facts2) {
      // Check for numerical contradictions
      const num1 = fact1.match(/\d+/g);
      const num2 = fact2.match(/\d+/g);

      if (num1 && num2) {
        const similar1 = fact1.replaceAll(/\d+/g, 'X');
        const similar2 = fact2.replaceAll(/\d+/g, 'X');

        if (similar1 === similar2 && num1[0] !== num2[0]) {
          contradictions.push(`Number mismatch: "${fact1}" vs "${fact2}"`);
        }
      }

      // Check for opposite statements
      if (fact1.includes('not') !== fact2.includes('not')) {
        const normalized1 = fact1.replaceAll(/\bnot\b/g, '').trim();
        const normalized2 = fact2.replaceAll(/\bnot\b/g, '').trim();

        if (normalized1.toLowerCase() === normalized2.toLowerCase()) {
          contradictions.push(`Opposite claims: "${fact1}" vs "${fact2}"`);
        }
      }

      // Check for conflicting dates
      const date1 = fact1.match(/\b(19|20)\d{2}\b/);
      const date2 = fact2.match(/\b(19|20)\d{2}\b/);

      if (date1 && date2) {
        const context1 = fact1.replaceAll(/\b(19|20)\d{2}\b/g, 'YEAR');
        const context2 = fact2.replaceAll(/\b(19|20)\d{2}\b/g, 'YEAR');

        if (context1 === context2 && date1[0] !== date2[0]) {
          contradictions.push(`Date conflict: "${fact1}" vs "${fact2}"`);
        }
      }
    }
  }

  return contradictions;
}

// Calculate similarity between two strings (simple implementation)
function calculateSimilarity(str1: string, str2: string): number {
  const words1 = new Set(str1.toLowerCase().split(/\s+/));
  const words2 = new Set(str2.toLowerCase().split(/\s+/));

  const intersection = new Set([...words1].filter((x) => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

// Define the consistency validation guardrail
const consistencyValidationGuardrail =
  defineOutputGuardrail<ResponseConsistencyMetadata>({
    name: 'response-consistency',
    description: 'Validates response consistency with previous responses',
    execute: async (context) => {
      const { text } = extractContent(context.result);
      const { prompt } = context.input as { prompt: string };

      // Extract facts and detect topic
      const currentFacts = extractKeyFacts(text);
      const currentTopic = detectTopic(prompt, text);

      // Check consistency with recent responses on the same topic
      const relevantHistory = responseHistory.filter(
        (entry) =>
          entry.topic === currentTopic &&
          Date.now() - entry.timestamp < 3_600_000, // Within last hour
      );

      const issues: string[] = [];
      const contradictions: string[] = [];

      for (const historical of relevantHistory) {
        // Check for contradictions
        const foundContradictions = findContradictions(
          currentFacts,
          historical.facts,
        );
        contradictions.push(...foundContradictions);

        // Check for similar prompts with very different responses
        const promptSimilarity = calculateSimilarity(prompt, historical.prompt);
        const responseSimilarity = calculateSimilarity(
          text,
          historical.response,
        );

        if (promptSimilarity > 0.8 && responseSimilarity < 0.3) {
          issues.push(
            `Inconsistent response to similar prompt (similarity: ${promptSimilarity.toFixed(2)})`,
          );
        }
      }

      // Store current response for future consistency checks
      responseHistory.push({
        prompt,
        response: text,
        timestamp: Date.now(),
        topic: currentTopic,
        facts: currentFacts,
      });

      // Keep history size manageable
      if (responseHistory.length > 100) {
        responseHistory.shift();
      }

      // Determine if there are consistency issues
      if (contradictions.length > 0 || issues.length > 0) {
        return {
          tripwireTriggered: true,
          message: `Consistency issues detected: ${[...contradictions, ...issues].join('; ')}`,
          severity: contradictions.length > 0 ? 'high' : 'medium',
          metadata: {
            topic: currentTopic,
            contradictions,
            issues,
            factsExtracted: currentFacts.length,
            historyChecked: relevantHistory.length,
          },
        };
      }

      return {
        tripwireTriggered: false,
        metadata: {
          topic: currentTopic,
          contradictions: [],
          issues: [],
          factsExtracted: currentFacts.length,
          historyChecked: relevantHistory.length,
        },
      };
    },
  });

console.log('🔄 Response Consistency Validation Example\n');

// Create a protected model with consistency validation
const protectedModel = withGuardrails(model, {
  outputGuardrails: [consistencyValidationGuardrail],
  throwOnBlocked: false, // Use warning mode to see all issues
  onOutputBlocked: (executionSummary) => {
    const result = executionSummary.blockedResults[0];
    console.log('⚠️  Consistency Warning:', result?.message);
    if (result?.metadata) {
      const metadata = result.metadata;
      console.log('   Topic:', metadata.topic);
      if (metadata.contradictions && metadata.contradictions.length > 0) {
        console.log('   Contradictions found:');
        for (const c of metadata.contradictions) {
          console.log(`   - ${c}`);
        }
      }
    }
  },
});

// Test 1: First response (should pass, no history)
console.log('Test 1: Initial response about AI');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'When was artificial intelligence first invented?',
  });
  console.log('✅ Response:', result.text.slice(0, 150) + '...\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 2: Consistent follow-up
console.log('Test 2: Consistent follow-up question');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Tell me more about the history of artificial intelligence',
  });
  console.log('✅ Response:', result.text.slice(0, 150) + '...\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 3: Similar question (should maintain consistency)
console.log('Test 3: Similar question (checking consistency)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'What year was AI invented?',
  });
  console.log('✅ Response:', result.text.slice(0, 150) + '...\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 4: Different topic (should not trigger consistency check)
console.log('Test 4: Different topic (climate change)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'What are the main causes of climate change?',
  });
  console.log('✅ Response:', result.text.slice(0, 150) + '...\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 5: Return to original topic
console.log('Test 5: Return to AI topic (consistency check)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Who invented artificial intelligence?',
  });
  console.log('✅ Response:', result.text.slice(0, 150) + '...\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 6: Conflicting information request
console.log('Test 6: Testing with potentially conflicting prompt');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'I heard AI was invented in 1990, is that correct?',
  });
  console.log('✅ Response:', result.text.slice(0, 150) + '...\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Summary of consistency validation
console.log('📊 Consistency Validation Summary:');
console.log(`   Total responses tracked: ${responseHistory.length}`);
const topicCounts: Record<string, number> = {};
for (const entry of responseHistory) {
  topicCounts[entry.topic] = (topicCounts[entry.topic] || 0) + 1;
}
console.log(
  '   Topics discussed:',
  Object.entries(topicCounts)
    .map(([t, c]) => `${t} (${c})`)
    .join(', '),
);

console.log('\n🎯 Key Features:');
console.log('• Tracks response history by topic');
console.log('• Extracts key facts and claims');
console.log('• Detects contradictions in numbers and dates');
console.log('• Identifies opposite claims');
console.log('• Checks consistency for similar prompts');
console.log('• Maintains sliding window of recent responses');
console.log('• Topic-based clustering for relevant comparisons\n');
