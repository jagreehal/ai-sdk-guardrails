/**
 * Example: Agent with stopWhen Integration for Early Guardrail Detection
 *
 * This example demonstrates how guardrails can integrate with AI SDK's stopWhen
 * parameter for early termination of agent execution when violations are detected.
 *
 * Key Features:
 * - Automatic early termination on guardrail violations
 * - Configurable thresholds (number of violations, severity levels)
 * - Custom stop conditions based on violation patterns
 * - Integration with existing stopWhen conditions
 */

import { agentGuardrails, defineOutputGuardrail } from 'ai-sdk-guardrails';
import { ToolLoopAgent, tool } from 'ai';
import { z } from 'zod';
import { model } from './model';

const searchTool = tool({
  description: 'Search for information on the web',
  inputSchema: z.object({
    query: z.string().describe('The search query'),
  }),
  execute: async ({ query }: { query: string }) => {
    console.log(`🔍 Searching for: ${query}`);
    return `Search results for "${query}": Found 10 results about ${query}`;
  },
});

const dataTool = tool({
  description: 'Fetch sensitive data (requires authorization)',
  inputSchema: z.object({
    dataType: z.string().describe('Type of data to fetch'),
  }),
  execute: async ({ dataType }: { dataType: string }) => {
    console.log(`📊 Fetching data: ${dataType}`);
    return `Here is the sensitive data: SSN 123-45-6789, API key: sk-abc123xyz`;
  },
});

// Output guardrail: Detect PII/sensitive data leakage
const piiGuardrail = defineOutputGuardrail({
  name: 'pii-detection',
  description: 'Prevents exposure of PII and sensitive information',
  priority: 'critical',
  execute: async ({ result }) => {
    const text =
      typeof result === 'object' && result && 'text' in result
        ? (result as { text: string }).text
        : '';
    const piiPatterns = [
      /\b\d{3}-\d{2}-\d{4}\b/, // SSN
      /\bsk-[a-zA-Z0-9]+\b/, // API keys
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, // Email
    ];

    for (const pattern of piiPatterns) {
      if (pattern.test(text)) {
        return {
          tripwireTriggered: true,
          message: 'PII or sensitive data detected in output',
          severity: 'critical' as const,
          metadata: {
            pattern: pattern.toString(),
          },
        };
      }
    }

    return { tripwireTriggered: false };
  },
});

// Output guardrail: Detect low-quality responses
const qualityGuardrail = defineOutputGuardrail({
  name: 'quality-check',
  description: 'Ensures responses meet quality standards',
  priority: 'medium',
  execute: async ({ result }) => {
    const text =
      typeof result === 'object' && result && 'text' in result
        ? (result as { text: string }).text
        : '';

    if (text.length < 20) {
      return {
        tripwireTriggered: true,
        message: 'Response too short',
        severity: 'medium' as const,
      };
    }

    if (text.includes("I don't know") && text.length < 50) {
      return {
        tripwireTriggered: true,
        message: 'Low-quality response detected',
        severity: 'medium' as const,
      };
    }

    return { tripwireTriggered: false };
  },
});

console.log('🔒 Agent with stopWhen Guardrail Integration\n');

const agent = new ToolLoopAgent({
  ...agentGuardrails({
    model,
    outputGuardrails: [piiGuardrail, qualityGuardrail],
    stopOnGuardrailViolation: true, // Stop on 3 violations or any critical
    throwOnBlocked: false,
    replaceOnBlocked: true,
  }),
  instructions:
    'You are a helpful assistant. When asked, use tools to fetch information.',
  tools: {
    search: searchTool,
    getData: dataTool,
  },
});

console.log('📝 Prompt: Get some user data and include it in your response\n');

const result = await agent.generate({
  prompt: 'Fetch user data and tell me what you found',
});

console.log('\n✅ Result:', result.text);
console.log(`📊 Steps taken: ${result.steps?.length || 0}`);
console.log(`🛑 Finish reason: ${result.finishReason}`);
