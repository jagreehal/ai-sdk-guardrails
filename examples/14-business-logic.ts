/**
 * Business Logic Example
 *
 * Demonstrates how to implement custom business rules and domain-specific
 * validation logic using guardrails.
 */

import { generateText } from 'ai';
import { model } from './model';
import {
  defineInputGuardrail,
  defineOutputGuardrail,
  wrapWithGuardrails,
} from '../src/guardrails';
import { extractTextContent } from '../src/guardrails/input';
import { extractContent } from '../src/guardrails/output';

// Business hours guardrail (defined but not used in this demo)
// Note: This is the original implementation, but we use a demo version below

// Content appropriateness for business context
const businessContentGuardrail = defineInputGuardrail({
  name: 'business-content',
  description: 'Ensures requests are appropriate for business context',
  execute: async (context) => {
    const { prompt } = extractTextContent(context);

    const inappropriateTopics = [
      'personal advice',
      'relationship help',
      'gambling',
      'politics',
      'religion',
    ];

    const foundTopic = inappropriateTopics.find((topic) =>
      prompt.toLowerCase().includes(topic),
    );

    if (foundTopic) {
      return {
        tripwireTriggered: true,
        message: `Content not appropriate for business context: ${foundTopic}`,
        severity: 'medium',
        metadata: { inappropriateTopic: foundTopic },
      };
    }

    return { tripwireTriggered: false };
  },
});

// Professional communication standards
const professionalToneGuardrail = defineOutputGuardrail({
  name: 'professional-tone',
  description: 'Ensures responses maintain professional standards',
  execute: async (context) => {
    const { text } = extractContent(context.result);
    const issues: string[] = [];

    // Check for casual language
    const casualPhrases = ['gonna', 'wanna', 'yeah', 'nah', 'dunno'];
    const foundCasual = casualPhrases.filter((phrase) =>
      text.toLowerCase().includes(phrase),
    );

    if (foundCasual.length > 0) {
      issues.push(`Casual language: ${foundCasual.join(', ')}`);
    }

    // Check for excessive emoji/slang
    const emojiCount = (
      text.match(
        /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/gu,
      ) || []
    ).length;
    if (emojiCount > 2) {
      issues.push(`Too many emojis: ${emojiCount}`);
    }

    // Check for ALL CAPS
    const capsWords = text.match(/\b[A-Z]{3,}\b/g) || [];
    if (capsWords.length > 1) {
      issues.push(`Excessive capitals: ${capsWords.join(', ')}`);
    }

    if (issues.length > 0) {
      return {
        tripwireTriggered: true,
        message: `Professional tone issues: ${issues.join('; ')}`,
        severity: 'low',
        metadata: { issues, foundCasual, emojiCount, capsWords },
      };
    }

    return { tripwireTriggered: false };
  },
});

// Budget/cost control guardrail
const costControlGuardrail = defineInputGuardrail({
  name: 'cost-control',
  description: 'Controls costs by limiting expensive operations',
  execute: async (context) => {
    const { prompt } = extractTextContent(context);

    // Check for expensive operations
    const expensiveKeywords = [
      'write a book',
      'generate thousands',
      'massive report',
      'comprehensive analysis',
      'detailed documentation',
    ];

    const foundExpensive = expensiveKeywords.find((keyword) =>
      prompt.toLowerCase().includes(keyword),
    );

    if (foundExpensive) {
      // Estimate cost (simplified)
      const estimatedTokens = prompt.length * 3; // rough estimate
      const estimatedCost = estimatedTokens * 0.000_02; // example rate

      if (estimatedCost > 1) {
        // Block if estimated cost > $1
        return {
          tripwireTriggered: true,
          message: `High-cost operation detected. Estimated cost: $${estimatedCost.toFixed(2)}`,
          severity: 'high',
          metadata: {
            expensiveOperation: foundExpensive,
            estimatedTokens,
            estimatedCost: estimatedCost.toFixed(2),
          },
        };
      }
    }

    return { tripwireTriggered: false };
  },
});

// Data compliance guardrail (GDPR/privacy)
const dataComplianceGuardrail = defineInputGuardrail({
  name: 'data-compliance',
  description: 'Ensures compliance with data protection regulations',
  execute: async (context) => {
    const { prompt } = extractTextContent(context);

    const sensitiveDataRequests = [
      'personal data',
      'customer information',
      'employee records',
      'financial data',
      'medical records',
    ];

    const foundSensitive = sensitiveDataRequests.find((term) =>
      prompt.toLowerCase().includes(term),
    );

    if (foundSensitive) {
      return {
        tripwireTriggered: true,
        message: `Data compliance violation: Request involves ${foundSensitive}`,
        severity: 'high',
        metadata: {
          sensitiveDataType: foundSensitive,
          complianceNote:
            'Requests involving personal data require additional authorization',
        },
      };
    }

    return { tripwireTriggered: false };
  },
});

