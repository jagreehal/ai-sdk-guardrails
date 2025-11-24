/**
 * Metrics calculator for guardrail evaluation results
 */

import type {
  SampleResult,
  GuardrailMetrics,
  EvaluationMetrics,
  EvaluationReport,
} from './types';

/**
 * Calculates evaluation metrics from sample results
 */
export class GuardrailMetricsCalculator {
  /**
   * Calculate metrics from sample results
   */
  calculate(results: SampleResult[]): EvaluationMetrics {
    const timestamp = new Date();
    const totalSamples = results.length;

    if (totalSamples === 0) {
      return this.emptyMetrics(timestamp);
    }

    // Count passed/failed samples
    const passedSamples = results.filter((r) => r.passed).length;
    const failedSamples = totalSamples - passedSamples;

    // Calculate per-guardrail metrics
    const guardrailMetrics = this.calculateGuardrailMetrics(results);

    // Calculate overall accuracy
    const overallAccuracy = this.calculateOverallAccuracy(results);

    // Calculate timing statistics
    const totalExecutionTimeMs = results.reduce(
      (sum, r) => sum + r.executionTimeMs,
      0,
    );
    const averageTimePerSample = totalExecutionTimeMs / totalSamples;

    return {
      timestamp,
      totalSamples,
      passedSamples,
      failedSamples,
      overallAccuracy,
      guardrailMetrics,
      totalExecutionTimeMs,
      averageTimePerSample,
    };
  }

  /**
   * Calculate metrics for each guardrail
   */
  private calculateGuardrailMetrics(
    results: SampleResult[],
  ): Record<string, GuardrailMetrics> {
    const metricsMap: Record<string, GuardrailMetrics> = {};

    // Get all unique guardrail IDs
    const guardrailIds = this.extractGuardrailIds(results);

    for (const guardrailId of guardrailIds) {
      const metrics = this.calculateSingleGuardrailMetrics(
        guardrailId,
        results,
      );
      metricsMap[guardrailId] = metrics;
    }

    return metricsMap;
  }

  /**
   * Calculate metrics for a single guardrail
   */
  private calculateSingleGuardrailMetrics(
    guardrailId: string,
    results: SampleResult[],
  ): GuardrailMetrics {
    let truePositives = 0;
    let trueNegatives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    const executionTimes: number[] = [];

    for (const result of results) {
      const expected = result.expectedTriggers[guardrailId];
      const actual = result.actualTriggers[guardrailId];

      // Skip if this guardrail wasn't evaluated for this sample
      if (expected === undefined) {
        continue;
      }

      // Count confusion matrix values
      if (expected && actual) {
        truePositives++;
      } else if (!expected && !actual) {
        trueNegatives++;
      } else if (!expected && actual) {
        falsePositives++;
      } else {
        falseNegatives++;
      }

      // Track execution time
      if (result.actualResults[guardrailId]?.context?.executionTimeMs) {
        executionTimes.push(
          result.actualResults[guardrailId].context.executionTimeMs,
        );
      }
    }

    const totalSamples =
      truePositives + trueNegatives + falsePositives + falseNegatives;

    // Calculate metrics
    const precision = this.safeDivision(
      truePositives,
      truePositives + falsePositives,
    );
    const recall = this.safeDivision(
      truePositives,
      truePositives + falseNegatives,
    );
    const f1Score = this.calculateF1Score(precision, recall);
    const accuracy = this.safeDivision(
      truePositives + trueNegatives,
      totalSamples,
    );

    // Calculate execution statistics
    const executionStats = this.calculateExecutionStats(executionTimes);

    return {
      totalSamples,
      truePositives,
      trueNegatives,
      falsePositives,
      falseNegatives,
      precision,
      recall,
      f1Score,
      accuracy,
      executionStats,
    };
  }

  /**
   * Calculate F1 score from precision and recall
   */
  private calculateF1Score(precision: number, recall: number): number {
    if (precision === 0 && recall === 0) {
      return 0;
    }
    return (2 * precision * recall) / (precision + recall);
  }

  /**
   * Safe division that returns 0 for division by zero
   */
  private safeDivision(numerator: number, denominator: number): number {
    if (denominator === 0) {
      return 0;
    }
    return numerator / denominator;
  }

  /**
   * Calculate execution time statistics
   */
  private calculateExecutionStats(
    times: number[],
  ): GuardrailMetrics['executionStats'] {
    if (times.length === 0) {
      return {
        mean: 0,
        median: 0,
        min: 0,
        max: 0,
        p95: 0,
        p99: 0,
      };
    }

    // Sort times for percentile calculations
    const sorted = [...times].sort((a, b) => a - b);

    return {
      mean: times.reduce((sum, t) => sum + t, 0) / times.length,
      median: this.calculatePercentile(sorted, 50),
      min: sorted[0]!,
      max: sorted[sorted.length - 1]!,
      p95: this.calculatePercentile(sorted, 95),
      p99: this.calculatePercentile(sorted, 99),
    };
  }

