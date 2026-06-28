import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GuardrailExecutionSummary, GuardrailResult } from '../types';
import {
  __setAutotelAgentModule,
  approvalStatusToPolicyDecision,
  guardrailGovernance,
  guardrailGovernanceApproval,
  guardrailTelemetry,
  guardrailNameOf,
  severityToRiskScore,
  toPolicyDecisionMetadata,
  ToolScopeDeniedError,
  withGuardedTool,
} from './index';

function result(overrides: Partial<GuardrailResult> = {}): GuardrailResult {
  return {
    tripwireTriggered: true,
    message: 'blocked',
    severity: 'high',
    info: { guardrailName: 'prompt-injection' },
    ...overrides,
  };
}

function summary(blocked: GuardrailResult[]): GuardrailExecutionSummary {
  return {
    allResults: blocked,
    blockedResults: blocked,
    totalExecutionTime: 1,
    guardrailsExecuted: blocked.length,
    stats: {
      passed: 0,
      blocked: blocked.length,
      failed: 0,
      averageExecutionTime: 1,
    },
  };
}

function fakeAgent() {
  return {
    recordPolicyDecision: vi.fn(),
    recordInputProvenance: vi.fn(),
    recordControllerId: vi.fn(),
    recordHumanApproval: vi.fn(),
    recordActionRiskClass: vi.fn(),
    recordPlanRiskAssessment: vi.fn(),
  };
}

afterEach(() => {
  __setAutotelAgentModule(null);
  vi.restoreAllMocks();
});

describe('pure mappers', () => {
  it('prefers confidence over severity for risk score', () => {
    expect(severityToRiskScore(result({ confidence: 0.9 }))).toBe(0.9);
    expect(
      severityToRiskScore(
        result({ severity: 'critical', confidence: undefined }),
      ),
    ).toBe(1);
    expect(
      severityToRiskScore(result({ severity: 'low', confidence: undefined })),
    ).toBe(0.25);
    expect(
      severityToRiskScore(
        result({ severity: undefined, confidence: undefined }),
      ),
    ).toBeUndefined();
  });

  it('resolves the guardrail name from context, then info, then a fallback', () => {
    expect(
      guardrailNameOf(result({ context: { guardrailName: 'ctx-name' } })),
    ).toBe('ctx-name');
    expect(guardrailNameOf(result())).toBe('prompt-injection');
    expect(guardrailNameOf(result({ info: {}, context: {} }))).toBe(
      'guardrail',
    );
  });

  it('maps a blocked result to a deny policy decision', () => {
    const meta = toPolicyDecisionMetadata(result(), {
      agent: { id: 'agent-1', model: 'gpt-4o' },
    });
    expect(meta).toMatchObject({
      action: 'prompt-injection',
      agent: { id: 'agent-1' },
      eventKind: 'policy_decision',
      category: 'high',
      policy: { decision: 'deny', riskScore: 0.75, reason: 'blocked' },
    });
  });

  it('maps approval statuses to policy decisions', () => {
    expect(approvalStatusToPolicyDecision('approved')).toBe('permit');
    expect(approvalStatusToPolicyDecision('denied')).toBe('deny');
    expect(approvalStatusToPolicyDecision('user-approval')).toBe('challenge');
    expect(approvalStatusToPolicyDecision('not-applicable')).toBeUndefined();
  });
});

