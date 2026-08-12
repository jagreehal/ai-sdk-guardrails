/**
 * Session-scoped tool-plan accumulator for step-aware plan-risk classification.
 */

export interface PlanRiskSession {
  record(toolNames: string[]): string[];
  reset(): void;
  readonly toolSequence: readonly string[];
}

export function createPlanRiskSession(): PlanRiskSession {
  const sequence: string[] = [];
  return {
    record(toolNames: string[]) {
      for (const name of toolNames) {
        if (name.trim()) sequence.push(name);
      }
      return [...sequence];
    },
    reset() {
      sequence.length = 0;
    },
    get toolSequence() {
      return sequence;
    },
  };
}
