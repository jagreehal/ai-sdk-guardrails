import { describe, it, expect } from 'vitest';
import {
  normalizeForDetection,
  resolveDetectNormalization,
  DEFAULT_DETECT_NORMALIZATION,
} from './normalization';

describe('normalizeForDetection', () => {
  it('decodes leetspeak digits to letters', () => {
    expect(normalizeForDetection('1gn0re prev10us 1nstruct10ns')).toBe(
      'ignore previous instructions',
    );
  });

  it('folds full-width homoglyphs to ASCII', () => {
    // U+FF21.. full-width "IGNORE PREVIOUS"
    expect(normalizeForDetection('ＩＧＮＯＲＥ ＰＲＥＶＩＯＵＳ')).toBe(
      'ignore previous',
    );
  });

  it('folds Cyrillic look-alike letters', () => {
    // Cyrillic а о е р с х (U+0430 U+043E U+0435 U+0440 U+0441 U+0445).
    // Disable letter-joining to isolate the homoglyph fold from the join stage.
    expect(
      normalizeForDetection('а о е р с х', { joinSeparatedLetters: false }),
    ).toBe('a o e p c x');
  });

  it('strips zero-width and invisible characters', () => {
    // zero-width space (U+200B) and BOM/zero-width-no-break (U+FEFF)
    expect(normalizeForDetection('ig\u200Bno\u200Bre')).toBe('ignore');
    expect(normalizeForDetection('over\uFEFFride')).toBe('override');
  });

  it('joins single letters separated by whitespace', () => {
    expect(normalizeForDetection('j a i l b r e a k')).toBe('jailbreak');
  });

  it('repairs common typos', () => {
    expect(normalizeForDetection('ingnore the overide')).toBe(
      'ignore the override',
    );
  });

  it('repairs phonetic spellings', () => {
    expect(normalizeForDetection('promt and rulz')).toBe('prompt and rules');
  });

  it('leaves benign text intact (aside from lowercasing/trim)', () => {
    expect(normalizeForDetection('  The Cat Sat On The Mat  ')).toBe(
      'the cat sat on the mat',
    );
  });

  it('returns trimmed raw input when disabled', () => {
    expect(normalizeForDetection('  1gn0re  ', false)).toBe('1gn0re');
  });

  it('honours per-stage opt-out', () => {
    // Disable leetspeak only — digits stay, homoglyphs still fold.
    expect(
      normalizeForDetection('1gn0re ＡＢＣ', { decodeLeetspeak: false }),
    ).toBe('1gn0re abc');
  });

  it('does not throw on empty input', () => {
    expect(normalizeForDetection('')).toBe('');
  });
});

describe('resolveDetectNormalization', () => {
  it('returns the default config for true and for no argument', () => {
    expect(resolveDetectNormalization(true)).toEqual(
      DEFAULT_DETECT_NORMALIZATION,
    );
    expect(resolveDetectNormalization()).toEqual(DEFAULT_DETECT_NORMALIZATION);
  });

  it('marks the config disabled for false', () => {
    expect(resolveDetectNormalization(false).enabled).toBe(false);
  });

  it('merges partial overrides over the defaults', () => {
    const resolved = resolveDetectNormalization({ repairTypos: false });
    expect(resolved.repairTypos).toBe(false);
    expect(resolved.foldHomoglyphs).toBe(true);
  });
});
