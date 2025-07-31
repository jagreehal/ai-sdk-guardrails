import { generateText } from 'ai';
import { model } from './model';
import {
  defineInputGuardrail,
  defineOutputGuardrail,
  wrapWithInputGuardrails,
  wrapWithOutputGuardrails,
  wrapWithGuardrails,
} from '../src/guardrails';
import type {
  InputGuardrailContext,
  OutputGuardrailContext,
} from '../src/types';
import { extractTextContent } from '../src/guardrails/input';
import { extractContent } from '../src/guardrails/output';
import { setupGracefulShutdown, safePrompt } from './utils/interactive-menu';

// Example 1: Input Length Limit Guardrail
const lengthLimitGuardrail = defineInputGuardrail({
  name: 'content-length-limit',
  description: 'Limits input content length',
  execute: async (params: InputGuardrailContext) => {
    const { prompt } = extractTextContent(params);
    const maxLength = 50;

    if (prompt.length > maxLength) {
      return {
        tripwireTriggered: true,
        message: `Input too long: ${prompt.length} characters (max: ${maxLength})`,
        severity: 'medium',
        metadata: { currentLength: prompt.length, maxLength },
      };
    }
    return { tripwireTriggered: false };
  },
});

// Example 2: Blocked Keywords Guardrail
const blockedKeywordsGuardrail = defineInputGuardrail({
  name: 'blocked-keywords',
  description: 'Blocks specific keywords',
  execute: async (params: InputGuardrailContext) => {
    const { prompt } = extractTextContent(params);
    const keywords = ['hack', 'spam', 'virus'];

    const foundKeyword = keywords.find((keyword) =>
      prompt.toLowerCase().includes(keyword.toLowerCase()),
    );

    if (foundKeyword) {
      return {
        tripwireTriggered: true,
        message: `Blocked keyword detected: ${foundKeyword}`,
        severity: 'high',
        metadata: { foundKeyword, blockedKeywords: keywords },
      };
    }
    return { tripwireTriggered: false };
  },
});

// Example 3: PII Detection Guardrail
const piiDetectionGuardrail = defineInputGuardrail({
  name: 'pii-detection',
  description: 'Detects potentially sensitive information',
  execute: async (params: InputGuardrailContext) => {
    const { prompt } = extractTextContent(params);

    const patterns = [
      { name: 'SSN', regex: /\b\d{3}-\d{2}-\d{4}\b/ },
      { name: 'Email', regex: /\b[\w.-]+@[\w.-]+\.\w+\b/ },
      { name: 'Phone', regex: /\b\d{3}-\d{3}-\d{4}\b/ },
    ];

    const foundPattern = patterns.find((pattern) => pattern.regex.test(prompt));

    if (foundPattern) {
      return {
        tripwireTriggered: true,
        message: `Potential PII detected: ${foundPattern.name}`,
        severity: 'high',
        metadata: { detectedType: foundPattern.name },
      };
    }
    return { tripwireTriggered: false };
  },
});

// Example 4: Output Length Guardrail
const outputLengthGuardrail = defineOutputGuardrail({
  name: 'output-length-check',
  description: 'Ensures output meets minimum length requirements',
  execute: async (params: OutputGuardrailContext) => {
    const { text } = extractContent(params.result);
    const minLength = 20;

    if (text.length < minLength) {
      return {
        tripwireTriggered: true,
        message: `Output too short: ${text.length} characters (min: ${minLength})`,
        severity: 'medium',
        metadata: { currentLength: text.length, minLength },
      };
    }
    return { tripwireTriggered: false };
  },
});

