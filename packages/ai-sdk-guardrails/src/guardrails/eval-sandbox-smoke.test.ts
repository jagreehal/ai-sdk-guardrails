import { describe, expect, it } from 'vitest';
import { createPlanRiskSession } from './plan-risk-session';
import { planRiskGuardrail } from './plan-risk';
import { evaluationScopeGuardrail } from './evaluation-scope';
import type { GenerateTextResult, OutputGuardrailContext } from '../types';

function stepContext(
  toolName: string,
  input: Record<string, string>,
): OutputGuardrailContext {
  const content: GenerateTextResult['content'] = [
    {
      type: 'tool-call',
      toolCallId: '1',
      toolName,
      input: JSON.stringify(input),
      dynamic: true,
    },
  ];

  return {
    // SAFETY: plan-risk and evaluation-scope read only the tool calls in
    // `content`, so a content-only result stands in for a full one.
    result: { content } as GenerateTextResult,
    input: { prompt: '', messages: [], system: '' },
  };
}

describe('eval sandbox smoke', () => {
  it('blocks SSRF chain across steps with session-aware plan risk', async () => {
    const session = createPlanRiskSession();

    const guardrail = planRiskGuardrail({
      session,
      blockAtOrAbove: 'high',
    });

    await guardrail.execute(stepContext('artifactoryList', { path: '/' }));
    await guardrail.execute(
      stepContext('artifactoryUpload', { path: 'note.txt', content: 'hi' }),
    );

    const blocked = await guardrail.execute(
      stepContext('artifactoryFetch', {
        url: 'https://huggingface.co/datasets/x',
      }),
    );

    expect(blocked.tripwireTriggered).toBe(true);
    expect(blocked.metadata?.categories).toContain('package_manager_ssrf');
  });

  it('blocks coordination upload via evaluation scope', async () => {
    const guardrail = evaluationScopeGuardrail({
      sharedStoreId: 'artifactory-prod',
      denySuspiciousFilenames: true,
    });

    const result = await guardrail.execute(
      stepContext('artifactoryUpload', {
        path: 'zz_agent_seek_note.txt',
        content: 'agent seek upload if found',
      }),
    );

    expect(result.tripwireTriggered).toBe(true);
  });

  it('denies all registry writes in read-only eval mode', async () => {
    const guardrail = evaluationScopeGuardrail({ denyRegistryWrites: true });

    const result = await guardrail.execute(
      stepContext('artifactoryUpload', { path: 'any.txt', content: 'x' }),
    );

    expect(result.tripwireTriggered).toBe(true);
    expect(result.message).toContain('registry writes denied');
  });
});
