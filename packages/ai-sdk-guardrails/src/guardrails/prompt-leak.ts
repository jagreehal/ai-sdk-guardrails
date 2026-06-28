/**
 * System-prompt leak detection. Catches a model echoing, quoting, or
 * paraphrasing its own system prompt back to the user by measuring n-gram and
 * word overlap between the output and the system prompt, then optionally
 * redacting the leaked fragments.
 *
 * Distinct from `sensitiveDataFilter` / `secretRedaction` (which look for
 * secrets/PII): this looks for the *instructions themselves* leaking out.
 *
 * Detection algorithm adapted for this guardrail runtime.
 */

import { createOutputGuardrail, type OutputGuardrail } from '../core';
import type { OutputGuardrailContext } from '../types';
import { extractContent, stringifyContent } from './output';

export interface SystemPromptLeakResult {
  leaked: boolean;
  /** 0..1 confidence that the output reproduces the system prompt. */
  confidence: number;
  /** Overlapping fragments found in the output. */
  fragments: string[];
  /** The output with leaked fragments replaced (when redaction runs). */
  sanitized: string;
}

export interface SystemPromptLeakOptions {
  /**
   * The system prompt to protect. When omitted, it is read from the guardrail
   * context (`context.input.system`), so the common case needs no config.
   */
  systemPrompt?: string;
  /** Contiguous-token window used for exact-fragment matching. Default 4. */
  ngramSize?: number;
  /** Confidence at or above which a match counts as a leak. Default 0.7. */
  threshold?: number;
  /** Jaccard word-overlap that counts as a leak on its own. Default 0.25. */
  wordOverlapThreshold?: number;
  /** Replacement for leaked fragments in `metadata.sanitized`. Default `[REDACTED]`. */
  redactionText?: string;
  /** Severity reported when a leak trips. Default `high`. */
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

export type SystemPromptLeakMetadata = {
  confidence: number;
  fragments: string[];
  /** Output with leaked fragments redacted — use this to replace the response. */
  sanitized: string;
};

const MAX_OUTPUT_LENGTH = 1024 * 1024;
const RE_NON_WORD = /[^\w\s]/g;
const RE_WHITESPACE = /\s+/;
const RE_REGEX_META = /[.*+?^${}()|[\]\\]/g;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replaceAll(RE_NON_WORD, ' ')
    .split(RE_WHITESPACE)
    .filter(Boolean);
}

function generateNgrams(tokens: string[], n: number): Set<string> {
  const ngrams = new Set<string>();
  for (let i = 0; i <= tokens.length - n; i++) {
    ngrams.add(tokens.slice(i, i + n).join(' '));
  }
  return ngrams;
}

