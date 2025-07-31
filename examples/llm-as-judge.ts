/**
 * LLM-as-Judge Example - AI-Powered Quality Evaluation
 *
 * This example demonstrates using an LLM to evaluate the quality of AI responses.
 * The "judge" LLM analyzes responses for:
 * - On-topic relevance
 * - Helpfulness
 * - Overall quality (0-10 score)
 *
 * This ensures consistent quality standards across all AI interactions,
 * preventing low-quality responses from reaching users.
 */

import { generateText, generateObject } from 'ai';
import { z } from 'zod';
import { model } from './model';
import {
  defineOutputGuardrail,
  wrapWithOutputGuardrails,
} from '../src/guardrails';
import type {
  LanguageModelV2,
  OutputGuardrailContext,
  GuardrailResult,
} from '../src/types';
import { extractTextContent } from '../src/guardrails/input';
import { extractContent } from '../src/guardrails/output';
import { setupGracefulShutdown, safePrompt } from './utils/interactive-menu';

// Quality evaluation schema for the judge LLM
const JudgmentSchema = z.object({
  isOnTopic: z
    .boolean()
    .describe('Is the response relevant to the original question?'),
  isHelpful: z
    .boolean()
    .describe('Does the response provide useful information?'),
  qualityScore: z
    .number()
    .min(0)
    .max(10)
    .describe('Overall quality score from 0-10'),
  reasoning: z.string().describe('Explanation of the evaluation'),
  improvements: z
    .array(z.string())
    .optional()
    .describe('Suggested improvements'),
});

/**
 * Creates an LLM-as-Judge guardrail that evaluates response quality
 */
const createLlmJudgeGuardrail = (options: {
  qualityThreshold?: number;
  judgeModel?: LanguageModelV2;
  includeImprovements?: boolean;
}) => {
  const { qualityThreshold = 7, judgeModel = model } = options;

  return defineOutputGuardrail({
    name: 'llm-judge',
    description: 'Uses LLM to evaluate response quality and helpfulness',
    execute: async (context: OutputGuardrailContext) => {
      const { text } = extractContent(context.result);
      const { prompt: originalPrompt } = extractTextContent(context.input);

      if (!text || !originalPrompt) {
        return {
          tripwireTriggered: false,
          message: 'Skipped judgment - insufficient content',
        };
      }

      try {
        console.log('🤖 LLM Judge evaluating response quality...');

        const judgmentResult = await generateObject({
          model: judgeModel,
          schema: JudgmentSchema,
          messages: [
            {
              role: 'system',
              content: `You are an expert quality evaluator. Analyze the AI response for:
              
1. RELEVANCE: Does it directly address the original question?
2. HELPFULNESS: Does it provide useful, actionable information?  
3. QUALITY: Is it well-structured, accurate, and comprehensive?

Score from 0-10 where:
- 0-3: Poor (off-topic, unhelpful, or very low quality)
- 4-6: Average (somewhat helpful but could be better)
- 7-8: Good (helpful and well-structured)
- 9-10: Excellent (exceptionally helpful and high quality)

Be strict but fair in your evaluation.`,
            },
            {
              role: 'user',
              content: `Original Question: "${originalPrompt}"

AI Response: "${text}"

Evaluate this response:`,
            },
          ],
        });

        const judgment = judgmentResult.object;
        const meetsQualityStandard =
          judgment.isOnTopic &&
          judgment.isHelpful &&
          judgment.qualityScore >= qualityThreshold;

        return {
          tripwireTriggered: !meetsQualityStandard,
          message: meetsQualityStandard
            ? `✅ Quality approved (${judgment.qualityScore}/10): ${judgment.reasoning}`
            : `❌ Quality below threshold (${judgment.qualityScore}/10): ${judgment.reasoning}`,
          severity: meetsQualityStandard ? 'low' : 'high',
          suggestion:
            judgment.improvements?.join('; ') ||
            'Consider regenerating with more specific guidance',
          metadata: {
            judgment,
            qualityThreshold,
            meetsStandard: meetsQualityStandard,
          },
        };
      } catch (error) {
        console.error('❌ LLM Judge evaluation failed:', error);
        return {
          tripwireTriggered: true,
          message: 'Quality evaluation failed - defaulting to block',
          severity: 'medium',
          metadata: { error: (error as Error).message },
        };
      }
    },
  });
};

