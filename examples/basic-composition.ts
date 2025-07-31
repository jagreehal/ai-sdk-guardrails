/**
 * Basic Middleware Composition Example
 *
 * This example demonstrates the simplest way to use AI SDK Guardrails:
 * - Basic input validation to save money by blocking wasteful requests
 * - Basic output validation to ensure quality and prevent embarrassing responses
 * - Simple error handling and logging
 *
 * Perfect starting point for understanding how guardrails save costs and improve quality.
 */

import { generateText } from 'ai';
import { model } from './model';
import {
  defineInputGuardrail,
  defineOutputGuardrail,
  wrapWithGuardrails,
} from '../src/guardrails';
import type {
  InputGuardrailContext,
  OutputGuardrailContext,
  GuardrailResult,
} from '../src/types';
import { extractTextContent } from '../src/guardrails/input';
import { extractContent } from '../src/guardrails/output';
import { setupGracefulShutdown, safePrompt } from './utils/interactive-menu';

// ============================================================================
// MONEY-SAVING INPUT GUARDRAILS
// ============================================================================

/**
 * Blocks requests that would waste API costs on inappropriate content
 * Saves money by preventing calls that would likely be refused anyway
 */
const contentPolicyGuardrail = defineInputGuardrail({
  name: 'content-policy',
  description:
    'Blocks inappropriate content to save API costs and prevent issues',
  execute: async (params: InputGuardrailContext) => {
    const { prompt } = extractTextContent(params);

    // These requests often get refused by AI models, wasting your money
    const blockedKeywords = [
      'hack',
      'spam',
      'malware',
      'virus',
      'exploit',
      'phishing',
      'scam',
    ];

    if (typeof prompt === 'string') {
      const foundKeyword = blockedKeywords.find((keyword) =>
        prompt.toLowerCase().includes(keyword),
      );

      if (foundKeyword) {
        return {
          tripwireTriggered: true,
          message: `💰 Cost saved: Blocked "${foundKeyword}" - would likely be refused by AI model`,
          severity: 'high',
          suggestion:
            'Rephrase your request to focus on legitimate, constructive topics',
          metadata: {
            blockedKeyword: foundKeyword,
            costSaving: 'Prevented API call that would likely fail',
          },
        };
      }
    }

    return { tripwireTriggered: false };
  },
});

/**
 * Prevents very short requests that provide little value
 * Saves money by blocking "hello", "test", etc. that waste tokens
 */
const lengthValidationGuardrail = defineInputGuardrail({
  name: 'length-validation',
  description: 'Blocks too-short requests that waste API costs',
  execute: async (params: InputGuardrailContext) => {
    const { prompt } = extractTextContent(params);

    if (typeof prompt === 'string') {
      const minLength = 10;

      if (prompt.trim().length < minLength) {
        return {
          tripwireTriggered: true,
          message: `💸 Cost optimization: Request too short (${prompt.length} chars, min ${minLength})`,
          severity: 'medium',
          suggestion:
            'Please provide a more detailed request to get valuable AI assistance',
          metadata: {
            actualLength: prompt.length,
            minLength,
            estimatedSavings: '$0.01-$0.05 per blocked short request',
          },
        };
      }
    }

    return { tripwireTriggered: false };
  },
});

// ============================================================================
// QUALITY-ENSURING OUTPUT GUARDRAILS
// ============================================================================

/**
 * Ensures responses meet basic quality standards
 * Prevents embarrassingly short or long responses
 */
