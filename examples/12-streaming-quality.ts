/**
 * Streaming Quality Example
 *
 * Demonstrates quality monitoring and validation for streaming responses,
 * including detecting common streaming issues.
 */

import { streamText } from 'ai';
import { model } from './model';
import { defineOutputGuardrail, withGuardrails } from '../src/index';
import { extractContent } from '../src/guardrails/output';

// Quality guardrail for streaming responses
const streamQualityGuardrail = defineOutputGuardrail({
  name: 'stream-quality-monitor',
  description: 'Monitors streaming response quality',
  execute: async (params) => {
    const { text } = extractContent(params.result);
    const issues: string[] = [];
    let severity: 'low' | 'medium' | 'high' = 'low';

    // Check 1: Incomplete sentences (common in interrupted streams)
    const lastChar = text.trim().slice(-1);
    if (lastChar && !'.!?'.includes(lastChar)) {
      issues.push('Incomplete sentence detected');
      severity = 'medium';
    }

    // Check 2: Repeated phrases (stuttering)
    const phrases = text.match(/\b(\w+\s+\w+)\b/g) || [];
    const phraseCounts = new Map<string, number>();
    for (const phrase of phrases) {
      const lower = phrase.toLowerCase();
      phraseCounts.set(lower, (phraseCounts.get(lower) || 0) + 1);
    }

    const maxPhraseRepeat = Math.max(...phraseCounts.values(), 0);
    if (maxPhraseRepeat > 3) {
      issues.push(`Repeated phrases detected (${maxPhraseRepeat}x)`);
      severity = 'medium';
    }

    // Check 3: Coherence (sudden topic changes)
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    if (sentences.length >= 2) {
      // Simple coherence check: look for common words between sentences
      const firstSentence = sentences[0] ?? '';
      const lastSentence = sentences.at(-1) ?? '';
      const firstWords = new Set(firstSentence.toLowerCase().split(/\s+/));
      const lastWords = new Set(lastSentence.toLowerCase().split(/\s+/));
      const commonWords = [...firstWords].filter((w) => lastWords.has(w));

      if (commonWords.length < 2 && sentences.length > 2) {
        issues.push('Potential coherence issue');
      }
    }

    // Check 4: Stream interruption markers
    const interruptionMarkers = [
      '...',
      '---',
      '***',
      '[truncated]',
      '[cut off]',
    ];
    const hasInterruption = interruptionMarkers.some((marker) =>
      text.includes(marker),
    );
    if (hasInterruption) {
      issues.push('Stream interruption marker detected');
      severity = 'high';
    }

    // Check 5: Quality metrics
    const metrics = {
      characterCount: text.length,
      wordCount: text.split(/\s+/).length,
      sentenceCount: sentences.length,
      avgWordsPerSentence:
        sentences.length > 0
          ? Math.round(text.split(/\s+/).length / sentences.length)
          : 0,
    };

    // Check for quality thresholds
    if (metrics.avgWordsPerSentence > 30) {
      issues.push('Sentences too long');
    }
    if (metrics.avgWordsPerSentence < 5 && metrics.sentenceCount > 2) {
      issues.push('Sentences too short');
    }

    if (issues.length > 0) {
      return {
        tripwireTriggered: true,
        message: `Stream quality issues: ${issues.join(', ')}`,
        severity,
        metadata: { issues, metrics },
      };
    }

    return {
      tripwireTriggered: false,
      metadata: {
        issues: [],
        metrics,
      },
    };
  },
});

