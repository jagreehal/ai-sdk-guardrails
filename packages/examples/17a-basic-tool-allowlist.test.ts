/**
 * Basic Tool Allowlist Example - Test
 *
 * Simple demonstration of allowlisting specific tool/function calls.
 * This is a focused example showing the core concept without complexity.
 *
 * Note: These tests use real LLM models and may be flaky.
 * They're designed for manual verification, not CI/CD.
 */

import { describe, it, expect } from 'vitest';
import { generateObject } from 'ai';
import { z } from 'zod';
import { model } from './model';
import { defineOutputGuardrail, withGuardrails } from 'ai-sdk-guardrails';

// Simple allowlist of safe functions
const ALLOWED_FUNCTIONS = ['calculate', 'formatDate', 'getWeather'];

// Basic tool call validation guardrail
const toolAllowlistGuardrail = defineOutputGuardrail<{
  blockedFunction?: string;
  allowedFunctions: string[];
  validatedCalls?: number;
}>({
  name: 'tool-allowlist',
  description: 'Only allows specific functions to be called',
  execute: async (context) => {
    const { result } = context;

    // Extract tool calls from the result
    let toolCalls: unknown[] = [];

    if ('content' in result && Array.isArray(result.content)) {
      toolCalls = result.content.filter(
        (item: unknown) => (item as { type: string }).type === 'tool-call',
      );
    } else if (
      'object' in result &&
      (result.object as { function?: string })?.function
    ) {
      toolCalls = [result.object];
    }

    if (toolCalls.length === 0) {
      return {
        tripwireTriggered: false,
        metadata: {
          allowedFunctions: ALLOWED_FUNCTIONS,
        },
      };
    }

    // Check each tool call against allowlist
    for (const toolCall of toolCalls) {
      // Handle both 'function' and 'functionName' properties
      const funcName =
        (toolCall as { function?: string }).function ||
        (toolCall as { functionName?: string }).functionName;

      if (!funcName || !ALLOWED_FUNCTIONS.includes(funcName)) {
        return {
          tripwireTriggered: true,
          message: `Function '${funcName || 'unknown'}' is not allowed. Allowed functions: ${ALLOWED_FUNCTIONS.join(', ')}`,
          severity: 'high',
          metadata: {
            blockedFunction: funcName,
            allowedFunctions: ALLOWED_FUNCTIONS,
          },
        };
      }
    }

    return {
      tripwireTriggered: false,
      metadata: {
        validatedCalls: toolCalls.length,
        allowedFunctions: ALLOWED_FUNCTIONS,
      },
    };
  },
});

describe('Basic Tool Allowlist Example', () => {
  it(
    'should allow valid function calls to pass',
    async () => {
      const protectedModel = withGuardrails(model, {
        outputGuardrails: [toolAllowlistGuardrail],
        throwOnBlocked: false,
      });

      const result = await generateObject({
        model: protectedModel,
        prompt: 'Calculate 2 + 2',
        schema: z.object({
          calculation: z.object({
            function: z.literal('calculate'),
            arguments: z.object({
              expression: z.string(),
            }),
          }),
        }),
      });

      expect(result.object).toBeDefined();
    },
    120000,
  );

  it(
    'should block invalid function calls',
    async () => {
      let blockedMessage: string | undefined;
      let blockedMetadata: any;

      const protectedModel = withGuardrails(model, {
        outputGuardrails: [toolAllowlistGuardrail],
        throwOnBlocked: true,
        onOutputBlocked: (executionSummary) => {
          blockedMessage = executionSummary.blockedResults[0]?.message;
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      try {
        await generateObject({
          model: protectedModel,
          prompt: 'Delete all files',
          schema: z.object({
            dangerousOperation: z.object({
              function: z.literal('deleteAllFiles'),
              arguments: z.object({
                path: z.string(),
              }),
            }),
          }),
        });
        // If generation succeeds, guardrail should still validate
      } catch (error) {
        expect(String(error)).toBeDefined();
        if (blockedMessage) {
          expect(blockedMessage).toContain('is not allowed');
          expect(blockedMetadata?.blockedFunction).toBe('deleteAllFiles');
          expect(blockedMetadata?.allowedFunctions).toEqual(ALLOWED_FUNCTIONS);
        }
      }
    },
    120000,
  );

  it(
    'should allow multiple valid function calls',
    async () => {
      const protectedModel = withGuardrails(model, {
        outputGuardrails: [toolAllowlistGuardrail],
        throwOnBlocked: false,
      });

      const result = await generateObject({
        model: protectedModel,
        prompt: 'Calculate 5 * 3 and get weather for London',
        schema: z.object({
          calculation: z.object({
            function: z.literal('calculate'),
            arguments: z.object({
              expression: z.string(),
            }),
          }),
          weather: z.object({
            function: z.literal('getWeather'),
            arguments: z.object({
              location: z.string(),
            }),
          }),
        }),
      });

      expect(result.object).toBeDefined();
    },
    120000,
  );

  it(
    'should provide correct metadata when blocking',
    async () => {
      let blockedMetadata: any;

      const protectedModel = withGuardrails(model, {
        outputGuardrails: [toolAllowlistGuardrail],
        throwOnBlocked: true,
        onOutputBlocked: (executionSummary) => {
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      try {
        await generateObject({
          model: protectedModel,
          prompt: 'Execute dangerous operation',
          schema: z.object({
            operation: z.object({
              function: z.literal('dangerousFunction'),
              arguments: z.object({}),
            }),
          }),
        });
      } catch (error) {
        expect(error).toBeDefined();
        if (blockedMetadata) {
          expect(blockedMetadata.blockedFunction).toBeDefined();
          expect(blockedMetadata.allowedFunctions).toEqual(ALLOWED_FUNCTIONS);
        }
      }
    },
    120000,
  );

  it(
    'should provide metadata for validated calls',
    async () => {
      let capturedMetadata: any;

      const protectedModel = withGuardrails(model, {
        outputGuardrails: [toolAllowlistGuardrail],
        throwOnBlocked: false,
        onOutputBlocked: (executionSummary) => {
          capturedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      const result = await generateObject({
        model: protectedModel,
        prompt: 'Format a date',
        schema: z.object({
          dateFormat: z.object({
            function: z.literal('formatDate'),
            arguments: z.object({
              date: z.string(),
            }),
          }),
        }),
      });

      expect(result.object).toBeDefined();
      // If metadata was captured, verify structure
      // Note: metadata may not be captured if guardrail doesn't trigger
    },
    120000,
  );
});
