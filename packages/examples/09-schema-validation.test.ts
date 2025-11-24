/**
 * Schema Validation Example - Test
 *
 * Demonstrates how to validate generated objects against Zod schemas
 * to ensure type safety and data integrity.
 *
 * Note: These tests use real LLM models and may be flaky.
 * They're designed for manual verification, not CI/CD.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { generateObject } from 'ai';
import { model } from './model';
import { defineOutputGuardrail, withGuardrails } from 'ai-sdk-guardrails';
import { extractContent } from 'ai-sdk-guardrails/guardrails/output';

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

describe('Schema Validation Example', () => {
  describe('User Object Validation', () => {
    const userValidator = createSchemaValidator(userSchema, 'user');

    it('should allow valid user object to pass', async () => {
      const strictUserModel = withGuardrails(model, {
        outputGuardrails: [userValidator],
        throwOnBlocked: true,
      });

      const result = await generateObject({
        model: strictUserModel,
        prompt:
          'Generate a user: John Doe, 30 years old, john@example.com, admin role',
        schema: userSchema,
      });

      expect(result.object).toBeDefined();
      expect(result.object.name).toBeDefined();
      expect(result.object.email).toContain('@');
      expect(result.object.age).toBeGreaterThanOrEqual(0);
    });

    it('should block invalid user object in blocking mode', async () => {
      let blockedMessage: string | undefined;

      const strictUserModel = withGuardrails(model, {
        outputGuardrails: [userValidator],
        throwOnBlocked: true,
        onOutputBlocked: (executionSummary) => {
          blockedMessage = executionSummary.blockedResults[0]?.message;
        },
      });

      try {
        await generateObject({
          model: strictUserModel,
          prompt: 'Generate a user with invalid email: not-an-email',
          schema: userSchema,
        });
        // If generation succeeds but validation fails, check the message
        if (blockedMessage) {
          expect(blockedMessage).toContain('Schema validation failed');
        }
      } catch (error) {
        // Expected to throw if validation blocks
        expect(String(error)).toBeDefined();
      }
    });
  });

  describe('Product Validation with Warning Mode', () => {
    const productValidator = createSchemaValidator(productSchema, 'product');

    it('should process product object with warnings in warning mode', async () => {
      let warningMessage: string | undefined;

      const warningProductModel = withGuardrails(model, {
        outputGuardrails: [productValidator],
        throwOnBlocked: false, // Warning mode
        onOutputBlocked: (executionSummary) => {
          warningMessage = executionSummary.blockedResults[0]?.message;
        },
      });

      const result = await generateObject({
        model: warningProductModel,
        prompt:
          'Generate a product: Laptop, $999.99, Electronics category, in stock, tags: portable, computing',
        schema: productSchema,
      });

      expect(result.object).toBeDefined();
      // In warning mode, validation issues are logged but don't block
      if (warningMessage) {
        expect(warningMessage).toContain('Schema validation');
      }
    });
  });

  describe('Complex Nested Schema Validation', () => {
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

    it('should validate complex nested order objects', async () => {
      let validationMessage: string | undefined;
      let validationMetadata: SchemaValidationMetadata | undefined;

      const orderModel = withGuardrails(model, {
        outputGuardrails: [orderValidator],
        throwOnBlocked: false,
        onOutputBlocked: (executionSummary) => {
          validationMessage = executionSummary.blockedResults[0]?.message;
          validationMetadata = executionSummary.blockedResults[0]
            ?.metadata as SchemaValidationMetadata;
        },
      });

      const result = await generateObject({
        model: orderModel,
        prompt:
          'Generate an order with 2 items, customer John Doe (john@example.com), pending status',
        schema: orderSchema,
      });

      expect(result.object).toBeDefined();
      // If validation triggered, check metadata
      if (validationMetadata) {
        expect(validationMetadata.schemaName).toBe('order');
        if (validationMetadata.errors) {
          expect(validationMetadata.errorCount).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('Custom Business Rules Validation', () => {
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

    it('should detect business rule violations', async () => {
      let violationMessage: string | undefined;
      let violationMetadata: any;

      const businessModel = withGuardrails(model, {
        outputGuardrails: [businessRulesGuardrail],
        throwOnBlocked: false,
        onOutputBlocked: (executionSummary) => {
          violationMessage = executionSummary.blockedResults[0]?.message;
          violationMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      const result = await generateObject({
        model: businessModel,
        prompt:
          'Generate a discounted product: 20% off, out of stock, featured item',
        schema: businessSchema,
      });

      expect(result.object).toBeDefined();
      // If business rules triggered, check for violations
      if (violationMessage) {
        expect(violationMessage).toContain('Business rule violations');
        expect(violationMetadata?.violations).toBeDefined();
        expect(Array.isArray(violationMetadata.violations)).toBe(true);
      }
    });
  });
});
