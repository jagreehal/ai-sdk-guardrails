/**
 * Blocking vs Warning Mode Example
 *
 * Demonstrates the difference between blocking mode (throws errors)
 * and warning mode (logs but continues) for guardrails.
 */

import { generateText } from 'ai';
import { model } from './model';
import { defineInputGuardrail, withGuardrails } from '../src/index';
import { extractTextContent } from '../src/guardrails/input';

// Define a simple guardrail for demonstration
const profanityGuardrail = defineInputGuardrail({
  name: 'profanity-filter',
  description: 'Filters mild profanity for family-friendly applications',
  execute: async (params) => {
    const { prompt } = extractTextContent(params);

    // Mild words for demonstration
    const mildProfanity = ['damn', 'hell', 'crap'];

    const found = mildProfanity.find((word) =>
      prompt.toLowerCase().includes(word),
    );

    if (found) {
      return {
        tripwireTriggered: true,
        message: `Mild profanity detected: "${found}"`,
        severity: 'medium',
        metadata: {
          word: found,
          position: prompt.toLowerCase().indexOf(found),
        },
      };
    }
    return { tripwireTriggered: false };
  },
});

async function demonstrateBlockingMode() {
  console.log('🚫 BLOCKING MODE DEMONSTRATION');
  console.log('================================');
  console.log(
    'In blocking mode, guardrail violations throw errors and stop execution.\n',
  );

  const blockingModel = withGuardrails(model, {
    inputGuardrails: [profanityGuardrail],
    throwOnBlocked: true, // BLOCKING MODE
    onInputBlocked: (executionSummary) => {
      console.log(
        '🚫 Request BLOCKED:',
        executionSummary.blockedResults[0]?.message,
      );
      console.log('   Execution will stop here.\n');
    },
  });

  // Test 1: Clean input
  console.log('Test 1: Clean input');
  try {
    const result = await generateText({
      model: blockingModel,
      prompt: 'What is the weather like today?',
    });
    console.log('✅ Success: Request processed normally');
    console.log('   Response:', result.text.slice(0, 50) + '...\n');
  } catch (error) {
    console.log('❌ Unexpected error:', (error as Error).message + '\n');
    throw error;
  }

  // Test 2: Input with profanity
  console.log('Test 2: Input with mild profanity');
  try {
    const result = await generateText({
      model: blockingModel,
      prompt: 'Why the hell is this not working?',
    });
    console.log('✅ Success:', result.text.slice(0, 50) + '...\n');
  } catch (error) {
    console.log('❌ Error thrown (as expected):', (error as Error).message);
    console.log('   The request was completely blocked.\n');
  }

  // Test 3: Multiple violations
  console.log('Test 3: Attempting multiple requests');
  const testPrompts = [
    'This is a clean prompt',
    'What the hell happened',
    'Damn this is frustrating',
    'Another clean prompt',
  ];

  let successCount = 0;
  let blockedCount = 0;

  for (const prompt of testPrompts) {
    try {
      await generateText({ model: blockingModel, prompt });
      successCount++;
      console.log(`   ✅ "${prompt.slice(0, 30)}..." - Success`);
    } catch {
      blockedCount++;
      console.log(`   🚫 "${prompt.slice(0, 30)}..." - BLOCKED`);
    }
  }

  console.log(
    `\nResults: ${successCount} successful, ${blockedCount} blocked\n`,
  );
}

async function demonstrateWarningMode() {
  console.log('⚠️  WARNING MODE DEMONSTRATION');
  console.log('==============================');
  console.log(
    'In warning mode, violations are logged but execution continues.\n',
  );

  const warningModel = withGuardrails(model, {
    inputGuardrails: [profanityGuardrail],
    throwOnBlocked: false, // WARNING MODE
    onInputBlocked: (executionSummary) => {
      console.log('⚠️  Warning:', executionSummary.blockedResults[0]?.message);
      console.log('   Request will continue processing.\n');
    },
  });

  // Test 1: Clean input
  console.log('Test 1: Clean input');
  try {
    const result = await generateText({
      model: warningModel,
      prompt: 'What is the weather like today?',
    });
    console.log('✅ Success: No warnings');
    console.log('   Response:', result.text.slice(0, 50) + '...\n');
  } catch (error) {
    console.log('❌ Unexpected error:', (error as Error).message + '\n');
    throw error;
  }

  // Test 2: Input with profanity
  console.log('Test 2: Input with mild profanity');
  try {
    const result = await generateText({
      model: warningModel,
      prompt: 'Why the hell is this not working?',
    });
    console.log('✅ Success: Processed despite warning');
    console.log('   Response:', result.text.slice(0, 50) + '...\n');
  } catch (error) {
    console.log('❌ Unexpected error:', (error as Error).message + '\n');
    throw error;
  }

  // Test 3: Multiple violations
  console.log('Test 3: Processing multiple requests');
  const testPrompts = [
    'This is a clean prompt',
    'What the hell happened',
    'Damn this is frustrating',
    'Another clean prompt',
  ];

  let successCount = 0;
  let warningCount = 0;

  for (const prompt of testPrompts) {
    const hadWarning =
      prompt.toLowerCase().includes('hell') ||
      prompt.toLowerCase().includes('damn');

    try {
      await generateText({ model: warningModel, prompt });
      successCount++;
      if (hadWarning) {
        warningCount++;
        console.log(
          `   ⚠️  "${prompt.slice(0, 30)}..." - Success with warning`,
        );
      } else {
        console.log(`   ✅ "${prompt.slice(0, 30)}..." - Success`);
      }
    } catch (error) {
      console.log(
        `   ❌ "${prompt.slice(0, 30)}..." - Error: ${(error as Error).message}`,
      );
    }
  }

  console.log(
    `\nResults: ${successCount} successful (${warningCount} with warnings)\n`,
  );
}

