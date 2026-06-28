import { describe, it, expect, vi } from 'vitest';
import { guardrailApproval } from './tool-approval';
import type { GuardrailApprovalOptions } from './tool-approval';
import {
  sqlInjectionGuardrail,
  toolRBACGuardrail,
  type ToolParameterGuardrail,
} from './tool-parameters';
import { ToolLoopAgent, generateText, tool, stepCountIs } from 'ai';
import type {
  LanguageModel,
  ToolApprovalStatus,
  ToolApprovalConfiguration,
} from 'ai';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Compile-time DX assertion (the real regression guard): `guardrailApproval()`
// must drop straight into the `toolApproval` slot with the tool set inferred,
// for BOTH `generateText` and `ToolLoopAgent` (the recommended agent API). The
// SDK types `toolApproval` with `NoInfer<TOOLS>`, so this only holds when the
// adapter returns a broad, contravariantly-assignable function — not a
// `ToolSet`-defaulted union. No annotations or casts at the call site.
// ---------------------------------------------------------------------------
const _dxModel = null as unknown as LanguageModel;
const _dxTools = {
  executeSQL: tool({
    description: 'run sql',
    inputSchema: z.object({ query: z.string() }),
    execute: async () => '',
  }),
};
const _dxApproval = guardrailApproval([
  sqlInjectionGuardrail({ toolName: 'executeSQL' }),
]);
async function _dxGenerateText() {
  await generateText({
    model: _dxModel,
    tools: _dxTools,
    toolApproval: _dxApproval,
    prompt: 'x',
    stopWhen: stepCountIs(2),
  });
}
const _dxAgent = new ToolLoopAgent({
  model: _dxModel,
  instructions: 'x',
  tools: _dxTools,
  toolApproval: _dxApproval,
  stopWhen: stepCountIs(2),
});
void _dxGenerateText;
void _dxAgent;

// ---------------------------------------------------------------------------
// Compile-time interop assertion: the adapter's return value is a native
// `ToolApprovalConfiguration` — the exact type `@ai-sdk/policy-opa`'s
// `shadow(approval, { enforce })` and `wrapMcpTools(tools, approval)` consume
// and return. Proving assignability here guarantees the composition typechecks
// WITHOUT taking a dependency on policy-opa: a guardrail gate can be shadow-
// rolled-out or made total over an MCP tool set using the SDK-native helpers.
// ---------------------------------------------------------------------------
const _interopApproval: ToolApprovalConfiguration<typeof _dxTools, unknown> =
  _dxApproval;
void _interopApproval;

// The public return type is the SDK's `ToolApprovalConfiguration` union
// (function | per-tool object). Every case here uses the generic-function form,
// so narrow to a callable for invocation in tests.
type ApprovalFn = (args: {
  toolCall: { toolName: string; toolCallId: string; input: unknown };
}) => Promise<ToolApprovalStatus>;

function build(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  guardrails: ToolParameterGuardrail<any, any>[],
  options?: GuardrailApprovalOptions,
) {
  const fn = guardrailApproval(guardrails, options) as unknown as ApprovalFn;
  return (toolName: string, input: unknown, toolCallId = 'tc-1') =>
    fn({ toolCall: { toolName, toolCallId, input } });
}

// A simple medium-severity gate used across several cases.
const reviewLargeTransfer: ToolParameterGuardrail<{ amount?: number }> = {
  name: 'large-transfer-review',
  toolName: 'transfer',
  validateInput: ({ amount }) =>
    (amount ?? 0) > 1000
      ? {
          valid: false,
          block: true,
          severity: 'medium',
          message: 'large transfer',
        }
      : { valid: true },
};