// Guardrail for detecting hallucination patterns
const hallucinationDetector = defineOutputGuardrail({
  name: 'hallucination-detector',
  description: 'Detects potential hallucination patterns in streams',
  execute: async (params) => {
    const { text } = extractContent(params.result);
    const warnings: string[] = [];

    // Pattern 1: Excessive confidence markers
    const confidenceMarkers = [
      'definitely',
      'absolutely',
      'certainly',
      'undoubtedly',
      'without a doubt',
      'clearly',
      'obviously',
    ];
    const confidenceCount = confidenceMarkers.filter((marker) =>
      text.toLowerCase().includes(marker),
    ).length;

    if (confidenceCount > 3) {
      warnings.push('Excessive confidence markers');
    }

    // Pattern 2: Made-up citations or references
    const fakeCitationPattern =
      /\[\d+\]|\(\d{4}\)|\b(?:Smith|Jones|Johnson) et al\./g;
    const citations = text.match(fakeCitationPattern) || [];
    if (citations.length > 2) {
      warnings.push('Potential fabricated citations');
    }

    // Pattern 3: Specific numbers without context
    const suspiciousNumbers =
      /\b\d{2,}\.?\d*%|\$\d+(?:,\d{3})*(?:\.\d{2})?|\b\d{4,}\b/g;
    const numbers = text.match(suspiciousNumbers) || [];
    if (numbers.length > 3) {
      warnings.push('Multiple specific numbers (verify accuracy)');
    }

    if (warnings.length > 0) {
      return {
        tripwireTriggered: true,
        message: `Potential hallucination patterns: ${warnings.join(', ')}`,
        severity: 'medium',
        metadata: {
          issues: warnings,
          metrics: {
            confidenceCount,
            citationCount: citations.length,
            numberCount: numbers.length,
            characterCount: text.length,
            wordCount: text.split(/\s+/).length,
            sentenceCount: text
              .split(/[.!?]+/)
              .filter((s) => s.trim().length > 0).length,
            avgWordsPerSentence: 0,
          },
        },
      };
    }

    return {
      tripwireTriggered: false,
      metadata: {
        issues: [],
        metrics: {
          confidenceCount: 0,
          citationCount: citations.length,
          numberCount: numbers.length,
          characterCount: text.length,
          wordCount: text.split(/\s+/).length,
          sentenceCount: text.split(/[.!?]+/).filter((s) => s.trim().length > 0)
            .length,
          avgWordsPerSentence: 0,
        },
      },
    };
  },
});

async function demonstrateQualityMonitoring() {
  console.log('📊 Stream Quality Monitoring');
  console.log('============================\n');

  const qualityModel = withGuardrails(model, {
    outputGuardrails: [streamQualityGuardrail],
    throwOnBlocked: false,
    onOutputBlocked: (executionSummary) => {
      console.log(
        '\n📊 Quality Assessment:',
        executionSummary.blockedResults[0]?.message,
      );
      const metadata = executionSummary.blockedResults[0]?.metadata;
      if (metadata?.metrics) {
        console.log('   Metrics:');
        console.log(`   - Words: ${metadata.metrics.wordCount}`);
        console.log(`   - Sentences: ${metadata.metrics.sentenceCount}`);
        console.log(
          `   - Avg words/sentence: ${metadata.metrics.avgWordsPerSentence}`,
        );
      }
    },
  });

  console.log('Test 1: Well-formed stream');
  try {
    const stream = await streamText({
      model: qualityModel,
      prompt: 'Write a clear, well-structured paragraph about trees',
    });

    console.log('Streaming: ');
    for await (const chunk of stream.textStream) {
      process.stdout.write(chunk);
    }
    console.log('\n✅ Quality check complete\n');
  } catch (error) {
    console.log('❌ Error:', (error as Error).message);
    throw error;
  }

  console.log('Test 2: Stream with potential issues');
  try {
    const stream = await streamText({
      model: qualityModel,
      prompt:
        'Write very short sentences. Make them choppy. Like this. Very brief.',
    });

    console.log('Streaming: ');
    for await (const chunk of stream.textStream) {
      process.stdout.write(chunk);
    }
    console.log('\n✅ Quality check complete\n');
  } catch (error) {
    console.log('❌ Error:', (error as Error).message);
    throw error;
  }
}

async function demonstrateHallucinationDetection() {
  console.log('🔍 Hallucination Pattern Detection');
  console.log('===================================\n');

  const hallucinationModel = withGuardrails(model, {
    outputGuardrails: [hallucinationDetector],
    throwOnBlocked: false,
    onOutputBlocked: (executionSummary) => {
      console.log(
        '\n⚠️  Hallucination Warning:',
        executionSummary.blockedResults[0]?.message,
      );
      const metadata = executionSummary.blockedResults[0]?.metadata;
      if (metadata) {
        console.log('   Detection counts:');
        console.log(
          `   - Confidence markers: ${metadata.metrics.confidenceCount}`,
        );
        console.log(`   - Citations: ${metadata.metrics.citationCount}`);
        console.log(`   - Specific numbers: ${metadata.metrics.numberCount}`);
      }
    },
  });

  console.log('Test: Generate factual content');
  try {
    const stream = await streamText({
      model: hallucinationModel,
      prompt: 'Describe general facts about the solar system',
    });

    console.log('Streaming: ');
    for await (const chunk of stream.textStream) {
      process.stdout.write(chunk);
    }
    console.log('\n✅ Hallucination check complete\n');
  } catch (error) {
    console.log('❌ Error:', (error as Error).message);
    throw error;
  }
}

