/**
 * Schema Validation Example
 *
 * Demonstrates how to validate generated objects against Zod schemas
 * to ensure type safety and data integrity.
 *
 * NOTE: For generateObject scenarios, the recommended approach is to use
 * executeOutputGuardrails() after generation for reliable validation.
 */

import { z } from 'zod';
import { generateObject } from 'ai';
import { mistralModel as model } from './model';
import { defineOutputGuardrail, withGuardrails } from '../src/index';
import { extractContent } from '../src/guardrails/output';

// Define schemas for different object types
const userSchema = z.object({
  name: z.string().min(1),
  age: z.number().min(0).max(120),
  email: z.string().email(),
  role: z.enum(['admin', 'user', 'guest']).optional(),
});

const productSchema = z.object({
  name: z.string(),
  price: z.number().positive(),
  category: z.string(),
  inStock: z.boolean(),
  tags: z.array(z.string()).optional(),
});

// Define the metadata type for schema validation
interface SchemaValidationMetadata extends Record<string, unknown> {
  schemaName: string;
  valid?: boolean;
  errors?: z.ZodIssue[];
  errorCount?: number;
}

// Create a schema validation guardrail
function createSchemaValidator<T>(schema: z.ZodSchema<T>, schemaName: string) {
  return defineOutputGuardrail<SchemaValidationMetadata>({
    name: `${schemaName}-validator`,
    description: `Validates objects against ${schemaName} schema`,
    execute: async (context) => {
      const { object } = extractContent(context.result);

      // Allow null/undefined objects to pass through - they may be generated later
      if (!object || object === null) {
        return {
          tripwireTriggered: false,
          metadata: { schemaName },
        };
      }

      try {
        schema.parse(object);
        return {
          tripwireTriggered: false,
          metadata: { schemaName, valid: true },
        };
      } catch (error) {
        if (error instanceof z.ZodError) {
          return {
            tripwireTriggered: true,
            message: `Schema validation failed: ${error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
            severity: 'high',
            metadata: {
              schemaName,
              valid: false,
              errors: error.issues,
              errorCount: error.issues.length,
            },
          };
        }
        return {
          tripwireTriggered: true,
          message: `Validation error: ${error}`,
          severity: 'high',
          metadata: { schemaName, valid: false },
        };
      }
    },
  });
}

console.log('📋 Schema Validation Example\n');

// Example 1: User object validation
console.log('Example 1: User Object Validation');
console.log('==================================\n');

const userValidator = createSchemaValidator(userSchema, 'user');

// Blocking mode - rejects invalid objects
const strictUserModel = withGuardrails(model, {
  outputGuardrails: [userValidator],
  throwOnBlocked: true,
  onOutputBlocked: (executionSummary) => {
    console.log(
      '🚫 Validation failed:',
      executionSummary.blockedResults[0]?.message,
    );
    const metadata = executionSummary.blockedResults[0]?.metadata as {
      errors?: z.ZodIssue[];
    };
    if (metadata?.errors) {
      console.log('   Errors:');
      for (const err of metadata.errors) {
        console.log(`   - ${err.path.join('.')}: ${err.message}`);
      }
    }
  },
});

// Test valid user
console.log('Test 1: Valid user object');
try {
  const result = await generateObject({
    model: strictUserModel,
    prompt:
      'Generate a user: John Doe, 30 years old, john@example.com, admin role',
    schema: userSchema,
  });
  console.log(
    '✅ Valid user generated:',
    JSON.stringify(result.object, null, 2),
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message);
  throw error;
}

// Test invalid user (might fail validation)
console.log('\nTest 2: User with invalid email');
try {
  const result = await generateObject({
    model: strictUserModel,
    prompt: 'Generate a user with invalid email: not-an-email',
    schema: userSchema,
  });
  console.log('✅ Generated:', JSON.stringify(result.object, null, 2));
} catch {
  console.log('❌ Validation blocked the object');
}

// Example 2: Product validation with warning mode
console.log('\n\nExample 2: Product Object Validation (Warning Mode)');
console.log('===================================================\n');

const productValidator = createSchemaValidator(productSchema, 'product');

const warningProductModel = withGuardrails(model, {
  outputGuardrails: [productValidator],
  throwOnBlocked: false, // Warning mode
  onOutputBlocked: (executionSummary) => {
    console.log(
      '⚠️  Validation warning:',
      executionSummary.blockedResults[0]?.message,
    );
  },
});

console.log('Test: Generate product object');
try {
  const result = await generateObject({
    model: warningProductModel,
    prompt:
      'Generate a product: Laptop, $999.99, Electronics category, in stock, tags: portable, computing',
    schema: productSchema,
  });
  console.log('✅ Product generated:', JSON.stringify(result.object, null, 2));
} catch (error) {
  console.log('❌ Error:', (error as Error).message);
  throw error;
}

// Example 3: Complex nested schema validation
console.log('\n\nExample 3: Complex Nested Schema');
console.log('================================\n');

const orderSchema = z.object({
  orderId: z.string().uuid(),
  customer: z.object({
    name: z.string(),
    email: z.string().email(),
  }),
  items: z
    .array(
      z.object({
        productId: z.string(),
        quantity: z.number().positive().int(),
        price: z.number().positive(),
      }),
    )
    .min(1),
  total: z.number().positive(),
  status: z.enum(['pending', 'processing', 'shipped', 'delivered']),
});

const orderValidator = createSchemaValidator(orderSchema, 'order');

const orderModel = withGuardrails(model, {
  outputGuardrails: [orderValidator],
  throwOnBlocked: false,
  onOutputBlocked: (executionSummary) => {
    console.log(
      '⚠️  Order validation:',
      executionSummary.blockedResults[0]?.message,
    );
  },
});

try {
  const result = await generateObject({
    model: orderModel,
    prompt:
      'Generate an order with 2 items, customer John Doe (john@example.com), pending status',
    schema: orderSchema,
  });
  console.log(
    '✅ Complex order generated:',
    JSON.stringify(result.object, null, 2),
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message);
  throw error;
}

// Example 4: Custom validation rules
console.log('\n\nExample 4: Custom Business Rules Validation');
console.log('==========================================\n');

const businessRulesGuardrail = defineOutputGuardrail({
  name: 'business-rules',
  description: 'Validates business-specific rules',
  execute: async (context) => {
    const { object } = extractContent(context.result);

    // Allow null/undefined objects to pass through - they may be generated later
    if (!object || object === null) {
      return { tripwireTriggered: false };
    }

    const product = object as Record<string, unknown>;
    const violations: string[] = [];

    // Business rule 1: Discounted items must have original price
    if (product.discount && !product.originalPrice) {
      violations.push('Discounted items must have original price');
    }

    // Business rule 2: Out of stock items shouldn't be featured
    if (product.inStock === false && product.featured === true) {
      violations.push('Out of stock items cannot be featured');
    }

    // Business rule 3: Price consistency
    if (
      product.originalPrice &&
      product.price &&
      typeof product.price === 'number' &&
      typeof product.originalPrice === 'number' &&
      product.price > product.originalPrice
    ) {
      violations.push('Sale price cannot exceed original price');
    }

    if (violations.length > 0) {
      return {
        tripwireTriggered: true,
        message: `Business rule violations: ${violations.join(', ')}`,
        severity: 'medium',
        metadata: { violations },
      };
    }

    return { tripwireTriggered: false };
  },
});

const businessSchema = z.object({
  name: z.string(),
  price: z.number().positive(),
  originalPrice: z.number().positive().optional(),
  discount: z.number().min(0).max(100).optional(),
  inStock: z.boolean(),
  featured: z.boolean().optional(),
});

const businessModel = withGuardrails(model, {
  outputGuardrails: [businessRulesGuardrail],
  throwOnBlocked: false,
  onOutputBlocked: (executionSummary) => {
    console.log(
      '⚠️  Business rule violation:',
      executionSummary.blockedResults[0]?.message,
    );
  },
});

try {
  const result = await generateObject({
    model: businessModel,
    prompt:
      'Generate a discounted product: 20% off, out of stock, featured item',
    schema: businessSchema,
  });
  console.log(
    '✅ Product with business rules:',
    JSON.stringify(result.object, null, 2),
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message);
  throw error;
}

console.log('\n📊 Summary:');
console.log('• Use schema validation for type safety');
console.log('• Blocking mode for critical data integrity');
console.log('• Warning mode for monitoring and debugging');
console.log('• Combine with business rules for domain logic\n');
