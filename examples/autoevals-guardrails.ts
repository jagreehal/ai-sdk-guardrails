import { generateText, wrapLanguageModel } from 'ai';
import { model, MODEL_NAME } from './model';
import {
  createOutputGuardrailsMiddleware,
  defineOutputGuardrail,
} from '../src/guardrails';
import type { OutputGuardrailContext } from '../src/types';
import { extractTextContent } from '../src/guardrails/input';
import { extractContent } from '../src/guardrails/output';
import { Factuality, init } from 'autoevals';
import OpenAI from 'openai';
import inquirer from 'inquirer';
import { setupGracefulShutdown, safePrompt } from './utils/interactive-menu';

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

  const protectedModel = wrapLanguageModel({
    model,
    middleware: [
      createOutputGuardrailsMiddleware({
        outputGuardrails: [factualityGuardrail],
        throwOnBlocked: false,
        onOutputBlocked: (results) => {
          console.log(
            '❌ Response blocked for factuality:',
            results[0]?.message,
          );
          console.log(
            '📊 Factuality score:',
            results[0]?.metadata?.factualityScore,
          );
        },
      }),
    ],
  });

  console.log('🧪 Testing with correct answer...');
  try {
    const result = await generateText({
      model: protectedModel,
      prompt: 'Which country has the highest population? Answer in one word.',
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'factuality-correct',
        metadata: {
          example: 'autoevals-factuality',
          expectedAnswer: 'China',
        },
      },
    });

    if (result.text) {
      console.log('✅ Factual response passed:', result.text);
    } else {
      console.log('✅ Response was processed by factuality guardrail');
    }
  } catch (error) {
    console.error('❌ Error:', error);
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

  const protectedModel = wrapLanguageModel({
    model,
    middleware: [
      createOutputGuardrailsMiddleware({
        outputGuardrails: [factualityGuardrail],
        throwOnBlocked: true, // Will throw error when factuality check fails
      }),
    ],
  });

  console.log('🧪 Testing with unrelated question (expecting to be blocked)...');
  console.log('📝 Question: "Why do Italians not like pineapple on pizza?"');
  console.log('📝 Expected answer: "China" (intentional mismatch)');
  console.log('');
  
  try {
    const result = await generateText({
      model: protectedModel,
      prompt: 'Why do Italians not like pineapple on pizza?',
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'factuality-test-blocking',
        metadata: {
          example: 'autoevals-factuality-mismatch',
          expectedAnswer: 'China',
        },
      },
    });

    // This should not be reached if factuality check fails
    console.log('❌ UNEXPECTED: Response was not blocked:', result.text);
  } catch (error: any) {
    console.log('✅ Response correctly blocked by guardrail!');
    console.log('🛡️ Block reason:', error.message);
    if (error.details?.metadata) {
      console.log('📊 Factuality score:', error.details.metadata.factualityScore);
      console.log('💭 Rationale:', error.details.metadata.rationale);
    }
  }
}