// Example 5: Sensitive Output Detection Guardrail
const sensitiveOutputGuardrail = defineOutputGuardrail({
  name: 'sensitive-output-detection',
  description: 'Detects sensitive information in AI responses',
  execute: async (params: OutputGuardrailContext) => {
    const { text } = extractContent(params.result);

    const sensitivePatterns = [
      { name: 'SSN', regex: /\b\d{3}-\d{2}-\d{4}\b/ },
      {
        name: 'API Key',
        regex: /(?:api[_-]?key|apikey)[\s:=]*['"]*([a-z0-9]{32,})/i,
      },
      {
        name: 'Credit Card',
        regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/,
      },
    ];

    const foundPattern = sensitivePatterns.find((pattern) =>
      pattern.regex.test(text),
    );

    if (foundPattern) {
      return {
        tripwireTriggered: true,
        message: `Sensitive information in output: ${foundPattern.name}`,
        severity: 'high',
        metadata: { detectedType: foundPattern.name },
      };
    }
    return { tripwireTriggered: false };
  },
});

// Example 6: Quality Assessment Guardrail
const qualityAssessmentGuardrail = defineOutputGuardrail({
  name: 'quality-assessment',
  description: 'Assesses output quality and helpfulness',
  execute: async (params: OutputGuardrailContext) => {
    const { text } = extractContent(params.result);

    // Check for various quality indicators
    const qualityIssues = [];

    // Too short
    if (text.length < 10) {
      qualityIssues.push('Response too short');
    }

    // Generic/unhelpful responses
    const genericPhrases = [
      "I can't help",
      "I don't know",
      'Sorry, I cannot',
      "I'm not able to",
    ];
    if (genericPhrases.some((phrase) => text.includes(phrase))) {
      qualityIssues.push('Generic/unhelpful response');
    }

    // Repetitive content
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim());
    const uniqueSentences = new Set(
      sentences.map((s) => s.trim().toLowerCase()),
    );
    if (sentences.length > 2 && uniqueSentences.size / sentences.length < 0.7) {
      qualityIssues.push('Repetitive content');
    }

    if (qualityIssues.length > 0) {
      return {
        tripwireTriggered: true,
        message: `Quality issues: ${qualityIssues.join(', ')}`,
        severity: 'medium',
        metadata: { issues: qualityIssues },
      };
    }
    return { tripwireTriggered: false };
  },
});

// ============================================================================
// MAIN INTERACTIVE DEMONSTRATION
// ============================================================================

async function main() {
  console.log('\n🛡️  AI SDK GUARDRAILS - BASIC EXAMPLES DEMONSTRATION');
  console.log('====================================================');
  console.log(
    '• This demonstrates 8 core guardrail patterns using the latest AI SDK helper functions.',
  );
  console.log('• All helpers use the latest wrapWithGuardrails() API patterns');
  console.log(
    '• Use arrow keys to navigate, space to select, and enter to run examples.',
  );

  const examples = [
    {
      name: '1. Input Length Limit - Blocking vs Warning',
      description: 'Shows blocking and warning modes for input validation',
      fn: example1_InputLengthLimit,
    },
    {
      name: '2. Blocked Keywords Detection',
      description: 'Prevents harmful or inappropriate content',
      fn: example2_BlockedKeywords,
    },
    {
      name: '3. PII Detection and Protection',
      description: 'Detects and blocks personal information',
      fn: example3_PIIDetection,
    },
    {
      name: '4. Output Length Validation',
      description: 'Ensures responses meet quality standards',
      fn: example4_OutputLength,
    },
    {
      name: '5. Sensitive Output Detection',
      description: 'Prevents leaking sensitive information in responses',
      fn: example5_SensitiveOutput,
    },
    {
      name: '6. Quality Assessment',
      description: 'Evaluates response quality and helpfulness',
      fn: example6_QualityAssessment,
    },
    {
      name: '7. Combined Input + Output Protection',
      description: 'Full pipeline protection with multiple guardrails',
      fn: example7_CombinedProtection,
    },
    {
      name: '8. Advanced Configuration & Monitoring',
      description: 'Custom callbacks, timeouts, and observability',
      fn: example8_AdvancedConfiguration,
    },
  ];

  setupGracefulShutdown();

  while (true) {
    try {
      const choice = await safePrompt(
        '\nChoose examples to run:',
        examples.map((ex) => ({
          name: ex.name,
          value: ex,
          description: ex.description,
        })),
        { type: 'multiselect' },
      );

      if (!choice || choice.length === 0) {
        console.log('\n👋 Goodbye!');
        break;
      }

      for (const selectedExample of choice) {
        await selectedExample.fn();
        console.log('\n' + '='.repeat(60));
      }

      const continueChoice = await safePrompt(
        '\nWould you like to run more examples?',
        [
          { name: 'Yes', value: true },
          { name: 'No', value: false },
        ],
      );

      if (!continueChoice) {
        console.log('\n👋 Goodbye!');
        break;
      }
    } catch (error) {
      console.error('\n❌ Error in main loop:', error);
      break;
    }
  }
}