// Example 1: LLM-as-Judge Quality Thresholds - Blocking vs Warning Demo
async function example1_QualityThresholds() {
  console.log(
    '\n=== LLM-as-Judge Quality Thresholds - Blocking vs Warning ===',
  );

  const testPrompts = [
    {
      prompt: 'What is the capital of France?',
      expectation: 'Simple factual question - should pass quality checks',
    },
    {
      prompt: 'How do I fix my broken code?', // Vague question
      expectation: 'Vague question - may trigger quality issues',
    },
    {
      prompt: 'Explain quantum computing in simple terms',
      expectation: 'Complex but well-defined question - should pass',
    },
  ];

  // DEMO 1: BLOCKING MODE - Strict Quality Enforcement
  console.log('\n🚫 DEMO 1: BLOCKING MODE (throwOnBlocked: true)');
  console.log('===============================================');
  console.log(
    'Low-quality responses are rejected - no response returned to user\n',
  );

  for (const testCase of testPrompts) {
    console.log(`\n📋 BLOCKING TEST: ${testCase.expectation}`);
    console.log(`💬 Question: "${testCase.prompt}"`);
    console.log(
      'Expected: High-quality response passes, low-quality is BLOCKED\n',
    );

    // Strict threshold (8/10) with blocking
    const strictBlockingJudge = createLlmJudgeGuardrail({
      qualityThreshold: 8,
      includeImprovements: true,
    });

    const blockingModel = wrapWithOutputGuardrails(
      model,
      [strictBlockingJudge],
      {
        throwOnBlocked: true, // BLOCKS low-quality responses
        onOutputBlocked: (results: GuardrailResult[]) => {
          console.log(
            '🚫 BLOCKED: Low-quality response rejected -',
            results[0]?.message,
          );
          if (results[0]?.suggestion) {
            console.log('�� Improvement needed:', results[0].suggestion);
          }
        },
      },
    );

    try {
      const result = await generateText({
        model: blockingModel,
        prompt: testCase.prompt,
      });

      console.log(
        '✅ SUCCESS: Response passed strict quality check and was returned',
      );
      console.log(`📄 High-quality response: ${result.text.slice(0, 100)}...`);
    } catch {
      console.log('🚫 SUCCESS: Low-quality response was BLOCKED as expected');
    }
  }

  // DEMO 2: WARNING MODE - Quality Monitoring
  console.log('\n⚠️  DEMO 2: WARNING MODE (throwOnBlocked: false)');
  console.log('===========================================');
  console.log(
    'Quality issues are logged but responses are still returned to user\n',
  );

  for (const testCase of testPrompts) {
    console.log(`\n📋 WARNING TEST: ${testCase.expectation}`);
    console.log(`💬 Question: "${testCase.prompt}"`);
    console.log(
      'Expected: All responses returned, quality warnings logged for issues\n',
    );

    // Same strict threshold (8/10) but with warnings
    const strictWarningJudge = createLlmJudgeGuardrail({
      qualityThreshold: 8,
      includeImprovements: true,
    });

    const warningModel = wrapWithOutputGuardrails(model, [strictWarningJudge], {
      throwOnBlocked: false, // WARNS but returns response
      onOutputBlocked: (results: GuardrailResult[]) => {
        console.log(
          '⚠️  WARNED: Quality concern detected but returning response -',
          results[0]?.message,
        );
        if (results[0]?.suggestion) {
          console.log('💡 Consider improvement:', results[0].suggestion);
        }
      },
    });

    try {
      const result = await generateText({
        model: warningModel,
        prompt: testCase.prompt,
      });

      console.log(
        '✅ SUCCESS: Response returned regardless of quality assessment',
      );
      console.log(`📄 Response provided: ${result.text.slice(0, 100)}...`);
    } catch (error) {
      console.log(
        '❌ UNEXPECTED: Warning mode should not throw -',
        (error as Error).message,
      );
    }
  }

  console.log('\n📋 LLM-AS-JUDGE SUMMARY:');
  console.log('=========================');
  console.log(
    '🚫 BLOCKING mode = Only high-quality responses reach users, low-quality is rejected',
  );
  console.log(
    '⚠️  WARNING mode = All responses reach users, quality monitoring provides insights',
  );
  console.log(
    '🎯 Best practice: Use BLOCKING for critical applications, WARNING for optimization',
  );
}