describe('guardrailGovernance hooks', () => {
  it('no-ops without throwing when the optional peer is absent', () => {
    __setAutotelAgentModule(null);
    const gov = guardrailGovernance({ agent: { id: 'a' } });
    expect(() => gov.onInputBlocked(summary([result()]))).not.toThrow();
    expect(() => gov.onOutputBlocked(summary([result()]))).not.toThrow();
  });

  it('emits a policy decision per blocked result, plus controller + provenance on input', async () => {
    const agent = fakeAgent();
    __setAutotelAgentModule(agent);
    const gov = guardrailGovernance({
      agent: { id: 'a' },
      controllerId: 'user-9',
      hashSalt: 'salt',
    });

    gov.onInputBlocked(
      summary([result(), result({ info: { guardrailName: 'pii' } })]),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(agent.recordPolicyDecision).toHaveBeenCalledTimes(2);
    expect(agent.recordControllerId).toHaveBeenCalledWith({
      controllerId: 'user-9',
      hashSalt: 'salt',
    });
    expect(agent.recordInputProvenance).toHaveBeenCalledWith({
      provenance: 'external_untrusted',
    });
  });

  it('does not record controller/provenance for output blocks', async () => {
    const agent = fakeAgent();
    __setAutotelAgentModule(agent);
    const gov = guardrailGovernance({ agent: { id: 'a' }, controllerId: 'u' });

    gov.onOutputBlocked(summary([result()]));
    await Promise.resolve();
    await Promise.resolve();

    expect(agent.recordPolicyDecision).toHaveBeenCalledTimes(1);
    expect(agent.recordControllerId).not.toHaveBeenCalled();
    expect(agent.recordInputProvenance).not.toHaveBeenCalled();
  });

  it('swallows errors thrown by the peer so guardrails never crash', async () => {
    const agent = fakeAgent();
    agent.recordPolicyDecision.mockImplementation(() => {
      throw new Error('no active span');
    });
    __setAutotelAgentModule(agent);
    const gov = guardrailGovernance({ agent: { id: 'a' } });

    expect(() => gov.onOutputBlocked(summary([result()]))).not.toThrow();
    await Promise.resolve();
  });
});

describe('guardrailGovernanceApproval', () => {
  it('records human approval for user-approval and denied, but not approved', async () => {
    const agent = fakeAgent();
    __setAutotelAgentModule(agent);
    const onDecision = guardrailGovernanceApproval({
      agent: { id: 'a' },
      controllerId: 'u',
    });

    onDecision({
      toolName: 'sql',
      status: { type: 'user-approval' },
      guardrail: 'sql-injection',
    });
    onDecision({ toolName: 'sql', status: { type: 'approved' } });
    onDecision({ toolName: 'sql', status: { type: 'not-applicable' } });
    await Promise.resolve();
    await Promise.resolve();

    // permit + challenge recorded; not-applicable skipped
    expect(agent.recordPolicyDecision).toHaveBeenCalledTimes(2);
    expect(agent.recordHumanApproval).toHaveBeenCalledTimes(1);
    expect(agent.recordHumanApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'sql',
        approved: false,
        required: true,
      }),
    );
  });

  it('records the action risk class for every gated tool, including not-applicable', async () => {
    const agent = fakeAgent();
    __setAutotelAgentModule(agent);
    const onDecision = guardrailGovernanceApproval({
      agent: { id: 'a' },
      toolRiskClass: (toolName) =>
        toolName === 'executeSQL' ? 'destructive' : undefined,
    });

    onDecision({ toolName: 'executeSQL', status: { type: 'denied' } });
    onDecision({ toolName: 'executeSQL', status: { type: 'not-applicable' } });
    onDecision({ toolName: 'readDocs', status: { type: 'not-applicable' } });
    await Promise.resolve();
    await Promise.resolve();

    // executeSQL classified on both calls; readDocs returns undefined → skipped.
    expect(agent.recordActionRiskClass).toHaveBeenCalledTimes(2);
    expect(agent.recordActionRiskClass).toHaveBeenCalledWith('destructive');
  });
});

// Fire the native onToolExecutionStart with a minimal event, cast to the SDK's
// parameter type (the full event has many fields the bridge never reads).
function fireToolStart(
  integration: ReturnType<typeof guardrailTelemetry>,
  toolName: string,
): void {
  const start = integration.onToolExecutionStart;
  if (!start) return;
  start({
    toolCall: { toolName, toolCallId: 'tc', input: {} },
  } as unknown as Parameters<typeof start>[0]);
}

describe('guardrailTelemetry (native Telemetry integration)', () => {
  it('records risk class + an observe decision per executed tool', async () => {
    const agent = fakeAgent();
    __setAutotelAgentModule(agent);
    const integration = guardrailTelemetry({
      agent: { id: 'support-agent' },
      toolRiskClass: (toolName) =>
        toolName === 'executeSQL' ? 'destructive' : undefined,
    });

    // The native event shape: onToolExecutionStart receives { toolCall }.
    fireToolStart(integration, 'executeSQL');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(agent.recordActionRiskClass).toHaveBeenCalledWith('destructive');
    expect(agent.recordPolicyDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tool.executeSQL',
        resource: 'executeSQL',
        policy: { decision: 'observe' },
      }),
      expect.anything(),
    );
  });

  it('skips risk class for unclassified tools but still observes them', async () => {
    const agent = fakeAgent();
    __setAutotelAgentModule(agent);
    const integration = guardrailTelemetry({ agent: { id: 'a' } });

    fireToolStart(integration, 'readDocs');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(agent.recordActionRiskClass).not.toHaveBeenCalled();
    expect(agent.recordPolicyDecision).toHaveBeenCalledTimes(1);
  });

  it('no-ops when the optional peer is absent', async () => {
    __setAutotelAgentModule(null);
    const integration = guardrailTelemetry({ agent: { id: 'a' } });
    // Should not throw.
    fireToolStart(integration, 'x');
    await Promise.resolve();
    await Promise.resolve();
  });
});

