import { z } from 'zod';
import { model } from './model';
import {
  generateObjectWithGuardrails,
  createInputGuardrail,
  createOutputGuardrail,
  GuardrailError,
} from '../src/core';
import { extractContent } from '../src/guardrails/output';
import { extractTextContent } from '../src/guardrails/input';

// Example 1: Schema Validation
async function example1_SchemaValidation() {
  console.log('\n=== Example 1: Schema Validation ===');

  const userSchema = z.object({
    name: z.string(),
    age: z.number().min(0).max(120),
    email: z.string().email(),
  });

  const schemaValidator = createOutputGuardrail(
    'schema-validator',
    async (context) => {
      const { object } = extractContent(context.result);
      try {
        userSchema.parse(object);
        return {
          tripwireTriggered: false,
        };
      } catch {
        return {
          tripwireTriggered: true,
          message: 'Schema validation failed',
          severity: 'high',
        };
      }
    },
  );

  console.log('Testing schema validation...');
  try {
    const result = await generateObjectWithGuardrails(
      {
        model,
        prompt:
          'Create a user profile for John Doe, age 30, email john@example.com',
        schema: userSchema,
      } as any,
      {
        outputGuardrails: [schemaValidator],
      },
    );
    console.log('✅ Valid object generated:', result.object);
  } catch (error) {
    if (error instanceof GuardrailError) {
      console.log('❌ Output blocked:', error.reason);
    }
  }
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

  const recipeValidationGuardrail = createOutputGuardrail(
    'recipe-validator',
    async (context) => {
      const { object } = extractContent(context.result);
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
  );

  console.log('Testing recipe validation...');
  try {
    const result = await generateObjectWithGuardrails(
      {
        model,
        prompt: 'Create a simple pasta recipe',
        schema: recipeSchema,
      } as any,
      {
        outputGuardrails: [recipeValidationGuardrail],
      },
    );
    console.log('✅ Valid recipe generated:');
    console.log(JSON.stringify(result.object, null, 2));
  } catch (error) {
    if (error instanceof GuardrailError) {
      console.log('❌ Recipe blocked:', error.reason);
    }
  }
}

// Example 3: Content Filtering for Objects
async function example3_ObjectContentFiltering() {
  console.log('\n=== Example 3: Object Content Filtering ===');

  const messageSchema = z.object({
    subject: z.string(),
    body: z.string(),
    priority: z.enum(['low', 'medium', 'high']),
  });

  const contentFilterGuardrail = createOutputGuardrail(
    'message-content-filter',
    async (context) => {
      const { object } = extractContent(context.result);
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
  );

  // Test with normal message
  console.log('Testing normal message...');
  try {
    const result1 = await generateObjectWithGuardrails(
      {
        model,
        prompt: 'Create a friendly welcome message for new users',
        schema: messageSchema,
      } as any,
      {
        outputGuardrails: [contentFilterGuardrail],
      },
    );
    console.log('✅ Normal message generated:');
    console.log(JSON.stringify(result1.object, null, 2));
  } catch (error) {
    if (error instanceof GuardrailError) {
      console.log('❌ Message blocked:', error.reason);
    }
  }

  // Test with potentially spammy message
  console.log('\nTesting potentially spammy message...');
  try {
    const result2 = await generateObjectWithGuardrails(
      {
        model,
        prompt: 'Create an urgent marketing message about a limited-time offer',
        schema: messageSchema,
      } as any,
      {
        outputGuardrails: [contentFilterGuardrail],
      },
    );
    console.log('✅ Message passed filter:');
    console.log(JSON.stringify(result2.object, null, 2));
  } catch (error) {
    if (error instanceof GuardrailError) {
      console.log('❌ Message blocked:', error.reason);
    }
  }
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

  const businessContentGuardrail = createInputGuardrail(
    'business-content-filter',
    'Ensures business-appropriate product requests',
    async (context) => {
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
  );

  // Test with appropriate product
  console.log('Testing appropriate product request...');
  try {
    const result1 = await generateObjectWithGuardrails(
      {
        model,
        prompt: 'Create a product listing for a laptop computer',
        schema: productSchema,
      } as any,
      {
        inputGuardrails: [businessContentGuardrail],
      },
    );
    console.log('✅ Appropriate product generated:');
    console.log(JSON.stringify(result1.object, null, 2));
  } catch (error) {
    if (error instanceof GuardrailError) {
      console.log('❌ Input blocked:', error.reason);
    }
  }

  // Test with inappropriate product
  console.log('\nTesting inappropriate product request...');
  try {
    const result2 = await generateObjectWithGuardrails(
      {
        model,
        prompt: 'Create a product listing for an illegal substance',
        schema: productSchema,
      } as any,
      {
        inputGuardrails: [businessContentGuardrail],
      },
    );
    console.log(
      '✅ Product generated:',
      JSON.stringify(result2.object, null, 2),
    );
  } catch (error) {
    if (error instanceof GuardrailError) {
      console.log('❌ Input blocked:', error.reason);
    }
  }
}

// Main execution
async function main() {
  console.log('🔷 AI SDK Object Guardrails Examples');
  console.log('====================================');

  try {
    await example1_SchemaValidation();
    await example2_CustomObjectValidation();
    await example3_ObjectContentFiltering();
    await example4_InputValidationForObjects();

    console.log('\n✅ All object examples completed successfully!');
  } catch (error) {
    console.error('❌ Error running object examples:', error);
  }
}

// Run automatically
main().catch(console.error);