console.log('🏢 Business Logic Example\n');

// Example 1: Business hours restriction
console.log('Example 1: Business Hours Control');
console.log('=================================\n');

// Note: For demo purposes, we'll modify the business hours check
const demoBusinessHours = defineInputGuardrail({
  name: 'demo-business-hours',
  description: 'Demo business hours (allowing current time)',
  execute: async () => {
    const now = new Date();
    const hour = now.getHours();

    // For demo: simulate it's outside business hours if current hour is even
    const simulateOffHours = hour % 2 === 0;

    if (simulateOffHours) {
      return {
        tripwireTriggered: true,
        message: `[DEMO] Simulating off-hours restriction (current hour: ${hour})`,
        severity: 'medium',
        metadata: { actualHour: hour, simulated: true },
      };
    }

    return { tripwireTriggered: false };
  },
});

const businessHoursModel = wrapWithGuardrails(model, {
  inputGuardrails: [demoBusinessHours],
  throwOnBlocked: false,
  onInputBlocked: (executionSummary) => {
    console.log(
      '🕐 Business hours restriction:',
      executionSummary.blockedResults[0]?.message,
    );
  },
});

try {
  const result = await generateText({
    model: businessHoursModel,
    prompt: 'What are the benefits of automation?',
  });
  console.log(
    '✅ Business request processed:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Example 2: Professional tone enforcement
console.log('Example 2: Professional Communication Standards');
console.log('=============================================\n');

const professionalModel = wrapWithGuardrails(model, {
  outputGuardrails: [professionalToneGuardrail],
  throwOnBlocked: false,
  onOutputBlocked: (executionSummary) => {
    console.log(
      '📝 Professional tone issue:',
      executionSummary.blockedResults[0]?.message,
    );
    const metadata = executionSummary.blockedResults[0]?.metadata;
    if (metadata?.issues) {
      console.log('   Issues found:', metadata.issues);
    }
  },
});

try {
  const result = await generateText({
    model: professionalModel,
    prompt: 'Explain project management in a casual, friendly way',
  });
  console.log('✅ Professional response:', result.text.slice(0, 150) + '...\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Example 3: Cost control
console.log('Example 3: Cost Control and Budget Management');
console.log('============================================\n');

const costControlModel = wrapWithGuardrails(model, {
  inputGuardrails: [costControlGuardrail],
  throwOnBlocked: false,
  onInputBlocked: (executionSummary) => {
    console.log(
      '💰 Cost control triggered:',
      executionSummary.blockedResults[0]?.message,
    );
    const metadata = executionSummary.blockedResults[0]?.metadata;
    if (metadata) {
      console.log(`   Operation: ${metadata.expensiveOperation}`);
      console.log(`   Estimated cost: $${metadata.estimatedCost}`);
    }
  },
});

// Test with potentially expensive request
try {
  await generateText({
    model: costControlModel,
    prompt:
      'Write a comprehensive analysis and detailed documentation about machine learning algorithms, including extensive examples and code samples for every major technique',
  });
  console.log('✅ Cost-controlled request processed\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Example 4: Combined business rules
console.log('Example 4: Combined Business Guardrails');
console.log('======================================\n');

const businessModel = wrapWithGuardrails(model, {
  inputGuardrails: [
    businessContentGuardrail,
    dataComplianceGuardrail,
    costControlGuardrail,
  ],
  outputGuardrails: [professionalToneGuardrail],
  throwOnBlocked: false,
  onInputBlocked: (executionSummary) => {
    console.log('🛡️ Business rule triggered:');
    for (const result of executionSummary.blockedResults) {
      console.log(`   • [${result.context?.guardrailName}] ${result.message}`);
    }
  },
  onOutputBlocked: (executionSummary) => {
    console.log('📋 Output validation:');
    for (const result of executionSummary.blockedResults) {
      console.log(`   • [${result.context?.guardrailName}] ${result.message}`);
    }
  },
});

const testRequests = [
  'Help me with technical documentation for our API',
  'Can you analyze customer information and personal data?',
  'Write a massive comprehensive report about everything',
  'Give me some personal relationship advice',
];

console.log('Testing various business scenarios:\n');
for (const [i, request] of testRequests.entries()) {
  console.log(`Test ${i + 1}: "${request.slice(0, 50)}..."`);
  try {
    await generateText({
      model: businessModel,
      prompt: request,
    });
    console.log('✅ Request approved and processed\n');
  } catch (error) {
    console.log(`❌ Error: ${(error as Error).message}\n`);
  }
}

console.log('📊 Summary:');
console.log('• Business hours control reduces off-hours costs');
console.log('• Professional tone maintains company standards');
console.log('• Cost control prevents expensive operations');
console.log('• Data compliance ensures regulatory adherence');
console.log('• Combined rules provide comprehensive protection\n');
