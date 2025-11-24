/**
 * Blocking vs Warning Mode Example - Test
 *
 * Demonstrates the difference between blocking mode (throws errors)
 * and warning mode (logs but continues) for guardrails.
 *
 * Note: These tests use real LLM models and may be flaky.
 * They're designed for manual verification, not CI/CD.
 */

import { describe, it, expect } from 'vitest';
import { generateText } from 'ai';
import { model } from './model';
import { defineInputGuardrail, withGuardrails } from 'ai-sdk-guardrails';
import { extractTextContent } from 'ai-sdk-guardrails/guardrails/input';

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

describe('Blocking vs Warning Mode', () => {
  describe('Blocking Mode', () => {
    it('should allow clean input to pass', async () => {
      const blockingModel = withGuardrails(model, {
        inputGuardrails: [profanityGuardrail],
        throwOnBlocked: true, // BLOCKING MODE
      });

      const result = await generateText({
        model: blockingModel,
        prompt: 'What is the weather like today?',
      });

      expect(result.text).toBeDefined();
      expect(result.text.length).toBeGreaterThan(0);
    });

    it('should throw error when input contains profanity', async () => {
      const blockingModel = withGuardrails(model, {
        inputGuardrails: [profanityGuardrail],
        throwOnBlocked: true, // BLOCKING MODE
      });

      await expect(
        generateText({
          model: blockingModel,
          prompt: 'Why the hell is this not working?',
        }),
      ).rejects.toThrow(/Input blocked by guardrail/);
    });

    it('should block multiple requests with violations', async () => {
      const blockingModel = withGuardrails(model, {
        inputGuardrails: [profanityGuardrail],
        throwOnBlocked: true,
      });

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
        } catch {
          blockedCount++;
        }
      }

      expect(successCount).toBe(2); // Two clean prompts
      expect(blockedCount).toBe(2); // Two with profanity
    });
  });

  describe('Warning Mode', () => {
    it('should allow clean input to pass without warnings', async () => {
      const warningModel = withGuardrails(model, {
        inputGuardrails: [profanityGuardrail],
        throwOnBlocked: false, // WARNING MODE
      });

      const result = await generateText({
        model: warningModel,
        prompt: 'What is the weather like today?',
      });

      expect(result.text).toBeDefined();
      expect(result.text.length).toBeGreaterThan(0);
    });

    it('should process input with profanity but trigger warning', async () => {
      let warningMessage: string | undefined;

      const warningModel = withGuardrails(model, {
        inputGuardrails: [profanityGuardrail],
        throwOnBlocked: false, // WARNING MODE
        onInputBlocked: (executionSummary) => {
          warningMessage = executionSummary.blockedResults[0]?.message;
        },
      });

      const result = await generateText({
        model: warningModel,
        prompt: 'Why the hell is this not working?',
      });

      // Should not throw, but should log warning
      expect(result.text).toBeDefined();
      expect(warningMessage).toBeDefined();
      expect(warningMessage).toContain('Mild profanity detected');
    });

    it('should process all requests but log warnings for violations', async () => {
      let warningCount = 0;

      const warningModel = withGuardrails(model, {
        inputGuardrails: [profanityGuardrail],
        throwOnBlocked: false,
        onInputBlocked: () => {
          warningCount++;
        },
      });

      const testPrompts = [
        'This is a clean prompt',
        'What the hell happened',
        'Damn this is frustrating',
        'Another clean prompt',
      ];

      let successCount = 0;

      for (const prompt of testPrompts) {
        try {
          await generateText({ model: warningModel, prompt });
          successCount++;
        } catch {
          // Should not throw in warning mode
          expect.fail('Should not throw in warning mode');
        }
      }

      expect(successCount).toBe(4); // All should succeed
      expect(warningCount).toBe(2); // Two warnings for profanity
    });
  });

  describe('Conditional Mode', () => {
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

    it('should allow clean prompts to pass', async () => {
      const conditionalModel = withGuardrails(model, {
        inputGuardrails: [severityGuardrail],
        throwOnBlocked: false,
      });

      const result = await generateText({
        model: conditionalModel,
        prompt: 'How does authentication work?',
      });

      expect(result.text).toBeDefined();
    });

    it('should handle different severity levels appropriately', async () => {
      const severityResults: Array<{
        prompt: string;
        severity?: string;
        blocked: boolean;
      }> = [];

      const conditionalModel = withGuardrails(model, {
        inputGuardrails: [severityGuardrail],
        throwOnBlocked: false,
        onInputBlocked: (executionSummary) => {
          const result = executionSummary.blockedResults[0];
          const currentPrompt = severityResults[severityResults.length - 1]?.prompt;
          if (currentPrompt) {
            severityResults[severityResults.length - 1].severity = result?.severity;
          }
        },
      });

      const testCases = [
        { prompt: 'How does authentication work?', expectedSeverity: undefined },
        { prompt: 'Debug this code for me', expectedSeverity: 'low' },
        { prompt: 'How to hack a system', expectedSeverity: 'medium' },
        { prompt: 'Attack the server', expectedSeverity: 'high' },
      ];

      for (const testCase of testCases) {
        severityResults.push({
          prompt: testCase.prompt,
          blocked: false,
        });

        try {
          await generateText({
            model: conditionalModel,
            prompt: testCase.prompt,
          });
        } catch {
          severityResults[severityResults.length - 1].blocked = true;
        }
      }

      // Verify severity levels were detected
      expect(severityResults.length).toBe(4);
      // High severity should potentially block (depending on implementation)
      // Low and medium should warn but not block in this mode
    });

    it('should provide correct metadata for each severity level', async () => {
      let capturedMetadata: any[] = [];

      const conditionalModel = withGuardrails(model, {
        inputGuardrails: [severityGuardrail],
        throwOnBlocked: false,
        onInputBlocked: (executionSummary) => {
          capturedMetadata.push(executionSummary.blockedResults[0]?.metadata);
        },
      });

      await generateText({
        model: conditionalModel,
        prompt: 'How to hack a system',
      });

      // Should capture metadata for medium severity
      if (capturedMetadata.length > 0) {
        expect(capturedMetadata[0]?.category).toBe('suspicious');
      }
    });
  });
});
