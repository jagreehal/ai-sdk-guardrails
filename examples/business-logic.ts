/**
 * Business Logic Guardrails Example - Custom Rules for Your Organization
 *
 * This example demonstrates how to implement business-specific guardrails that:
 * - Save money by blocking requests during off-hours or for low-value work
 * - Enforce company standards and coding practices
 * - Ensure technical accuracy and professional communication
 * - Prevent embarrassing responses that don't meet business standards
 */

import { generateText, wrapLanguageModel } from 'ai';
import { model } from './model';
import {
  createInputGuardrailsMiddleware,
  createOutputGuardrailsMiddleware,
  defineInputGuardrail,
  defineOutputGuardrail,
} from '../src/guardrails';
import type {
  InputGuardrailContext,
  OutputGuardrailContext,
} from '../src/types';
import { extractTextContent } from '../src/guardrails/input';
import { extractContent } from '../src/guardrails/output';
import inquirer from 'inquirer';
import { setupGracefulShutdown, safePrompt } from './utils/interactive-menu';

// ============================================================================
// COST-SAVING BUSINESS RULES
// ============================================================================

/**
 * Saves API costs by blocking requests outside business hours
 * Prevents weekend/evening AI usage that may not be business-critical
 */
const businessHoursGuardrail = defineInputGuardrail({
  name: 'business-hours',
  description:
    'Blocks non-essential AI usage outside business hours to control costs',
  execute: async () => {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();

    const isBusinessHours = hour >= 9 && hour <= 17;
    const isWeekend = day === 0 || day === 6;
    const isHoliday = checkHoliday(now); // You can implement holiday checking

    if (!isBusinessHours || isWeekend || isHoliday) {
      return {
        tripwireTriggered: true,
        message: `💰 Cost Control: Service unavailable outside business hours (currently ${hour}:00${isWeekend ? ', weekend' : ''})`,
        severity: 'medium',
        suggestion:
          'For urgent requests, contact on-call support. Otherwise, try again during business hours (9 AM - 5 PM, Mon-Fri).',
        metadata: {
          currentHour: hour,
          isWeekend,
          isBusinessHours,
          estimatedSavings: '$0.05-$0.50 per blocked request',
        },
      };
    }

    return { tripwireTriggered: false };
  },
});

/**
 * Checks if current date is a company holiday
 * You can customize this with your organization's holiday calendar
 */
function checkHoliday(date: Date): boolean {
  // Example: Block on major holidays
  const holidays = [
    '2024-12-25', // Christmas
    '2024-01-01', // New Year
    '2024-07-04', // July 4th
    // Add your organization's holidays
  ];

  const dateString = date.toISOString().split('T')[0]!;
  return holidays.includes(dateString);
}

/**
 * Prevents low-quality code requests that waste AI capacity
 * Encourages best practices and proper solutions
 */
const codeQualityStandardsGuardrail = defineInputGuardrail({
  name: 'code-quality-standards',
  description: 'Blocks requests for quick fixes and promotes best practices',
  execute: async (params: InputGuardrailContext) => {
    const { prompt } = extractTextContent(params);

    if (typeof prompt === 'string') {
      const lowQualityPatterns = [
        'quick fix',
        'dirty hack',
        'temporary solution',
        'copy paste',
        'workaround',
        'band aid',
        'hot fix',
        'just make it work',
      ];

      const foundPatterns = lowQualityPatterns.filter((pattern) =>
        prompt.toLowerCase().includes(pattern),
      );

      if (foundPatterns.length > 0) {
        return {
          tripwireTriggered: true,
          message: `🏗️ Code Quality: Request promotes poor practices - "${foundPatterns[0]}" detected`,
          severity: 'medium',
          suggestion:
            'Please rephrase your request to ask for proper, maintainable solutions and best practices.',
          metadata: {
            detectedPatterns: foundPatterns,
            qualityStandard: 'enterprise-grade',
          },
        };
      }
    }

    return { tripwireTriggered: false };
  },
});

/**
 * Prevents requests for non-work related content during business hours
 * Saves money by ensuring AI is used for productive purposes
 */