// ============================================================================
// EXAMPLE IMPLEMENTATIONS
// ============================================================================

async function example1_InputLengthLimit() {
  console.log('\n=== Example 1: Input Length Limit - Blocking vs Warning ===');

  // DEMO 1: BLOCKING MODE (throwOnBlocked: true)
  console.log('\n🚫 DEMO 1: BLOCKING MODE (throwOnBlocked: true)');
  console.log('===========================================');

  const blockingModel = wrapWithInputGuardrails(model, [lengthLimitGuardrail], {
    throwOnBlocked: true, // BLOCKS requests completely
    onInputBlocked: (results) => {
      console.log('🚫 BLOCKED: Input rejected -', results[0]?.message);
    },
  });

  // Test 1A: Valid short input (should work in blocking mode)
  console.log('\n📝 Test 1A: Valid short input (should work)');
  try {
    const result = await generateText({
      model: blockingModel,
      prompt: 'Hello there!', // 12 chars - under limit
    });
    console.log('✅ SUCCESS:', result.text.slice(0, 100) + '...');
  } catch (error) {
    console.log('❌ ERROR:', (error as Error).message);
  }

  // Test 1B: Long input (should be blocked)
  console.log('\n📝 Test 1B: Long input (should be blocked)');
  try {
    const result = await generateText({
      model: blockingModel,
      prompt:
        'This is a very long prompt that definitely exceeds fifty characters and should be blocked', // Over 50 chars
    });
    console.log('✅ SUCCESS:', result.text);
  } catch (error) {
    console.log('❌ EXPECTED BLOCKING:', (error as Error).message);
  }

  // DEMO 2: WARNING MODE (throwOnBlocked: false)
  console.log('\n⚠️  DEMO 2: WARNING MODE (throwOnBlocked: false)');
  console.log('============================================');

  const warningModel = wrapWithInputGuardrails(model, [lengthLimitGuardrail], {
    throwOnBlocked: false, // WARNS but allows requests
    onInputBlocked: (results) => {
      console.log('⚠️  WARNING: Input flagged -', results[0]?.message);
    },
  });

  // Test 2A: Long input (should warn but proceed)
  console.log('\n📝 Test 2A: Long input (should warn but proceed)');
  try {
    const result = await generateText({
      model: warningModel,
      prompt:
        'This is a very long prompt that definitely exceeds fifty characters but should still proceed with a warning', // Over 50 chars
    });
    console.log(
      '✅ PROCEEDED WITH WARNING:',
      result.text.slice(0, 100) + '...',
    );
  } catch (error) {
    console.log('❌ UNEXPECTED ERROR:', (error as Error).message);
  }
}

async function example2_BlockedKeywords() {
  console.log('\n=== Example 2: Blocked Keywords Detection ===');

  // DEMO 1: BLOCKING MODE
  console.log('\n🚫 DEMO 1: BLOCKING MODE');
  console.log('========================');

  const blockingModel = wrapWithInputGuardrails(
    model,
    [blockedKeywordsGuardrail],
    {
      throwOnBlocked: true,
      onInputBlocked: (results) => {
        console.log('🚫 BLOCKED:', results[0]?.message);
      },
    },
  );

  // Test 1: Harmless content (should work)
  console.log('\n📝 Test 1: Harmless content');
  try {
    const result = await generateText({
      model: blockingModel,
      prompt: 'Tell me about healthy eating habits',
    });
    console.log('✅ SUCCESS:', result.text.slice(0, 100) + '...');
  } catch (error) {
    console.log('❌ ERROR:', (error as Error).message);
  }

  // Test 2: Blocked keyword (should be rejected)
  console.log('\n📝 Test 2: Contains blocked keyword');
  try {
    const result = await generateText({
      model: blockingModel,
      prompt: 'How to hack into systems?', // Contains "hack"
    });
    console.log('✅ SUCCESS:', result.text);
  } catch (error) {
    console.log('❌ EXPECTED BLOCKING:', (error as Error).message);
  }

  // DEMO 2: WARNING MODE
  console.log('\n⚠️  DEMO 2: WARNING MODE');
  console.log('=======================');

  const warningModel = wrapWithInputGuardrails(
    model,
    [blockedKeywordsGuardrail],
    {
      throwOnBlocked: false,
      onInputBlocked: (results) => {
        console.log('⚠️  WARNING: Flagged content -', results[0]?.message);
      },
    },
  );

  // Test 3: Blocked keyword (should warn but proceed)
  console.log('\n📝 Test 3: Contains blocked keyword (with warning)');
  try {
    const result = await generateText({
      model: warningModel,
      prompt: 'What is spam email?', // Contains "spam"
    });
    console.log(
      '✅ PROCEEDED WITH WARNING:',
      result.text.slice(0, 100) + '...',
    );
  } catch (error) {
    console.log('❌ UNEXPECTED ERROR:', (error as Error).message);
  }
}

