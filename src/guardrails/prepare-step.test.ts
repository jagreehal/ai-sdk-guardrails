import { describe, it, expect, vi } from 'vitest';
import {
  createGuardrailPrepareStep,
  createAdaptivePrepareStep,
} from './prepare-step';
import type { GuardrailViolation } from './stop-conditions';
import type { LanguageModelV2 } from '../types';

describe('createGuardrailPrepareStep', () => {
  it('should return undefined when no violations', () => {
    const violations: GuardrailViolation[] = [];
    const prepareStep = createGuardrailPrepareStep(violations);

    const result = prepareStep({
      steps: [],
      stepNumber: 0,
      messages: [],
      model: {} as LanguageModelV2,
    });

    expect(result).toBeUndefined();
  });

  it('should reduce temperature on recent violations', () => {
    const violations: GuardrailViolation[] = [
      {
        step: 0,
        summary: {
          blockedResults: [
            {
              tripwireTriggered: true,
              message: 'Violation',
              severity: 'medium',
            },
          ],
          allResults: [],
          totalExecutionTime: 0,
          guardrailsExecuted: 1,
          stats: { passed: 0, blocked: 1, failed: 0, averageExecutionTime: 0 },
        },
      },
    ];

    const prepareStep = createGuardrailPrepareStep(violations);

    const result = prepareStep({
      steps: [],
      stepNumber: 1,
      messages: [],
      model: {} as LanguageModelV2,
    });

    expect(result).toBeDefined();
    expect(result?.temperature).toBe(0.3);
  });

  it('should add warning to system prompt on violations', () => {
    const violations: GuardrailViolation[] = [
      {
        step: 0,
        summary: {
          blockedResults: [
            {
              tripwireTriggered: true,
              message: 'PII detected',
              severity: 'high',
            },
          ],
          allResults: [],
          totalExecutionTime: 0,
          guardrailsExecuted: 1,
          stats: { passed: 0, blocked: 1, failed: 0, averageExecutionTime: 0 },
        },
      },
    ];

    const prepareStep = createGuardrailPrepareStep(violations);

    const result = prepareStep({
      steps: [],
      stepNumber: 1,
      messages: [],
      model: {} as LanguageModelV2,
    });

    expect(result?.system).toContain('Previous responses violated guidelines');
  });

  it('should stop execution on critical violations', () => {
    const violations: GuardrailViolation[] = [
      {
        step: 0,
        summary: {
          blockedResults: [
            {
              tripwireTriggered: true,
              message: 'Critical issue',
              severity: 'critical',
            },
          ],
          allResults: [],
          totalExecutionTime: 0,
          guardrailsExecuted: 1,
          stats: { passed: 0, blocked: 1, failed: 0, averageExecutionTime: 0 },
        },
      },
    ];

    const prepareStep = createGuardrailPrepareStep(violations, {
      stopOnCritical: true,
    });

    const result = prepareStep({
      steps: [],
      stepNumber: 1,
      messages: [],
      model: {} as LanguageModelV2,
    });

    expect(result?.stopWhen).toBeDefined();
    const stopWhen = result?.stopWhen;
    const stopResult = stopWhen ? stopWhen() : false;
    expect(stopResult).toBe(true);
  });

  it('should only consider recent violations based on lookback', () => {
    const violations: GuardrailViolation[] = [
      {
        step: 0,
        summary: {
          blockedResults: [
            {
              tripwireTriggered: true,
              message: 'Old violation',
              severity: 'medium',
            },
          ],
          allResults: [],
          totalExecutionTime: 0,
          guardrailsExecuted: 1,
          stats: { passed: 0, blocked: 1, failed: 0, averageExecutionTime: 0 },
        },
      },
    ];

    const prepareStep = createGuardrailPrepareStep(violations, {
      lookback: 1,
    });

    const result = prepareStep({
      steps: [{ content: null }, { content: null }, { content: null }],
      stepNumber: 5,
      messages: [],
      model: {} as LanguageModelV2,
    });

    // Step 5 with lookback 1 should not consider step 0
    expect(result).toBeUndefined();
  });

  it('should customize temperature based on severity', () => {
    const violations: GuardrailViolation[] = [
      {
        step: 0,
        summary: {
          blockedResults: [
            {
              tripwireTriggered: true,
              message: 'High severity',
              severity: 'high',
            },
          ],
          allResults: [],
          totalExecutionTime: 0,
          guardrailsExecuted: 1,
          stats: { passed: 0, blocked: 1, failed: 0, averageExecutionTime: 0 },
        },
      },
    ];

    const prepareStep = createGuardrailPrepareStep(violations, {
      temperatureReduction: 0.5,
    });

    const result = prepareStep({
      steps: [],
      stepNumber: 1,
      messages: [],
      model: {} as LanguageModelV2,
    });

    expect(result?.temperature).toBe(0.5);
  });
});

