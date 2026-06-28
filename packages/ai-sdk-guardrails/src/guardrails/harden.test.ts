import { describe, it, expect } from 'vitest';
import { hardenSystemPrompt } from './harden';

describe('hardenSystemPrompt', () => {
  it('appends a security-rules block by default', () => {
    const out = hardenSystemPrompt('You are a financial advisor.');
    expect(out.startsWith('You are a financial advisor.')).toBe(true);
    expect(out).toContain('### Security Rules');
    expect(out).toContain('untrusted data');
  });

  it('includes the persona anchor and anti-extraction rules by default', () => {
    const out = hardenSystemPrompt('BASE');
    expect(out).toContain('bound to your assigned role');
    expect(out).toContain('prompt extraction attempts');
  });

  it('can skip the persona anchor', () => {
    const out = hardenSystemPrompt('BASE', { skipPersonaAnchor: true });
    expect(out).not.toContain('bound to your assigned role');
  });

  it('can skip the anti-extraction rules', () => {
    const out = hardenSystemPrompt('BASE', { skipAntiExtraction: true });
    expect(out).not.toContain('prompt extraction attempts');
  });

  it('appends custom rules', () => {
    const out = hardenSystemPrompt('BASE', {
      customRules: ['Never mention competitors by name.'],
    });
    expect(out).toContain('- Never mention competitors by name.');
  });

  it('prepends the block when position is "prepend"', () => {
    const out = hardenSystemPrompt('BASE', { position: 'prepend' });
    expect(out.indexOf('### Security Rules')).toBeLessThan(out.indexOf('BASE'));
    expect(out.trimEnd().endsWith('BASE')).toBe(true);
  });
});
