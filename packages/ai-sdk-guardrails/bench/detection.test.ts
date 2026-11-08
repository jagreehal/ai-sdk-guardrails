/**
 * Detection benchmark. Runs every built-in detector against the labelled
 * corpus and fails if a catch rate drops below, or a false-alarm rate rises
 * above, the floors in `floors.json`. After improving a detector, run
 * `pnpm bench:update` to raise the floors and regenerate RESULTS.md.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { builtinSuites } from './detectors';
import { runSuite, toMarkdown, type DetectorResult } from './run';

type Floors = Record<string, { recall: number; falsePositiveRate: number }>;

const FLOORS = fileURLToPath(new URL('floors.json', import.meta.url));

const RESULTS = fileURLToPath(new URL('RESULTS.md', import.meta.url));

const UPDATE = process.env.BENCH_UPDATE === '1';

const EPSILON = 1e-9;

const key = (r: DetectorResult) => `${r.corpus} / ${r.detector}`;

describe('detection benchmark', async () => {
  const results = (
    await Promise.all(builtinSuites.map((s) => runSuite(s)))
  ).flat();

  if (UPDATE) {
    const floors: Floors = Object.fromEntries(
      results.map((r) => [
        key(r),
        {
          recall: Math.floor(r.recall * 1e4) / 1e4,
          falsePositiveRate: Math.ceil(r.falsePositiveRate * 1e4) / 1e4,
        },
      ]),
    );

    writeFileSync(FLOORS, `${JSON.stringify(floors, null, 2)}\n`);
    writeFileSync(RESULTS, toMarkdown(results));
  }

  const floors: Floors = existsSync(FLOORS)
    ? JSON.parse(readFileSync(FLOORS, 'utf8'))
    : {};

  it.each(results.map((r) => [key(r), r] as const))('%s', (name, r) => {
    expect(r.errors, `${name} threw on ${r.errors} samples`).toBe(0);
    const floor = floors[name];
    expect(floor, `no floor for ${name}; run pnpm bench:update`).toBeDefined();
    expect(
      r.recall,
      `${name} catch rate fell. Missed: ${r.missed.join(', ')}`,
    ).toBeGreaterThanOrEqual(floor!.recall - EPSILON);
    expect(
      r.falsePositiveRate,
      `${name} false alarms rose: ${r.falseAlarmIds.join(', ')}`,
    ).toBeLessThanOrEqual(floor!.falsePositiveRate + EPSILON);
  });
});
