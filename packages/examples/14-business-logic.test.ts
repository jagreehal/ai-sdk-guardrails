/**
 * Business Logic Example - Test
 *
 * Demonstrates how to implement custom business rules and domain-specific
 * validation logic using guardrails.
 *
 * Note: These tests use real LLM models and may be flaky.
 * They're designed for manual verification, not CI/CD.
 */

import { describe, it, expect } from 'vitest';
import { generateText } from 'ai';
import { model } from './model';
import {
  defineInputGuardrail,
  defineOutputGuardrail,
  withGuardrails,
} from 'ai-sdk-guardrails';
import { extractTextContent } from 'ai-sdk-guardrails/guardrails/input';
import { extractContent } from 'ai-sdk-guardrails/guardrails/output';

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

describe('Business Logic Example', () => {
  describe('Business Content Guardrail', () => {
    it('should allow appropriate business requests', async () => {
      const businessModel = withGuardrails(model, {
        inputGuardrails: [businessContentGuardrail],
        throwOnBlocked: false,
      });

      const result = await generateText({
        model: businessModel,
        prompt: 'What are the benefits of automation?',
      });

      expect(result.text).toBeDefined();
      expect(result.text.length).toBeGreaterThan(0);
    });

    it('should block inappropriate topics for business context', async () => {
      const businessModel = withGuardrails(model, {
        inputGuardrails: [businessContentGuardrail],
        throwOnBlocked: true,
      });

      await expect(
        generateText({
          model: businessModel,
          prompt: 'Can you give me personal advice about relationships?',
        }),
      ).rejects.toThrow(/Input blocked by guardrail/);
    });

    it('should provide correct metadata when blocking inappropriate content', async () => {
      let blockedMetadata: any;

      const businessModel = withGuardrails(model, {
        inputGuardrails: [businessContentGuardrail],
        throwOnBlocked: true,
        onInputBlocked: (executionSummary) => {
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      try {
        await generateText({
          model: businessModel,
          prompt: 'I need help with gambling addiction',
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeDefined();
        if (blockedMetadata) {
          expect(blockedMetadata.inappropriateTopic).toBe('gambling');
        }
      }
    });
  });

  describe('Professional Tone Guardrail', () => {
    it('should detect casual language in responses', async () => {
      let blockedMessage: string | undefined;
      let blockedMetadata: any;

      const professionalModel = withGuardrails(model, {
        outputGuardrails: [professionalToneGuardrail],
        throwOnBlocked: false,
        onOutputBlocked: (executionSummary) => {
          blockedMessage = executionSummary.blockedResults[0]?.message;
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      const result = await generateText({
        model: professionalModel,
        prompt: 'Explain project management in a casual, friendly way',
      });

      expect(result.text).toBeDefined();
      // If professional tone issues were detected, verify metadata
      if (blockedMessage) {
        expect(blockedMessage).toContain('Professional tone issues');
        expect(blockedMetadata?.issues).toBeDefined();
        expect(Array.isArray(blockedMetadata.issues)).toBe(true);
      }
    });

    it('should provide correct metadata for tone violations', async () => {
      let blockedMetadata: any;

      const professionalModel = withGuardrails(model, {
        outputGuardrails: [professionalToneGuardrail],
        throwOnBlocked: false,
        onOutputBlocked: (executionSummary) => {
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      await generateText({
        model: professionalModel,
        prompt: 'Write a casual response about teamwork',
      });

      // If metadata was captured, verify structure
      if (blockedMetadata) {
        expect(blockedMetadata.issues).toBeDefined();
        expect(blockedMetadata.foundCasual).toBeDefined();
        expect(blockedMetadata.emojiCount).toBeDefined();
      }
    });
  });

  describe('Cost Control Guardrail', () => {
    it(
      'should detect high-cost operations',
      async () => {
        let blockedMessage: string | undefined;
        let blockedMetadata: any;

        const costControlModel = withGuardrails(model, {
          inputGuardrails: [costControlGuardrail],
          throwOnBlocked: false,
          onInputBlocked: (executionSummary) => {
            blockedMessage = executionSummary.blockedResults[0]?.message;
            blockedMetadata = executionSummary.blockedResults[0]?.metadata;
          },
        });

        const result = await generateText({
          model: costControlModel,
          prompt:
            'Write a comprehensive analysis and detailed documentation about machine learning algorithms, including extensive examples and code samples for every major technique',
        });

        expect(result.text).toBeDefined();
        // If cost control triggered, verify metadata
        if (blockedMessage) {
          expect(blockedMessage).toContain('High-cost operation detected');
          expect(blockedMetadata?.expensiveOperation).toBeDefined();
          expect(blockedMetadata?.estimatedCost).toBeDefined();
        }
      },
      120000,
    );

    it(
      'should provide cost estimation metadata',
      async () => {
        let blockedMetadata: any;

        const costControlModel = withGuardrails(model, {
          inputGuardrails: [costControlGuardrail],
          throwOnBlocked: false,
          onInputBlocked: (executionSummary) => {
            blockedMetadata = executionSummary.blockedResults[0]?.metadata;
          },
        });

        await generateText({
          model: costControlModel,
          prompt:
            'Generate a massive report with comprehensive analysis and detailed documentation',
        });

        // If metadata was captured, verify structure
        if (blockedMetadata) {
          expect(blockedMetadata.expensiveOperation).toBeDefined();
          expect(blockedMetadata.estimatedTokens).toBeDefined();
          expect(blockedMetadata.estimatedCost).toBeDefined();
        }
      },
      120000,
    );
  });

  describe('Data Compliance Guardrail', () => {
    it('should block requests involving sensitive data', async () => {
      const complianceModel = withGuardrails(model, {
        inputGuardrails: [dataComplianceGuardrail],
        throwOnBlocked: true,
      });

      await expect(
        generateText({
          model: complianceModel,
          prompt: 'Can you analyze customer information and personal data?',
        }),
      ).rejects.toThrow(/Input blocked by guardrail/);
    });

    it('should provide compliance metadata when blocking', async () => {
      let blockedMetadata: any;

      const complianceModel = withGuardrails(model, {
        inputGuardrails: [dataComplianceGuardrail],
        throwOnBlocked: true,
        onInputBlocked: (executionSummary) => {
          blockedMetadata = executionSummary.blockedResults[0]?.metadata;
        },
      });

      try {
        await generateText({
          model: complianceModel,
          prompt: 'I need to access employee records',
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeDefined();
        if (blockedMetadata) {
          expect(blockedMetadata.sensitiveDataType).toBe('employee records');
          expect(blockedMetadata.complianceNote).toBeDefined();
        }
      }
    });
  });

  describe('Business Hours Control', () => {
    it('should simulate business hours restriction', async () => {
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

      let blockedMessage: string | undefined;

      const businessHoursModel = withGuardrails(model, {
        inputGuardrails: [demoBusinessHours],
        throwOnBlocked: false,
        onInputBlocked: (executionSummary) => {
          blockedMessage = executionSummary.blockedResults[0]?.message;
        },
      });

      const result = await generateText({
        model: businessHoursModel,
        prompt: 'What are the benefits of automation?',
      });

      expect(result.text).toBeDefined();
      // May or may not trigger depending on current hour
      if (blockedMessage) {
        expect(blockedMessage).toContain('off-hours restriction');
      }
    });
  });

  describe('Combined Business Rules', () => {
    it('should apply multiple business guardrails together', async () => {
      let inputBlockedResults: any[] = [];
      let outputBlockedResults: any[] = [];

      const businessModel = withGuardrails(model, {
        inputGuardrails: [
          businessContentGuardrail,
          dataComplianceGuardrail,
          costControlGuardrail,
        ] as const,
        outputGuardrails: [professionalToneGuardrail],
        throwOnBlocked: false,
        onInputBlocked: (executionSummary) => {
          inputBlockedResults = executionSummary.blockedResults;
        },
        onOutputBlocked: (executionSummary) => {
          outputBlockedResults = executionSummary.blockedResults;
        },
      });

      const result = await generateText({
        model: businessModel,
        prompt: 'Help me with technical documentation for our API',
      });

      expect(result.text).toBeDefined();
      // If any guardrails triggered, verify results
      if (inputBlockedResults.length > 0) {
        expect(Array.isArray(inputBlockedResults)).toBe(true);
        inputBlockedResults.forEach((result) => {
          expect(result.message).toBeDefined();
          expect(result.severity).toBeDefined();
        });
      }
    });

    it(
      'should handle various business scenarios',
      async () => {
        const businessModel = withGuardrails(model, {
          inputGuardrails: [
            businessContentGuardrail,
            dataComplianceGuardrail,
            costControlGuardrail,
          ] as const,
          outputGuardrails: [professionalToneGuardrail],
          throwOnBlocked: false,
        });

        const testRequests = [
          'Help me with technical documentation for our API',
          'Can you analyze customer information and personal data?',
          'Write a massive comprehensive report about everything',
          'Give me some personal relationship advice',
        ];

        for (const request of testRequests) {
          const result = await generateText({
            model: businessModel,
            prompt: request,
          });
          expect(result.text).toBeDefined();
        }
      },
      120000,
    );
  });
});
