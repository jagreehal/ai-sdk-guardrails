/**
 * Opt-in benchmark for model-backed classifiers. Costs money and needs network,
 * so it is skipped unless BENCH_PROVIDERS=1 and OPENAI_API_KEY are set:
 *
 *   BENCH_PROVIDERS=1 OPENAI_API_KEY=... pnpm bench
 *
 * Writes PROVIDER-RESULTS.md next to RESULTS.md so you can compare a
 * classifier against the offline heuristics on the same corpus. No floors:
 * model answers drift, so this is a report, not a gate.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { openai } from '@ai-sdk/openai';
import {
  classifierGuardrail,
  llmClassifier,
  openAIModerationClassifier,
  type Classifier,
} from '../src/guardrails/classifier';
import { textOf, type Detect, type Suite } from './detectors';
import { runSuite, toMarkdown } from './run';

const enabled =
  process.env.BENCH_PROVIDERS === '1' && !!process.env.OPENAI_API_KEY;

const model = openai(process.env.BENCH_MODEL ?? 'gpt-4.1-mini');

const viaGuardrail = (classify: Classifier): Detect => {
  const rail = classifierGuardrail({
    name: 'bench',
    classify,
    onError: 'allow',
  });

  return async (s) => {
    const text = textOf(s);

    const r = await rail.execute({
      prompt: text,
      messages: [{ role: 'user', content: text }],
      system: '',
    });

    if (r.executionFailed) throw new Error(String(r.message));

    return r.tripwireTriggered;
  };
};

const suites: Suite[] = [
  {
    corpus: 'prompt-injection',
    detectors: {
      'llmClassifier(prompt-injection)': viaGuardrail(
        llmClassifier({ model, task: 'prompt-injection' }),
      ),
    },
  },
  {
    corpus: 'pii',
    detectors: {
      'llmClassifier(pii)': viaGuardrail(llmClassifier({ model, task: 'pii' })),
    },
  },
  {
    corpus: 'toxicity',
    detectors: {
      openAIModerationClassifier: viaGuardrail(
        openAIModerationClassifier({
          categories: [
            'harassment',
            'harassment/threatening',
            'violence',
            'hate',
          ],
        }),
      ),
      'llmClassifier(toxicity)': viaGuardrail(
        llmClassifier({ model, task: 'toxicity' }),
      ),
    },
  },
];

describe.skipIf(!enabled)('provider benchmark (opt-in)', () => {
  it('runs classifiers over the corpus', { timeout: 600_000 }, async () => {
    const results = [];

    for (const suite of suites) results.push(...(await runSuite(suite)));
    writeFileSync(
      fileURLToPath(new URL('PROVIDER-RESULTS.md', import.meta.url)),
      toMarkdown(results).replace(
        '# Detection benchmark results',
        `# Provider benchmark results (${process.env.BENCH_MODEL ?? 'gpt-4.1-mini'})`,
      ),
    );
  });
});
