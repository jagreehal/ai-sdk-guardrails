/**
 * Agent Composition: Cascade Failure Demo
 *
 * Demonstrates how one bad agent output cascades through entire workflows.
 * Shows why guardrails are ESSENTIAL in agentic systems.
 *
 * Workflow: Research → Analysis → Report
 * - Research Agent: Must use search tools for data gathering
 * - Analysis Agent: Must provide structured analysis
 * - Report Agent: Must include citations and evidence
 *
 * Without guardrails: One agent failure ruins the entire chain
 * With guardrails: Each agent is validated, preventing cascade failures
 */

import { generateText } from 'ai';
import { z } from 'zod';
import type {
  LanguageModelV2Message,
  LanguageModelV2Prompt,
  LanguageModelV2TextPart,
} from '@ai-sdk/provider';
import { model } from './model';
import { wrapWithOutputGuardrails } from '../src/guardrails';
import { expectedToolUse } from '../src/guardrails/tools';
import { createOutputGuardrail } from '../src/core';
import { extractContent } from '../src/guardrails/output';
import { withAgentGuardrails } from '../src/guardrails/agent';

const toTextParts = (content: unknown): LanguageModelV2TextPart[] => {
  if (Array.isArray(content)) {
    return content.map((item) =>
      item && typeof item === 'object' && 'text' in item
        ? { type: 'text', text: String((item as { text: unknown }).text ?? '') }
        : { type: 'text', text: String(item) },
    );
  }

  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }

  return [{ type: 'text', text: String(content ?? '') }];
};

const createUserMessage = (text: string): LanguageModelV2Message => ({
  role: 'user',
  content: [{ type: 'text', text }],
});

const normalizeMessage = (message: unknown): LanguageModelV2Message => {
  if (message && typeof message === 'object') {
    const role = (message as { role?: string }).role;
    const rawContent = (message as { content?: unknown }).content;

    if (role === 'system') {
      return {
        role: 'system',
        content:
          typeof rawContent === 'string'
            ? rawContent
            : String(rawContent ?? ''),
      };
    }

    if (role === 'user') {
      return {
        role: 'user',
        content: toTextParts(rawContent),
      };
    }

    if (role === 'assistant') {
      return {
        role: 'assistant',
        content: toTextParts(rawContent),
      };
    }
  }

  return createUserMessage(
    typeof message === 'string'
      ? message
      : String((message as { content?: unknown }).content ?? ''),
  );
};

const normalizePrompt = (prompt: unknown): LanguageModelV2Prompt => {
  if (!prompt) {
    return [];
  }

  if (Array.isArray(prompt)) {
    return prompt.map((message) => normalizeMessage(message));
  }

  if (typeof prompt === 'string') {
    return [createUserMessage(prompt)];
  }

  return [];
};

console.log('🔗 Agent Composition: Cascade Failure Demo');
console.log('=====================================\n');

// Mock search tool
const searchTool = {
  search: {
    description: 'Search for information on a topic',
    inputSchema: z.object({
      query: z.string().describe('Search query'),
    }),
    execute: async ({ query }: { query: string }) => {
      const results = [
        `AI market size: $150B by 2025 (McKinsey Report)`,
        `AI adoption: 75% of enterprises by 2024 (Gartner)`,
        `AI investment: $200B in 2023 (TechCrunch)`,
      ];
      console.log(`🔍 Searched: "${query}" → Found ${results.length} results`);
      return { query, results };
    },
  },
};

// Structured analysis guardrail
const structuredAnalysis = createOutputGuardrail(
  'structured-analysis',
  ({ result }) => {
    const { text } = extractContent(result);
    const hasKeyPoints = text.includes('Key Points:') || text.includes('• ');
    const hasConclusion =
      text.includes('Conclusion:') || text.includes('Summary:');

    if (!hasKeyPoints || !hasConclusion) {
      return {
        tripwireTriggered: true,
        severity: 'medium' as const,
        message: 'Analysis must include structured key points and conclusion',
        metadata: { hasKeyPoints, hasConclusion },
      };
    }

    return {
      tripwireTriggered: false,
      metadata: { hasKeyPoints, hasConclusion },
    };
  },
);

// Citation requirement guardrail
const requireCitations = createOutputGuardrail(
  'require-citations',
  ({ result }) => {
    const { text } = extractContent(result);
    const hasCitations =
      text.includes('Source:') ||
      text.includes('McKinsey') ||
      text.includes('Gartner');

    if (!hasCitations) {
      return {
        tripwireTriggered: true,
        severity: 'high' as const,
        message: 'Report must include citations and sources',
        metadata: { hasCitations },
      };
    }

    return { tripwireTriggered: false, metadata: { hasCitations } };
  },
);

