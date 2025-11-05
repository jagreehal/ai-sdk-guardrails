/**
 * Main guardrail evaluation runner
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import type { GuardrailContext } from '../../enhanced-types';
import {
  loadGuardrailBundle,
  instantiateGuardrails,
} from '../../enhanced-runtime';
import { JsonlDatasetLoader } from './jsonl-loader';
import { AsyncRunEngine } from './async-engine';
import { GuardrailMetricsCalculator } from './metrics-calculator';
import type {
  EvaluationConfig,
  EvaluationReport,
  EvaluationProgress,
} from './types';

/**
 * Main class for running guardrail evaluations
 */
export class GuardrailEval {
  private loader = new JsonlDatasetLoader();
  private calculator = new GuardrailMetricsCalculator();

  constructor(private config: EvaluationConfig) {}

  /**
   * Run the evaluation pipeline
   */
  async run(
    description: string = 'Evaluating guardrails',
    context: GuardrailContext = {},
  ): Promise<EvaluationReport> {
    console.log(`\n🚀 ${description}\n`);

    try {
      // Load configuration
      console.log('📋 Loading configuration...');
      const configContent = await fs.readFile(this.config.configPath, 'utf-8');
      const bundle = loadGuardrailBundle(JSON.parse(configContent));
      const guardrails = await instantiateGuardrails(bundle);
      console.log(`   ✅ Loaded ${guardrails.length} guardrails`);

      // Load dataset
      console.log('📊 Loading dataset...');
      let samples = await this.loader.load(this.config.datasetPath);
      console.log(`   ✅ Loaded ${samples.length} samples`);

      // Apply filters if specified
      if (this.config.sampleFilter || this.config.guardrailFilter) {
        console.log('🔍 Applying filters...');

        // Filter samples
        if (this.config.sampleFilter) {
          samples = JsonlDatasetLoader.filterSamples(
            samples,
            this.config.sampleFilter,
          );
          console.log(`   ✅ Filtered to ${samples.length} samples`);
        }

        // Filter guardrails
        if (
          this.config.guardrailFilter &&
          this.config.guardrailFilter.length > 0
        ) {
          const filtered = guardrails.filter((g) =>
            this.config.guardrailFilter!.includes(g.spec.id),
          );
          if (filtered.length === 0) {
            throw new Error('No guardrails matched the filter criteria');
          }
          console.log(`   ✅ Filtered to ${filtered.length} guardrails`);
        }
      }

      // Show dataset statistics
      const stats = JsonlDatasetLoader.getDatasetStats(samples);
      console.log('\n📈 Dataset Statistics:');
      console.log(`   Total samples: ${stats.totalSamples}`);
      console.log(`   Categories: ${Object.keys(stats.byCategory).join(', ')}`);
      console.log(
        `   Guardrails covered: ${Array.from(stats.guardrailsCovered).join(', ')}`,
      );
      console.log(
        `   Average triggers per sample: ${stats.averageTriggersPerSample.toFixed(2)}`,
      );

      // Initialize engine
      const engine = new AsyncRunEngine(guardrails);

      // Progress tracking
      let lastProgressUpdate = 0;
      const progressCallback:
        | ((progress: EvaluationProgress) => void)
        | undefined = this.config.batchSize
        ? (progress) => {
            const now = Date.now();
            // Update every second
            if (now - lastProgressUpdate > 1000) {
              lastProgressUpdate = now;
              const bar = this.createProgressBar(progress.percentComplete);
              console.log(
                `\r⏳ Progress: ${bar} ${progress.percentComplete.toFixed(1)}% ` +
                  `(${progress.currentSample}/${progress.totalSamples}) ` +
                  `ETA: ${progress.estimatedTimeRemaining?.toFixed(0)}s`,
              );
            }
          }
        : undefined;

      // Run evaluation
      console.log('\n🏃 Running evaluation...');
      const startTime = Date.now();

      const results = await engine.run(context, samples, {
        batchSize: this.config.batchSize || 32,
        timeoutMs: this.config.timeoutMs || 30000,
        failFast: this.config.failFast || false,
        onProgress: progressCallback,
      });

      const elapsedMs = Date.now() - startTime;
      console.log(
        `\n✅ Evaluation complete in ${(elapsedMs / 1000).toFixed(2)}s`,
      );

      // Calculate metrics
      console.log('\n📊 Calculating metrics...');
      const metrics = this.calculator.calculate(results);

      // Generate report
      const report = this.calculator.generateReport(metrics, results, {
        evaluationId: `eval-${Date.now()}`,
        datasetPath: this.config.datasetPath,
        configPath: this.config.configPath,
        environment: process.env.NODE_ENV,
      });

      // Save results if configured
      if (this.config.outputDir) {
        await this.saveResults(report);
      }

      // Print summary
      this.printSummary(report);

      return report;
    } catch (error) {
      console.error('\n❌ Evaluation failed:', error);
      throw error;
    }
  }