const outputQualityGuardrail = defineOutputGuardrail({
  name: 'output-quality',
  description:
    'Ensures responses meet quality standards - not too short or long',
  execute: async (context: OutputGuardrailContext) => {
    const { text } = extractContent(context.result);
    const minLength = 20; // Prevent useless short responses
    const maxLength = 800; // Prevent overwhelming long responses

    // Check if response is too short to be useful
    if (text.length < minLength) {
      return {
        tripwireTriggered: true,
        message: `🎯 Quality issue: Response too brief (${text.length} chars, min ${minLength})`,
        severity: 'medium',
        suggestion: 'Request a more detailed or comprehensive response',
        metadata: {
          actualLength: text.length,
          minLength,
          qualityIssue: 'insufficient_detail',
        },
      };
    }

    // Check if response is excessively long
    if (text.length > maxLength) {
      return {
        tripwireTriggered: true,
        message: `📏 Quality issue: Response too long (${text.length} chars, max ${maxLength})`,
        severity: 'medium',
        suggestion: 'Request a more concise, focused response',
        metadata: {
          actualLength: text.length,
          maxLength,
          qualityIssue: 'excessive_length',
        },
      };
    }

    return { tripwireTriggered: false };
  },
});

/**
 * Prevents responses that contain obvious placeholder text
 * Ensures users get complete, professional responses
 */
const completenessGuardrail = defineOutputGuardrail({
  name: 'completeness-check',
  description: 'Blocks incomplete responses with placeholder text',
  execute: async (context: OutputGuardrailContext) => {
    const { text } = extractContent(context.result);

    // Common indicators of incomplete or placeholder responses
    const placeholderIndicators = [
      '[insert',
      '[add',
      '[your',
      'TODO:',
      'FIXME:',
      '...',
      'etc.',
      'and so on',
    ];

    const foundPlaceholder = placeholderIndicators.find((indicator) =>
      text.toLowerCase().includes(indicator.toLowerCase()),
    );

    if (foundPlaceholder) {
      return {
        tripwireTriggered: true,
        message: `🚧 Quality issue: Incomplete response detected - "${foundPlaceholder}"`,
        severity: 'high',
        suggestion: 'Request a complete response without placeholder text',
        metadata: {
          placeholderFound: foundPlaceholder,
          qualityIssue: 'incomplete_response',
        },
      };
    }

    return { tripwireTriggered: false };
  },
});

// ============================================================================
// BASIC COMPOSITION - THE MONEY-SAVING, QUALITY-ENSURING MODEL
// ============================================================================

/**
 * Create a model that saves money and ensures quality with basic guardrails
 * This is the recommended starting configuration for most applications
 */
const createBasicProtectedModel = () => {
  return wrapWithGuardrails(model, {
    inputGuardrails: [contentPolicyGuardrail, lengthValidationGuardrail],
    outputGuardrails: [outputQualityGuardrail, completenessGuardrail],
    throwOnBlocked: false, // Log issues but don't crash
    onInputBlocked: (results: GuardrailResult[]) => {
      console.log('\n💰 INPUT BLOCKED - Money Saved:');
      for (const result of results) {
        console.log(
          `   ❌ ${result.context?.guardrailName}: ${result.message}`,
        );
        if (result.suggestion) {
          console.log(`   💡 ${result.suggestion}`);
        }
      }
    },
    onOutputBlocked: (results) => {
      console.log('\n🎯 OUTPUT FILTERED - Quality Maintained:');
      for (const result of results) {
        console.log(
          `   ❌ ${result.context?.guardrailName}: ${result.message}`,
        );
        if (result.suggestion) {
          console.log(`   💡 ${result.suggestion}`);
        }
      }
    },
  });
};

// ============================================================================
// DEMONSTRATION
// ============================================================================