describe('guardrailApproval', () => {
  it('approves when the governing guardrail passes', async () => {
    const approve = build([sqlInjectionGuardrail({ toolName: 'executeSQL' })]);
    const status = await approve('executeSQL', { query: 'SELECT 1' });
    expect(status).toEqual({ type: 'approved' });
  });

  it('denies a high/critical violation with the message as reason', async () => {
    const approve = build([sqlInjectionGuardrail({ toolName: 'executeSQL' })]);
    const status = await approve('executeSQL', {
      query: "'; DROP TABLE users; --",
    });
    expect(status).toEqual({
      type: 'denied',
      reason: 'Potential SQL injection detected',
    });
  });

  it('escalates a sub-threshold (medium) violation to user-approval', async () => {
    const approve = build([reviewLargeTransfer]);
    const status = await approve('transfer', { amount: 5000 });
    expect(status).toEqual({ type: 'user-approval' });
  });

  it('returns not-applicable when no guardrail governs the tool', async () => {
    const approve = build([sqlInjectionGuardrail({ toolName: 'executeSQL' })]);
    const status = await approve('getWeather', { city: 'London' });
    expect(status).toEqual({ type: 'not-applicable' });
  });

  it('honours denyAtOrAbove to harden a medium violation into a deny', async () => {
    const approve = build([reviewLargeTransfer], { denyAtOrAbove: 'medium' });
    const status = await approve('transfer', { amount: 5000 });
    expect(status).toMatchObject({ type: 'denied', reason: 'large transfer' });
  });

  describe('onBlock override', () => {
    it("'user-approval' escalates even a critical violation", async () => {
      const approve = build(
        [sqlInjectionGuardrail({ toolName: 'executeSQL' })],
        {
          onBlock: 'user-approval',
        },
      );
      const status = await approve('executeSQL', {
        query: '1=1; DROP TABLE t',
      });
      expect(status).toEqual({ type: 'user-approval' });
    });

    it("'deny' denies even a low-severity violation", async () => {
      const lowGate: ToolParameterGuardrail = {
        name: 'low',
        toolName: 'note',
        validateInput: () => ({
          valid: false,
          severity: 'low',
          message: 'nope',
        }),
      };
      const approve = build([lowGate], { onBlock: 'deny' });
      const status = await approve('note', {});
      expect(status).toMatchObject({ type: 'denied', reason: 'nope' });
    });
  });

  it('escalates non-blocking failures (block:false) to user-approval regardless of severity', async () => {
    const softCritical: ToolParameterGuardrail = {
      name: 'soft',
      toolName: 'deploy',
      validateInput: () => ({
        valid: false,
        block: false,
        severity: 'critical',
      }),
    };
    const approve = build([softCritical]);
    expect(await approve('deploy', {})).toEqual({ type: 'user-approval' });
  });

  it('first failing guardrail wins (evaluation order)', async () => {
    const denyFirst: ToolParameterGuardrail = {
      name: 'deny-first',
      toolName: 'x',
      validateInput: () => ({
        valid: false,
        severity: 'critical',
        message: 'first',
      }),
    };
    const second = vi.fn(() => ({ valid: false, severity: 'low' as const }));
    const approve = build([
      denyFirst,
      { name: 'second', toolName: 'x', validateInput: second },
    ]);
    const status = await approve('x', {});
    expect(status).toMatchObject({ type: 'denied', reason: 'first' });
    expect(second).not.toHaveBeenCalled();
  });

  it('supports async guardrails', async () => {
    const asyncGate: ToolParameterGuardrail = {
      name: 'async',
      toolName: 'q',
      validateInput: async () => {
        await Promise.resolve();
        return { valid: false, severity: 'high', message: 'blocked' };
      },
    };
    expect(await build([asyncGate])('q', {})).toMatchObject({ type: 'denied' });
  });

  it('passes requestContext through to guardrails (RBAC)', async () => {
    const rbac = toolRBACGuardrail({
      toolName: 'deleteRecord',
      requiredPermissions: ['admin'],
    });

    const asAdmin = build([rbac], {
      requestContext: { permissions: ['admin'] },
    });
    expect(await asAdmin('deleteRecord', { id: 1 })).toEqual({
      type: 'approved',
    });

    const asUser = build([rbac], { requestContext: { permissions: ['read'] } });
    expect(await asUser('deleteRecord', { id: 1 })).toMatchObject({
      type: 'denied',
    });
  });

  it('invokes onDecision with the tool name, status and guardrail', async () => {
    const onDecision = vi.fn();
    const approve = build([sqlInjectionGuardrail({ toolName: 'executeSQL' })], {
      onDecision,
    });
    await approve('executeSQL', { query: 'DROP TABLE x' });
    expect(onDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'executeSQL',
        guardrail: 'sql-injection-prevention',
        status: expect.objectContaining({ type: 'denied' }),
      }),
    );
  });

  it('returns not-applicable for an empty guardrail list', async () => {
    expect(await build([])('anything', {})).toEqual({ type: 'not-applicable' });
  });
});
