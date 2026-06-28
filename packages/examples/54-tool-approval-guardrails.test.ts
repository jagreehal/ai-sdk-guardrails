/**
 * Example 54 — Tool Approval Guardrails — Test
 *
 * Unlike most example tests (which hit live models and are for manual
 * verification), this one uses a mock model and runs deterministically in CI.
 */

import { describe, it, expect } from 'vitest';
import { runWithApproval } from './54-tool-approval-guardrails';

describe('guardrailApproval via generateText toolApproval', () => {
  it('denies a SQL-injection tool call — the tool never executes', async () => {
    const r = await runWithApproval({
      query: "'; DROP TABLE users; --",
      permissions: ['db:write'],
    });

    expect(r.executed).toBe(false);
    expect(r.decisions[0]).toMatchObject({
      toolName: 'executeSQL',
      guardrail: 'sql-injection-prevention',
      status: { type: 'denied' },
    });
    // The model still produces a final answer after the denial.
    expect(r.finalText.length).toBeGreaterThan(0);
  });

  it('denies a benign call when the caller lacks the required permission', async () => {
    const r = await runWithApproval({
      query: 'SELECT 1',
      permissions: ['db:read'],
    });

    expect(r.executed).toBe(false);
    expect(r.decisions[0]).toMatchObject({
      toolName: 'executeSQL',
      guardrail: 'tool-rbac',
      status: { type: 'denied' },
    });
  });

  it('approves and executes a benign call when permitted', async () => {
    const r = await runWithApproval({
      query: 'SELECT 1',
      permissions: ['db:write'],
    });

    expect(r.executed).toBe(true);
    expect(r.decisions[0]).toMatchObject({
      toolName: 'executeSQL',
      status: { type: 'approved' },
    });
  });
});
