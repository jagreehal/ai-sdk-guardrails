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
        metadata: { blockedKeyword: foundKeyword },
      };
    }
    return { tripwireTriggered: false };
  },
});

// Example 3: Math Homework Detection Guardrail
const mathHomeworkGuardrail = defineInputGuardrail({
  name: 'math-homework-detector',
  description: 'Detects potential math homework requests',
  execute: async (params: InputGuardrailContext) => {
    const { prompt } = extractTextContent(params);
    const mathKeywords = ['solve', 'calculate', 'equation', 'homework'];
    const mathPatterns = [/\b\d+\s*[+\-*/]\s*\d+/, /\b[xy]\s*[+\-*/=]\s*\d+/];

    const content = prompt.toLowerCase();
    const hasKeywords = mathKeywords.some((keyword) =>
      content.includes(keyword),
    );
    const hasPatterns = mathPatterns.some((pattern) => pattern.test(content));
    const isMathHomework = hasKeywords && hasPatterns;

    if (isMathHomework) {
      return {
        tripwireTriggered: true,
        message: 'Math homework detected',
        severity: 'high',
        suggestion: 'Try asking about concepts instead',
        metadata: { hasKeywords, hasPatterns },
      };
    }
    return { tripwireTriggered: false };
  },
});

// Example 4: Output Length Limit Guardrail
const outputLengthGuardrail = defineOutputGuardrail({
  name: 'output-length-limit',
  description: 'Limits output length',
  execute: async (context: OutputGuardrailContext) => {
    const { text } = extractContent(context.result);
    const maxLength = 100;

    if (text.length > maxLength) {
      return {
        tripwireTriggered: true,
        message: `Output too long: ${text.length} characters (max: ${maxLength})`,
        severity: 'medium',
        metadata: { currentLength: text.length, maxLength },
      };
    }
    return { tripwireTriggered: false };
  },
});

// Example 5: Positivity Filter Guardrail
const positivityGuardrail = defineOutputGuardrail({
  name: 'positivity-filter',
  description: 'Filters negative sentiment',
  execute: async (context: OutputGuardrailContext) => {
    const { text } = extractContent(context.result);
    const negativeWords = ['terrible', 'awful', 'horrible', 'hate', 'bad'];

    const hasNegative = negativeWords.some((word) =>
      text.toLowerCase().includes(word),
    );

    if (hasNegative) {
      return {
        tripwireTriggered: true,
        message: 'Negative sentiment detected',
        severity: 'medium',
        suggestion: 'Try rephrasing with more positive language',
        metadata: {
          negativeWords: negativeWords.filter((word) =>
            text.toLowerCase().includes(word),
          ),
        },
      };
    }
    return { tripwireTriggered: false };
  },
});

