/**
 * LLM-as-Judge Auto-Retry Example
 *
 * Shows how to pair an LLM-as-judge output guardrail with the built-in
 * auto-retry middleware to feed back the judge's reasons and try again
 * up to a retry limit.
 */

import { generateText } from 'ai';
import { model } from './model';
import {
  defineOutputGuardrail,
  wrapWithOutputGuardrails,
} from '../src/guardrails';
import { extractContent } from '../src/guardrails/output';

type JudgeMeta = {
  llmJudgment?: {
    score: number;
    quality: string;
    issues?: string[];
    isAppropriate: boolean;
    reasoning: string;
  };
};

// Variable to track if this is the first attempt
let firstTry = true;

// A compact LLM-as-judge guardrail that flags low quality
const llmJudgeGuardrail = defineOutputGuardrail<JudgeMeta>({
  name: 'llm-judge-auto',
  description: 'Uses LLM to rate answer quality and flags low scores',
  execute: async (context) => {
    const { text } = extractContent(context.result);

    // Force retry on first attempt for demonstration
    if (firstTry) {
      firstTry = false;
      console.log('🔄 Forcing retry on first attempt (demo)');
      return {
        tripwireTriggered: true,
        severity: 'medium' as const,
        message: 'Forcing retry on first attempt to demonstrate functionality',
        metadata: {
          llmJudgment: {
            score: 3,
            quality: 'forced_retry',
            isAppropriate: false,
            issues: ['First attempt - forcing retry for demo'],
            reasoning: 'Demonstrating auto-retry functionality',
          },
        },
      };
    }

    // Very compact judge to keep tokens small for example purposes
    const judgePrompt = `Rate reply 1-10. JSON only: {"score": n, "issues": [..], "isAppropriate": bool, "reasoning": "..."}.\nReply:\n${text}`;
    const judge = await generateText({ model, prompt: judgePrompt });

    let parsed: JudgeMeta['llmJudgment'] | undefined;
    try {
      const json = judge.text.match(/\{[\s\S]*\}/)?.[0];
      if (json) {
        parsed = JSON.parse(json);
      }
    } catch {}

    // Fallback heuristic if parse failed
    if (!parsed) {
      parsed = {
        score: text.length > 80 ? 7 : 4,
        quality: 'heuristic',
        isAppropriate: true,
        issues: ['Could not parse judge JSON'],
        reasoning: 'Heuristic fallback',
      };
    }

    const shouldBlock = !parsed.isAppropriate || parsed.score < 7;
    if (shouldBlock) {
      return {
        tripwireTriggered: true,
        severity: parsed.score < 5 ? 'high' : 'medium',
        message: `Low judge score ${parsed.score}/10: ${parsed.reasoning}`,
        metadata: { llmJudgment: parsed },
      };
    }

    return { tripwireTriggered: false, metadata: { llmJudgment: parsed } };
  },
});

console.log('🛡️  LLM-as-Judge Auto-Retry Example');
console.log('');
let feedback = '';

const judgedModel = wrapWithOutputGuardrails(model, [llmJudgeGuardrail], {
  throwOnBlocked: false,
  replaceOnBlocked: false,
  retry: {
    maxRetries: 2,
    backoffMs: (n) => n * 250,
    buildRetryParams: ({ summary, lastParams }) => {
      const first = summary.blockedResults[0];
      const meta = (first?.metadata as JudgeMeta | undefined)?.llmJudgment;
      const scoreInfo = meta ? `score ${meta.score}/10` : 'low quality';
      const issues = meta?.issues?.length
        ? `Issues: ${meta.issues.join(', ')}`
        : '';
      const reason = meta?.reasoning ? `Reason: ${meta.reasoning}` : '';
      feedback = `Previous answer was judged ${scoreInfo}. ${issues} ${reason}. Improve clarity, structure, and add concrete details and examples.`;

      return {
        ...lastParams,
        maxOutputTokens: Math.max(
          800,
          (lastParams.maxOutputTokens ?? 400) + 200,
        ),
        prompt: [
          ...(Array.isArray(lastParams.prompt) ? lastParams.prompt : []),
          {
            role: 'user' as const,
            content: [{ type: 'text' as const, text: feedback }],
          },
        ],
      };
    },
  },
});

const { text } = await generateText({
  model: judgedModel,
  prompt: 'Explain the Turing Test in AI. Keep it concise.',
});

console.log('✅ Final (after retries if needed):');
console.log(text.slice(0, 400) + (text.length > 400 ? '...' : ''));
console.log('🔄 Feedback:', feedback);
