/**
 * Policy packs: ready-made bundles of existing guardrails for common threat
 * models. Each returns `{ inputGuardrails, outputGuardrails }`, so spread it
 * into `withGuardrails` or `agentGuardrails` and append your own rails:
 *
 * ```ts
 * const pii = piiPack();
 * withGuardrails({
 *   model,
 *   ...pii,
 *   outputGuardrails: [...pii.outputGuardrails, myRail],
 * });
 * ```
 */
import type { InputGuardrail, OutputGuardrail } from '../types';
import { piiDetector, promptInjectionDetector } from './input';
import type { PromptInjectionOptions } from './input';
import { sensitiveDataFilter } from './output';
import {
  mcpResponseSanitizer,
  mcpSecurityGuardrail,
  mcpToolResultGuardrail,
  type McpSecurityOptions,
} from './mcp-security';
import { toolEgressPolicy, type ToolEgressPolicyOptions } from './tools';
import {
  evaluationScopeGuardrail,
  type EvaluationScopeGuardrailOptions,
} from './evaluation-scope';
import { planRiskGuardrail } from './plan-risk';
import {
  createPlanRiskSession,
  type PlanRiskSession,
} from './plan-risk-session';
import { budgetGuardrail, type BudgetGuardrailOptions } from './budget';

export interface GuardrailPack {
  inputGuardrails: InputGuardrail[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- packs mix rails with different metadata types
  outputGuardrails: OutputGuardrail<any>[];
}

/** PII in, PII out: detect personal data in prompts, filter it from responses. */
export function piiPack(): GuardrailPack {
  return {
    inputGuardrails: [piiDetector()],
    outputGuardrails: [sensitiveDataFilter()],
  };
}

export interface McpHardenedPackOptions {
  injection?: PromptInjectionOptions;
  mcp?: McpSecurityOptions;
  egress?: ToolEgressPolicyOptions;
}

/**
 * Agent wired to MCP servers: injection scan on every step, MCP scanning of
 * incoming tool results and of the model's output, response sanitising, and
 * tool egress policy.
 * Also gate tool definitions with `guardMcpTools` and calls with
 * `guardrailApproval`; those live outside model middleware.
 */
export function mcpHardenedPack(
  options: McpHardenedPackOptions = {},
): GuardrailPack {
  return {
    inputGuardrails: [
      promptInjectionDetector(options.injection),
      mcpToolResultGuardrail(options.mcp),
    ],
    outputGuardrails: [
      mcpSecurityGuardrail(options.mcp),
      mcpResponseSanitizer(),
      toolEgressPolicy(options.egress),
    ],
  };
}

export interface EvalSandboxPackOptions {
  scope?: EvaluationScopeGuardrailOptions;
  /** Shared across the agent run. Defaults to a fresh session per pack. */
  session?: PlanRiskSession;
  /** Add a cost/token ceiling. */
  budget?: BudgetGuardrailOptions;
}

/**
 * Model under evaluation: keep it inside the sandbox (evaluation scope),
 * watch its multi-step tool plan (plan-risk), optionally cap spend (budget).
 */
export function evalSandboxPack(
  options: EvalSandboxPackOptions = {},
): GuardrailPack {
  return {
    inputGuardrails: [],
    outputGuardrails: [
      evaluationScopeGuardrail(options.scope),
      planRiskGuardrail({
        session: options.session ?? createPlanRiskSession(),
      }),
      ...(options.budget ? [budgetGuardrail(options.budget)] : []),
    ],
  };
}