// Example 1: Input Length Limit - Blocking vs Warning Demo
async function example1_InputLengthLimit() {
  console.log('\n=== Example 1: Input Length Limit - Blocking vs Warning ===');
  
  // DEMO 1: BLOCKING MODE (throwOnBlocked: true)
  console.log('\n🚫 DEMO 1: BLOCKING MODE (throwOnBlocked: true)');
  console.log('===========================================');
  
  const blockingModel = wrapLanguageModel({
    model,
    middleware: [
      createInputGuardrailsMiddleware({
        inputGuardrails: [lengthLimitGuardrail],
        throwOnBlocked: true, // BLOCKS requests completely
        onInputBlocked: (results) => {
          console.log('🚫 BLOCKED: Input rejected -', results[0]?.message);
        },
      }),
    ],
  });

  // Test 1A: Valid short input (should work in blocking mode)
  console.log('\n✅ Testing VALID short input in BLOCKING mode...');
  console.log('Expected: Should generate response normally');
  try {
    const result = await generateText({
      model: blockingModel,
      prompt: 'Hello world', // 11 chars - under 50 limit
    });
    console.log('✅ SUCCESS: Response generated -', result.text.slice(0, 50) + '...');
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }

  // Test 1B: Invalid long input (should be completely blocked)
  console.log('\n🚫 Testing INVALID long input in BLOCKING mode...');
  console.log('Expected: Should be BLOCKED - no response generated');
  try {
    const result = await generateText({
      model: blockingModel,
      prompt: 'This is a very long prompt that definitely exceeds the 50 character limit we set in the guardrail configuration and should be completely blocked', // 140+ chars
    });
    console.log('🔥 ERROR: This should never appear! Blocking failed:', result.text);
  } catch (error) {
    console.log('✅ SUCCESS: Request was BLOCKED as expected - no response generated');
  }

  // DEMO 2: WARNING MODE (throwOnBlocked: false)
  console.log('\n⚠️  DEMO 2: WARNING MODE (throwOnBlocked: false)');
  console.log('=========================================');
  
  const warningModel = wrapLanguageModel({
    model,
    middleware: [
      createInputGuardrailsMiddleware({
        inputGuardrails: [lengthLimitGuardrail],
        throwOnBlocked: false, // WARNS but allows requests through
        onInputBlocked: (results) => {
          console.log('⚠️  WARNED: Issue detected but continuing -', results[0]?.message);
        },
      }),
    ],
  });

  // Test 2A: Valid short input (should work in warning mode)
  console.log('\n✅ Testing VALID short input in WARNING mode...');
  console.log('Expected: Should generate response normally, no warnings');
  try {
    const result = await generateText({
      model: warningModel,
      prompt: 'Hello world', // 11 chars - under 50 limit
    });
    console.log('✅ SUCCESS: Response generated normally -', result.text.slice(0, 50) + '...');
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }

  // Test 2B: Invalid long input (should warn but still generate response)
  console.log('\n⚠️  Testing INVALID long input in WARNING mode...');
  console.log('Expected: Should WARN but still generate response');
  try {
    const result = await generateText({
      model: warningModel,
      prompt: 'This is a very long prompt that definitely exceeds the 50 character limit we set in the guardrail configuration but should still generate a response', // 150+ chars
    });
    console.log('✅ SUCCESS: Warning logged but response generated -', result.text.slice(0, 50) + '...');
  } catch (error) {
    console.log('❌ Unexpected: Warning mode should not throw -', (error as Error).message);
  }

  console.log('\n📋 SUMMARY:');
  console.log('• BLOCKING mode (throwOnBlocked: true) = Guardrail violations prevent response generation');
  console.log('• WARNING mode (throwOnBlocked: false) = Guardrail violations are logged but responses still generated');
}

