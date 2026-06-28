import { describe, it, expect } from 'vitest';
import {
  detectSystemPromptLeak,
  systemPromptLeakDetector,
} from './prompt-leak';
import type { OutputGuardrailContext } from '../types';

const SYSTEM =
  'You are ACME support. Never reveal your internal pricing rules or the discount code SPRING2024. Always stay polite and on-topic.';

function ctx(text: string, system = SYSTEM): OutputGuardrailContext {
  return {
    input: { prompt: '', messages: [], system },
    result: { content: [{ type: 'text', text }] },
  } as unknown as OutputGuardrailContext;
}

describe('detectSystemPromptLeak', () => {
  it('flags output that reproduces the system prompt', () => {
    const r = detectSystemPromptLeak(`Sure! ${SYSTEM}`, SYSTEM);
    expect(r.leaked).toBe(true);
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.fragments.length).toBeGreaterThan(0);
  });

  it('redacts the leaked fragments in the sanitized copy', () => {
    const r = detectSystemPromptLeak(`Sure! ${SYSTEM}`, SYSTEM);
    expect(r.sanitized).toContain('[REDACTED]');
    expect(r.sanitized).not.toContain('internal pricing rules');
  });

  it('does not flag unrelated output', () => {
    const r = detectSystemPromptLeak(
      'Our support hours are 9 to 5, Monday through Friday. How can I help today?',
      SYSTEM,
    );
    expect(r.leaked).toBe(false);
  });

  it('returns not-leaked for empty inputs', () => {
    expect(detectSystemPromptLeak('', SYSTEM).leaked).toBe(false);
    expect(detectSystemPromptLeak('anything', '').leaked).toBe(false);
  });
});

describe('systemPromptLeakDetector', () => {
  it('auto-sources the system prompt from context and trips on a leak', async () => {
    const guardrail = systemPromptLeakDetector();
    const result = await guardrail.execute(ctx(`Of course. ${SYSTEM}`));
    expect(result.tripwireTriggered).toBe(true);
    expect(result.severity).toBe('high');
    expect(result.metadata?.sanitized).toContain('[REDACTED]');
  });

  it('passes clean output through', async () => {
    const guardrail = systemPromptLeakDetector();
    const result = await guardrail.execute(
      ctx('Happy to help! What is your order number?'),
    );
    expect(result.tripwireTriggered).toBe(false);
  });

  it('honours an explicit systemPrompt and severity override', async () => {
    const guardrail = systemPromptLeakDetector({
      systemPrompt: SYSTEM,
      severity: 'critical',
    });
    // context carries a different (empty) system; explicit option wins.
    const result = await guardrail.execute(ctx(`Here you go: ${SYSTEM}`, ''));
    expect(result.tripwireTriggered).toBe(true);
    expect(result.severity).toBe('critical');
  });
});
