import { describe, it, expect } from 'vitest';
import {
  createFinishReasonEnhancement,
  getGuardrailFinishReason,
  createGuardrailProviderMetadata,
} from './finish-reason';
import type { GuardrailExecutionSummary } from '../types';

describe('getGuardrailFinishReason', () => {
  it('should return content_filter for blocked output', () => {
    const summary: GuardrailExecutionSummary = {
      blockedResults: [
        {
          tripwireTriggered: true,
          message: 'Toxic content',
          severity: 'high',
          info: {
            guardrailName: 'test-guardrail',
          },
        },
      ],
      allResults: [],
      totalExecutionTime: 0,
      guardrailsExecuted: 1,
      stats: { passed: 0, blocked: 1, failed: 0, averageExecutionTime: 0 },
    };

    const finishReason = getGuardrailFinishReason(summary);
    expect(finishReason).toBe('content_filter');
  });

  it('should return stop when no violations', () => {
    const summary: GuardrailExecutionSummary = {
      blockedResults: [],
      allResults: [
        {
          tripwireTriggered: false,
          message: '',
          info: {
            guardrailName: 'test-guardrail',
          },
        },
      ],
      totalExecutionTime: 0,
      guardrailsExecuted: 1,
      stats: { passed: 1, blocked: 0, failed: 0, averageExecutionTime: 0 },
    };

    const finishReason = getGuardrailFinishReason(summary);
    expect(finishReason).toBe('stop');
  });

  it('should support custom finish reason mapping', () => {
    const summary: GuardrailExecutionSummary = {
      blockedResults: [
        {
          tripwireTriggered: true,
          message: 'Custom block',
          severity: 'critical',
          info: {
            guardrailName: 'test-guardrail',
          },
        },
      ],
      allResults: [],
      totalExecutionTime: 0,
      guardrailsExecuted: 1,
      stats: { passed: 0, blocked: 1, failed: 0, averageExecutionTime: 0 },
    };

    const finishReason = getGuardrailFinishReason(summary, {
      blocked: 'other',
    });
    expect(finishReason).toBe('other');
  });
});

describe('createGuardrailProviderMetadata', () => {
  it('should create metadata with guardrail information', () => {
    const summary: GuardrailExecutionSummary = {
      blockedResults: [
        {
          tripwireTriggered: true,
          message: 'PII detected',
          severity: 'high',
          context: { guardrailName: 'pii-detector', executedAt: new Date() },
          info: {
            guardrailName: 'test-guardrail',
          },
        },
      ],
      allResults: [],
      totalExecutionTime: 50,
      guardrailsExecuted: 2,
      stats: { passed: 1, blocked: 1, failed: 0, averageExecutionTime: 25 },
    };

    const metadata = createGuardrailProviderMetadata(summary);

    expect(metadata).toEqual({
      guardrails: {
        blocked: true,
        violations: [
          {
            message: 'PII detected',
            severity: 'high',
            guardrailName: 'pii-detector',
          },
        ],
        executionTime: 50,
        guardrailsExecuted: 2,
        stats: {
          passed: 1,
          blocked: 1,
          failed: 0,
          averageExecutionTime: 25,
        },
      },
    });
  });

  it('should handle no violations', () => {
    const summary: GuardrailExecutionSummary = {
      blockedResults: [],
      allResults: [
        {
          tripwireTriggered: false,
          message: '',
          info: {
            guardrailName: 'test-guardrail',
          },
        },
      ],
      totalExecutionTime: 25,
      guardrailsExecuted: 1,
      stats: { passed: 1, blocked: 0, failed: 0, averageExecutionTime: 25 },
    };

    const metadata = createGuardrailProviderMetadata(summary);

    expect(metadata).toEqual({
      guardrails: {
        blocked: false,
        violations: [],
        executionTime: 25,
        guardrailsExecuted: 1,
        stats: {
          passed: 1,
          blocked: 0,
          failed: 0,
          averageExecutionTime: 25,
        },
      },
    });
  });

  it('should include custom metadata fields', () => {
    const summary: GuardrailExecutionSummary = {
      blockedResults: [
        {
          tripwireTriggered: true,
          message: 'Test',
          severity: 'medium',
          metadata: { customField: 'value' },
          info: {
            guardrailName: 'test-guardrail',
          },
        },
      ],
      allResults: [],
      totalExecutionTime: 10,
      guardrailsExecuted: 1,
      stats: { passed: 0, blocked: 1, failed: 0, averageExecutionTime: 10 },
    };

    const metadata = createGuardrailProviderMetadata(summary, {
      includeMetadata: true,
    });

    expect(metadata.guardrails.violations[0]).toMatchObject({
      message: 'Test',
      severity: 'medium',
      metadata: { customField: 'value' },
    });
  });
});