// Example 2: Blocked Keywords - Blocking vs Warning Demo
async function example2_BlockedKeywords() {
  console.log('\n=== Example 2: Blocked Keywords - Blocking vs Warning ===');

  // DEMO 1: BLOCKING MODE (throwOnBlocked: true)
  console.log('\n🚫 DEMO 1: BLOCKING MODE (throwOnBlocked: true)');
  console.log('===========================================');
  
  const blockingModel = wrapLanguageModel({
    model,
    middleware: [
      createInputGuardrailsMiddleware({
        inputGuardrails: [blockedKeywordsGuardrail],
        throwOnBlocked: true, // BLOCKS requests completely
        onInputBlocked: (results) => {
          console.log('🚫 BLOCKED: Request rejected -', results[0]?.message);
        },
      }),
    ],
  });

  // Test 1A: Safe input (should work in blocking mode)
  console.log('\n✅ Testing SAFE content in BLOCKING mode...');
  console.log('Expected: Should generate response normally');
  try {
    const result = await generateText({
      model: blockingModel,
      prompt: 'Explain how to create a secure password',
    });
    console.log('✅ SUCCESS: Safe content generated response -', result.text.slice(0, 50) + '...');
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }

  // Test 1B: Blocked keyword (should be completely blocked)
  console.log('\n🚫 Testing BLOCKED keyword in BLOCKING mode...');
  console.log('Expected: Should be BLOCKED - no response generated');
  try {
    const result = await generateText({
      model: blockingModel,
      prompt: 'How to hack into a system', // Contains "hack" - blocked keyword
    });
    console.log('🔥 ERROR: This should never appear! Blocking failed:', result.text);
  } catch (error) {
    console.log('✅ SUCCESS: Blocked keyword request was BLOCKED as expected');
  }

  // DEMO 2: WARNING MODE (throwOnBlocked: false)
  console.log('\n⚠️  DEMO 2: WARNING MODE (throwOnBlocked: false)');
  console.log('=========================================');
  
  const warningModel = wrapLanguageModel({
    model,
    middleware: [
      createInputGuardrailsMiddleware({
        inputGuardrails: [blockedKeywordsGuardrail],
        throwOnBlocked: false, // WARNS but allows requests through
        onInputBlocked: (results) => {
          console.log('⚠️  WARNED: Problematic content detected but continuing -', results[0]?.message);
        },
      }),
    ],
  });

  // Test 2A: Safe input (should work in warning mode)
  console.log('\n✅ Testing SAFE content in WARNING mode...');
  console.log('Expected: Should generate response normally, no warnings');
  try {
    const result = await generateText({
      model: warningModel,
      prompt: 'Explain how to create a secure password',
    });
    console.log('✅ SUCCESS: Safe content generated response normally -', result.text.slice(0, 50) + '...');
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }

  // Test 2B: Blocked keyword (should warn but still generate response)
  console.log('\n⚠️  Testing BLOCKED keyword in WARNING mode...');
  console.log('Expected: Should WARN about keyword but still generate response');
  try {
    const result = await generateText({
      model: warningModel,
      prompt: 'How to hack into a system', // Contains "hack" - blocked keyword
    });
    console.log('✅ SUCCESS: Warning logged but response still generated -', result.text.slice(0, 50) + '...');
  } catch (error) {
    console.log('❌ Unexpected: Warning mode should not throw -', (error as Error).message);
  }

  console.log('\n📋 SUMMARY:');
  console.log('• BLOCKING mode = Blocked keywords prevent any response generation');
  console.log('• WARNING mode = Blocked keywords trigger warnings but responses are still generated');
}

// Example 3: Custom Input Guardrail (Math Homework)
async function example3_CustomInputGuardrail() {
  console.log('\n=== Example 3: Custom Input Guardrail ===');

  const protectedModel = wrapLanguageModel({
    model,
    middleware: [
      createInputGuardrailsMiddleware({
        inputGuardrails: [mathHomeworkGuardrail],
        throwOnBlocked: false,
        onInputBlocked: (results) => {
          console.log('❌ Input blocked:', results[0]?.message);
          console.log('💡 Suggestion:', results[0]?.suggestion);
        },
      }),
    ],
  });

  // Test with normal question
  console.log('Testing concept question...');
  try {
    const result = await generateText({
      model: protectedModel,
      prompt: 'What is calculus and why is it important?',
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'math-homework-example',
        metadata: { example: 'custom-input' },
      },
    });
    console.log(
      '✅ Concept question result:',
      result.text.slice(0, 100) + '...',
    );
  } catch (error) {
    console.error('❌ Error:', error);
  }

  // Test with homework-like question
  console.log('\nTesting homework question...');
  try {
    const result = await generateText({
      model: protectedModel,
      prompt: 'Solve this equation: 2x + 5 = 15',
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'math-homework-example',
        metadata: { example: 'custom-input' },
      },
    });
    console.log('🚫 This should not appear:', result.text);
  } catch {
    console.log('✅ Homework question correctly handled');
  }
}