async function demonstrateBasicComposition() {
  console.log('💡 Basic Composition Demo: Blocking vs Warning Modes');
  console.log('===================================================');

  // DEMO A: BLOCKING MODE - Complete Request Rejection
  console.log('\n🚫 DEMO A: BLOCKING MODE (throwOnBlocked: true)');
  console.log('==============================================');
  console.log(
    'When guardrails trigger: NO response generated, request is rejected\n',
  );

  const blockingModel = wrapWithGuardrails(model, {
    inputGuardrails: [contentPolicyGuardrail, lengthValidationGuardrail],
    outputGuardrails: [outputQualityGuardrail, completenessGuardrail],
    throwOnBlocked: true, // BLOCKS completely
    onInputBlocked: (results) => {
      console.log('🚫 BLOCKED: No response generated');
      for (const result of results) {
        console.log(
          `   ❌ ${result.context?.guardrailName}: ${result.message}`,
        );
      }
    },
    onOutputBlocked: (results) => {
      console.log('🚫 BLOCKED: Response quality insufficient');
      for (const result of results) {
        console.log(
          `   ❌ ${result.context?.guardrailName}: ${result.message}`,
        );
      }
    },
  });

  const blockingTests = [
    {
      name: 'Valid Professional Request',
      prompt:
        'Explain the benefits of automated testing in software development',
      expectation: '✅ Should PASS and generate response',
    },
    {
      name: 'Cost-Wasting Short Request',
      prompt: 'hi', // Under 10 chars - will trigger length validation
      expectation: '🚫 Should be BLOCKED - too short, wastes money',
    },
    {
      name: 'Inappropriate Content',
      prompt: 'How to hack into systems', // Contains "hack" - blocked keyword
      expectation: '🚫 Should be BLOCKED - inappropriate content',
    },
  ];

  for (const testCase of blockingTests) {
    console.log(`\n📋 BLOCKING TEST: ${testCase.name}`);
    console.log(`🔍 Expected: ${testCase.expectation}`);
    console.log(`💬 Prompt: "${testCase.prompt}"`);

    try {
      const result = await generateText({
        model: blockingModel,
        prompt: testCase.prompt,
      });

      console.log(
        `✅ SUCCESS: Response generated (${result.text.length} chars)`,
      );
      console.log(`📄 Preview: ${result.text.slice(0, 80)}...`);
    } catch {
      console.log(
        '🚫 SUCCESS: Request was BLOCKED as expected - no response generated',
      );
    }
  }

  // DEMO B: WARNING MODE - Log Issues But Continue
  console.log('\n⚠️  DEMO B: WARNING MODE (throwOnBlocked: false)');
  console.log('==============================================');
  console.log(
    'When guardrails trigger: WARNING logged but response still generated\n',
  );

  const warningModel = wrapWithGuardrails(model, {
    inputGuardrails: [contentPolicyGuardrail, lengthValidationGuardrail],
    outputGuardrails: [outputQualityGuardrail, completenessGuardrail],
    throwOnBlocked: false, // WARNS but continues
    onInputBlocked: (results) => {
      console.log('⚠️  WARNED: Issues detected but continuing with request');
      for (const result of results) {
        console.log(
          `   ⚠️  ${result.context?.guardrailName}: ${result.message}`,
        );
      }
    },
    onOutputBlocked: (results) => {
      console.log(
        '⚠️  WARNED: Response quality issues detected but returning response',
      );
      for (const result of results) {
        console.log(
          `   ⚠️  ${result.context?.guardrailName}: ${result.message}`,
        );
      }
    },
  });

  const warningTests = [
    {
      name: 'Valid Professional Request',
      prompt:
        'Explain the benefits of automated testing in software development',
      expectation: '✅ Should generate response normally, no warnings',
    },
    {
      name: 'Cost-Wasting Short Request',
      prompt: 'hi', // Under 10 chars - will trigger warning
      expectation: '⚠️  Should WARN about length but still generate response',
    },
    {
      name: 'Inappropriate Content',
      prompt: 'How to hack into systems', // Contains "hack" - will trigger warning
      expectation: '⚠️  Should WARN about content but still generate response',
    },
  ];

  for (const testCase of warningTests) {
    console.log(`\n📋 WARNING TEST: ${testCase.name}`);
    console.log(`🔍 Expected: ${testCase.expectation}`);
    console.log(`💬 Prompt: "${testCase.prompt}"`);

    try {
      const result = await generateText({
        model: warningModel,
        prompt: testCase.prompt,
      });

      console.log(
        `✅ SUCCESS: Response generated despite any warnings (${result.text.length} chars)`,
      );
      console.log(`📄 Preview: ${result.text.slice(0, 80)}...`);
    } catch (error) {
      console.log(
        '❌ UNEXPECTED: Warning mode should not throw errors -',
        (error as Error).message,
      );
    }
  }

  console.log('\n📊 COMPARISON SUMMARY:');
  console.log('========================');
  console.log('🚫 BLOCKING MODE (throwOnBlocked: true):');
  console.log(
    '   • Guardrail violations completely prevent response generation',
  );
  console.log('   • User gets no response when issues are detected');
  console.log('   • Strict enforcement of policies and quality standards');
  console.log(
    '   • Use when: Safety/compliance is critical, violations must be prevented',
  );
  console.log('');
  console.log('⚠️  WARNING MODE (throwOnBlocked: false):');
  console.log(
    '   • Guardrail violations are logged but responses still generated',
  );
  console.log(
    '   • User always gets a response, warnings help with monitoring',
  );
  console.log('   • Flexible approach that prioritizes user experience');
  console.log(
    '   • Use when: You want monitoring/logging but not strict enforcement',
  );
}

