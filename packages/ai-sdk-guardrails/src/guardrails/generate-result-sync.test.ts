import { describe, it, expect } from 'vitest';
import {
  snapshotGenerateResultText,
  syncGenerateResultTextAfterGuardrails,
} from './generate-result-sync';

describe('generate-result-sync', () => {
  it('propagates guardrail mutations from text to content', () => {
    const result = {
      content: [{ type: 'text', text: 'Email: jag@example.com' }],
    };
    const before = snapshotGenerateResultText(result);

    (result as { text?: string }).text = 'Email: <redacted>';

    syncGenerateResultTextAfterGuardrails(result, before);

    expect(result.content).toEqual([
      { type: 'text', text: 'Email: <redacted>' },
    ]);
    expect((result as { text?: string }).text).toBe('Email: <redacted>');
  });

  it('propagates guardrail mutations from content to text', () => {
    const result = {
      text: 'Email: jag@example.com',
      content: [{ type: 'text', text: 'Email: <redacted>' }],
    };
    const before = snapshotGenerateResultText({
      text: 'Email: jag@example.com',
      content: [{ type: 'text', text: 'Email: jag@example.com' }],
    });

    syncGenerateResultTextAfterGuardrails(result, before);

    expect((result as { text?: string }).text).toBe('Email: <redacted>');
  });

  it('aligns text when only content is present', () => {
    const result = {
      content: [{ type: 'text', text: 'hello' }],
    };
    const before = snapshotGenerateResultText(result);

    syncGenerateResultTextAfterGuardrails(result, before);

    expect((result as { text?: string }).text).toBe('hello');
  });

  it('creates content when only text is present', () => {
    const result = {
      text: 'hello',
    };
    const before = snapshotGenerateResultText(result);

    syncGenerateResultTextAfterGuardrails(result, before);

    expect(result).toEqual({
      text: 'hello',
      content: [{ type: 'text', text: 'hello' }],
    });
  });
});