async function example3_PIIDetection() {
  console.log('\n=== Example 3: PII Detection and Protection ===');

  const protectedModel = wrapWithInputGuardrails(
    model,
    [piiDetectionGuardrail],
    {
      throwOnBlocked: true,
      onInputBlocked: (results) => {
        console.log('🛡️  PII DETECTED:', results[0]?.message);
        console.log('📊 Detection metadata:', results[0]?.metadata);
      },
    },
  );

  // Test 1: Safe content (should work)
  console.log('\n📝 Test 1: Safe content without PII');
  try {
    const result = await generateText({
      model: protectedModel,
      prompt: 'Explain data privacy best practices',
    });
    console.log('✅ SUCCESS:', result.text.slice(0, 100) + '...');
  } catch (error) {
    console.log('❌ ERROR:', (error as Error).message);
  }

  // Test 2: Email address (should be blocked)
  console.log('\n📝 Test 2: Contains email address');
  try {
    const result = await generateText({
      model: protectedModel,
      prompt: 'Send a message to john.doe@company.com about the project',
    });
    console.log('✅ SUCCESS:', result.text);
  } catch (error) {
    console.log(
      '❌ EXPECTED BLOCKING (Email detected):',
      (error as Error).message,
    );
  }

  // Test 3: SSN (should be blocked)
  console.log('\n📝 Test 3: Contains SSN');
  try {
    const result = await generateText({
      model: protectedModel,
      prompt: 'The SSN is 123-45-6789 for reference',
    });
    console.log('✅ SUCCESS:', result.text);
  } catch (error) {
    console.log(
      '❌ EXPECTED BLOCKING (SSN detected):',
      (error as Error).message,
    );
  }

  // Test 4: Phone number (should be blocked)
  console.log('\n📝 Test 4: Contains phone number');
  try {
    const result = await generateText({
      model: protectedModel,
      prompt: 'Call me at 555-123-4567 when ready',
    });
    console.log('✅ SUCCESS:', result.text);
  } catch (error) {
    console.log(
      '❌ EXPECTED BLOCKING (Phone detected):',
      (error as Error).message,
    );
  }
}

async function example4_OutputLength() {
  console.log('\n=== Example 4: Output Length Validation ===');

  // DEMO 1: BLOCKING MODE
  console.log('\n🚫 DEMO 1: BLOCKING MODE');
  console.log('========================');

  const blockingModel = wrapWithOutputGuardrails(
    model,
    [outputLengthGuardrail],
    {
      throwOnBlocked: true,
      onOutputBlocked: (results) => {
        console.log('🚫 OUTPUT BLOCKED:', results[0]?.message);
      },
    },
  );

  // Test 1: Request that should produce adequate output
  console.log('\n📝 Test 1: Request for detailed explanation');
  try {
    const result = await generateText({
      model: blockingModel,
      prompt: 'Explain the benefits of renewable energy in detail',
    });
    console.log(
      '✅ SUCCESS (adequate length):',
      result.text.slice(0, 100) + '...',
    );
  } catch (error) {
    console.log('❌ ERROR:', (error as Error).message);
  }

  // Test 2: Request that might produce short output
  console.log('\n📝 Test 2: Request likely to produce short output');
  try {
    const result = await generateText({
      model: blockingModel,
      prompt: 'Say "yes"',
    });
    console.log('✅ SUCCESS:', result.text);
  } catch (error) {
    console.log('❌ EXPECTED BLOCKING (too short):', (error as Error).message);
  }

  // DEMO 2: WARNING MODE
  console.log('\n⚠️  DEMO 2: WARNING MODE');
  console.log('=======================');

  const warningModel = wrapWithOutputGuardrails(
    model,
    [outputLengthGuardrail],
    {
      throwOnBlocked: false,
      onOutputBlocked: (results) => {
        console.log('⚠️  OUTPUT WARNING:', results[0]?.message);
      },
    },
  );

  // Test 3: Short output (should warn but allow)
  console.log('\n📝 Test 3: Short output (with warning)');
  try {
    const result = await generateText({
      model: warningModel,
      prompt: 'Just say "OK"',
    });
    console.log('✅ PROCEEDED WITH WARNING:', result.text);
  } catch (error) {
    console.log('❌ UNEXPECTED ERROR:', (error as Error).message);
  }
}