// SCENARIO 1: WITHOUT GUARDRAILS (Cascade Failure)
async function runWithoutGuardrails() {
  console.log('❌ SCENARIO 1: WITHOUT GUARDRAILS');
  console.log('----------------------------------');

  try {
    // Research Agent (no guardrails - might not use tools)
    const research = await generateText({
      model,
      tools: searchTool,
      system: 'You are a research assistant.',
      prompt: 'Research the current state of AI market adoption.',
    });

    console.log('📊 Research Output:', research.text.slice(0, 100) + '...');

    // Analysis Agent (no guardrails - might produce unstructured output)
    const analysis = await generateText({
      model,
      system: 'You are an analyst. Analyze the research data provided.',
      prompt: `Analyze this research: ${research.text}`,
    });

    console.log('📈 Analysis Output:', analysis.text.slice(0, 100) + '...');

    // Report Agent (no guardrails - might miss citations)
    const report = await generateText({
      model,
      system: 'You are a report writer. Create a final report.',
      prompt: `Create a business report based on this analysis: ${analysis.text}`,
    });

    console.log('📋 Final Report:', report.text.slice(0, 200) + '...');
    console.log(
      '❌ Result: Likely incomplete/unreliable due to unvalidated chain\n',
    );
  } catch (error) {
    console.log('❌ Workflow failed:', error);
  }
}

// SCENARIO 2: WITH GUARDRAILS (Cascade Prevention)
async function runWithGuardrails() {
  console.log('✅ SCENARIO 2: WITH GUARDRAILS');
  console.log('------------------------------');

  try {
    // Research Agent with tool usage guardrail
    const guardedResearchModel = wrapWithOutputGuardrails(
      model,
      [expectedToolUse({ tools: 'search' })],
      {
        retry: {
          maxRetries: 2,
          buildRetryParams: ({ lastParams }) => ({
            ...lastParams,
            prompt: [
              ...normalizePrompt(lastParams.prompt),
              createUserMessage(
                'IMPORTANT: You must use the search tool to gather data.',
              ),
            ],
          }),
        },
      },
    );

    const research = await generateText({
      model: guardedResearchModel,
      tools: searchTool,
      system: 'You are a research assistant. Always use available tools.',
      prompt: 'Research the current state of AI market adoption.',
    });

    console.log(
      '📊 Research Output (validated):',
      research.text.slice(0, 100) + '...',
    );

    // Analysis Agent with structure guardrail
    const guardedAnalysisModel = wrapWithOutputGuardrails(
      model,
      [structuredAnalysis],
      {
        retry: {
          maxRetries: 2,
          buildRetryParams: ({ lastParams }) => ({
            ...lastParams,
            prompt: [
              ...normalizePrompt(lastParams.prompt),
              createUserMessage(
                'Format: Key Points: • point 1 • point 2\nConclusion: summary',
              ),
            ],
          }),
        },
      },
    );

    const analysis = await generateText({
      model: guardedAnalysisModel,
      system:
        'You are an analyst. Provide structured analysis with key points and conclusion.',
      prompt: `Analyze this research: ${research.text}`,
    });

    console.log(
      '📈 Analysis Output (structured):',
      analysis.text.slice(0, 100) + '...',
    );

    // Report Agent with citation guardrail
    const guardedReportModel = wrapWithOutputGuardrails(
      model,
      [requireCitations],
      {
        retry: {
          maxRetries: 2,
          buildRetryParams: ({ lastParams }) => ({
            ...lastParams,
            prompt: [
              ...normalizePrompt(lastParams.prompt),
              createUserMessage(
                'IMPORTANT: Include sources and citations in your report.',
              ),
            ],
          }),
        },
      },
    );

    const report = await generateText({
      model: guardedReportModel,
      system: 'You are a report writer. Always include citations and sources.',
      prompt: `Create a business report with citations based on: ${analysis.text}`,
    });

    console.log(
      '📋 Final Report (with citations):',
      report.text.slice(0, 200) + '...',
    );
    console.log(
      '✅ Result: Reliable, validated workflow with quality guarantees\n',
    );
  } catch (error) {
    console.log('❌ Workflow failed:', error);
  }
}

