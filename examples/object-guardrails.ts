import { z } from 'zod';
import { generateObject, wrapLanguageModel } from 'ai';
import { model } from './model';
import {
  createInputGuardrailsMiddleware,
  createOutputGuardrailsMiddleware,
  defineInputGuardrail,
  defineOutputGuardrail,
} from '../src/guardrails';
import type { InputGuardrailContext, OutputGuardrailContext } from '../src/types';
import { extractContent } from '../src/guardrails/output';
import { extractTextContent } from '../src/guardrails/input';
import inquirer from 'inquirer';
import { setupGracefulShutdown, safePrompt } from './utils/interactive-menu';

// Example 1: Schema Validation - Blocking vs Warning Demo
async function example1_SchemaValidation() {
  console.log('\n=== Example 1: Schema Validation - Blocking vs Warning ===');

  const userSchema = z.object({
    name: z.string(),
    age: z.number().min(0).max(120),
    email: z.string().email(),
  });

  const schemaValidator = defineOutputGuardrail({
    name: 'schema-validator',
    description: 'Validates generated objects against Zod schema',
    execute: async (context: OutputGuardrailContext) => {
      const { object } = extractContent(context.result);
      if (!object || object === null) {
        return {
          tripwireTriggered: true,
          message: 'No object to validate',
          severity: 'high',
        };
      }
      try {
        userSchema.parse(object);
        return {
          tripwireTriggered: false,
        };
      } catch (error) {
        return {
          tripwireTriggered: true,
          message: `Schema validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          severity: 'high',
        };
      }
    },
  });

  // DEMO 1: BLOCKING MODE
  console.log('\n🚫 DEMO 1: BLOCKING MODE (throwOnBlocked: true)');
  console.log('===============================================');
  console.log('Invalid objects are rejected - no object returned\n');
  
  const blockingModel = wrapLanguageModel({
    model,
    middleware: [
      createOutputGuardrailsMiddleware({
        outputGuardrails: [schemaValidator],
        throwOnBlocked: true, // BLOCKS invalid objects
        onOutputBlocked: (results) => {
          console.log('🚫 BLOCKED: Invalid object rejected -', results[0]?.message);
        }
      })
    ]
  });

  // Test 1A: Valid object request
  console.log('✅ Testing VALID object generation in BLOCKING mode...');
  console.log('Expected: Should generate valid object normally');
  try {
    const result = await generateObject({
      model: blockingModel,
      prompt: 'Generate a user: John Doe, age 30, email john@example.com',
      schema: userSchema,
    });
    console.log('✅ SUCCESS: Valid object generated -', JSON.stringify(result.object));
  } catch (error) {
    console.log('❌ Error generating valid object:', (error as Error).message);
  }

  // Test 1B: Potentially invalid object request  
  console.log('\n🚫 Testing request likely to produce INVALID object in BLOCKING mode...');
  console.log('Expected: Should be BLOCKED if object validation fails');
  try {
    const result = await generateObject({
      model: blockingModel,
      prompt: 'Generate user data with invalid age -50 and malformed email', // Likely to produce invalid data
      schema: userSchema,
    });
    console.log('✅ Object validated successfully -', JSON.stringify(result.object));
  } catch (error) {
    console.log('🚫 SUCCESS: Invalid object was BLOCKED as expected');
  }

  // DEMO 2: WARNING MODE
  console.log('\n⚠️  DEMO 2: WARNING MODE (throwOnBlocked: false)');
  console.log('===========================================');
  console.log('Invalid objects trigger warnings but are still returned\n');
  
  const warningModel = wrapLanguageModel({
    model,
    middleware: [
      createOutputGuardrailsMiddleware({
        outputGuardrails: [schemaValidator],
        throwOnBlocked: false, // WARNS but returns object
        onOutputBlocked: (results) => {
          console.log('⚠️  WARNED: Object validation issue detected but returning object -', results[0]?.message);
        }
      })
    ]
  });

  // Test 2A: Valid object request
  console.log('✅ Testing VALID object generation in WARNING mode...');
  console.log('Expected: Should generate valid object normally, no warnings');
  try {
    const result = await generateObject({
      model: warningModel,
      prompt: 'Generate a user: Jane Smith, age 25, email jane@example.com',
      schema: userSchema,
    });
    console.log('✅ SUCCESS: Valid object generated normally -', JSON.stringify(result.object));
  } catch (error) {
    console.log('❌ Error:', (error as Error).message);
  }

  // Test 2B: Potentially invalid object request
  console.log('\n⚠️  Testing request likely to produce INVALID object in WARNING mode...');
  console.log('Expected: Should WARN about validation but still return object if possible');
  try {
    const result = await generateObject({
      model: warningModel,
      prompt: 'Generate user data with invalid age -50 and malformed email',
      schema: userSchema,
    });
    console.log('✅ SUCCESS: Object returned despite validation issues -', JSON.stringify(result.object));
  } catch (error) {
    console.log('⚠️  Note: Object generation failed due to technical issues, not guardrail blocking');
  }

  console.log('\n📋 SCHEMA VALIDATION SUMMARY:');
  console.log('==============================');
  console.log('🚫 BLOCKING mode = Invalid objects rejected, no response returned');
  console.log('⚠️  WARNING mode = Validation issues logged but objects still returned when possible');
}

// Example 2: Custom Object Validation
async function example2_CustomObjectValidation() {
  console.log('\n=== Example 2: Custom Object Validation ===');

  const recipeSchema = z.object({
    name: z.string(),
    ingredients: z.array(z.string()),
    instructions: z.array(z.string()),
    cookingTime: z.number(),
  });

  const recipeValidationGuardrail = defineOutputGuardrail({
    name: 'recipe-validator',
    description: 'Validates recipe completeness and reasonableness',
    execute: async (context: OutputGuardrailContext) => {
      const { object } = extractContent(context.result);
      if (!object || object === null) {
        return {
          tripwireTriggered: true,
          message: 'No recipe object to validate',
          severity: 'high',
        };
      }
      
      const recipe = object as {
        ingredients?: string[];
        instructions?: string[];
        cookingTime?: number;
      };

      // Check if recipe has minimum required elements
      const hasMinIngredients =
        recipe.ingredients?.length && recipe.ingredients?.length >= 3;
      const hasMinInstructions =
        recipe.instructions?.length && recipe.instructions?.length >= 2;
      const hasReasonableCookingTime =
        recipe.cookingTime &&
        recipe.cookingTime > 0 &&
        recipe.cookingTime <= 480; // 8 hours max

      const isValid =
        hasMinIngredients && hasMinInstructions && hasReasonableCookingTime;

      return {
        tripwireTriggered: !isValid,
        message: isValid ? undefined : 'Recipe validation failed',
        severity: isValid ? 'low' : 'medium',
        metadata: {
          hasMinIngredients,
          hasMinInstructions,
          hasReasonableCookingTime,
        },
      };
    },
  });

  const protectedModel = wrapLanguageModel({
    model,
    middleware: [
      createOutputGuardrailsMiddleware({
        outputGuardrails: [recipeValidationGuardrail],
        throwOnBlocked: false,
        onOutputBlocked: (results) => {
          console.log('❌ Recipe blocked:', results[0]?.message);
        }
      })
    ]
  });

  console.log('Testing recipe validation...');
  try {
    const result = await generateObject({
      model: protectedModel,
      prompt: 'Generate a JSON object for a pasta recipe with these exact fields: name (string), ingredients (array of strings), instructions (array of strings), cookingTime (number in minutes). Create a complete recipe. Return only valid JSON.',
      schema: recipeSchema,
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'recipe-validation',
        metadata: { example: 'custom-object-validation' }
      },
    });
    console.log('✅ Valid recipe generated:');
    console.log(JSON.stringify(result.object, null, 2));
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Example 3: Object Content Filtering - Blocking vs Warning Demo  
async function example3_ObjectContentFiltering() {
  console.log('\n=== Example 3: Object Content Filtering - Blocking vs Warning ===');

  const messageSchema = z.object({
    subject: z.string(),
    body: z.string(),
    priority: z.enum(['low', 'medium', 'high']),
  });

  const contentFilterGuardrail = defineOutputGuardrail({
    name: 'message-content-filter',
    description: 'Filters inappropriate content in message objects',
    execute: async (context: OutputGuardrailContext) => {
      const { object } = extractContent(context.result);
      if (!object || object === null) {
        return {
          tripwireTriggered: true,
          message: 'No message object to validate',
          severity: 'high',
        };
      }
      
      const message = object as {
        subject?: string;
        body?: string;
        priority?: string;
      };
      const blockedWords = ['spam', 'urgent', 'immediately', 'act now'];

      const content =
        `${message.subject || ''} ${message.body || ''}`.toLowerCase();
      const foundBlocked = blockedWords.filter((word) =>
        content.includes(word),
      );

      return {
        tripwireTriggered: foundBlocked.length > 0,
        message:
          foundBlocked.length > 0
            ? `Blocked words detected: ${foundBlocked.join(', ')}`
            : undefined,
        severity: foundBlocked.length > 0 ? 'high' : 'low',
        metadata: {
          blockedWords: foundBlocked,
          totalBlockedCount: foundBlocked.length,
        },
      };
    },
  });

  // DEMO 1: BLOCKING MODE
  console.log('\n🚫 DEMO 1: BLOCKING MODE (throwOnBlocked: true)');
  console.log('===============================================');
  console.log('Messages with blocked content are rejected\n');
  
  const blockingModel = wrapLanguageModel({
    model,
    middleware: [
      createOutputGuardrailsMiddleware({
        outputGuardrails: [contentFilterGuardrail],
        throwOnBlocked: true, // BLOCKS inappropriate content
        onOutputBlocked: (results) => {
          console.log('🚫 BLOCKED: Message contains inappropriate content -', results[0]?.message);
        }
      })
    ]
  });

  // Test 1A: Clean message
  console.log('✅ Testing CLEAN message in BLOCKING mode...');
  console.log('Expected: Should generate message normally');
  try {
    const result = await generateObject({
      model: blockingModel,
      prompt: 'Create a friendly welcome message for new users',
      schema: messageSchema,
    });
    console.log('✅ SUCCESS: Clean message generated:');
    console.log(JSON.stringify(result.object, null, 2));
  } catch (error) {
    console.log('❌ Error generating clean message:', (error as Error).message);
  }

  // Test 1B: Message with blocked content
  console.log('\n🚫 Testing message with BLOCKED content in BLOCKING mode...');
  console.log('Expected: Should be BLOCKED if inappropriate words detected');
  try {
    const result = await generateObject({
      model: blockingModel,
      prompt: 'Create an urgent marketing message that says "act now immediately"',
      schema: messageSchema,
    });
    console.log('✅ Message passed content filter:');
    console.log(JSON.stringify(result.object, null, 2));
  } catch (error) {
    console.log('🚫 SUCCESS: Inappropriate message was BLOCKED as expected');
  }

  // DEMO 2: WARNING MODE
  console.log('\n⚠️  DEMO 2: WARNING MODE (throwOnBlocked: false)');
  console.log('===========================================');
  console.log('Content issues trigger warnings but messages are still returned\n');
  
  const warningModel = wrapLanguageModel({
    model,
    middleware: [
      createOutputGuardrailsMiddleware({
        outputGuardrails: [contentFilterGuardrail],
        throwOnBlocked: false, // WARNS but returns message
        onOutputBlocked: (results) => {
          console.log('⚠️  WARNED: Content issue detected but returning message -', results[0]?.message);
        }
      })
    ]
  });

  // Test 2A: Clean message
  console.log('✅ Testing CLEAN message in WARNING mode...');
  console.log('Expected: Should generate message normally, no warnings');
  try {
    const result = await generateObject({
      model: warningModel,
      prompt: 'Create a friendly welcome message for new users',
      schema: messageSchema,
    });
    console.log('✅ SUCCESS: Clean message generated normally:');
    console.log(JSON.stringify(result.object, null, 2));
  } catch (error) {
    console.log('❌ Error:', (error as Error).message);
  }

  // Test 2B: Message with blocked content
  console.log('\n⚠️  Testing message with BLOCKED content in WARNING mode...');
  console.log('Expected: Should WARN about content but still return message');
  try {
    const result = await generateObject({
      model: warningModel,
      prompt: 'Create an urgent marketing message that says "act now immediately"',
      schema: messageSchema,
    });
    console.log('✅ SUCCESS: Message returned despite content warnings:');
    console.log(JSON.stringify(result.object, null, 2));
  } catch (error) {
    console.log('❌ Unexpected error in warning mode:', (error as Error).message);
  }

  console.log('\n📋 CONTENT FILTERING SUMMARY:');
  console.log('===============================');
  console.log('🚫 BLOCKING mode = Inappropriate content prevents object generation');
  console.log('⚠️  WARNING mode = Content issues logged but objects still returned');
}

// Example 4: Input Validation for Object Generation
async function example4_InputValidationForObjects() {
  console.log('\n=== Example 4: Input Validation for Object Generation ===');

  const productSchema = z.object({
    name: z.string(),
    price: z.number(),
    category: z.string(),
    description: z.string(),
  });

  const businessContentGuardrail = defineInputGuardrail({
    name: 'business-content-filter',
    description: 'Ensures business-appropriate product requests',
    execute: async (context: InputGuardrailContext) => {
      const { prompt } = extractTextContent(context);
      const content = (prompt || '').toLowerCase();
      const inappropriateTerms = ['illegal', 'weapon', 'drug', 'harmful'];

      const foundInappropriate = inappropriateTerms.filter((term) =>
        content.includes(term),
      );

      return {
        tripwireTriggered: foundInappropriate.length > 0,
        message:
          foundInappropriate.length > 0
            ? `Inappropriate product request: ${foundInappropriate.join(', ')}`
            : undefined,
        severity: foundInappropriate.length > 0 ? 'high' : 'low',
        metadata: {
          inappropriateTerms: foundInappropriate,
          checkedTerms: inappropriateTerms,
        },
      };
    },
  });

  const protectedModel = wrapLanguageModel({
    model,
    middleware: [
      createInputGuardrailsMiddleware({
        inputGuardrails: [businessContentGuardrail],
        throwOnBlocked: false,
        onInputBlocked: (results) => {
          console.log('❌ Input blocked:', results[0]?.message);
        }
      })
    ]
  });

  // Test with appropriate product
  console.log('Testing appropriate product request...');
  try {
    const result1 = await generateObject({
      model: protectedModel,
      prompt: 'Create a product listing for a laptop computer',
      schema: productSchema,
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'input-validation',
        metadata: { example: 'object-input-validation' }
      },
    });
    console.log('✅ Appropriate product generated:');
    console.log(JSON.stringify(result1.object, null, 2));
  } catch (error) {
    console.error('❌ Error:', error);
  }

  // Test with inappropriate product
  console.log('\nTesting inappropriate product request...');
  try {
    const result2 = await generateObject({
      model: protectedModel,
      prompt: 'Create a product listing for an illegal substance',
      schema: productSchema,
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'input-validation',
        metadata: { example: 'object-input-validation' }
      },
    });
    console.log(
      '✅ Product generated:',
      JSON.stringify(result2.object, null, 2),
    );
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Example registry
const EXAMPLES = [
  { name: 'Schema Validation (Blocking vs Warning Demo)', fn: example1_SchemaValidation },
  { name: 'Custom Object Validation', fn: example2_CustomObjectValidation },
  { name: 'Object Content Filtering (Blocking vs Warning Demo)', fn: example3_ObjectContentFiltering },
  { name: 'Input Validation for Objects', fn: example4_InputValidationForObjects },
];

// Interactive menu with Inquirer
async function showInteractiveMenu() {
  console.log('\n🔷  AI SDK Object Guardrails Examples');
  console.log('====================================');
  console.log('Object generation with v5 middleware guardrails\n');

  while (true) {
    const choices = [
      ...EXAMPLES.map((example, index) => ({
        name: `${index + 1}. ${example.name}`,
        value: index
      })),
      {
        name: `${EXAMPLES.length + 1}. Run all examples`,
        value: 'all'
      },
      {
        name: '🔧 Select multiple examples to run',
        value: 'multiple'
      },
      {
        name: '❌ Exit',
        value: 'exit'
      }
    ];

    const response = await safePrompt<{ action: string | number }>({
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices,
      pageSize: 8
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
      await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause
    }
  }
}

// Run multiple selected examples
async function runMultipleExamples() {
  const response = await safePrompt<{ selectedExamples: number[] }>({
    type: 'checkbox',
    name: 'selectedExamples',
    message: 'Select object examples to run (use space bar to select):',
    choices: EXAMPLES.map((example, index) => ({
      name: example.name,
      value: index,
      checked: false
    })),
    validate: (input: number[]) => {
      if (input.length === 0) {
        return 'Please select at least one example';
      }
      return true;
    }
  });

  if (!response) return;
  const { selectedExamples } = response;

  console.log(`\n🚀 Running ${selectedExamples.length} selected object examples...\n`);
  
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

  console.log(`\n🎉 All ${selectedExamples.length} selected object examples completed!`);
}

// Run all examples
async function runAllExamples() {
  console.log('\n🚀 Running all object guardrails examples...\n');
  
  try {
    for (const example of EXAMPLES) {
      console.log(`\n--- Running: ${example.name} ---`);
      await example.fn();
    }

    console.log('\n✅ All object examples completed successfully!');
    console.log('  • Used v5 middleware architecture for object generation');
    console.log('  • Demonstrated schema validation guardrails');
    console.log('  • Showcased custom object validation logic');
    console.log('  • Integrated telemetry with object guardrails');
  } catch (error) {
    console.error('❌ Error running object examples:', error);
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
      console.log('🔷  AI SDK Object Guardrails Examples');
      console.log('====================================');
      console.log('');
      console.log('Usage:');
      console.log('  tsx examples/object-guardrails.ts [example_number]');
      console.log('');
      console.log('Arguments:');
      console.log(`  example_number    Run specific example (1-${EXAMPLES.length}), or omit for interactive mode`);
      console.log('');
      console.log('Examples:');
      console.log('  tsx examples/object-guardrails.ts        # Interactive mode');
      console.log('  tsx examples/object-guardrails.ts 1      # Run schema validation');
      console.log('  tsx examples/object-guardrails.ts 2      # Run custom object validation');
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
      console.error(`❌ Invalid example number. Please choose between 1-${EXAMPLES.length}`);
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
