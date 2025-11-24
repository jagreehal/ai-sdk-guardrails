import { describe, it, expect, beforeEach } from 'vitest';
import {
  createGuardrailAbortController,
  GuardrailViolationAbort,
} from './abort-controller';
import type { GuardrailExecutionSummary } from '../types';

describe('createGuardrailAbortController', () => {
  let controller: ReturnType<typeof createGuardrailAbortController>;

  beforeEach(() => {
    controller = createGuardrailAbortController();
  });

  it('should create an AbortController with signal', () => {
    expect(controller.signal).toBeDefined();
    expect(controller.signal.aborted).toBe(false);
  });

  it('should create abortOnViolation callback', () => {
    expect(controller.abortOnViolation).toBeDefined();
    expect(typeof controller.abortOnViolation).toBe('function');
  });

  describe('abortOnViolation', () => {
    it('should abort on critical severity violation by default', () => {
      const summary: GuardrailExecutionSummary = {
        allResults: [
          {
            tripwireTriggered: true,
            message: 'Critical violation',
            severity: 'critical',
            info: {
              guardrailName: 'test-guardrail',
            },
          },
        ],
        blockedResults: [
          {
            tripwireTriggered: true,
            message: 'Critical violation',
            severity: 'critical',
            info: {
              guardrailName: 'test-guardrail',
            },
          },
        ],
        totalExecutionTime: 100,
        guardrailsExecuted: 1,
        stats: { passed: 0, blocked: 1, failed: 0, averageExecutionTime: 100 },
      };

      const callback = controller.abortOnViolation();
      callback(summary);

      expect(controller.signal.aborted).toBe(true);
    });

    it('should not abort on non-critical violations by default', () => {
      const summary: GuardrailExecutionSummary = {
        allResults: [
          {
            tripwireTriggered: true,
            message: 'Medium violation',
            severity: 'medium',
            info: {
              guardrailName: 'test-guardrail',
            },
          },
        ],
        blockedResults: [
          {
            tripwireTriggered: true,
            message: 'Medium violation',
            severity: 'medium',
            info: {
              guardrailName: 'test-guardrail',
            },
          },
        ],
        totalExecutionTime: 100,
        guardrailsExecuted: 1,
        stats: { passed: 0, blocked: 1, failed: 0, averageExecutionTime: 100 },
      };

      const callback = controller.abortOnViolation();
      callback(summary);

      expect(controller.signal.aborted).toBe(false);
    });

    it('should abort on high severity when configured', () => {
      const summary: GuardrailExecutionSummary = {
        allResults: [
          {
            tripwireTriggered: true,
            message: 'High violation',
            severity: 'high',
            info: {
              guardrailName: 'test-guardrail',
            },
          },
        ],
        blockedResults: [
          {
            tripwireTriggered: true,
            message: 'High violation',
            severity: 'high',
            info: {
              guardrailName: 'test-guardrail',
            },
          },
        ],
        totalExecutionTime: 100,
        guardrailsExecuted: 1,
        stats: { passed: 0, blocked: 1, failed: 0, averageExecutionTime: 100 },
      };

      const callback = controller.abortOnViolation('high');
      callback(summary);

      expect(controller.signal.aborted).toBe(true);
    });

    it('should not abort when no violations', () => {
      const summary: GuardrailExecutionSummary = {
        allResults: [
          {
            tripwireTriggered: false,
            message: '',
            info: {
              guardrailName: 'test-guardrail',
            },
          },
        ],
        blockedResults: [],
        totalExecutionTime: 100,
        guardrailsExecuted: 1,
        stats: { passed: 1, blocked: 0, failed: 0, averageExecutionTime: 100 },
      };

      const callback = controller.abortOnViolation();
      callback(summary);

      expect(controller.signal.aborted).toBe(false);
    });

    it('should include violation details in abort reason', () => {
      const summary: GuardrailExecutionSummary = {
        allResults: [
          {
            tripwireTriggered: true,
            message: 'PII detected',
            severity: 'critical',
            metadata: { detectedPII: ['email'] },
            info: {
              guardrailName: 'test-guardrail',
            },
          },
        ],
        blockedResults: [
          {
            tripwireTriggered: true,
            message: 'PII detected',
            severity: 'critical',
            metadata: { detectedPII: ['email'] },
            info: {
              guardrailName: 'test-guardrail',
            },
          },
        ],
        totalExecutionTime: 100,
        guardrailsExecuted: 1,
        stats: { passed: 0, blocked: 1, failed: 0, averageExecutionTime: 100 },
      };

      const callback = controller.abortOnViolation();
      callback(summary);

      expect(controller.signal.aborted).toBe(true);
      expect(controller.signal.reason).toBeInstanceOf(GuardrailViolationAbort);
      expect(controller.signal.reason.summary).toEqual(summary);
    });
  });

  describe('abortOnCondition', () => {
    it('should abort when custom condition is met', () => {
      const summary: GuardrailExecutionSummary = {
        allResults: [
          {
            tripwireTriggered: true,
            message: 'Low violation',
            severity: 'low',
            info: {
              guardrailName: 'test-guardrail',
            },
          },
        ],
        blockedResults: [
          {
            tripwireTriggered: true,
            message: 'Low violation',
            severity: 'low',
            info: {
              guardrailName: 'test-guardrail',
            },
          },
        ],
        totalExecutionTime: 100,
        guardrailsExecuted: 1,
        stats: { passed: 0, blocked: 1, failed: 0, averageExecutionTime: 100 },
      };

      const callback = controller.abortOnCondition(
        (s) => s.blockedResults.length > 0,
      );
      callback(summary);

      expect(controller.signal.aborted).toBe(true);
    });

    it('should not abort when custom condition is not met', () => {
      const summary: GuardrailExecutionSummary = {
        allResults: [
          {
            tripwireTriggered: false,
            message: '',
            info: {
              guardrailName: 'test-guardrail',
            },
          },
        ],
        blockedResults: [],
        totalExecutionTime: 100,
        guardrailsExecuted: 1,
        stats: { passed: 1, blocked: 0, failed: 0, averageExecutionTime: 100 },
      };

      const callback = controller.abortOnCondition(
        (s) => s.blockedResults.length > 5,
      );
      callback(summary);

      expect(controller.signal.aborted).toBe(false);
    });
  });

  describe('abort', () => {
    it('should manually abort with custom reason', () => {
      controller.abort('Manual abort');

      expect(controller.signal.aborted).toBe(true);
      expect(controller.signal.reason).toBe('Manual abort');
    });
  });
});