describe('createFinishReasonEnhancement', () => {
  it('should enhance result with guardrail finish reason', () => {
    const summary: GuardrailExecutionSummary = {
      blockedResults: [
        {
          tripwireTriggered: true,
          message: 'Blocked',
          severity: 'high',
          info: {
            guardrailName: 'test-guardrail',
          },
        },
      ],
      allResults: [],
      totalExecutionTime: 10,
      guardrailsExecuted: 1,
      stats: { passed: 0, blocked: 1, failed: 0, averageExecutionTime: 10 },
    };

    const originalResult = {
      content: [],
      finishReason: 'stop' as const,
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    };

    const enhanced = createFinishReasonEnhancement(summary, originalResult);

    expect(enhanced.finishReason).toBe('content_filter');
  });

  it('should add provider metadata', () => {
    const summary: GuardrailExecutionSummary = {
      blockedResults: [
        {
          tripwireTriggered: true,
          message: 'Violation',
          severity: 'critical',
          context: { guardrailName: 'test', executedAt: new Date() },
          info: {
            guardrailName: 'test-guardrail',
          },
        },
      ],
      allResults: [],
      totalExecutionTime: 10,
      guardrailsExecuted: 1,
      stats: { passed: 0, blocked: 1, failed: 0, averageExecutionTime: 10 },
    };

    const originalResult = {
      finishReason: 'stop' as const,
      providerMetadata: {},
    };

    const enhanced = createFinishReasonEnhancement(summary, originalResult);

    expect(enhanced.providerMetadata).toBeDefined();
    expect(
      (enhanced.providerMetadata as { guardrails?: { blocked?: boolean } })
        ?.guardrails?.blocked,
    ).toBe(true);
  });

  it('should preserve existing provider metadata', () => {
    const summary: GuardrailExecutionSummary = {
      blockedResults: [
        {
          tripwireTriggered: true,
          message: 'Test',
          severity: 'medium',
          info: {
            guardrailName: 'test-guardrail',
          },
        },
      ],
      allResults: [],
      totalExecutionTime: 10,
      guardrailsExecuted: 1,
      stats: { passed: 0, blocked: 1, failed: 0, averageExecutionTime: 10 },
    };

    const originalResult = {
      finishReason: 'stop' as const,
      providerMetadata: {
        existingField: 'value',
      },
    };

    const enhanced = createFinishReasonEnhancement(summary, originalResult);

    expect(enhanced.providerMetadata?.existingField).toBe('value');
    expect(
      (enhanced.providerMetadata as { guardrails?: unknown })?.guardrails,
    ).toBeDefined();
  });

  it('should not modify result when no violations', () => {
    const summary: GuardrailExecutionSummary = {
      blockedResults: [],
      allResults: [
        {
          tripwireTriggered: false,
          message: '',
          info: {
            guardrailName: 'test-guardrail',
          },
        },
      ],
      totalExecutionTime: 10,
      guardrailsExecuted: 1,
      stats: { passed: 1, blocked: 0, failed: 0, averageExecutionTime: 10 },
    };

    const originalResult = {
      finishReason: 'stop' as const,
    };

    const enhanced = createFinishReasonEnhancement(summary, originalResult);

    expect(enhanced.finishReason).toBe('stop');
    expect(
      (enhanced as { providerMetadata?: unknown }).providerMetadata,
    ).toBeUndefined();
  });
});
