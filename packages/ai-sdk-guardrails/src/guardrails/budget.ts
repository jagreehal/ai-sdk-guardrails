/**
 * Budget guardrail — a single cumulative cost / token / tool-call kill-switch
 * driven automatically by the guardrails pipeline.
 *
 * The per-request `tokenUsageLimit` / `costQuotaRails` guardrails check one
 * response in isolation. A *budget* accumulates across every call in a session
 * and trips once a ceiling is crossed — the same job as autotel-genai's
 * `createGenAiBudget`. Rather than track cumulative spend in two places, this
 * guardrail feeds each call's usage into **one** shared budget object.
 *
 * The {@link GuardrailBudget} interface is satisfied structurally by
 * autotel-genai's `GenAiGuard` — so the canonical kill-switch (abort signal,
 * `GEN_AI_GUARD_STOP`, `gen_ai.guard.*` telemetry) becomes the single source of
 * truth, fed by the middleware:
 *
 * ```ts
 * import { createGenAiBudget } from 'autotel-genai/guard';
 * import { estimateLLMCost } from 'autotel-genai/cost';
 * import { withGuardrails, budgetGuardrail } from 'ai-sdk-guardrails';
 *
 * const budget = createGenAiBudget({ maxCostUsd: 5, warnAtUsd: 4, onStop: 'abort' });
 * const model = withGuardrails({ model: base,
 *   outputGuardrails: [
 *     budgetGuardrail({
 *       budget,
 *       estimateCost: (u) => estimateLLMCost('gpt-4o', u),
 *     }),
 *   ],
 * });
 * ```
 *
 * With no autotel-genai installed, use the built-in {@link createGuardrailBudget}
 * — same interface, dependency-free accumulator.
 */

import { createOutputGuardrail } from '../core';
import type { OutputGuardrail, OutputGuardrailContext } from '../types';
import { extractContent, normalizeUsage } from './output';

/**
 * Whether an error is autotel-genai's deliberate stop signal (a `GenAiGuard`
 * with `onStop: 'throw'` throws `GEN_AI_GUARD_STOP` once a ceiling crosses).
 * Anything else thrown from `record()` is a real fault and must propagate, not
 * be silently misread as "budget exceeded".
 */
function isGuardStop(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'GenAiGuardStop' ||
      error.message.includes('GEN_AI_GUARD_STOP'))
  );
}

/** Per-step usage contribution. Mirrors autotel-genai's `GuardUsage`. */
export interface BudgetUsage {
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}

/** A supervised step fed to the budget. Mirrors autotel-genai's `GenAiGuardStep`. */
export interface BudgetStep {
  kind?: string;
  name?: string;
  error?: boolean;
  usage?: BudgetUsage;
}

/** Read-only accumulated budget state. A subset of autotel-genai's `GuardState`. */
export interface BudgetState {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  stepCount: number;
  toolCallCount: number;
  errorCount: number;
}

/**
 * The minimal budget surface the guardrail drives. autotel-genai's `GenAiGuard`
 * (from `createGenAiBudget` / `createGenAiGuard`) satisfies this structurally, so
 * it can be passed directly — no adapter, no import from this package's side.
 */
export interface GuardrailBudget {
  /** Record a step and accumulate its usage. Return value is ignored here. */
  record(step: BudgetStep): unknown;
  /** `true` once a stop ceiling has been crossed. */
  readonly stopped: boolean;
  /** Current accumulated totals. */
  readonly state: BudgetState;
}

export interface CreateGuardrailBudgetOptions {
  /** Hard cumulative cost ceiling in USD. */
  maxCostUsd?: number;
  /** Hard cumulative token ceiling (input + output). */
  maxTokens?: number;
  /** Hard cumulative tool-call ceiling. */
  maxToolCalls?: number;
}

/**
 * Dependency-free cumulative budget — the standalone counterpart to
 * autotel-genai's `createGenAiBudget`. Accumulates cost / tokens / tool calls
 * and flips {@link GuardrailBudget.stopped} once a ceiling is crossed.
 */
