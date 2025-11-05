/**
 * Tests for stop condition helpers with severity default handling
 */

import { describe, it, expect } from 'vitest';
import {
  criticalViolationDetected,
  violationCountIs,
  violationSeverityIs,
  specificGuardrailViolated,
  consecutiveViolations,
  anyOf,
  allOf,
  custom,
} from './stop-conditions';
import type { GuardrailViolation } from './stop-conditions';
import type { GuardrailExecutionSummary } from '../types';

// Helper to create mock violations
function createMockViolation(
  step: number,
  severity?: 'low' | 'medium' | 'high' | 'critical',
  guardrailName: string = 'test-guardrail',
  chunkIndex?: number,
): GuardrailViolation {
  const blockedResult = {
    message: 'Test violation',
    tripwireTriggered: true,
    ...(severity !== undefined && { severity }),
    context: {
      guardrailName,
      executedAt: new Date(),
    },
  };

  const summary: GuardrailExecutionSummary = {
    guardrailsExecuted: 1,
    allResults: [blockedResult],
    blockedResults: [blockedResult],
    stats: {
      passed: 0,
      blocked: 1,
      failed: 0,
      averageExecutionTime: 10,
    },
    totalExecutionTime: 10,
  };

  if (chunkIndex !== undefined) {
    return { chunkIndex, summary };
  }
  return { step, summary };
}