const workFocusGuardrail = defineInputGuardrail({
  name: 'work-focus',
  description: 'Ensures AI usage is work-related during business hours',
  execute: async (params: InputGuardrailContext) => {
    const { prompt } = extractTextContent(params);

    if (typeof prompt === 'string') {
      const personalUsePatterns = [
        'joke',
        'funny',
        'recipe',
        'game',
        'entertainment',
        'vacation',
        'personal',
        'dating',
        'sports scores',
        'weather',
      ];

      const foundPersonalUse = personalUsePatterns.find((pattern) =>
        prompt.toLowerCase().includes(pattern),
      );

      // Only block during business hours
      const hour = new Date().getHours();
      const isBusinessHours = hour >= 9 && hour <= 17;

      if (foundPersonalUse && isBusinessHours) {
        return {
          tripwireTriggered: true,
          message: `💼 Work Focus: Personal use detected during business hours - "${foundPersonalUse}"`,
          severity: 'low',
          suggestion:
            'Please use AI for work-related tasks during business hours. Personal queries are welcome during breaks or after hours.',
          metadata: {
            personalPattern: foundPersonalUse,
            suggestion: 'Save personal queries for lunch break or after 5 PM',
          },
        };
      }
    }

    return { tripwireTriggered: false };
  },
});

// ============================================================================
// PROFESSIONAL OUTPUT STANDARDS
// ============================================================================

/**
 * Ensures responses meet professional communication standards
 * Prevents embarrassing informal responses in business contexts
 */
const professionalToneGuardrail = defineOutputGuardrail({
  name: 'professional-tone',
  description:
    'Ensures responses maintain professional business communication standards',
  execute: async (context: OutputGuardrailContext) => {
    const { text } = extractContent(context.result);

    const unprofessionalPhrases = [
      'lol',
      'lmao',
      'wtf',
      'omg',
      'ur',
      'u r',
      'gonna',
      'wanna',
      'dunno',
      'yeah right',
      'whatever',
    ];

    const foundUnprofessional = unprofessionalPhrases.filter((phrase) =>
      text.toLowerCase().includes(phrase),
    );

    if (foundUnprofessional.length > 0) {
      return {
        tripwireTriggered: true,
        message: `🎯 Professional Standards: Informal language detected - "${foundUnprofessional[0]}"`,
        severity: 'medium',
        suggestion: 'Please regenerate with professional business language.',
        metadata: {
          unprofessionalPhrases: foundUnprofessional,
          businessStandard: 'formal communication required',
        },
      };
    }

    return { tripwireTriggered: false };
  },
});

/**
 * Validates technical responses for accuracy and confidence
 * Prevents uncertain technical advice that could cause issues
 */
const technicalAccuracyGuardrail = defineOutputGuardrail({
  name: 'technical-accuracy',
  description: 'Validates technical responses for confidence and accuracy',
  execute: async (context: OutputGuardrailContext) => {
    const { text } = extractContent(context.result);

    const uncertaintyPhrases = [
      'i think',
      'maybe',
      'probably',
      'not sure',
      'might be',
      'could be',
      'i guess',
      'possibly',
      'perhaps',
    ];

    const foundUncertainty = uncertaintyPhrases.filter((phrase) =>
      text.toLowerCase().includes(phrase),
    );

    // Flag if too much uncertainty in technical response
    if (foundUncertainty.length > 2) {
      return {
        tripwireTriggered: true,
        message: `🔧 Technical Standards: High uncertainty detected (${foundUncertainty.length} uncertain phrases)`,
        severity: 'medium',
        suggestion:
          'Please request more specific technical guidance or verify the information independently.',
        metadata: {
          uncertaintyPhrases: foundUncertainty,
          confidenceLevel: 'low',
          recommendation: 'Seek additional technical verification',
        },
      };
    }

    // Check for dangerous technical advice
    const dangerousPhrases = [
      'delete everything',
      'rm -rf',
      'format the drive',
      'drop database',
      'sudo chmod 777',
    ];

    const foundDangerous = dangerousPhrases.find((phrase) =>
      text.toLowerCase().includes(phrase),
    );

    if (foundDangerous) {
      return {
        tripwireTriggered: true,
        message: `⚠️ Safety Alert: Potentially dangerous technical instruction detected - "${foundDangerous}"`,
        severity: 'critical',
        suggestion:
          'Review this instruction carefully and consider safer alternatives.',
        metadata: {
          dangerousCommand: foundDangerous,
          safetyLevel: 'critical review required',
        },
      };
    }

    return { tripwireTriggered: false };
  },
});

// ============================================================================
// BUSINESS MODEL CONFIGURATION
// ============================================================================