  /**
   * Calculate percentile value from sorted array
   */
  private calculatePercentile(sorted: number[], percentile: number): number {
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))]!;
  }

  /**
   * Calculate overall accuracy across all guardrails
   */
  private calculateOverallAccuracy(results: SampleResult[]): number {
    let totalChecks = 0;
    let correctChecks = 0;

    for (const result of results) {
      for (const [guardrailId, expected] of Object.entries(
        result.expectedTriggers,
      )) {
        const actual = result.actualTriggers[guardrailId];
        if (actual !== undefined) {
          totalChecks++;
          if (expected === actual) {
            correctChecks++;
          }
        }
      }
    }

    return this.safeDivision(correctChecks, totalChecks);
  }

  /**
   * Extract all unique guardrail IDs from results
   */
  private extractGuardrailIds(results: SampleResult[]): Set<string> {
    const ids = new Set<string>();
    for (const result of results) {
      for (const id of Object.keys(result.expectedTriggers)) {
        ids.add(id);
      }
    }
    return ids;
  }

  /**
   * Create empty metrics object
   */
  private emptyMetrics(timestamp: Date): EvaluationMetrics {
    return {
      timestamp,
      totalSamples: 0,
      passedSamples: 0,
      failedSamples: 0,
      overallAccuracy: 0,
      guardrailMetrics: {},
      totalExecutionTimeMs: 0,
      averageTimePerSample: 0,
    };
  }

  /**
   * Generate evaluation report with summary and recommendations
   */
  generateReport(
    metrics: EvaluationMetrics,
    results: SampleResult[],
    metadata: {
      evaluationId: string;
      datasetPath: string;
      configPath: string;
      environment?: string;
    },
  ): EvaluationReport {
    const guardrailIds = Object.keys(metrics.guardrailMetrics);

    // Identify strong and weak performers
    const performanceData = guardrailIds.map((id) => ({
      id,
      f1Score: metrics.guardrailMetrics[id]!.f1Score,
      precision: metrics.guardrailMetrics[id]!.precision,
      recall: metrics.guardrailMetrics[id]!.recall,
    }));

    performanceData.sort((a, b) => b.f1Score - a.f1Score);

    const strongPerformers = performanceData
      .filter((p) => p.f1Score >= 0.9)
      .slice(0, 5)
      .map((p) => ({ guardrailId: p.id, f1Score: p.f1Score }));

    const weakPerformers = performanceData
      .filter((p) => p.f1Score < 0.7)
      .slice(-5)
      .map((p) => {
        const issues: string[] = [];
        if (p.precision < 0.7)
          issues.push('Low precision - too many false positives');
        if (p.recall < 0.7) issues.push('Low recall - missing true violations');
        return {
          guardrailId: p.id,
          f1Score: p.f1Score,
          issues,
        };
      });

    // Generate recommendations
    const recommendations: string[] = [];

    if (metrics.overallAccuracy < 0.8) {
      recommendations.push(
        'Overall accuracy is below 80% - consider refining guardrail configurations',
      );
    }

    for (const guardrailId of guardrailIds) {
      const m = metrics.guardrailMetrics[guardrailId]!;
      if (m.falsePositives > m.truePositives) {
        recommendations.push(
          `${guardrailId}: High false positive rate - consider adjusting sensitivity`,
        );
      }
      if (m.recall < 0.5 && m.truePositives > 0) {
        recommendations.push(
          `${guardrailId}: Low recall (${(m.recall * 100).toFixed(1)}%) - missing many violations`,
        );
      }
      if (m.executionStats.p95 > 1000) {
        recommendations.push(
          `${guardrailId}: Slow execution (p95: ${m.executionStats.p95.toFixed(0)}ms) - consider optimization`,
        );
      }
    }

    return {
      metadata: {
        evaluationId: metadata.evaluationId,
        timestamp: metrics.timestamp,
        datasetPath: metadata.datasetPath,
        configPath: metadata.configPath,
        guardrailsEvaluated: guardrailIds,
        environment: metadata.environment,
      },
      metrics,
      sampleResults: results,
      summary: {
        strongPerformers,
        weakPerformers,
        recommendations:
          recommendations.length > 0 ? recommendations : undefined,
      },
    };
  }

  /**
   * Format metrics as a readable string
   */
  formatMetrics(metrics: GuardrailMetrics): string {
    const lines = [
      `Total Samples: ${metrics.totalSamples}`,
      `Accuracy: ${(metrics.accuracy * 100).toFixed(1)}%`,
      `Precision: ${(metrics.precision * 100).toFixed(1)}%`,
      `Recall: ${(metrics.recall * 100).toFixed(1)}%`,
      `F1 Score: ${(metrics.f1Score * 100).toFixed(1)}%`,
      '',
      'Confusion Matrix:',
      `  True Positives:  ${metrics.truePositives}`,
      `  True Negatives:  ${metrics.trueNegatives}`,
      `  False Positives: ${metrics.falsePositives}`,
      `  False Negatives: ${metrics.falseNegatives}`,
      '',
      'Execution Times:',
      `  Mean:   ${metrics.executionStats.mean.toFixed(2)}ms`,
      `  Median: ${metrics.executionStats.median.toFixed(2)}ms`,
      `  P95:    ${metrics.executionStats.p95.toFixed(2)}ms`,
      `  P99:    ${metrics.executionStats.p99.toFixed(2)}ms`,
    ];

    return lines.join('\n');
  }
}