describe('Stop Condition Helpers', () => {
  describe('criticalViolationDetected', () => {
    it('should trigger on explicit critical severity', () => {
      const condition = criticalViolationDetected();
      const violations = [createMockViolation(1, 'critical')];
      expect(condition(violations)).toBe(true);
    });

    it('should NOT trigger on undefined severity (defaults to medium)', () => {
      const condition = criticalViolationDetected();
      const violations = [createMockViolation(1)];
      expect(condition(violations)).toBe(false);
    });

    it('should NOT trigger on medium severity', () => {
      const condition = criticalViolationDetected();
      const violations = [createMockViolation(1, 'medium')];
      expect(condition(violations)).toBe(false);
    });

    it('should NOT trigger on high severity', () => {
      const condition = criticalViolationDetected();
      const violations = [createMockViolation(1, 'high')];
      expect(condition(violations)).toBe(false);
    });
  });

  describe('violationSeverityIs', () => {
    it('should match explicit severity', () => {
      const condition = violationSeverityIs('high');
      const violations = [createMockViolation(1, 'high')];
      expect(condition(violations)).toBe(true);
    });

    it('should match undefined severity as medium', () => {
      const condition = violationSeverityIs('medium');
      const violations = [createMockViolation(1)];
      expect(condition(violations)).toBe(true);
    });

    it('should NOT match undefined severity as high', () => {
      const condition = violationSeverityIs('high');
      const violations = [createMockViolation(1)];
      expect(condition(violations)).toBe(false);
    });

    it('should respect minCount parameter', () => {
      const condition = violationSeverityIs('medium', 2);
      const violations = [
        createMockViolation(1, 'medium'),
        createMockViolation(2), // Should count as medium
      ];
      expect(condition(violations)).toBe(true);
    });

    it('should NOT trigger if count is below minCount', () => {
      const condition = violationSeverityIs('medium', 3);
      const violations = [
        createMockViolation(1, 'medium'),
        createMockViolation(2),
      ];
      expect(condition(violations)).toBe(false);
    });
  });

  describe('violationCountIs', () => {
    it('should trigger when count matches', () => {
      const condition = violationCountIs(2);
      const violations = [createMockViolation(1), createMockViolation(2)];
      expect(condition(violations)).toBe(true);
    });

    it('should trigger when count exceeds', () => {
      const condition = violationCountIs(2);
      const violations = [
        createMockViolation(1),
        createMockViolation(2),
        createMockViolation(3),
      ];
      expect(condition(violations)).toBe(true);
    });

    it('should NOT trigger when count is below', () => {
      const condition = violationCountIs(3);
      const violations = [createMockViolation(1), createMockViolation(2)];
      expect(condition(violations)).toBe(false);
    });
  });

  describe('specificGuardrailViolated', () => {
    it('should trigger when specific guardrail is violated', () => {
      const condition = specificGuardrailViolated('pii-detector');
      const violations = [createMockViolation(1, 'critical', 'pii-detector')];
      expect(condition(violations)).toBe(true);
    });

    it('should NOT trigger for different guardrail', () => {
      const condition = specificGuardrailViolated('pii-detector');
      const violations = [
        createMockViolation(1, 'critical', 'other-guardrail'),
      ];
      expect(condition(violations)).toBe(false);
    });

    it('should respect minCount parameter', () => {
      const condition = specificGuardrailViolated('pii-detector', 2);
      const violations = [
        createMockViolation(1, 'high', 'pii-detector'),
        createMockViolation(2, 'high', 'pii-detector'),
      ];
      expect(condition(violations)).toBe(true);
    });
  });

  describe('consecutiveViolations', () => {
    it('should trigger on consecutive violations (agent steps)', () => {
      const condition = consecutiveViolations(2);
      const violations = [createMockViolation(1), createMockViolation(2)];
      expect(condition(violations)).toBe(true);
    });

    it('should trigger on consecutive violations (streaming chunks)', () => {
      const condition = consecutiveViolations(2);
      const violations = [
        createMockViolation(1, undefined, 'test', 1),
        createMockViolation(2, undefined, 'test', 2),
      ];
      expect(condition(violations)).toBe(true);
    });

    it('should trigger with more than required consecutive', () => {
      const condition = consecutiveViolations(2);
      const violations = [
        createMockViolation(1),
        createMockViolation(2),
        createMockViolation(3),
      ];
      expect(condition(violations)).toBe(true);
    });

    it('should NOT trigger with non-consecutive violations', () => {
      const condition = consecutiveViolations(2);
      const violations = [createMockViolation(1), createMockViolation(3)];
      expect(condition(violations)).toBe(false);
    });

    it('should NOT trigger with insufficient consecutive violations', () => {
      const condition = consecutiveViolations(3);
      const violations = [createMockViolation(1), createMockViolation(2)];
      expect(condition(violations)).toBe(false);
    });

    it('should NOT trigger when violations have no step or chunkIndex', () => {
      const condition = consecutiveViolations(2);
      const violations = [
        { summary: createMockViolation(1).summary } as GuardrailViolation, // Invalid: no step or chunkIndex
        { summary: createMockViolation(2).summary } as GuardrailViolation, // Invalid: no step or chunkIndex
      ];
      expect(condition(violations)).toBe(false);
    });
  });

  describe('anyOf', () => {
    it('should trigger if any condition is met', () => {
      const condition = anyOf([
        violationCountIs(5),
        criticalViolationDetected(),
      ]);
      const violations = [createMockViolation(1, 'critical')];
      expect(condition(violations)).toBe(true);
    });

    it('should NOT trigger if no conditions are met', () => {
      const condition = anyOf([
        violationCountIs(5),
        criticalViolationDetected(),
      ]);
      const violations = [createMockViolation(1, 'medium')];
      expect(condition(violations)).toBe(false);
    });
  });

  describe('allOf', () => {
    it('should trigger only if all conditions are met', () => {
      const condition = allOf([
        violationCountIs(2),
        violationSeverityIs('high', 1),
      ]);
      const violations = [
        createMockViolation(1, 'high'),
        createMockViolation(2, 'high'),
      ];
      expect(condition(violations)).toBe(true);
    });

    it('should NOT trigger if only some conditions are met', () => {
      const condition = allOf([
        violationCountIs(2),
        violationSeverityIs('critical'),
      ]);
      const violations = [
        createMockViolation(1, 'high'),
        createMockViolation(2, 'high'),
      ];
      expect(condition(violations)).toBe(false);
    });
  });

  describe('custom', () => {
    it('should allow custom logic', () => {
      const condition = custom((violations) => {
        if (violations.length === 0) return false;
        const first = violations[0]!;
        return 'step' in first && first.step === 1;
      });
      const violations = [createMockViolation(1)];
      expect(condition(violations)).toBe(true);
    });

    it('should respect custom logic returning false', () => {
      const condition = custom((violations) => {
        return violations.length > 5;
      });
      const violations = [createMockViolation(1)];
      expect(condition(violations)).toBe(false);
    });
  });
});