const businessStandardsModel = wrapLanguageModel({
  model,
  middleware: [
    createInputGuardrailsMiddleware({
      inputGuardrails: [
        businessHoursGuardrail,
        codeQualityStandardsGuardrail,
        workFocusGuardrail,
      ],
      throwOnBlocked: false,
      onInputBlocked: (results) => {
        console.log('\n📋 Business Policy Violations:');
        for (const result of results) {
          console.log(`❌ ${result.context?.guardrailName}: ${result.message}`);
          if (result.suggestion) {
            console.log(`💡 ${result.suggestion}`);
          }
        }
      },
    }),
    createOutputGuardrailsMiddleware({
      outputGuardrails: [professionalToneGuardrail, technicalAccuracyGuardrail],
      throwOnBlocked: false,
      onOutputBlocked: (results) => {
        console.log('\n🎯 Quality Standards Violations:');
        for (const result of results) {
          console.log(`❌ ${result.context?.guardrailName}: ${result.message}`);
        }
      },
    }),
  ],
});

// ============================================================================
// DEMONSTRATION SCENARIOS
// ============================================================================

async function testBusinessPolicies() {
  console.log('\n💼 Business Policy Guardrails: Blocking vs Warning Demo');
  console.log('========================================================');

  // DEMO 1: BLOCKING MODE - Strict Policy Enforcement
  console.log('\n🚫 DEMO 1: BLOCKING MODE (throwOnBlocked: true)');
  console.log('===============================================');
  console.log(
    'Violations completely block requests - no responses generated\n',
  );

  const blockingBusinessModel = wrapLanguageModel({
    model,
    middleware: [
      createInputGuardrailsMiddleware({
        inputGuardrails: [
          businessHoursGuardrail,
          codeQualityStandardsGuardrail,
          workFocusGuardrail,
        ],
        throwOnBlocked: true, // STRICT enforcement
        onInputBlocked: (results) => {
          console.log(
            '🚫 BLOCKED: Business policy violation - no response generated',
          );
          for (const result of results) {
            console.log(
              `   ❌ ${result.context?.guardrailName}: ${result.message}`,
            );
            if (result.suggestion) {
              console.log(`   💡 ${result.suggestion}`);
            }
          }
        },
      }),
      createOutputGuardrailsMiddleware({
        outputGuardrails: [
          professionalToneGuardrail,
          technicalAccuracyGuardrail,
        ],
        throwOnBlocked: true, // STRICT output standards
        onOutputBlocked: (results) => {
          console.log('🚫 BLOCKED: Output quality standards violation');
          for (const result of results) {
            console.log(
              `   ❌ ${result.context?.guardrailName}: ${result.message}`,
            );
          }
        },
      }),
    ],
  });

  const blockingTests = [
    {
      name: 'Professional Request',
      prompt: 'What are the best practices for database optimization?',
      expected: '✅ Should PASS - professional and work-related',
    },
    {
      name: 'Code Quality Standards Violation',
      prompt: 'Give me a quick fix for this database performance issue',
      expected: '🚫 Should be BLOCKED - promotes poor practices',
    },
    {
      name: 'Work Focus Violation (if business hours)',
      prompt: 'Tell me a funny joke about programming',
      expected: '🚫 May be BLOCKED if during business hours',
    },
  ];

  for (const testCase of blockingTests) {
    console.log(`\n📋 BLOCKING TEST: ${testCase.name}`);
    console.log(`🔍 Expected: ${testCase.expected}`);
    console.log(`💬 Prompt: "${testCase.prompt}"`);

    try {
      const result = await generateText({
        model: blockingBusinessModel,
        prompt: testCase.prompt,
      });

      console.log(
        `✅ SUCCESS: Business policy compliance - response generated (${result.text.length} chars)`,
      );
      console.log(`📄 Preview: ${result.text.slice(0, 80)}...`);
    } catch (error) {
      console.log(
        '🚫 SUCCESS: Business policy violation BLOCKED as expected - no response',
      );
    }
  }

  // DEMO 2: WARNING MODE - Flexible Monitoring
  console.log('\n⚠️  DEMO 2: WARNING MODE (throwOnBlocked: false)');
  console.log('=============================================');
  console.log('Policy violations logged but responses still generated\n');

  const warningBusinessModel = wrapLanguageModel({
    model,
    middleware: [
      createInputGuardrailsMiddleware({
        inputGuardrails: [
          businessHoursGuardrail,
          codeQualityStandardsGuardrail,
          workFocusGuardrail,
        ],
        throwOnBlocked: false, // WARN but continue
        onInputBlocked: (results) => {
          console.log(
            '⚠️  WARNED: Business policy concerns detected but continuing',
          );
          for (const result of results) {
            console.log(
              `   ⚠️  ${result.context?.guardrailName}: ${result.message}`,
            );
            if (result.suggestion) {
              console.log(`   💡 ${result.suggestion}`);
            }
          }
        },
      }),
      createOutputGuardrailsMiddleware({
        outputGuardrails: [
          professionalToneGuardrail,
          technicalAccuracyGuardrail,
        ],
        throwOnBlocked: false, // WARN about quality but return response
        onOutputBlocked: (results) => {
          console.log(
            '⚠️  WARNED: Output quality concerns but returning response',
          );
          for (const result of results) {
            console.log(
              `   ⚠️  ${result.context?.guardrailName}: ${result.message}`,
            );
          }
        },
      }),
    ],
  });

  const warningTests = [
    {
      name: 'Professional Request',
      prompt: 'What are the best practices for database optimization?',
      expected: '✅ Should generate response normally - no warnings',
    },
    {
      name: 'Code Quality Standards Issue',
      prompt: 'Give me a quick fix for this database performance issue',
      expected:
        '⚠️  Should WARN about poor practices but still provide response',
    },
    {
      name: 'Work Focus Issue (if business hours)',
      prompt: 'Tell me a funny joke about programming',
      expected: '⚠️  May WARN about work focus but still generate response',
    },
  ];

  for (const testCase of warningTests) {
    console.log(`\n📋 WARNING TEST: ${testCase.name}`);
    console.log(`🔍 Expected: ${testCase.expected}`);
    console.log(`💬 Prompt: "${testCase.prompt}"`);

    try {
      const result = await generateText({
        model: warningBusinessModel,
        prompt: testCase.prompt,
      });

      console.log(
        `✅ SUCCESS: Response generated despite any policy concerns (${result.text.length} chars)`,
      );
      console.log(`📄 Preview: ${result.text.slice(0, 80)}...`);
    } catch (error) {
      console.log(
        '❌ UNEXPECTED: Warning mode should not block -',
        (error as Error).message,
      );
    }
  }

  console.log('\n📊 BUSINESS POLICY SUMMARY:');
  console.log('============================');
  console.log('🚫 BLOCKING MODE:');
  console.log('   • Strict business policy enforcement');
  console.log('   • Policy violations completely prevent responses');
  console.log('   • Ensures 100% compliance with business standards');
  console.log('   • Use for: Critical compliance, sensitive environments');
  console.log('');
  console.log('⚠️  WARNING MODE:');
  console.log('   • Flexible business policy monitoring');
  console.log('   • Policy violations logged but responses provided');
  console.log('   • Balances compliance with user productivity');
  console.log(
    '   • Use for: Monitoring, gradual policy rollout, user guidance',
  );
}