  /**
   * Save evaluation results to disk
   */
  private async saveResults(report: EvaluationReport): Promise<void> {
    const outputDir = this.config.outputDir || 'evaluation-results';

    // Create output directory
    await fs.mkdir(outputDir, { recursive: true });

    // Save main report
    const reportPath = join(
      outputDir,
      `report-${report.metadata.evaluationId}.json`,
    );
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n💾 Report saved to: ${reportPath}`);

    // Save detailed results if configured
    if (this.config.saveDetailedResults) {
      const detailsPath = join(
        outputDir,
        `details-${report.metadata.evaluationId}.jsonl`,
      );
      const lines = report.sampleResults.map((r) => JSON.stringify(r));
      await fs.writeFile(detailsPath, lines.join('\n'));
      console.log(`   Detailed results saved to: ${detailsPath}`);
    }

    // Save metrics summary
    const metricsPath = join(
      outputDir,
      `metrics-${report.metadata.evaluationId}.txt`,
    );
    const metricsText = this.formatMetricsReport(report);
    await fs.writeFile(metricsPath, metricsText);
    console.log(`   Metrics summary saved to: ${metricsPath}`);
  }

  /**
   * Format metrics as text report
   */
  private formatMetricsReport(report: EvaluationReport): string {
    const lines = [
      '='.repeat(70),
      'GUARDRAIL EVALUATION REPORT',
      '='.repeat(70),
      '',
      `Evaluation ID: ${report.metadata.evaluationId}`,
      `Timestamp: ${report.metadata.timestamp}`,
      `Dataset: ${report.metadata.datasetPath}`,
      `Configuration: ${report.metadata.configPath}`,
      '',
      'OVERALL METRICS',
      '-'.repeat(40),
      `Total Samples: ${report.metrics.totalSamples}`,
      `Passed: ${report.metrics.passedSamples}`,
      `Failed: ${report.metrics.failedSamples}`,
      `Overall Accuracy: ${(report.metrics.overallAccuracy * 100).toFixed(1)}%`,
      `Total Execution Time: ${(report.metrics.totalExecutionTimeMs / 1000).toFixed(2)}s`,
      `Average Time per Sample: ${report.metrics.averageTimePerSample.toFixed(2)}ms`,
      '',
      'PER-GUARDRAIL METRICS',
      '-'.repeat(40),
    ];

    for (const [guardrailId, metrics] of Object.entries(
      report.metrics.guardrailMetrics,
    )) {
      lines.push('');
      lines.push(`Guardrail: ${guardrailId}`);
      lines.push(this.calculator.formatMetrics(metrics));
    }

    if (
      report.summary.recommendations &&
      report.summary.recommendations.length > 0
    ) {
      lines.push('');
      lines.push('RECOMMENDATIONS');
      lines.push('-'.repeat(40));
      for (const rec of report.summary.recommendations) {
        lines.push(`• ${rec}`);
      }
    }

    lines.push('');
    lines.push('='.repeat(70));

    return lines.join('\n');
  }

  /**
   * Print evaluation summary to console
   */
  private printSummary(report: EvaluationReport): void {
    console.log('\n' + '='.repeat(70));
    console.log('📋 EVALUATION SUMMARY');
    console.log('='.repeat(70));

    console.log(`\n📊 Overall Results:`);
    console.log(
      `   Accuracy: ${(report.metrics.overallAccuracy * 100).toFixed(1)}%`,
    );
    console.log(
      `   Passed: ${report.metrics.passedSamples}/${report.metrics.totalSamples}`,
    );
    console.log(
      `   Failed: ${report.metrics.failedSamples}/${report.metrics.totalSamples}`,
    );

    if (report.summary.strongPerformers.length > 0) {
      console.log(`\n🏆 Strong Performers:`);
      for (const performer of report.summary.strongPerformers) {
        console.log(
          `   ✅ ${performer.guardrailId}: ${(performer.f1Score * 100).toFixed(1)}% F1`,
        );
      }
    }

    if (report.summary.weakPerformers.length > 0) {
      console.log(`\n⚠️  Needs Improvement:`);
      for (const performer of report.summary.weakPerformers) {
        console.log(
          `   ❌ ${performer.guardrailId}: ${(performer.f1Score * 100).toFixed(1)}% F1`,
        );
        for (const issue of performer.issues) {
          console.log(`      - ${issue}`);
        }
      }
    }

    if (
      report.summary.recommendations &&
      report.summary.recommendations.length > 0
    ) {
      console.log(`\n💡 Recommendations:`);
      for (const rec of report.summary.recommendations.slice(0, 5)) {
        console.log(`   • ${rec}`);
      }
    }

    console.log('\n' + '='.repeat(70));
  }

  /**
   * Create a visual progress bar
   */
  private createProgressBar(percent: number): string {
    const width = 30;
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${'-'.repeat(empty)}]`;
  }

  /**
   * Create a sample evaluation configuration
   */
  static createSampleConfig(): EvaluationConfig {
    return {
      datasetPath: './evaluation-dataset.jsonl',
      configPath: './guardrails-config.json',
      outputDir: './evaluation-results',
      batchSize: 32,
      saveDetailedResults: true,
      timeoutMs: 30000,
      failFast: false,
    };
  }
}