// Example 3: Factuality Check with Non-Blocking (Logs Only)
async function example3_FactualityNonBlocking() {
  console.log(
    '\n=== Example 3: Factuality Check Non-Blocking (Logs Only) ===',
  );

  const factualityGuardrail = createFactualityGuardrail({
    expected: 'China',
    minScore: 0.4,
  });

  const protectedModel = wrapLanguageModel({
    model,
    middleware: [
      createOutputGuardrailsMiddleware({
        outputGuardrails: [factualityGuardrail],
        throwOnBlocked: false, // Only logs, doesn't block
        onOutputBlocked: (results) => {
          console.log('\n⚠️  GUARDRAIL TRIGGERED (Non-blocking mode):');
          console.log('   - Message:', results[0]?.message);
          console.log('   - Score:', results[0]?.metadata?.factualityScore);
          console.log('   - Rationale:', results[0]?.metadata?.rationale);
          console.log('   - Action: Response allowed through (non-blocking)\n');
        },
      }),
    ],
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
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'factuality-test-non-blocking',
        metadata: {
          example: 'autoevals-factuality-non-blocking',
          expectedAnswer: 'China',
        },
      },
    });

    if (result.text) {
      console.log('✅ Response allowed through (non-blocking):', result.text);
      console.log('ℹ️  Note: Check logs above for guardrail warnings');
    }
  } catch (error) {
    console.error('❌ Unexpected error:', error);
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

  const protectedModel = wrapLanguageModel({
    model,
    middleware: [
      createOutputGuardrailsMiddleware({
        outputGuardrails: [populationGuardrail, capitalGuardrail],
        throwOnBlocked: false,
        onOutputBlocked: (results) => {
          for (const result of results) {
            console.log(
              `❌ Blocked by ${result.context?.guardrailName}:`,
              result.message,
            );
          }
        },
      }),
    ],
  });

  // Test population question
  console.log('🧪 Testing population question...');
  try {
    const result1 = await generateText({
      model: protectedModel,
      prompt: 'What country has the most people? One word answer.',
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'multiple-factuality',
        metadata: {
          example: 'multiple-guardrails',
          guardrails: ['population-check', 'capital-check'],
        },
      },
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
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'multiple-factuality',
        metadata: {
          example: 'multiple-guardrails',
          guardrails: ['population-check', 'capital-check'],
        },
      },
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

  const protectedModel = wrapLanguageModel({
    model,
    middleware: [
      createOutputGuardrailsMiddleware({
        outputGuardrails: [responseQualityGuardrail],
        throwOnBlocked: false,
        onOutputBlocked: (results) => {
          const result = results[0];
          console.log('❌ Quality check failed:', result?.message);
          console.log('📊 Quality score:', result?.metadata?.qualityScore);
          console.log('💡 Suggestion:', result?.suggestion);
        },
      }),
    ],
  });

  console.log('🧪 Testing response quality evaluation...');
  try {
    const result = await generateText({
      model: protectedModel,
      prompt: 'Explain artificial intelligence in simple terms.',
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'quality-eval',
        metadata: {
          example: 'custom-evaluation',
          evaluationType: 'response-quality',
        },
      },
    });

    if (result.text) {
      console.log('✅ Quality response:', result.text.slice(0, 150) + '...');
    } else {
      console.log('✅ Response was processed by quality guardrail');
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Example registry
const EXAMPLES = [
  { name: 'Factuality Check (Correct Answer)', fn: example1_FactualityCorrect },
  {
    name: 'Factuality Check with Blocking (Throws Error)',
    fn: example2_FactualityIncorrect,
  },
  { name: 'Factuality Check Non-Blocking (Logs Only)', fn: example3_FactualityNonBlocking },
  { name: 'Multiple Factuality Guardrails', fn: example4_MultipleFactuality },
  { name: 'Custom Evaluation Logic', fn: example5_CustomEvaluation },
];

// Interactive menu with Inquirer
async function showInteractiveMenu() {
  console.clear();
  console.log('🤖  Autoevals + Guardrails Examples');
  console.log('==================================');
  console.log('AI quality evaluation as guardrails using v5 middleware');

  while (true) {
    // Clear terminal and wait for it to settle
    console.clear();
    await new Promise(resolve => setTimeout(resolve, 50));
    
    console.log('🤖  Autoevals + Guardrails Examples');
    console.log('==================================');
    console.log('AI quality evaluation as guardrails using v5 middleware');
    console.log(); // Single empty line before menu
    
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
    
    const result = await safePrompt<{ action: string | number }>({
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices,
      pageSize: 8,
      loop: false,
    });
    
    if (!result) return;
    const { action } = result;

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
      console.log('\n↩️  Returning to main menu...');
      await new Promise((resolve) => setTimeout(resolve, 1500)); // Brief pause
      console.clear(); // Clear screen before showing menu again
    }
  }
}

// Run multiple selected examples
async function runMultipleExamples() {
  const result = await safePrompt<{ selectedExamples: number[] }>({
    type: 'checkbox',
    name: 'selectedExamples',
    message: 'Select autoevals examples to run (use space bar to select):',
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
  
  if (!result) return;
  const { selectedExamples } = result;

  console.log(
    `\n🚀 Running ${selectedExamples.length} selected autoevals examples...\n`,
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
    `\n🎉 All ${selectedExamples.length} selected autoevals examples completed!`,
  );
}

// Run all examples
async function runAllExamples() {
  console.log('\n🚀 Running all autoevals examples...\n');

  try {
    for (const example of EXAMPLES) {
      console.log(`\n--- Running: ${example.name} ---`);
      await example.fn();
    }

    console.log('\n✅ All autoevals examples completed!');
    console.log('\n📚 Key Learnings:');
    console.log('  • throwOnBlocked: true  → Throws error, stops execution');
    console.log('  • throwOnBlocked: false → Logs warning, allows response through');
    console.log('  • Autoevals provides AI-powered factuality scoring');
    console.log('  • Custom evaluation logic can be implemented');
    console.log('  • Multiple guardrails can be chained together');
  } catch (error) {
    console.error('❌ Error running autoevals examples:', error);
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
      console.log('🤖  Autoevals + Guardrails Examples');
      console.log('==================================');
      console.log('');
      console.log('Usage:');
      console.log('  tsx examples/autoevals-guardrails.ts [example_number]');
      console.log('');
      console.log('Arguments:');
      console.log(
        `  example_number    Run specific example (1-${EXAMPLES.length}), or omit for interactive mode`,
      );
      console.log('');
      console.log('Examples:');
      console.log(
        '  tsx examples/autoevals-guardrails.ts        # Interactive mode',
      );
      console.log(
        '  tsx examples/autoevals-guardrails.ts 1      # Run factuality correct',
      );
      console.log(
        '  tsx examples/autoevals-guardrails.ts 2      # Run factuality blocking',
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
    if (error.name !== 'ExitPromptError') {
      console.error(error);
    }
    process.exit(1);
  });
}