describe('guardrailGovernance output-block risk class', () => {
  it('records risk class for observed tools when a tool guardrail blocks', async () => {
    const agent = fakeAgent();
    __setAutotelAgentModule(agent);
    const gov = guardrailGovernance({
      agent: { id: 'a' },
      toolRiskClass: (toolName) =>
        toolName === 'deleteFile' ? 'destructive' : undefined,
    });

    gov.onOutputBlocked(
      summary([
        result({
          info: { guardrailName: 'tool-egress-policy' },
          metadata: { observedTools: ['deleteFile', 'readDocs'] },
        }),
      ]),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(agent.recordActionRiskClass).toHaveBeenCalledTimes(1);
    expect(agent.recordActionRiskClass).toHaveBeenCalledWith('destructive');
  });
});

describe('withGuardedTool (SAIF Principle 2 — least privilege)', () => {
  function tool(
    execute = vi.fn<(input?: unknown) => Promise<string>>(async () => 'result'),
  ) {
    return { description: 'd', execute };
  }

  it('denies a call missing a required scope and never runs the tool', async () => {
    const agent = fakeAgent();
    __setAutotelAgentModule(agent);
    const execute = vi.fn<(input?: unknown) => Promise<string>>(
      async () => 'result',
    );
    const guarded = withGuardedTool(tool(execute), {
      agent: { id: 'payments' },
      toolName: 'transferFunds',
      requiredScopes: ['payments:write'],
      grantedScopes: ['payments:read'],
      riskClass: 'financial',
      controllerId: 'user-1',
    });

    await expect(guarded.execute({ amount: 5 })).rejects.toBeInstanceOf(
      ToolScopeDeniedError,
    );
    expect(execute).not.toHaveBeenCalled();
    expect(agent.recordActionRiskClass).toHaveBeenCalledWith('financial');
    expect(agent.recordPolicyDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tool.transferFunds',
        resource: 'transferFunds',
        policy: expect.objectContaining({ decision: 'deny' }),
      }),
      expect.anything(),
    );
    expect(agent.recordControllerId).toHaveBeenCalledWith(
      expect.objectContaining({ controllerId: 'user-1' }),
    );
  });

  it('permits a call with all required scopes and runs the tool', async () => {
    const agent = fakeAgent();
    __setAutotelAgentModule(agent);
    const execute = vi.fn(
      async (input: { amount: number }) => input.amount * 2,
    );
    const guarded = withGuardedTool(
      { description: 'd', execute },
      {
        agent: { id: 'payments' },
        toolName: 'transferFunds',
        requiredScopes: ['payments:write'],
        grantedScopes: ['payments:write', 'payments:read'],
      },
    );

    await expect(guarded.execute({ amount: 5 })).resolves.toBe(10);
    expect(execute).toHaveBeenCalledWith({ amount: 5 });
    expect(agent.recordPolicyDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: expect.objectContaining({ decision: 'permit' }),
      }),
      expect.anything(),
    );
  });

  it('enforces least privilege even without the autotel peer', async () => {
    __setAutotelAgentModule(null);
    const execute = vi.fn<(input?: unknown) => Promise<string>>(
      async () => 'result',
    );
    const guarded = withGuardedTool(tool(execute), {
      agent: { id: 'a' },
      toolName: 't',
      requiredScopes: ['x'],
      grantedScopes: [],
    });

    await expect(guarded.execute({})).rejects.toBeInstanceOf(
      ToolScopeDeniedError,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns the tool unchanged when it has no execute', () => {
    const clientTool = { description: 'no execute', execute: undefined };
    expect(
      withGuardedTool(clientTool, { agent: { id: 'a' }, toolName: 't' }),
    ).toBe(clientTool);
  });
});