async function example5_SensitiveOutput() {
  console.log('\n=== Example 5: Sensitive Output Detection ===');

  const protectedModel = wrapWithOutputGuardrails(
    model,
    [sensitiveOutputGuardrail],
    {
      throwOnBlocked: true,
      onOutputBlocked: (results) => {
        console.log('🛡️  SENSITIVE OUTPUT BLOCKED:', results[0]?.message);
        console.log('📊 Detection metadata:', results[0]?.metadata);
      },
    },
  );

  // Test 1: Safe request (should work)
  console.log('\n📝 Test 1: Safe request');
  try {
    const result = await generateText({
      model: protectedModel,
      prompt: 'Explain how to create secure passwords',
    });
    console.log('✅ SUCCESS:', result.text.slice(0, 100) + '...');
  } catch (error) {
    console.log('❌ ERROR:', (error as Error).message);
  }

  // Test 2: Request that might generate sensitive content
  console.log('\n📝 Test 2: Request that might expose sensitive info');
  try {
    const result = await generateText({
      model: protectedModel,
      prompt: 'Generate a sample user profile with contact information',
    });
    console.log('✅ SUCCESS:', result.text.slice(0, 200) + '...');
  } catch (error) {
    console.log(
      '❌ BLOCKED (contained sensitive info):',
      (error as Error).message,
    );
  }
}

async function example6_QualityAssessment() {
  console.log('\n=== Example 6: Quality Assessment ===');

  const qualityModel = wrapWithOutputGuardrails(
    model,
    [qualityAssessmentGuardrail],
    {
      throwOnBlocked: false, // Use warning mode for quality issues
      onOutputBlocked: (results) => {
        console.log('📊 QUALITY ISSUE:', results[0]?.message);
        console.log('🔍 Details:', results[0]?.metadata);
      },
    },
  );

  // Test 1: Good request (should pass quality checks)
  console.log('\n📝 Test 1: Request for quality content');
  try {
    const result = await generateText({
      model: qualityModel,
      prompt: 'Explain the importance of software testing with examples',
    });
    console.log('✅ HIGH QUALITY OUTPUT:', result.text.slice(0, 150) + '...');
  } catch (error) {
    console.log('❌ ERROR:', (error as Error).message);
  }

  // Test 2: Request likely to produce low-quality response
  console.log('\n📝 Test 2: Request likely to produce generic response');
  try {
    const result = await generateText({
      model: qualityModel,
      prompt: 'Tell me something you cannot do',
    });
    console.log('✅ OUTPUT (may have quality issues):', result.text);
  } catch (error) {
    console.log('❌ ERROR:', (error as Error).message);
  }
}

