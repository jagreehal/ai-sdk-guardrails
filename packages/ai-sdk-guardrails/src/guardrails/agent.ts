import {
  type LanguageModel,
  type ToolSet,
  type StopCondition,
  type GenerateTextOnStepEndCallback,
} from 'ai';
import { withGuardrails } from '../guardrails';
import type {
  InputGuardrail,
  OutputGuardrail,
  GuardrailExecutionSummary,
  InputGuardrailsMiddlewareConfig,
  OutputGuardrailsMiddlewareConfig,
} from '../types';

type AnyRecord = Record<string, unknown>;

export interface AgentGuardrailsConfig<TOOLS extends ToolSet = ToolSet> {
  /** The language model the agent runs on, wrapped with the guardrails below. */
  model: LanguageModel;
  /** Input guardrails — run as model middleware on the request. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputGuardrails?: Array<InputGuardrail<any>>;
  /** Output guardrails — run as model middleware on the response. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outputGuardrails?: Array<OutputGuardrail<any>>;
  /**
   * Output guardrails applied to tool calls/results (e.g. `toolEgressPolicy`).
   * Folded into the model's output guardrails — they see tool-call content in the
   * model result. For *parameter*-level pre-execution gating, set the agent's
   * native `toolApproval` with `guardrailApproval([...])` instead.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolGuardrails?: Array<OutputGuardrail<any>>;
  /** Throw on a blocked input/output instead of replacing. */
  throwOnBlocked?: boolean;
  /** Replace blocked output text with a message (default true). */
  replaceOnBlocked?: boolean;
  /** Auto-retry config forwarded to the model's output-guardrail middleware. */
  retry?: OutputGuardrailsMiddlewareConfig<AnyRecord>['retry'];
  executionOptions?: {
    parallel?: boolean;
    timeout?: number;
    continueOnFailure?: boolean;
    logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
  };
  onInputBlocked?: InputGuardrailsMiddlewareConfig<AnyRecord>['onInputBlocked'];
  onOutputBlocked?: OutputGuardrailsMiddlewareConfig<AnyRecord>['onOutputBlocked'];
  /**
   * A `stopWhen` condition to compose with the guardrail-violation stop
   * condition. Pass it here (not to `ToolLoopAgent`) so it is combined rather
   * than overwritten by the returned fragment.
   */
  stopWhen?: StopCondition<TOOLS> | Array<StopCondition<TOOLS>>;
  /**
   * Halt the agent loop when output guardrails trip. The model middleware still
   * enforces (block/replace) content; this drives *loop termination*, which has
   * no native equivalent. Each real block recorded by the middleware (via
   * `onOutputBlocked`) counts toward the threshold — the stop decision rides the
   * exact same evaluation the middleware enforced, never a re-run.
   *
   * - `true`   stop on 3 violations or any critical
   * - `number` stop after N violations
   * - fn       custom predicate over the violation history
   */
  stopOnGuardrailViolation?:
    | boolean
    | number
    | ((
        violations: Array<{ step: number; summary: GuardrailExecutionSummary }>,
      ) => boolean);
}

/**
 * Native `ToolLoopAgentSettings` fragments contributed by the guardrails layer.
 * Spread into your own `new ToolLoopAgent({ ... })` — the result is a *real*
 * `ToolLoopAgent`, so streaming, structured `output`, `runtimeContext`, and
 * `InferAgentUIMessage<typeof agent>` all keep working.
 */
export interface AgentGuardrailsFragments<TOOLS extends ToolSet = ToolSet> {
  /** The model wrapped with input/output content guardrails. */
  model: LanguageModel;
  /** Present only when `stopOnGuardrailViolation` is set (composed with yours). */
  stopWhen?: StopCondition<TOOLS> | Array<StopCondition<TOOLS>>;
  /**
   * Present only when `stopOnGuardrailViolation` is set. Stamps each recorded
   * block with its real agent step index (does NOT re-run guardrails). If you
   * also need your own `onStepEnd`, compose it after spreading these fragments.
   */
  onStepEnd?: GenerateTextOnStepEndCallback<TOOLS>;
}

/**
 * Compose the guardrail-violation stop condition with a user-supplied one.
 */