// Example 4: Output Length Limit - Blocking vs Warning Demo
async function example4_OutputLengthLimit() {
  console.log('\n=== Example 4: Output Length Limit - Blocking vs Warning ===');

  // DEMO 1: BLOCKING MODE (throwOnBlocked: true)
  console.log('\n🚫 DEMO 1: BLOCKING MODE (throwOnBlocked: true)');
  console.log('===========================================');
  
  const blockingModel = wrapLanguageModel({
    model,
    middleware: [
      createOutputGuardrailsMiddleware({
        outputGuardrails: [outputLengthGuardrail], // 100 char limit
        throwOnBlocked: true, // BLOCKS if output too long
        onOutputBlocked: (results) => {
          console.log('🚫 BLOCKED: Output rejected -', results[0]?.message);
        },
      }),
    ],
  });

  // Test 1A: Request likely to produce short output (should work)
  console.log('\n✅ Testing prompt likely to produce SHORT output in BLOCKING mode...');
  console.log('Expected: Should generate normal response under 100 chars');
  try {
    const result = await generateText({
      model: blockingModel,
      prompt: 'What is AI in one sentence?',
    });
    console.log(`✅ SUCCESS: Short output generated (${result.text.length} chars) -`, result.text);
  } catch (error) {
    console.log('❌ Unexpected blocking for short output:', (error as Error).message);
  }

  // Test 1B: Request likely to produce long output (should be blocked)
  console.log('\n🚫 Testing prompt likely to produce LONG output in BLOCKING mode...');
  console.log('Expected: Should be BLOCKED if output exceeds 100 chars');
  try {
    const result = await generateText({
      model: blockingModel,
      prompt: 'Write a detailed explanation of machine learning with examples and benefits',
    });
    if (result.text && result.text.length > 100) {
      console.log('🔥 ERROR: Long output should have been blocked! Length:', result.text.length);
      console.log('Content:', result.text.slice(0, 100) + '...');
    } else {
      console.log(`✅ SUCCESS: Output within limits (${result.text.length} chars)`);
    }
  } catch (error) {
    console.log('✅ SUCCESS: Long output was BLOCKED as expected');
  }

  // DEMO 2: WARNING MODE (throwOnBlocked: false)
  console.log('\n⚠️  DEMO 2: WARNING MODE (throwOnBlocked: false)');
  console.log('=========================================');
  
  const warningModel = wrapLanguageModel({
    model,
    middleware: [
      createOutputGuardrailsMiddleware({
        outputGuardrails: [outputLengthGuardrail], // 100 char limit
        throwOnBlocked: false, // WARNS but allows long output
        onOutputBlocked: (results) => {
          console.log('⚠️  WARNED: Output length issue detected but continuing -', results[0]?.message);
        },
      }),
    ],
  });

  // Test 2A: Request likely to produce short output (should work normally)
  console.log('\n✅ Testing prompt likely to produce SHORT output in WARNING mode...');
  console.log('Expected: Should generate normal response, no warnings');
  try {
    const result = await generateText({
      model: warningModel,
      prompt: 'What is AI in one sentence?',
    });
    console.log(`✅ SUCCESS: Short output generated normally (${result.text.length} chars) -`, result.text);
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }

  // Test 2B: Request likely to produce long output (should warn but return response)
  console.log('\n⚠️  Testing prompt likely to produce LONG output in WARNING mode...');
  console.log('Expected: Should WARN about length but still return the full response');
  try {
    const result = await generateText({
      model: warningModel,
      prompt: 'Write a detailed explanation of machine learning with examples and benefits',
    });
    console.log(`✅ SUCCESS: Full output returned despite length (${result.text.length} chars)`);
    console.log('Preview:', result.text.slice(0, 100) + '...');
  } catch (error) {
    console.log('❌ Unexpected: Warning mode should not throw -', (error as Error).message);
  }

  console.log('\n📋 SUMMARY:');
  console.log('• BLOCKING mode = Long outputs are completely blocked/rejected');
  console.log('• WARNING mode = Long outputs trigger warnings but are still returned to user');
}

