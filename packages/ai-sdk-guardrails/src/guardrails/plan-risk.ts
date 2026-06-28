/**
 * Plan-risk guardrail — a first-class **SAIF Layer-2 reasoning-based defense**.
 *
 * Google's *Secure AI Agents* paper warns that iterative tool-use planning is
 * where rogue plans translate into real-world impact — especially the
 * "untrusted read → destructive action" exfiltration chain. This guardrail
 * inspects the tool calls a model proposes, runs a pluggable risk classifier
 * over the proposed tool *sequence*, and blocks (or warns) when the verdict
 * crosses a threshold — before the tools execute.
 *
 * It works standalone with a dependency-free built-in heuristic, and — when the
 * optional `autotel-genai` peer is present — records the verdict as canonical
 * `agent.plan.risk.*` attributes on the active span (see
 * `ai-sdk-guardrails/governance`). Pass your own `classifier` to plug in a
 * model-based predictor (Model Armor, Llama Guard, an LLM judge, …).
 *
 * ```ts
 * import { withGuardrails, planRiskGuardrail } from 'ai-sdk-guardrails';
 *
 * const model = withGuardrails({ model: baseModel,
 *   outputGuardrails: [planRiskGuardrail({ blockAtOrAbove: 'high' })],
 *   throwOnBlocked: true,
 * });
 * ```
 */

import { createOutputGuardrail } from '../core';
import type {
  AIResult,
  OutputGuardrail,
  OutputGuardrailContext,
} from '../types';
import { recordPlanRisk } from '../governance';
import type { PlanRiskAssessment } from '../governance';
import { SEVERITY_RANK } from '../severity';
import { extractToolNamesFromResult } from './tools';

export type { PlanRiskAssessment } from '../governance';

export type PlanRiskVerdict = PlanRiskAssessment['verdict'];

/**
 * Classifies a proposed tool plan. Return `undefined` to abstain (treated as no
 * risk). May be async (e.g. an LLM/Model-Armor call).
 */
export type PlanRiskClassifier = (input: {
  toolSequence: string[];
}) => PlanRiskAssessment | undefined | Promise<PlanRiskAssessment | undefined>;

export interface PlanRiskGuardrailOptions {
  /**
   * Risk classifier. Defaults to {@link builtinPlanRiskClassifier} — a
   * dependency-free heuristic that flags untrusted-read→destructive chains and
   * over-long tool sequences. Swap in a model-based classifier for production.
   */
  classifier?: PlanRiskClassifier;
  /**
   * Verdict at or above which the guardrail trips. Default: `'high'`.
   */
  blockAtOrAbove?: PlanRiskVerdict;
  /**
   * Override how tool-call names are read from the result. Defaults to the
   * shared heuristic extractor.
   */
  toolExtractor?: (result: AIResult) => string[];
  /**
   * When autotel-genai is present, also emit a `llm.plan.risk.elevated` security
   * event for non-`low` verdicts (in addition to the span attributes).
   * Default: `false`.
   */
  emitSecurityEvent?: boolean;
}

export interface PlanRiskMetadata extends Record<string, unknown> {
  toolSequence: string[];
  verdict: PlanRiskVerdict;
  score?: number;
  categories?: string[];
  reason?: string;
}

const DESTRUCTIVE_TOOL =
  /\b(delete|remove|send|post|transfer|pay|upload|execute|drop)\b/i;
const UNTRUSTED_READ =
  /\b(read|fetch|get|search|load|parse|inbox|email|web|scrape|browse)\b/i;

/**
 * Dependency-free first-pass plan-risk heuristic, mirroring autotel-genai's. It
 * flags a mixed untrusted-read + destructive tool plan (the exfiltration chain)
 * as `high`, and long tool sequences (≥ 8) as `medium`.
 */
export function builtinPlanRiskClassifier(): PlanRiskClassifier {
  return ({ toolSequence }) => {
    if (toolSequence.length === 0) return { verdict: 'low', score: 0 };

    // Normalize snake_case AND camelCase so word-boundary matching works on
    // real-world tool names (`transferFunds`, `read_inbox`, `sendEmail`).
    const normalized = toolSequence.map((name) =>
      name
        .replaceAll('_', ' ')
        .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase(),
    );
    const hasDestructive = normalized.some((n) => DESTRUCTIVE_TOOL.test(n));
    const hasUntrustedRead = normalized.some((n) => UNTRUSTED_READ.test(n));

    if (hasDestructive && hasUntrustedRead) {
      return {
        verdict: 'high',
        score: 0.85,
        categories: ['untrusted_to_destructive_chain'],
        reason: 'mixed_untrusted_and_destructive_tools',
      };
    }

    if (toolSequence.length >= 8) {
      return {
        verdict: 'medium',
        score: 0.55,
        categories: ['long_tool_chain'],
        reason: 'long_tool_sequence',
      };
    }

    return { verdict: 'low', score: 0.1 };
  };
}

/**
 * Build a plan-risk output guardrail. The guardrail extracts the proposed tool
 * sequence from the model's output, classifies it, records the verdict to
 * autotel-genai (best-effort, when present), and trips when the verdict reaches
 * `blockAtOrAbove`.
 */
export function planRiskGuardrail(
  options: PlanRiskGuardrailOptions = {},
): OutputGuardrail<PlanRiskMetadata> {
  const {
    classifier = builtinPlanRiskClassifier(),
    blockAtOrAbove = 'high',
    toolExtractor = extractToolNamesFromResult,
    emitSecurityEvent = false,
  } = options;
  const blockRank = SEVERITY_RANK[blockAtOrAbove];

  return createOutputGuardrail<PlanRiskMetadata>(
    'plan-risk',
    async (context: OutputGuardrailContext) => {
      const { result } = context;
      const toolSequence = toolExtractor(result);

      const assessment = await classifier({ toolSequence });
      if (!assessment) {
        return {
          tripwireTriggered: false,
          metadata: { toolSequence, verdict: 'low' },
          info: { guardrailName: 'plan-risk' },
        };
      }

      // SAIF Layer-3: land the verdict on the trace, even when it passes.
      recordPlanRisk(assessment, toolSequence, { emitSecurityEvent });

      const metadata: PlanRiskMetadata = {
        toolSequence,
        verdict: assessment.verdict,
        score: assessment.score,
        categories: assessment.categories,
        reason: assessment.reason,
      };

      if (SEVERITY_RANK[assessment.verdict] >= blockRank) {
        return {
          tripwireTriggered: true,
          severity: assessment.verdict,
          message: `Plan-risk ${assessment.verdict}${
            assessment.reason ? `: ${assessment.reason}` : ''
          } (tools: ${toolSequence.join(' → ') || 'none'})`,
          metadata,
          info: {
            guardrailName: 'plan-risk',
            verdict: assessment.verdict,
            categories: assessment.categories,
            toolSequence,
          },
        };
      }

      return {
        tripwireTriggered: false,
        metadata,
        info: { guardrailName: 'plan-risk', verdict: assessment.verdict },
      };
    },
  );
}