function buildGuardrailStopCondition<TOOLS extends ToolSet>(
  userStopWhen: StopCondition<TOOLS> | Array<StopCondition<TOOLS>> | undefined,
  stopOnViolation: AgentGuardrailsConfig['stopOnGuardrailViolation'],
  violationHistory: Array<{ step: number; summary: GuardrailExecutionSummary }>,
): StopCondition<TOOLS> | Array<StopCondition<TOOLS>> | undefined {
  if (!stopOnViolation) return userStopWhen;

  // A native StopCondition: the SDK calls it as `condition({ steps, ... })` after
  // each step. It bases its decision on the accumulated violation history (fed by
  // the model middleware's real onOutputBlocked), not on the step argument.
  const guardrailStop: StopCondition<TOOLS> = () => {
    if (stopOnViolation === true) {
      const critical = violationHistory.filter((v) =>
        v.summary.blockedResults.some(
          (r) => (r.severity ?? 'medium') === 'critical',
        ),
      );
      return violationHistory.length >= 3 || critical.length > 0;
    }
    if (typeof stopOnViolation === 'number') {
      return violationHistory.length >= stopOnViolation;
    }
    if (typeof stopOnViolation === 'function') {
      return stopOnViolation(violationHistory);
    }
    return false;
  };

  if (!userStopWhen) return guardrailStop;
  return Array.isArray(userStopWhen)
    ? [...userStopWhen, guardrailStop]
    : [userStopWhen, guardrailStop];
}

/**
 * Build native AI SDK `ToolLoopAgentSettings` fragments that add guardrails to an
 * agent. Spread the result into your own `ToolLoopAgent` — guardrails ride the
 * SDK's own primitives (model middleware, `stopWhen`, `onStepEnd`,
 * `telemetry.integrations`) rather than wrapping the agent:
 *
 * ```ts
 * import { ToolLoopAgent } from 'ai';
 * import { agentGuardrails, piiDetector, sensitiveDataFilter } from 'ai-sdk-guardrails';
 *
 * const agent = new ToolLoopAgent({
 *   ...agentGuardrails({
 *     model,
 *     inputGuardrails: [piiDetector()],
 *     outputGuardrails: [sensitiveDataFilter()],
 *     stopOnGuardrailViolation: true,
 *   }),
 *   instructions: 'You are a helpful assistant.',
 *   tools,
 * });
 *
 * await agent.generate({ prompt: '...' }); // .stream() is guarded too
 * ```
 *
 * Input/output content guardrails run as model middleware (the only layer that
 * can block, replace, or retry the model's output). Tool *parameter* gating stays
 * native: set `toolApproval: guardrailApproval([...])` on the agent yourself.
 */
export function agentGuardrails<TOOLS extends ToolSet = ToolSet>(
  config: AgentGuardrailsConfig<TOOLS>,
): AgentGuardrailsFragments<TOOLS> {
  const {
    model,
    inputGuardrails = [],
    outputGuardrails = [],
    toolGuardrails = [],
    throwOnBlocked = false,
    replaceOnBlocked = true,
    retry,
    executionOptions,
    onInputBlocked,
    onOutputBlocked,
    stopWhen,
    stopOnGuardrailViolation,
  } = config;

  const combinedOutput = [...outputGuardrails, ...toolGuardrails];

  // Stop-on-violation rides the SAME evaluation the middleware enforces. The
  // middleware's onOutputBlocked captures the real block (its true result, tool
  // calls, usage, metadata, context) into `pendingBlock`; onStepEnd then stamps
  // it with the *real* agent step index and records it. No re-running of
  // guardrails, no synthetic step result — and the recorded step index is the
  // actual loop step, so adjacency-based conditions (hasConsecutiveViolations) work.
  const violationHistory: Array<{
    step: number;
    summary: GuardrailExecutionSummary;
  }> = [];
  let pendingBlock: GuardrailExecutionSummary | null = null;

  const recordingOnOutputBlocked: OutputGuardrailsMiddlewareConfig<AnyRecord>['onOutputBlocked'] =
    stopOnGuardrailViolation
      ? (summary, ...rest) => {
          pendingBlock = summary;
          onOutputBlocked?.(summary, ...rest);
        }
      : onOutputBlocked;

  const guardedModel = withGuardrails({
    model,
    inputGuardrails,
    outputGuardrails: combinedOutput,
    throwOnBlocked,
    replaceOnBlocked,
    retry,
    executionOptions,
    onInputBlocked,
    onOutputBlocked: recordingOnOutputBlocked,
  });

  const fragments: AgentGuardrailsFragments<TOOLS> = { model: guardedModel };

  if (stopOnGuardrailViolation) {
    fragments.onStepEnd = ((step: { stepNumber: number }) => {
      if (pendingBlock) {
        violationHistory.push({ step: step.stepNumber, summary: pendingBlock });
        pendingBlock = null;
      }
    }) as GenerateTextOnStepEndCallback<TOOLS>;

    fragments.stopWhen = buildGuardrailStopCondition<TOOLS>(
      stopWhen,
      stopOnGuardrailViolation,
      violationHistory,
    );
  } else if (stopWhen) {
    fragments.stopWhen = stopWhen;
  }

  return fragments;
}