// Example registry
const EXAMPLES = [
  {
    name: 'Business Policy Blocking vs Warning Demo',
    fn: testBusinessPolicies,
  },
];

// Interactive menu with Inquirer
async function showInteractiveMenu() {
  console.log('\n🏢  Business Logic Guardrails Examples');
  console.log('====================================');
  console.log('Cost control and professional standards for organizations\n');

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

        console.log('\n💰 Cost Savings Achieved:');
        console.log('  • Off-hours requests blocked');
        console.log('  • Non-work requests filtered during business time');
        console.log(
          '  • Low-quality code requests redirected to best practices',
        );
        console.log('\n🎯 Professional Standards Maintained:');
        console.log('  • Professional tone enforcement');
        console.log('  • Technical accuracy validation');
        console.log('  • Dangerous command detection');
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
      console.log('🏢  Business Logic Guardrails Examples');
      console.log('====================================');
      console.log('');
      console.log('Usage:');
      console.log('  tsx examples/business-logic.ts [example_number]');
      console.log('');
      console.log('Arguments:');
      console.log(
        `  example_number    Run specific example (1-${EXAMPLES.length}), or omit for interactive mode`,
      );
      console.log('');
      console.log('Examples:');
      console.log('  tsx examples/business-logic.ts        # Interactive mode');
      console.log(
        '  tsx examples/business-logic.ts 1      # Run business policy testing',
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
async function runBusinessLogicDemo() {
  await testBusinessPolicies();
}

// Export for testing
export {
  main,
  businessHoursGuardrail,
  codeQualityStandardsGuardrail,
  workFocusGuardrail,
  professionalToneGuardrail,
  technicalAccuracyGuardrail,
  businessStandardsModel,
  runBusinessLogicDemo,
};

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    if (error?.name !== 'ExitPromptError') {
      console.error(error);
    }
  });
}