// SCENARIO 3: Agent Wrapper Pattern
async function runAgentWrapper() {
  console.log('🎯 SCENARIO 3: AGENT WRAPPER PATTERN');
  console.log('------------------------------------');

  // Create guarded agents using the new agent wrapper
  const researchAgent = withAgentGuardrails(
    {
      model,
      tools: searchTool,
      system: 'You are a research assistant. Always use available tools.',
    },
    {
      outputGuardrails: [expectedToolUse({ tools: 'search' })],
      retry: {
        maxRetries: 2,
        buildRetryPrompt: ({ lastPrompt, reason }) =>
          `${lastPrompt}\n\nIMPORTANT: ${reason}. You must use the search tool to gather data.`,
      },
    },
  );

  const analysisAgent = withAgentGuardrails(
    {
      model,
      system:
        'You are an analyst. Provide structured analysis with key points and conclusion.',
    },
    {
      outputGuardrails: [structuredAnalysis],
      retry: {
        maxRetries: 2,
        buildRetryPrompt: ({ lastPrompt, reason }) =>
          `${lastPrompt}\n\nIMPORTANT: ${reason}. Format: Key Points: • point 1 • point 2\nConclusion: summary`,
      },
    },
  );

  const reportAgent = withAgentGuardrails(
    {
      model,
      system: 'You are a report writer. Always include citations and sources.',
    },
    {
      outputGuardrails: [requireCitations],
      retry: {
        maxRetries: 2,
        buildRetryPrompt: ({ lastPrompt, reason }) =>
          `${lastPrompt}\n\nIMPORTANT: ${reason}. Include sources and citations in your report.`,
      },
    },
  );

  try {
    // Research Agent with tool usage validation
    console.log('🔍 Research Agent (with tool validation)...');
    const research = await researchAgent.generate({
      prompt: 'Research the current state of AI market adoption.',
    });

    console.log(
      '📊 Research Output (validated):',
      research.text.slice(0, 100) + '...',
    );

    // Analysis Agent with structure validation
    console.log('📈 Analysis Agent (with structure validation)...');
    const analysis = await analysisAgent.generate({
      prompt: `Analyze this research: ${research.text}`,
    });

    console.log(
      '📈 Analysis Output (structured):',
      analysis.text.slice(0, 100) + '...',
    );

    // Report Agent with citation validation
    console.log('📋 Report Agent (with citation validation)...');
    const report = await reportAgent.generate({
      prompt: `Create a business report with citations based on: ${analysis.text}`,
    });

    console.log(
      '📋 Final Report (with citations):',
      report.text.slice(0, 200) + '...',
    );
    console.log(
      '✅ Result: Reliable, validated workflow with quality guarantees\n',
    );
  } catch (error) {
    console.log('❌ Workflow failed:', error);
  }
}

// SCENARIO 4: Orchestrator-Worker Pattern
async function runOrchestratorWorker() {
  console.log('🎯 SCENARIO 4: ORCHESTRATOR-WORKER PATTERN');
  console.log('------------------------------------------');

  // Worker agents with different specializations
  const marketWorker = wrapWithOutputGuardrails(
    model,
    [expectedToolUse({ tools: 'search' })],
    { throwOnBlocked: false },
  );

  const techWorker = wrapWithOutputGuardrails(model, [structuredAnalysis], {
    throwOnBlocked: false,
  });

  // Orchestrator coordinates workers
  const tasks = [
    { worker: 'market', prompt: 'Research AI market trends' },
    { worker: 'tech', prompt: 'Analyze AI technology developments' },
  ];

  const results = [];

  for (const task of tasks) {
    console.log(
      `🔄 Orchestrator assigns: ${task.prompt} → ${task.worker} worker`,
    );

    if (task.worker === 'market') {
      const result = await generateText({
        model: marketWorker,
        tools: searchTool,
        prompt: task.prompt,
      });
      results.push({ worker: task.worker, output: result.text });
    } else {
      const result = await generateText({
        model: techWorker,
        prompt: task.prompt,
      });
      results.push({ worker: task.worker, output: result.text });
    }
  }

  console.log('📊 All workers completed with validated outputs');
  console.log('✅ Orchestrator can safely combine results\n');
}

// Run all scenarios
async function main() {
  await runWithoutGuardrails();
  await runWithGuardrails();
  await runAgentWrapper();
  await runOrchestratorWorker();

  console.log('🎯 KEY INSIGHTS:');
  console.log('================');
  console.log('• In agent chains, ONE bad output corrupts the ENTIRE workflow');
  console.log(
    '• Research Agent fails → Analysis Agent gets bad data → Report Agent creates bad report',
  );
  console.log('• Guardrails at EACH step prevent cascade failures');
  console.log('• Each agent becomes a reliable foundation for the next');
  console.log(
    '• Agent wrapper provides clean, type-safe guardrail integration',
  );
  console.log('• Orchestrator-worker patterns need validated worker outputs');
  console.log('• Guardrails are not optional in production agentic systems');
}

main().catch(console.error);