async function demonstrateCombinedQualityChecks() {
  console.log('🎯 Combined Quality Checks');
  console.log('==========================\n');

  const combinedModel = withGuardrails(model, {
    outputGuardrails: [streamQualityGuardrail, hallucinationDetector],
    throwOnBlocked: false,
    onOutputBlocked: (executionSummary) => {
      console.log('\n📋 Quality Report:');
      for (const result of executionSummary.blockedResults) {
        const severity =
          result.severity === 'high'
            ? '🚨'
            : result.severity === 'medium'
              ? '⚠️'
              : 'ℹ️';
        console.log(
          `${severity} [${result.context?.guardrailName}] ${result.message}`,
        );
      }
    },
  });

  console.log('Test: Complex response with multiple quality checks');
  try {
    const stream = await streamText({
      model: combinedModel,
      prompt: 'Write a detailed technical explanation about quantum computing',
    });

    console.log('Streaming with full quality monitoring:\n');
    let charCount = 0;
    for await (const chunk of stream.textStream) {
      process.stdout.write(chunk);
      charCount += chunk.length;

      // Visual progress indicator
      if (charCount % 100 === 0) {
        process.stdout.write(` [${charCount}]`);
      }
    }
    console.log('\n\n✅ All quality checks complete\n');
  } catch (error) {
    console.log('❌ Error:', (error as Error).message);
    throw error;
  }
}

async function demonstrateRealTimeMetrics() {
  console.log('📈 Real-Time Streaming Metrics');
  console.log('==============================\n');

  // Custom real-time monitoring (not using guardrails)
  console.log('Streaming with live metrics:\n');

  try {
    const stream = await streamText({
      model,
      prompt: 'Tell an interesting story about space exploration',
    });

    const metrics = {
      chunks: 0,
      characters: 0,
      words: 0,
      startTime: Date.now(),
    };

    for await (const chunk of stream.textStream) {
      process.stdout.write(chunk);

      // Update metrics
      metrics.chunks++;
      metrics.characters += chunk.length;
      metrics.words += chunk.split(/\s+/).filter((w) => w.length > 0).length;

      // Show live metrics every 10 chunks
      if (metrics.chunks % 10 === 0) {
        const elapsed = (Date.now() - metrics.startTime) / 1000;
        const charsPerSec = Math.round(metrics.characters / elapsed);
        process.stdout.write(` [${charsPerSec} char/s]`);
      }
    }

    const totalTime = (Date.now() - metrics.startTime) / 1000;
    console.log('\n\n📊 Final Metrics:');
    console.log(`   Total chunks: ${metrics.chunks}`);
    console.log(`   Total characters: ${metrics.characters}`);
    console.log(`   Total words: ${metrics.words}`);
    console.log(`   Time: ${totalTime.toFixed(2)}s`);
    console.log(
      `   Speed: ${Math.round(metrics.characters / totalTime)} char/s\n`,
    );
  } catch (error) {
    console.log('❌ Error:', (error as Error).message);
    throw error;
  }
}

console.log('✨ Streaming Quality Example\n');
console.log(
  'This example demonstrates quality monitoring for streaming responses.\n',
);
console.log('Quality checks include:');
console.log('• Sentence completion and structure');
console.log('• Repetition and stuttering detection');
console.log('• Coherence analysis');
console.log('• Hallucination pattern detection');
console.log('• Real-time performance metrics\n');
console.log('='.repeat(60) + '\n');

await demonstrateQualityMonitoring();
console.log('='.repeat(60) + '\n');

await demonstrateHallucinationDetection();
console.log('='.repeat(60) + '\n');

await demonstrateCombinedQualityChecks();
console.log('='.repeat(60) + '\n');

await demonstrateRealTimeMetrics();

console.log('='.repeat(60));
console.log('\n📊 Summary:');
console.log('• Monitor streaming quality with multiple guardrails');
console.log('• Detect common streaming issues (incomplete, repetitive)');
console.log('• Check for hallucination patterns');
console.log('• Track real-time metrics for performance\n');