async function example7_CombinedProtection() {
  console.log('\n=== Example 7: Combined Input + Output Protection ===');

  const fullyProtectedModel = wrapWithGuardrails(model, {
    inputGuardrails: [
      lengthLimitGuardrail,
      blockedKeywordsGuardrail,
      piiDetectionGuardrail,
    ],
    outputGuardrails: [
      outputLengthGuardrail,
      sensitiveOutputGuardrail,
      qualityAssessmentGuardrail,
    ],
    throwOnBlocked: false, // Use warning mode for demonstration
    onInputBlocked: (results) => {
      console.log('🛡️  INPUT PROTECTION TRIGGERED:');
      for (const [i, result] of results.entries()) {
        console.log(`  ${i + 1}. ${result.message}`);
      }
    },
    onOutputBlocked: (results) => {
      console.log('🛡️  OUTPUT PROTECTION TRIGGERED:');
      for (const [i, result] of results.entries()) {
        console.log(`  ${i + 1}. ${result.message}`);
      }
    },
  });

  // Test 1: Clean request (should pass all checks)
  console.log('\n📝 Test 1: Clean request');
  try {
    const result = await generateText({
      model: fullyProtectedModel,
      prompt: 'Explain cloud computing benefits',
    });
    console.log(
      '✅ FULLY PROTECTED SUCCESS:',
      result.text.slice(0, 100) + '...',
    );
  } catch (error) {
    console.log('❌ ERROR:', (error as Error).message);
  }

  // Test 2: Request with input issues
  console.log('\n📝 Test 2: Request with potential input issues');
  try {
    const result = await generateText({
      model: fullyProtectedModel,
      prompt:
        'This is a very long prompt that exceeds the character limit and contains spam-like content which should trigger input protection mechanisms', // Long + contains "spam"
    });
    console.log(
      '✅ PROCESSED WITH WARNINGS:',
      result.text.slice(0, 100) + '...',
    );
  } catch (error) {
    console.log('❌ ERROR:', (error as Error).message);
  }

  // Test 3: Request that might trigger output protection
  console.log('\n📝 Test 3: Request that might trigger output protection');
  try {
    const result = await generateText({
      model: fullyProtectedModel,
      prompt: 'Create a sample database record',
    });
    console.log(
      '✅ OUTPUT WITH PROTECTION:',
      result.text.slice(0, 150) + '...',
    );
  } catch (error) {
    console.log('❌ ERROR:', (error as Error).message);
  }
}

async function example8_AdvancedConfiguration() {
  console.log('\n=== Example 8: Advanced Configuration & Monitoring ===');

  const advancedModel = wrapWithGuardrails(model, {
    inputGuardrails: [lengthLimitGuardrail, blockedKeywordsGuardrail],
    outputGuardrails: [qualityAssessmentGuardrail],

    // Configuration options
    throwOnBlocked: false,

    // Comprehensive monitoring callbacks
    onInputBlocked: (results) => {
      console.log('📊 INPUT MONITORING:');
      for (const result of results) {
        console.log(`  🛡️  Guardrail: ${result.context?.guardrailName}`);
        console.log(`  ⚠️  Severity: ${result.severity}`);
        console.log(`  💬 Message: ${result.message}`);
        console.log(
          `  ⏱️  Execution time: ${result.context?.executionTimeMs}ms`,
        );
        if (result.metadata) {
          console.log(`  📋 Metadata:`, result.metadata);
        }
      }
    },

    onOutputBlocked: (results) => {
      console.log('📊 OUTPUT MONITORING:');
      for (const result of results) {
        console.log(`  🛡️  Guardrail: ${result.context?.guardrailName}`);
        console.log(`  ⚠️  Severity: ${result.severity}`);
        console.log(`  💬 Message: ${result.message}`);
        console.log(
          `  ⏱️  Execution time: ${result.context?.executionTimeMs}ms`,
        );
        if (result.metadata) {
          console.log(`  📋 Metadata:`, result.metadata);
        }
      }
    },
  });

  // Test 1: Normal request with full monitoring
  console.log('\n📝 Test 1: Normal request with comprehensive monitoring');
  try {
    const result = await generateText({
      model: advancedModel,
      prompt: 'Explain machine learning concepts',
    });
    console.log(
      '✅ SUCCESS WITH MONITORING:',
      result.text.slice(0, 100) + '...',
    );
  } catch (error) {
    console.log('❌ ERROR:', (error as Error).message);
  }

  // Test 2: Request that triggers multiple guardrails
  console.log('\n📝 Test 2: Request triggering multiple guardrails');
  try {
    const result = await generateText({
      model: advancedModel,
      prompt:
        'This is a very long prompt that definitely exceeds the character limit and also contains some spam content', // Triggers length + keyword guardrails
    });
    console.log('✅ MONITORED EXECUTION:', result.text.slice(0, 100) + '...');
  } catch (error) {
    console.log('❌ ERROR:', (error as Error).message);
  }
}

// ============================================================================
// RUN THE DEMONSTRATION
// ============================================================================

if (require.main === module) {
  main().catch(console.error);
}