export function createGuardrailBudget(
  options: CreateGuardrailBudgetOptions = {},
): GuardrailBudget {
  let costUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let stepCount = 0;
  let toolCallCount = 0;
  let errorCount = 0;
  let stopped = false;

  return {
    record(step: BudgetStep) {
      stepCount += 1;
      if (step.kind === 'tool') toolCallCount += 1;
      if (step.error) errorCount += 1;
      costUsd += step.usage?.costUsd ?? 0;
      inputTokens += step.usage?.inputTokens ?? 0;
      outputTokens += step.usage?.outputTokens ?? 0;

      if (options.maxCostUsd !== undefined && costUsd > options.maxCostUsd) {
        stopped = true;
      }
      if (
        options.maxTokens !== undefined &&
        inputTokens + outputTokens > options.maxTokens
      ) {
        stopped = true;
      }
      if (
        options.maxToolCalls !== undefined &&
        toolCallCount > options.maxToolCalls
      ) {
        stopped = true;
      }
    },
    get stopped() {
      return stopped;
    },
    get state() {
      return {
        costUsd,
        inputTokens,
        outputTokens,
        stepCount,
        toolCallCount,
        errorCount,
      };
    },
  };
}

export interface BudgetMetadata extends Record<string, unknown> {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  stepCount: number;
  stopped: boolean;
}

export interface BudgetGuardrailOptions {
  /** The shared budget to feed and check. autotel-genai's `GenAiGuard` fits. */
  budget: GuardrailBudget;
  /** Estimate USD cost for this call from its token usage. */
  estimateCost?: (usage: {
    inputTokens?: number;
    outputTokens?: number;
  }) => number | undefined;
  /** Trip the guardrail once the budget has stopped. Default: `true`. */
  blockOnStop?: boolean;
  /** Custom block message. */
  message?: string;
}

/**
 * Output guardrail that records each response's usage into a shared
 * {@link GuardrailBudget} and trips once the budget stops. This makes the budget
 * the single cumulative source of truth — no double-tracking against a
 * separately-driven kill-switch.
 *
 * An autotel-genai `GenAiGuard` configured with `onStop: 'throw'` will throw
 * from `record()` when a ceiling is crossed; the guardrail catches that and
 * converts it into a normal block, so it composes with `throwOnBlocked`,
 * `onOutputBlocked`, and the `governance` option.
 */
export function budgetGuardrail(
  options: BudgetGuardrailOptions,
): OutputGuardrail<BudgetMetadata> {
  const { budget, estimateCost, blockOnStop = true } = options;

  return createOutputGuardrail<BudgetMetadata>(
    'budget',
    (context: OutputGuardrailContext) => {
      const { usage } = extractContent(context.result);
      const normalized = normalizeUsage(
        usage as Parameters<typeof normalizeUsage>[0],
      );
      const inputTokens = normalized?.promptTokens;
      const outputTokens = normalized?.completionTokens;
      const costUsd = estimateCost?.({ inputTokens, outputTokens });

      // The budget is the single source of truth for `stopped`: read it after a
      // successful record, or trust the deliberate stop-throw. Any other throw
      // is a real fault and propagates.
      let stopped: boolean;
      try {
        budget.record({
          kind: 'llm',
          usage: { costUsd, inputTokens, outputTokens },
        });
        stopped = budget.stopped;
      } catch (error) {
        if (!isGuardStop(error)) throw error;
        stopped = true;
      }

      const state = budget.state;
      const metadata: BudgetMetadata = {
        costUsd: state.costUsd,
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
        stepCount: state.stepCount,
        stopped,
      };

      if (blockOnStop && stopped) {
        return {
          tripwireTriggered: true,
          severity: 'high',
          message:
            options.message ??
            `Budget exceeded: $${state.costUsd.toFixed(4)} cost, ${
              state.inputTokens + state.outputTokens
            } tokens over ${state.stepCount} calls`,
          metadata,
          info: { guardrailName: 'budget', ...state },
        };
      }

      return {
        tripwireTriggered: false,
        metadata,
        info: { guardrailName: 'budget' },
      };
    },
  );
}