describe('createAdaptivePrepareStep', () => {
  it('should create prepareStep function', () => {
    const prepareStep = createAdaptivePrepareStep({
      violations: [],
    });

    expect(typeof prepareStep).toBe('function');
  });

  it('should call onViolationDetected callback', () => {
    const onViolationDetected = vi.fn();
    const violations: GuardrailViolation[] = [
      {
        step: 0,
        summary: {
          blockedResults: [
            {
              tripwireTriggered: true,
              message: 'Test violation',
              severity: 'medium',
            },
          ],
          allResults: [],
          totalExecutionTime: 0,
          guardrailsExecuted: 1,
          stats: { passed: 0, blocked: 1, failed: 0, averageExecutionTime: 0 },
        },
      },
    ];

    const prepareStep = createAdaptivePrepareStep({
      violations,
      onViolationDetected,
    });

    prepareStep({
      steps: [],
      stepNumber: 1,
      messages: [],
      model: {} as LanguageModelV2,
    });

    expect(onViolationDetected).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          step: 0,
        }),
      ]),
    );
  });

  it('should apply custom strategy on violations', () => {
    const violations: GuardrailViolation[] = [
      {
        step: 0,
        summary: {
          blockedResults: [
            {
              tripwireTriggered: true,
              message: 'Test violation',
              severity: 'medium',
            },
          ],
          allResults: [],
          totalExecutionTime: 0,
          guardrailsExecuted: 1,
          stats: { passed: 0, blocked: 1, failed: 0, averageExecutionTime: 0 },
        },
      },
    ];

    const prepareStep = createAdaptivePrepareStep({
      violations,
      strategy: () => ({
        temperature: 0.1,
        topP: 0.9,
      }),
    });

    const result = prepareStep({
      steps: [],
      stepNumber: 1,
      messages: [],
      model: {} as LanguageModelV2,
    });

    expect(result?.temperature).toBe(0.1);
    expect(result?.topP).toBe(0.9);
  });

  it('should escalate on repeated violations', () => {
    const violations: GuardrailViolation[] = [
      {
        step: 0,
        summary: {
          blockedResults: [
            {
              tripwireTriggered: true,
              message: 'Violation 1',
              severity: 'medium',
            },
          ],
          allResults: [],
          totalExecutionTime: 0,
          guardrailsExecuted: 1,
          stats: { passed: 0, blocked: 1, failed: 0, averageExecutionTime: 0 },
        },
      },
      {
        step: 1,
        summary: {
          blockedResults: [
            {
              tripwireTriggered: true,
              message: 'Violation 2',
              severity: 'medium',
            },
          ],
          allResults: [],
          totalExecutionTime: 0,
          guardrailsExecuted: 1,
          stats: { passed: 0, blocked: 1, failed: 0, averageExecutionTime: 0 },
        },
      },
      {
        step: 2,
        summary: {
          blockedResults: [
            {
              tripwireTriggered: true,
              message: 'Violation 3',
              severity: 'medium',
            },
          ],
          allResults: [],
          totalExecutionTime: 0,
          guardrailsExecuted: 1,
          stats: { passed: 0, blocked: 1, failed: 0, averageExecutionTime: 0 },
        },
      },
    ];

    const prepareStep = createAdaptivePrepareStep({
      violations,
      escalateAfter: 2,
    });

    const result = prepareStep({
      steps: [{ content: null }, { content: null }, { content: null }],
      stepNumber: 3,
      messages: [],
      model: {} as LanguageModelV2,
    });

    // After 3 violations, should stop
    expect(result?.stopWhen).toBeDefined();
  });

  it('should handle no violations gracefully', () => {
    const prepareStep = createAdaptivePrepareStep({
      violations: [],
    });

    const result = prepareStep({
      steps: [],
      stepNumber: 0,
      messages: [],
      model: {} as LanguageModelV2,
    });

    expect(result).toBeUndefined();
  });
});
