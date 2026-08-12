/**
 * JSONL dataset loader for evaluation framework
 */

import { promises as fs } from 'node:fs';
import type { EvaluationSample } from './types';

/**
 * Loads and validates evaluation datasets in JSONL format
 */
export class JsonlDatasetLoader {
  /**
   * Load a JSONL dataset from file
   */
  async load(filePath: string): Promise<EvaluationSample[]> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content
        .trim()
        .split('\n')
        .filter((line) => line.trim());

      const samples: EvaluationSample[] = [];
      const errors: string[] = [];

      for (const [i, line_] of lines.entries()) {
        const lineNum = i + 1;
        const line = line_!;

        try {
          const sample = JSON.parse(line);
          const validated = this.validateSample(sample, lineNum);
          samples.push(validated);
        } catch (error) {
          errors.push(
            `Line ${lineNum}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      if (errors.length > 0) {
        throw new Error(`Dataset validation failed:\n${errors.join('\n')}`);
      }

      return samples;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Dataset file not found: ${filePath}`, {
          cause: error,
        });
      }
      throw error;
    }
  }

  /**
   * Validate a single sample
   */
  // Input is a raw `JSON.parse` result — untyped by definition; this method is
  // what turns it into an `EvaluationSample`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private validateSample(sample: any, lineNum: number): EvaluationSample {
    // Required fields
    if (!sample.id || typeof sample.id !== 'string') {
      throw new Error(`Missing or invalid 'id' field at line ${lineNum}`);
    }

    if (sample.data === undefined || sample.data === null) {
      throw new Error(`Missing 'data' field at line ${lineNum}`);
    }

    if (
      !sample.expectedTriggers ||
      typeof sample.expectedTriggers !== 'object'
    ) {
      throw new Error(
        `Missing or invalid 'expectedTriggers' field at line ${lineNum}`,
      );
    }

    // Validate expectedTriggers contains boolean values
    for (const [guardrailId, shouldTrigger] of Object.entries(
      sample.expectedTriggers,
    )) {
      if (typeof shouldTrigger !== 'boolean') {
        throw new TypeError(
          `Invalid expectedTriggers value for '${guardrailId}' at line ${lineNum}: expected boolean, got ${typeof shouldTrigger}`,
        );
      }
    }

    // Optional metadata validation
    if (sample.metadata) {
      if (typeof sample.metadata !== 'object') {
        throw new TypeError(
          `Invalid 'metadata' field at line ${lineNum}: expected object`,
        );
      }

      if (sample.metadata.difficulty) {
        const validDifficulties = ['easy', 'medium', 'hard'];
        if (!validDifficulties.includes(sample.metadata.difficulty)) {
          throw new Error(
            `Invalid difficulty '${sample.metadata.difficulty}' at line ${lineNum}: expected one of ${validDifficulties.join(', ')}`,
          );
        }
      }
    }

    return {
      id: sample.id,
      data: sample.data,
      expectedTriggers: sample.expectedTriggers,
      metadata: sample.metadata,
      context: sample.context,
    };
  }

  /**
   * Save samples to JSONL file
   */
  async save(samples: EvaluationSample[], filePath: string): Promise<void> {
    const lines = samples.map((sample) => JSON.stringify(sample));
    const content = lines.join('\n') + '\n';
    await fs.writeFile(filePath, content, 'utf8');
  }

  /**
   * Create a sample dataset for testing
   */
  static createSampleDataset(): EvaluationSample[] {
    return [
      {
        id: 'sample-1',
        data: 'This is a clean message with no issues.',
        expectedTriggers: {
          'pii-detection': false,
          'profanity-filter': false,
          'content-length': false,
        },
        metadata: {
          category: 'clean',
          difficulty: 'easy',
        },
      },
      {
        id: 'sample-2',
        data: 'Contact me at john.doe@example.com or call 555-123-4567',
        expectedTriggers: {
          'pii-detection': true,
          'profanity-filter': false,
          'content-length': false,
        },
        metadata: {
          category: 'pii',
          difficulty: 'easy',
        },
      },
      {
        id: 'sample-3',
        data: 'My SSN is 123-45-6789 and credit card is 4111-1111-1111-1111',
        expectedTriggers: {
          'pii-detection': true,
          'profanity-filter': false,
          'content-length': false,
        },
        metadata: {
          category: 'pii',
          difficulty: 'medium',
          source: 'synthetic',
        },
      },
      {
        id: 'sample-4',
        data: 'This message contains badword1 and is offensive',
        expectedTriggers: {
          'pii-detection': false,
          'profanity-filter': true,
          'content-length': false,
        },
        metadata: {
          category: 'profanity',
          difficulty: 'easy',
        },
      },
      {
        id: 'sample-5',
        data: Array.from({ length: 2000 }, () => 'word').join(' '), // Very long text
        expectedTriggers: {
          'pii-detection': false,
          'profanity-filter': false,
          'content-length': true,
        },
        metadata: {
          category: 'length',
          difficulty: 'easy',
        },
      },
      {
        id: 'sample-6',
        data:
          'Email john@example.com about the badword1 issue ' +
          Array.from({ length: 1000 }, () => 'word').join(' '),
        expectedTriggers: {
          'pii-detection': true,
          'profanity-filter': true,
          'content-length': true,
        },
        metadata: {
          category: 'multiple',
          difficulty: 'hard',
        },
      },
    ];
  }

  /**
   * Filter samples based on criteria
   */
  static filterSamples(
    samples: EvaluationSample[],
    filter?: {
      categories?: string[];
      difficulty?: Array<'easy' | 'medium' | 'hard'>;
      sampleIds?: string[];
    },
  ): EvaluationSample[] {
    if (!filter) {
      return samples;
    }

    return samples.filter((sample) => {
      // Filter by category
      if (filter.categories && filter.categories.length > 0) {
        const category = sample.metadata?.category;
        if (!category || !filter.categories.includes(category)) {
          return false;
        }
      }

      // Filter by difficulty
      if (filter.difficulty && filter.difficulty.length > 0) {
        const difficulty = sample.metadata?.difficulty;
        if (!difficulty || !filter.difficulty.includes(difficulty)) {
          return false;
        }
      }

      // Filter by sample IDs
      return !(
        filter.sampleIds &&
        filter.sampleIds.length > 0 &&
        !filter.sampleIds.includes(sample.id)
      );
    });
  }

  /**
   * Get statistics about a dataset
   */
  static getDatasetStats(samples: EvaluationSample[]): {
    totalSamples: number;
    byCategory: Record<string, number>;
    byDifficulty: Record<string, number>;
    guardrailsCovered: Set<string>;
    averageTriggersPerSample: number;
  } {
    const byCategory: Record<string, number> = {};
    const byDifficulty: Record<string, number> = {};
    const guardrailsCovered = new Set<string>();
    let totalTriggers = 0;

    for (const sample of samples) {
      // Count by category
      const category = sample.metadata?.category || 'uncategorized';
      byCategory[category] = (byCategory[category] || 0) + 1;

      // Count by difficulty
      const difficulty = sample.metadata?.difficulty || 'unspecified';
      byDifficulty[difficulty] = (byDifficulty[difficulty] || 0) + 1;

      // Track guardrails
      for (const [guardrailId, shouldTrigger] of Object.entries(
        sample.expectedTriggers,
      )) {
        guardrailsCovered.add(guardrailId);
        if (shouldTrigger) {
          totalTriggers++;
        }
      }
    }

    return {
      totalSamples: samples.length,
      byCategory,
      byDifficulty,
      guardrailsCovered,
      averageTriggersPerSample: totalTriggers / samples.length,
    };
  }
}