async function demonstrateConditionalMode() {
  console.log('🔄 CONDITIONAL MODE DEMONSTRATION');
  console.log('==================================');
  console.log('Dynamically choose blocking vs warning based on severity.\n');

  // Create a more sophisticated guardrail with severity levels
  const severityGuardrail = defineInputGuardrail({
    name: 'severity-based-filter',
    description: 'Different severity levels for different violations',
    execute: async (params) => {
      const { prompt } = extractTextContent(params);
      const lower = prompt.toLowerCase();

      // High severity - should always block
      if (lower.includes('attack') || lower.includes('destroy')) {
        return {
          tripwireTriggered: true,
          message: 'High severity violation detected',
          severity: 'high',
          metadata: { category: 'dangerous' },
        };
      }

      // Medium severity - might block or warn
      if (lower.includes('hack') || lower.includes('exploit')) {
        return {
          tripwireTriggered: true,
          message: 'Medium severity violation detected',
          severity: 'medium',
          metadata: { category: 'suspicious' },
        };
      }

      // Low severity - usually just warn
      if (lower.includes('test') || lower.includes('debug')) {
        return {
          tripwireTriggered: true,
          message: 'Low severity note',
          severity: 'low',
          metadata: { category: 'development' },
        };
      }

      return { tripwireTriggered: false };
    },
  });

  // Create a model that blocks only on high severity
  const conditionalModel = withGuardrails(model, {
    inputGuardrails: [severityGuardrail],
    throwOnBlocked: false, // We'll handle this manually
    onInputBlocked: (executionSummary) => {
      const result = executionSummary.blockedResults[0];
      if (result?.severity === 'high') {
        console.log(
          '🚫 HIGH SEVERITY - Would block in production:',
          result.message,
        );
        throw new Error(`Blocked: ${result.message}`);
      } else if (result?.severity === 'medium') {
        console.log('⚠️  MEDIUM SEVERITY - Warning:', result.message);
      } else {
        console.log(
          'ℹ️  LOW SEVERITY - Info:',
          result?.message ?? 'No details',
        );
      }
    },
  });

  const testCases = [
    { prompt: 'How does authentication work?', expected: 'pass' },
    { prompt: 'Debug this code for me', expected: 'low' },
    { prompt: 'How to hack a system', expected: 'medium' },
    { prompt: 'Attack the server', expected: 'high' },
  ];

  console.log('Testing different severity levels:');
  for (const test of testCases) {
    console.log(`\nPrompt: "${test.prompt}"`);
    console.log(`Expected: ${test.expected}`);

    try {
      await generateText({
        model: conditionalModel,
        prompt: test.prompt,
      });
      console.log('✅ Request processed');
    } catch {
      console.log('❌ Request blocked');
    }
  }
}

console.log('🎯 Blocking vs Warning Mode Comparison\n');
console.log('This example demonstrates when to use each mode:\n');
console.log('• BLOCKING MODE: Use for critical security/safety violations');
console.log('• WARNING MODE: Use for monitoring, debugging, or soft limits');
console.log('• CONDITIONAL: Use severity levels for nuanced handling\n');
console.log('='.repeat(60) + '\n');

// Run demonstrations
await demonstrateBlockingMode();
console.log('='.repeat(60) + '\n');

await demonstrateWarningMode();
console.log('='.repeat(60) + '\n');

await demonstrateConditionalMode();

console.log('\n' + '='.repeat(60));
console.log('📊 SUMMARY');
console.log('='.repeat(60));
console.log('\nUse Cases:');
console.log('\n🚫 Blocking Mode:');
console.log('   - Production environments');
console.log('   - Security-critical applications');
console.log('   - Compliance requirements');
console.log('   - Preventing harmful content');

console.log('\n⚠️  Warning Mode:');
console.log('   - Development/debugging');
console.log('   - Analytics and monitoring');
console.log('   - Soft limits and recommendations');
console.log('   - User education');

console.log('\n🔄 Conditional Mode:');
console.log('   - Different handling per severity');
console.log('   - Flexible policy enforcement');
console.log('   - A/B testing guardrail strategies');
console.log('   - Progressive enforcement\n');