// Example 5: Custom Output Guardrail (Positivity Filter)
async function example5_CustomOutputGuardrail() {
  console.log('\n=== Example 5: Custom Output Guardrail ===');

  const protectedModel = wrapLanguageModel({
    model,
    middleware: [
      createOutputGuardrailsMiddleware({
        outputGuardrails: [positivityGuardrail],
        throwOnBlocked: false,
        onOutputBlocked: (results) => {
          console.log('❌ Output blocked:', results[0]?.message);
          console.log('💡 Suggestion:', results[0]?.suggestion);
        },
      }),
    ],
  });

  // Test with neutral prompt
  console.log('Testing neutral prompt...');
  try {
    const result = await generateText({
      model: protectedModel,
      prompt: 'Tell me about the weather',
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'positivity-example',
        metadata: { example: 'custom-output' },
      },
    });
    console.log('✅ Neutral result:', result.text.slice(0, 100) + '...');
  } catch (error) {
    console.error('❌ Error:', error);
  }

  // Test with prompt likely to produce negative response
  console.log('\nTesting prompt that might produce negative response...');
  try {
    const result = await generateText({
      model: protectedModel,
      prompt: 'What do you think about spam emails?',
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'positivity-example',
        metadata: { example: 'custom-output' },
      },
    });

    if (result.text) {
      console.log(
        '✅ Response passed filter:',
        result.text.slice(0, 100) + '...',
      );
    } else {
      console.log('✅ Response was processed by guardrails');
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Example 6: Combined Guardrails
async function example6_CombinedGuardrails() {
  console.log('\n=== Example 6: Combined Input & Output Guardrails ===');

  const protectedModel = wrapLanguageModel({
    model,
    middleware: [
      createInputGuardrailsMiddleware({
        inputGuardrails: [blockedKeywordsGuardrail, lengthLimitGuardrail],
        throwOnBlocked: false,
        onInputBlocked: (results) => {
          console.log(
            '❌ Input blocked by:',
            results
              .map((r) => r.context?.guardrailName || 'unknown')
              .join(', '),
          );
        },
      }),
      createOutputGuardrailsMiddleware({
        outputGuardrails: [outputLengthGuardrail, positivityGuardrail],
        throwOnBlocked: false,
        onOutputBlocked: (results) => {
          console.log(
            '❌ Output blocked by:',
            results
              .map((r) => r.context?.guardrailName || 'unknown')
              .join(', '),
          );
        },
      }),
    ],
  });

  console.log('Testing with combined guardrails...');
  try {
    const result = await generateText({
      model: protectedModel,
      prompt: 'Tell me about cybersecurity',
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'combined-example',
        metadata: { example: 'combined-guardrails' },
      },
    });

    if (result.text) {
      console.log('✅ Combined result:', result.text.slice(0, 100) + '...');
    } else {
      console.log('✅ Request was processed by guardrails');
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Example 7: Direct Telemetry with AI SDK
async function example7_DirectTelemetry() {
  console.log('\n=== Example 7: Direct Telemetry (AI SDK Native) ===');

  // Example showing AI SDK's native telemetry can be used directly
  // alongside guardrails middleware
  console.log('Testing with direct experimental_telemetry parameter...');

  const protectedModel = wrapLanguageModel({
    model,
    middleware: [
      createInputGuardrailsMiddleware({
        inputGuardrails: [lengthLimitGuardrail],
        throwOnBlocked: false,
        onInputBlocked: (results) => {
          console.log('❌ Input blocked:', results[0]?.message);
        },
      }),
    ],
  });

  try {
    // AI SDK's native telemetry parameter works seamlessly with guardrails
    const result = await generateText({
      model: protectedModel,
      prompt: 'What is telemetry?',
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'telemetry-example',
        metadata: {
          example: 'direct-telemetry',
          userSegment: 'demo',
          feature: 'guardrails-integration',
        },
      },
    });

    console.log(
      '✅ Telemetry-enabled result:',
      result.text.slice(0, 100) + '...',
    );
    console.log(
      '📊 Telemetry data captured with functionId: telemetry-example',
    );
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Example 8: Combined Middleware and Direct Telemetry
async function example8_CombinedTelemetry() {
  console.log('\n=== Example 8: Combined Telemetry Approaches ===');

  // This example shows how both telemetry middleware AND direct telemetry
  // can work together for comprehensive observability
  const fullyInstrumentedModel = wrapLanguageModel({
    model,
    middleware: [
      createInputGuardrailsMiddleware({
        inputGuardrails: [blockedKeywordsGuardrail],
        throwOnBlocked: false,
        onInputBlocked: (results) => {
          console.log('🛡️ Guardrail triggered:', results[0]?.message);
        },
      }),
    ],
  });

  console.log('Testing with both middleware and direct telemetry...');

  try {
    const result = await generateText({
      model: fullyInstrumentedModel,
      prompt: 'Explain observability in software systems',
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'observability-request',
        metadata: {
          service: 'guardrails-demo',
          version: '1.0.0',
          requestType: 'explanation',
          topic: 'observability',
          timestamp: new Date().toISOString(),
        },
      },
    });

    console.log('✅ Result:', result.text.slice(0, 100) + '...');
    console.log('📊 Telemetry captured:');
    console.log('  • Base telemetry (service, version)');
    console.log(
      '  • Request-specific telemetry (requestType, topic, timestamp)',
    );
    console.log('  • FunctionId: observability-request');
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Example registry
const EXAMPLES = [
  { name: 'Input Length Limit (Blocking vs Warning Demo)', fn: example1_InputLengthLimit },
  { name: 'Blocked Keywords (Blocking vs Warning Demo)', fn: example2_BlockedKeywords },
  {
    name: 'Custom Input Guardrail (Math Homework)',
    fn: example3_CustomInputGuardrail,
  },
  { name: 'Output Length Limit (Blocking vs Warning Demo)', fn: example4_OutputLengthLimit },
  {
    name: 'Custom Output Guardrail (Positivity Filter)',
    fn: example5_CustomOutputGuardrail,
  },
  { name: 'Combined Guardrails', fn: example6_CombinedGuardrails },
  { name: 'Direct Telemetry', fn: example7_DirectTelemetry },
  { name: 'Combined Telemetry', fn: example8_CombinedTelemetry },
];

// Interactive menu with Inquirer
async function showInteractiveMenu() {
  console.log('\n🛡️  AI SDK Guardrails Examples (v5 Middleware)');
  console.log('===============================================');
  console.log('Choose examples to explore guardrail functionality\n');

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
      pageSize: 12,
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
      if (!example) {
        console.error(`❌ Example ${action} not found`);
        continue;
      }
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
  console.log('\n🚀 Running all examples...\n');

  try {
    for (const example of EXAMPLES) {
      console.log(`\n--- Running: ${example.name} ---`);
      await example.fn();
    }

    console.log('\n✅ All examples completed successfully!');
    console.log('  • Used new v5 middleware architecture');
    console.log('  • Demonstrated composable guardrails');
    console.log(
      '  • Showcased telemetry integration (both middleware & direct)',
    );
    console.log('  • Proper error handling with callbacks');
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
      console.log('🛡️  AI SDK Guardrails Examples (v5 Middleware)');
      console.log('===============================================');
      console.log('');
      console.log('Usage:');
      console.log('  tsx examples/basic-guardrails.ts [example_number]');
      console.log('');
      console.log('Arguments:');
      console.log(
        `  example_number    Run specific example (1-${EXAMPLES.length}), or omit for interactive mode`,
      );
      console.log('');
      console.log('Examples:');
      console.log(
        '  tsx examples/basic-guardrails.ts        # Interactive mode',
      );
      console.log(
        '  tsx examples/basic-guardrails.ts 1      # Run first example',
      );
      console.log(
        `  tsx examples/basic-guardrails.ts ${EXAMPLES.length}      # Run last example`,
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
    if (error?.name !== 'ExitPromptError') {
      console.error(error);
    }
  });
}