function wordOverlapRatio(
  outputTokens: string[],
  promptTokens: string[],
): number {
  const outSet = new Set(outputTokens);
  const promptSet = new Set(promptTokens);
  let intersection = 0;
  for (const w of outSet) {
    if (promptSet.has(w)) intersection++;
  }
  const union = outSet.size + promptSet.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function findMatchingSubstrings(
  outputTokens: string[],
  promptNgrams: Set<string>,
  ngramSize: number,
): string[] {
  const matches: string[] = [];
  const windowSize = ngramSize + 4;
  for (let i = 0; i <= outputTokens.length - ngramSize; i++) {
    const ngram = outputTokens.slice(i, i + ngramSize).join(' ');
    if (promptNgrams.has(ngram)) {
      const end = Math.min(i + windowSize, outputTokens.length);
      const fragment = outputTokens.slice(i, end).join(' ');
      if (!matches.some((m) => m.includes(ngram))) {
        matches.push(fragment);
      }
    }
  }
  return matches;
}

/**
 * Pure detection: does `output` reproduce `systemPrompt`? Use this when you
 * want the verdict (and a redacted copy) without wiring a guardrail.
 */
export function detectSystemPromptLeak(
  output: string,
  systemPrompt: string,
  options: SystemPromptLeakOptions = {},
): SystemPromptLeakResult {
  if (
    !output ||
    typeof output !== 'string' ||
    !systemPrompt ||
    typeof systemPrompt !== 'string'
  ) {
    return {
      leaked: false,
      confidence: 0,
      fragments: [],
      sanitized: output || '',
    };
  }

  const boundedOutput =
    output.length > MAX_OUTPUT_LENGTH
      ? output.slice(0, MAX_OUTPUT_LENGTH)
      : output;
  const ngramSize = options.ngramSize ?? 4;
  const threshold = options.threshold ?? 0.7;
  const wordOverlapThreshold = options.wordOverlapThreshold ?? 0.25;
  const redactionText = options.redactionText || '[REDACTED]';

  const promptTokens = tokenize(systemPrompt);
  const outputTokens = tokenize(boundedOutput);

  if (promptTokens.length < 2) {
    return {
      leaked: false,
      confidence: 0,
      fragments: [],
      sanitized: boundedOutput,
    };
  }

  const effectiveNgram = Math.min(ngramSize, Math.max(2, promptTokens.length));
  const promptNgrams = generateNgrams(promptTokens, effectiveNgram);
  const fragments = findMatchingSubstrings(
    outputTokens,
    promptNgrams,
    effectiveNgram,
  );

  const smallNgramSize = Math.min(3, Math.max(1, effectiveNgram - 1));
  const smallFragments =
    smallNgramSize >= 2 && promptTokens.length >= smallNgramSize
      ? findMatchingSubstrings(
          outputTokens,
          generateNgrams(promptTokens, smallNgramSize),
          smallNgramSize,
        )
      : [];

  const outputNgrams = generateNgrams(outputTokens, effectiveNgram);
  let ngramOverlap = 0;
  for (const ng of outputNgrams) {
    if (promptNgrams.has(ng)) ngramOverlap++;
  }
  const ngramOverlapRatio =
    promptNgrams.size > 0 ? ngramOverlap / promptNgrams.size : 0;
  const wordOverlap = wordOverlapRatio(outputTokens, promptTokens);

  const confidence =
    fragments.length > 0
      ? Math.min(1, ngramOverlapRatio * 2 + (fragments.length > 2 ? 0.2 : 0))
      : wordOverlap >= wordOverlapThreshold
        ? Math.min(1, wordOverlap * 2)
        : 0;

  const isLeak =
    (fragments.length > 0 && confidence >= threshold) ||
    fragments.length >= 2 ||
    (smallFragments.length >= 3 && wordOverlap >= wordOverlapThreshold) ||
    (wordOverlap >= wordOverlapThreshold * 1.5 && smallFragments.length > 0);

  if (!isLeak) {
    return {
      leaked: false,
      confidence,
      fragments: [],
      sanitized: boundedOutput,
    };
  }

  const allFragments = [...new Set([...fragments, ...smallFragments])];

  let sanitized = boundedOutput;
  for (const fragment of allFragments) {
    const words = fragment.split(' ');
    for (let len = words.length; len >= effectiveNgram; len--) {
      const sub = words.slice(0, len).join(' ');
      const regex = new RegExp(
        sub
          .replaceAll(RE_REGEX_META, String.raw`\$&`)
          .replaceAll(/\s+/g, String.raw`\s+`),
        'gi',
      );
      sanitized = sanitized.replace(regex, redactionText);
    }
  }

  return { leaked: true, confidence, fragments: allFragments, sanitized };
}

/**
 * Output guardrail that trips when the model leaks its own system prompt. The
 * system prompt is taken from the call context by default, so a bare
 * `systemPromptLeakDetector()` works. The redacted output is provided on
 * `metadata.sanitized` — pair with `replaceOnBlocked` to swap it in.
 *
 * @example
 * const model = withGuardrails({
 *   model: openai('gpt-4o'),
 *   outputGuardrails: [systemPromptLeakDetector()],
 * });
 */
export function systemPromptLeakDetector(
  options: SystemPromptLeakOptions = {},
): OutputGuardrail<SystemPromptLeakMetadata> {
  return createOutputGuardrail<SystemPromptLeakMetadata>(
    'system-prompt-leak-detector',
    (context: OutputGuardrailContext, accumulatedText?: string) => {
      const systemPrompt = options.systemPrompt ?? context.input.system ?? '';
      const { text, object } = extractContent(context.result);
      const output = stringifyContent(text, object, accumulatedText);

      const result = detectSystemPromptLeak(output, systemPrompt, options);

      if (!result.leaked) {
        return {
          tripwireTriggered: false,
          info: { guardrailName: 'system-prompt-leak-detector' },
        };
      }

      return {
        tripwireTriggered: true,
        message: `System prompt leak detected (confidence: ${(result.confidence * 100).toFixed(1)}%): ${result.fragments.length} matching fragment(s)`,
        severity: options.severity ?? 'high',
        metadata: {
          confidence: result.confidence,
          fragments: result.fragments,
          sanitized: result.sanitized,
        },
        suggestion:
          'The response reproduces the system prompt. Block it or replace it with metadata.sanitized.',
        info: {
          guardrailName: 'system-prompt-leak-detector',
          confidence: result.confidence,
          fragmentCount: result.fragments.length,
        },
      };
    },
  );
}
