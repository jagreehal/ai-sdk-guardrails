import { describe, it, expect } from 'vitest';
import { highEntropyDetector } from './input';
import type { InputGuardrailContext } from '../types';

function run(prompt: string, opts?: Parameters<typeof highEntropyDetector>[0]) {
  const guardrail = highEntropyDetector(opts);
  return guardrail.execute({ prompt } as unknown as InputGuardrailContext);
}

describe('highEntropyDetector', () => {
  it('passes ordinary natural-language prompts', async () => {
    const result = await run(
      'Please write a friendly email to my team about the picnic on Saturday afternoon in the park.',
    );
    expect(result.tripwireTriggered).toBe(false);
  });

  it('flags high-entropy encoded blobs', async () => {
    const blob =
      'k9F2xQ8zV3mNpL7wErTyU1aSdFgHjKlZxCvBnM0oP4iQ5eR6tY7uI8oP9jW2bX1';
    const result = await run(blob);
    expect(result.tripwireTriggered).toBe(true);
    expect(result.metadata?.entropy).toBeGreaterThan(4.5);
  });

  it('ignores short inputs below minLength', async () => {
    const result = await run('x9F2kQ8z'); // high entropy but short
    expect(result.tripwireTriggered).toBe(false);
  });

  it('respects a custom threshold', async () => {
    const prompt =
      'The quick brown fox jumps over the lazy dog near the river.';
    // An impossibly low threshold flags even natural language.
    const result = await run(prompt, { threshold: 0.5 });
    expect(result.tripwireTriggered).toBe(true);
  });
});
