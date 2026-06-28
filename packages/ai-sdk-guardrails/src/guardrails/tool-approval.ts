/**
 * Tool approval adapter for AI SDK v7's first-class `toolApproval`.
 *
 * The library's tool-parameter guardrails already validate a tool call by name +
 * input and return a graded result. `guardrailApproval()` re-homes those
 * guardrails into the `toolApproval` slot of `generateText` / `streamText` /
 * `Agent`, so the same rules gain pause/resume and human-in-the-loop for free:
 *
 * ```ts
 * import { generateText } from 'ai';
 * import { guardrailApproval, sqlInjectionGuardrail, toolRBACGuardrail } from 'ai-sdk-guardrails';
 *
 * await generateText({
 *   model,
 *   tools,
 *   prompt,
 *   toolApproval: guardrailApproval([sqlInjectionGuardrail(), toolRBACGuardrail({ ... })]),
 * });
 * ```
 *
 * Decision mapping (first failing guardrail wins):
 * - `valid: true`                                  → `approved`
 * - `valid: false`, severity ≥ `denyAtOrAbove`     → `denied` (with `message` as `reason`)
 * - `valid: false`, severity < `denyAtOrAbove`     → `user-approval` (human-in-the-loop)
 * - no guardrail matches the tool                  → `not-applicable`
 */

import type { ToolApprovalStatus } from 'ai';
import type { RequestContext } from '../types';
import { SEVERITY_RANK, type Severity } from '../severity';
import type {
  ToolParameterGuardrail,
  ToolValidationContext,
  ToolValidationResult,
} from './tool-parameters';

export interface GuardrailApprovalOptions<TContext = Record<string, unknown>> {
  /**
   * Severity at or above which a blocking failure becomes an outright `denied`
   * instead of escalating to human `user-approval`. Default: `'high'`.
   */
  denyAtOrAbove?: Severity;
  /**
   * Explicit override for how a *blocking* failure maps to a decision,
   * ignoring severity:
   * - `'deny'`          : always auto-deny
   * - `'user-approval'` : always escalate to a human
   * When omitted, severity decides via {@link GuardrailApprovalOptions.denyAtOrAbove}.
   */
  onBlock?: 'deny' | 'user-approval';
  /** Request-scoped context (user, role, session) passed to each guardrail. */
  requestContext?: RequestContext<TContext>;
  /** Observability hook — fired once per tool call with the final decision. */
  onDecision?: (info: {
    toolName: string;
    toolCallId: string;
    status: ToolApprovalStatus;
    guardrail?: string;
    result?: ToolValidationResult;
  }) => void;
}

/** Matches a guardrail's `toolName` pattern against an observed tool name. */
function matchesToolName(
  pattern: string | RegExp | string[],
  toolName: string,
): boolean {
  if (typeof pattern === 'string') {
    return pattern === toolName || pattern === '*';
  }
  if (pattern instanceof RegExp) {
    return pattern.test(toolName);
  }
  if (Array.isArray(pattern)) {
    return pattern.includes(toolName);
  }
  return false;
}

/**
 * A generic tool-approval function: it reads only the `toolCall` (tool name and
 * input) and is therefore assignable to the SDK's per-tool-set approval function
 * for *any* tool set, via parameter contravariance. This matters because the
 * SDK types `toolApproval` with `NoInfer<TOOLS>` — `TOOLS` is inferred from
 * `tools`, not from the approval argument — so a `ToolSet`-defaulted return type
 * would not be assignable at the call site. Keeping the signature broad lets the
 * result drop straight into `generateText` / `streamText` / `ToolLoopAgent`.
 */
export type GuardrailApprovalFunction = (args: {
  toolCall: { toolName: string; toolCallId: string; input: unknown };
}) => Promise<ToolApprovalStatus>;

/**
 * Turn one or more tool-parameter guardrails into a v7 `toolApproval` function.
 * The result is assignable directly to the `toolApproval` option of
 * `generateText` / `streamText` / `ToolLoopAgent` (the recommended agent API) —
 * no type arguments or casts required at the call site.
 *
 * Because the return value is a native `ToolApprovalConfiguration`, it composes
 * with the SDK-ecosystem policy helpers in `@ai-sdk/policy-opa` for free — no
 * extra coupling on either side:
 *
 * ```ts
 * import { shadow, wrapMcpTools } from '@ai-sdk/policy-opa';
 *
 * const gate = guardrailApproval([sqlInjectionGuardrail({ toolName: 'executeSQL' })]);
 *
 * // Shadow-mode rollout: evaluate the gate and log what it WOULD do, but let
 * // every call through until you flip `enforce: true`.
 * const toolApproval = shadow(gate, {
 *   enforce: process.env.ENFORCE === 'true',
 *   onDecision: (e) => logger.info('guardrail.decision', e),
 * });
 *
 * // Total coverage over a discovered MCP tool set: anything the gate does not
 * // govern falls back to human approval instead of being silently allowed.
 * const { tools, toolApproval } = wrapMcpTools(await mcp.tools(), gate, {
 *   default: 'user-approval',
 * });
 * ```
 *
 * Prefer these SDK-native helpers over re-implementing shadow mode or MCP
 * fallback coverage in the guardrails layer.
 */
export function guardrailApproval<TContext = Record<string, unknown>>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  guardrails: ToolParameterGuardrail<any, TContext>[],
  options: GuardrailApprovalOptions<TContext> = {},
): GuardrailApprovalFunction {
  const denyFloor = SEVERITY_RANK[options.denyAtOrAbove ?? 'high'];

  const approval: GuardrailApprovalFunction = async (args) => {
    const { toolName, toolCallId, input } = args.toolCall;

    const applicable = guardrails.filter((g) =>
      matchesToolName(g.toolName, toolName),
    );

    // No guardrail governs this tool → the library expresses no opinion.
    if (applicable.length === 0) {
      const status: ToolApprovalStatus = { type: 'not-applicable' };
      options.onDecision?.({ toolName, toolCallId, status });
      return status;
    }

    const ctx: ToolValidationContext<TContext> = {
      toolName,
      toolCallId,
      requestContext: options.requestContext,
    };

    for (const g of applicable) {
      const result = await g.validateInput(input, ctx);
      if (result.valid) continue;

      const blocking = result.block !== false; // default true, matching the lib
      const rank = SEVERITY_RANK[result.severity ?? 'high'];

      // `onBlock` is an explicit override; otherwise severity decides.
      const escalate =
        options.onBlock === 'user-approval'
          ? true
          : options.onBlock === 'deny'
            ? false
            : rank < denyFloor;

      const status: ToolApprovalStatus =
        blocking && !escalate
          ? {
              type: 'denied',
              reason: result.message ?? `${g.name} blocked ${toolName}`,
            }
          : { type: 'user-approval' };

      options.onDecision?.({
        toolName,
        toolCallId,
        status,
        guardrail: g.name,
        result,
      });
      return status;
    }

    const status: ToolApprovalStatus = { type: 'approved' };
    options.onDecision?.({ toolName, toolCallId, status });
    return status;
  };

  return approval;
}