// Example 2: Business Quality Evaluation
async function example2_BusinessQuality() {
  console.log('\n💼 Business-Focused Quality Evaluation');
  console.log('=====================================');

  const businessJudge = defineOutputGuardrail({
    name: 'business-quality-judge',
    description: 'Evaluates responses for business communication standards',
    execute: async (context: OutputGuardrailContext) => {
      const { text } = extractContent(context.result);
      const { prompt } = extractTextContent(context.input);

      try {
        const businessEval = await generateObject({
          model,
          schema: z.object({
            isProfessional: z.boolean(),
            isActionable: z.boolean(),
            isComplete: z.boolean(),
            businessValue: z.number().min(0).max(10),
            concerns: z.array(z.string()),
          }),
          messages: [
            {
              role: 'system',
              content:
                "Evaluate this AI response for business communication. Check if it's professional, actionable, complete, and provides business value.",
            },
            {
              role: 'user',
              content: `Question: ${prompt}\nResponse: ${text}`,
            },
          ],
        });

        const evaluation = businessEval.object;
        const meetsBizStandards =
          evaluation.isProfessional &&
          evaluation.isActionable &&
          evaluation.businessValue >= 7;

        return {
          tripwireTriggered: !meetsBizStandards,
          message: meetsBizStandards
            ? `✅ Business-ready response (value: ${evaluation.businessValue}/10)`
            : `⚠️ Business concerns: ${evaluation.concerns.join(', ')}`,
          severity: meetsBizStandards ? 'low' : 'medium',
          metadata: { businessEvaluation: evaluation },
        };
      } catch {
        return {
          tripwireTriggered: false,
          message: 'Business evaluation skipped due to error',
        };
      }
    },
  });

  const businessModel = wrapWithOutputGuardrails(model, [businessJudge], {
    throwOnBlocked: false,
    onOutputBlocked: (results: GuardrailResult[]) => {
      console.log('📋 Business Quality Check:', results[0]?.message);
    },
  });

  const businessPrompts = [
    'How should we handle customer complaints?',
    "What's our pricing strategy?",
    'Tell me a joke',
  ];

  for (const prompt of businessPrompts) {
    console.log(`\n📝 Business Query: "${prompt}"`);

    try {
      const result = await generateText({
        model: businessModel,
        prompt,
        experimental_telemetry: {
          isEnabled: true,
          functionId: 'business-quality',
        },
      });

      if (result.text) {
        console.log('💼 Business evaluation completed');
      }
    } catch (error) {
      console.error('❌ Business evaluation failed:', (error as Error).message);
    }
  }
}

// Example 3: Combined LLM Judge Demo
async function example3_CombinedDemo() {
  console.log('\n=== Example 3: Combined LLM Judge Demo ===');
  console.log('Running both quality threshold and business evaluation demos');

  try {
    await example1_QualityThresholds();
    await example2_BusinessQuality();

    console.log('\n✅ Combined LLM-as-Judge demonstration completed!');
    console.log('\n💡 Key Benefits:');
    console.log('  • Automated quality control');
    console.log('  • Consistent evaluation standards');
    console.log('  • Detailed feedback for improvements');
    console.log('  • Prevents low-quality responses reaching users');
  } catch (error) {
    console.error('❌ Combined demo failed:', error);
  }
}

// Example registry
const EXAMPLES = [
  {
    name: 'LLM-as-Judge Quality Thresholds (Blocking vs Warning Demo)',
    fn: example1_QualityThresholds,
  },
  { name: 'Business Quality Evaluation', fn: example2_BusinessQuality },
  { name: 'Combined LLM Judge Demo', fn: example3_CombinedDemo },
];

// Interactive menu with Inquirer
async function showInteractiveMenu() {
  console.log('\n⚖️  LLM-as-Judge Quality Evaluation Examples');
  console.log('==========================================');
  console.log('Intelligent AI-powered quality evaluation and assessment\n');

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
    message: 'Select examples to run (use space bar to select):',
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

  console.log(`\n🚀 Running ${selectedExamples.length} selected examples...\n`);

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
    `\n🎉 All ${selectedExamples.length} selected examples completed!`,
  );
}

// Run all examples
async function runAllExamples() {
  console.log('\n🚀 Running all LLM-as-Judge examples...\n');

  try {
    for (const example of EXAMPLES) {
      console.log(`\n--- Running: ${example.name} ---`);
      await example.fn();
    }

    console.log('\n✅ All LLM-as-Judge examples completed successfully!');
    console.log('  • Demonstrated quality threshold evaluation');
    console.log('  • Showcased business-focused quality checks');
    console.log('  • Combined multiple evaluation approaches');
    console.log('  • Used LLM-powered content evaluation');
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
      console.log('⚖️  LLM-as-Judge Quality Evaluation Examples');
      console.log('==========================================');
      console.log('');
      console.log('Usage:');
      console.log('  tsx examples/llm-as-judge.ts [example_number]');
      console.log('');
      console.log('Arguments:');
      console.log(
        `  example_number    Run specific example (1-${EXAMPLES.length}), or omit for interactive mode`,
      );
      console.log('');
      console.log('Examples:');
      console.log('  tsx examples/llm-as-judge.ts        # Interactive mode');
      console.log(
        '  tsx examples/llm-as-judge.ts 1      # Run quality threshold demo',
      );
      console.log(
        '  tsx examples/llm-as-judge.ts 2      # Run business quality evaluation',
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

// Legacy function for backward compatibility
async function runLlmJudgeDemo() {
  await example3_CombinedDemo();
}

// Export for testing
export { main, createLlmJudgeGuardrail, JudgmentSchema, runLlmJudgeDemo };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    if (error?.name !== 'ExitPromptError') {
      console.error(error);
    }
  });
}