// Example registry
const EXAMPLES = [
  {
    name: 'Blocking vs Warning Demo (Cost Optimization + Quality)',
    fn: demonstrateBasicComposition,
  },
];

// Interactive menu with Inquirer
async function showInteractiveMenu() {
  console.log('\n🚀  Basic Middleware Composition Examples');
  console.log('=======================================');
  console.log('Save costs and ensure quality with simple guardrails\n');

  while (true) {
    const choices = [
      ...EXAMPLES.map((example, index) => ({
        name: `${index + 1}. ${example.name}`,
        value: index,
      })),
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
      pageSize: 5,
    });

    if (!response) return;
    const { action } = response;

    if (action === 'exit') {
      console.log('\n👋 Goodbye!');
      return;
    }

    if (typeof action === 'number') {
      const example = EXAMPLES[action];
      if (!example) continue;
      console.log(`\n🚀 Running: ${example.name}\n`);
      try {
        await example.fn();
        console.log(`\n✅ ${example.name} completed successfully!`);

        console.log('\n💰 Money-Saving Benefits:');
        console.log('  • Blocked wasteful short requests');
        console.log('  • Prevented inappropriate content calls');
        console.log('  • Saved API costs on requests that would likely fail');
        console.log('\n🎯 Quality Improvements:');
        console.log('  • Ensured responses meet length requirements');
        console.log('  • Blocked incomplete responses with placeholder text');
        console.log('  • Maintained professional standards');
        console.log(
          '\n🎉 Ready for production with basic cost optimization and quality assurance!',
        );
      } catch (error) {
        console.error(`❌ Error running ${example.name}:`, error);
      }
    }

    // Automatically return to main menu after running examples
    if (action !== 'exit') {
      console.log('\n↩️  Returning to main menu...\n');
      await new Promise((resolve) => setTimeout(resolve, 1500)); // Brief pause
    }
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
      console.log('🚀  Basic Middleware Composition Examples');
      console.log('=======================================');
      console.log('');
      console.log('Usage:');
      console.log('  tsx examples/basic-composition.ts [example_number]');
      console.log('');
      console.log('Arguments:');
      console.log(
        `  example_number    Run specific example (1-${EXAMPLES.length}), or omit for interactive mode`,
      );
      console.log('');
      console.log('Examples:');
      console.log(
        '  tsx examples/basic-composition.ts        # Interactive mode',
      );
      console.log(
        '  tsx examples/basic-composition.ts 1      # Run basic composition demo',
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

/**
 * Legacy function for backward compatibility
 */
async function runBasicCompositionDemo() {
  await demonstrateBasicComposition();
}

// Export for testing
export {
  main,
  contentPolicyGuardrail,
  lengthValidationGuardrail,
  outputQualityGuardrail,
  completenessGuardrail,
  createBasicProtectedModel,
  runBasicCompositionDemo,
};

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    if (error?.name !== 'ExitPromptError') {
      console.error(error);
    }
  });
}
