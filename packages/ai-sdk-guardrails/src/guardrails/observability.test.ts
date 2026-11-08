import { describe, expect, it } from 'vitest';
import { createMetricsCollector } from './observability';
import type { InputGuardrail } from '../types';

class KeywordGuardrail implements InputGuardrail {
  name = 'keyword';
  private readonly word = 'blocked';

  async execute() {
    return { tripwireTriggered: this.word === 'blocked' };
  }
}

describe('createMetricsCollector', () => {
  it('keeps `this` for class-based guardrails and records the run', async () => {
    const collector = createMetricsCollector();
    const tracked = collector.track(new KeywordGuardrail());

    const result = await tracked.execute({
      prompt: 'x',
      messages: [],
      system: '',
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(collector.getMetrics().totalExecutions).toBe(1);
  });
});