describe('GuardrailViolationAbort', () => {
  it('should create error with summary', () => {
    const summary: GuardrailExecutionSummary = {
      allResults: [],
      blockedResults: [
        {
          tripwireTriggered: true,
          message: 'Test violation',
          severity: 'critical',
          info: {
            guardrailName: 'test-guardrail',
          },
        },
      ],
      totalExecutionTime: 100,
      guardrailsExecuted: 1,
      stats: { passed: 0, blocked: 1, failed: 0, averageExecutionTime: 100 },
    };

    const error = new GuardrailViolationAbort(summary);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('GuardrailViolationAbort');
    expect(error.message).toContain('Test violation');
    expect(error.summary).toEqual(summary);
  });

  it('should handle multiple violations in message', () => {
    const summary: GuardrailExecutionSummary = {
      allResults: [],
      blockedResults: [
        {
          tripwireTriggered: true,
          message: 'Violation 1',
          severity: 'critical',
          info: {
            guardrailName: 'test-guardrail',
          },
        },
        {
          tripwireTriggered: true,
          message: 'Violation 2',
          severity: 'high',
          info: {
            guardrailName: 'test-guardrail',
          },
        },
      ],
      totalExecutionTime: 100,
      guardrailsExecuted: 2,
      stats: { passed: 0, blocked: 2, failed: 0, averageExecutionTime: 100 },
    };

    const error = new GuardrailViolationAbort(summary);

    expect(error.message).toContain('Violation 1');
    expect(error.message).toContain('Violation 2');
  });
});
