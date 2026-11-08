// Adversarial inputs for the regex-heavy detectors: each must stay fast.
import { describe, expect, it } from 'vitest';
import { matchInjectionSignals } from './injection-signals';
import { assessToxicity } from './toxicity-signals';
import { scanMcpTool } from './mcp-tool-scan';
import { parseLLMJson } from '../openai-guardrails';

const inputs = {
  newlines: '\n'.repeat(40_000) + 'x',
  spaces: ' '.repeat(50_000) + 'x',
  letters: 'a'.repeat(100_000),
  braces: '{'.repeat(20_000),
  words: 'ignore the '.repeat(5000),
  dots: 'i.'.repeat(20_000),
  quotes: '"'.repeat(20_000),
};

const timeIt = (fn: () => void) => {
  const start = performance.now();

  try {
    fn();
  } catch {
    // Throwing on malformed input is fine; hanging is not.
  }

  return performance.now() - start;
};

describe('detectors stay linear on adversarial input', () => {
  it.each(Object.entries(inputs))('%s', (_name, text) => {
    expect(timeIt(() => matchInjectionSignals(text))).toBeLessThan(1500);
    expect(timeIt(() => assessToxicity(text))).toBeLessThan(1500);
    expect(
      timeIt(() => scanMcpTool({ name: 'tool', description: text })),
    ).toBeLessThan(1500);
    expect(timeIt(() => parseLLMJson(text))).toBeLessThan(1500);
  });
});
