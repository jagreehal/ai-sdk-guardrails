import { describe, expect, it } from 'vitest';
import { normalizeGuardrailContext } from './internal';

describe('normalizeGuardrailContext', () => {
  it('reads a string system message, which is how the LanguageModel prompt carries it', () => {
    const ctx = normalizeGuardrailContext({
      prompt: [
        { role: 'system', content: 'You are the payments assistant.' },
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ],
    } as never);
    expect(ctx.system).toBe('You are the payments assistant.');
    expect(ctx.prompt).toBe('hi');
  });
});
