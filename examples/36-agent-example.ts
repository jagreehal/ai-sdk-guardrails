/**
 * Agent Class + Guardrails Example
 *
 * Demonstrates how guardrails work with the AI SDK Agent class for proper
 * agentic workflows with tool execution and loop control.
 *
 * - Output guardrail: ensures quality responses with proper length
 * - Agent loop control: allows multiple tool calls and iterations
 * - Tool usage: demonstrates search and analysis capabilities
 */

import { tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { model } from './model';
import {
  defineOutputGuardrail,
  wrapAgentWithGuardrails,
} from '../src/guardrails';
import { extractContent } from '../src/guardrails/output';

console.log('🤖 Agent Class + Guardrails Example');

// Define tools for the agent
const searchTool = tool({
  description:
    'Search for information on a topic and return results with sources',
  inputSchema: z.object({
    query: z.string().min(3).describe('Search query'),
  }),
  execute: async ({ query }: { query: string }) => {
    // Mock search results - in production, call your search API
    const results = [
      {
        title: 'Mount Everest - Wikipedia',
        url: 'https://en.wikipedia.org/wiki/Mount_Everest',
        snippet:
          "Mount Everest is Earth's highest mountain above sea level, located in the Mahalangur Himal sub-range of the Himalayas.",
      },
      {
        title: 'Highest Mountains in the World',
        url: 'https://www.nationalgeographic.com/mountains',
        snippet:
          'Mount Everest stands at 8,848 meters (29,029 feet) above sea level, making it the tallest peak on Earth.',
      },
    ];

    console.log(`🔎 Search executed for: "${query}"`);
    console.log(`   Found ${results.length} results`);

    return {
      query,
      results,
      totalResults: results.length,
    };
  },
});

const analysisTool = tool({
  description: 'Analyze search results and extract key information',
  inputSchema: z.object({
    searchResults: z.object({
      query: z.string(),
      results: z.array(
        z.object({
          title: z.string(),
          url: z.string(),
          snippet: z.string(),
        }),
      ),
      totalResults: z.number(),
    }),
  }),
  execute: async ({ searchResults }) => {
    console.log(`📊 Analyzing ${searchResults.totalResults} search results`);

    // Extract key information from results
    const keyInfo = {
      answer: searchResults.results[0]?.snippet || 'No information found',
      sources: searchResults.results.map((r) => ({
        title: r.title,
        url: r.url,
      })),
      confidence: searchResults.totalResults > 1 ? 'high' : 'medium',
    };

    console.log(`   Confidence: ${keyInfo.confidence}`);
    console.log(`   Sources: ${keyInfo.sources.length}`);

    return keyInfo;
  },
});

// Define guardrails for quality control
const qualityGuardrail = defineOutputGuardrail({
  name: 'response-quality',
  execute: async ({ result }) => {
    const { text } = extractContent(result);

    // Check minimum length
    if (text.length < 50) {
      return {
        tripwireTriggered: true,
        severity: 'medium' as const,
        message: 'Response too short - provide more detailed information',
      };
    }

    // Check for source citations
    const hasSources =
      text.includes('http') ||
      text.includes('Source:') ||
      text.includes('According to');
    if (!hasSources) {
      return {
        tripwireTriggered: true,
        severity: 'low' as const,
        message: 'Response should include source citations',
      };
    }

    return { tripwireTriggered: false };
  },
});

// Create an agent with guardrails at the Agent level
const researchAgent = wrapAgentWithGuardrails(
  {
    model,
    system: `You are an expert research assistant. Your job is to:

1. Use the search tool to find information
2. Use the analysis tool to process results
3. Provide comprehensive answers with proper citations
4. Always cite your sources

Be thorough and accurate in your research.`,
    tools: {
      search: searchTool,
      analyze: analysisTool,
    },
    stopWhen: stepCountIs(5), // Allow up to 5 steps for complex research
    toolChoice: 'auto', // Let the agent decide when to use tools
  },
  {
    outputGuardrails: [qualityGuardrail],
    throwOnBlocked: false,
    replaceOnBlocked: true,
    retry: {
      maxRetries: 2,
      buildRetryPrompt: ({ lastPrompt, reason }) =>
        `${lastPrompt}\n\nPlease provide a more detailed response with proper citations. Reason: ${reason}`,
    },
  },
);

console.log('🔬 Starting research task...\n');

// Example 1: Simple research question
const question1 = 'What is the tallest mountain in the world?';

try {
  const result1 = await researchAgent.generate({
    prompt: question1,
  });

  console.log('✅ Research Result:');
  console.log(result1.text);
  console.log(`\n📊 Steps taken: ${result1.steps.length}`);
  console.log(
    `🔧 Tools used: ${
      result1.steps.filter((step) =>
        step.content?.some((item) => item.type === 'tool-call'),
      ).length
    }`,
  );
} catch (error) {
  console.log('❌ Research failed:', error);
}

console.log('\n' + '='.repeat(60) + '\n');

// Example 2: More complex research with multiple steps
const question2 =
  'Compare Mount Everest and K2 - which is more dangerous to climb and why?';

try {
  const result2 = await researchAgent.generate({
    prompt: question2,
  });

  console.log('✅ Comparison Result:');
  console.log(result2.text);
  console.log(`\n📊 Steps taken: ${result2.steps.length}`);
  console.log(
    `🔧 Tools used: ${
      result2.steps.filter((step) =>
        step.content?.some((item) => item.type === 'tool-call'),
      ).length
    }`,
  );
} catch (error) {
  console.log('❌ Comparison failed:', error);
}

console.log('\n🎯 Agent + Guardrails Demo Complete!');
console.log('\nKey Features Demonstrated:');
console.log('• Agent class with proper tool execution');
console.log('• Loop control with stepCountIs');
console.log('• Quality guardrails with auto-retry');
console.log('• Multiple tool usage in sequence');
console.log('• Source citation requirements');
