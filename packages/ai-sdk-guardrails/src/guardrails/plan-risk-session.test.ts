import { describe, expect, it } from 'vitest';
import { createPlanRiskSession } from './plan-risk-session';
import { builtinPlanRiskClassifier } from './plan-risk';

describe('createPlanRiskSession', () => {
  it('accumulates tool names across steps', () => {
    const session = createPlanRiskSession();
    session.record(['artifactoryList']);
    session.record(['artifactoryUpload']);
    expect(session.toolSequence).toEqual([
      'artifactoryList',
      'artifactoryUpload',
    ]);
  });

  it('classifies SSRF chain only when session spans steps', async () => {
    const session = createPlanRiskSession();
    const classify = builtinPlanRiskClassifier();

    expect(
      await classify({ toolSequence: ['artifactoryList'] }),
    ).toMatchObject({ verdict: 'low' });

    session.record(['artifactoryList']);
    session.record(['artifactoryUpload']);
    const full = session.record(['artifactoryFetch']);

    expect(await classify({ toolSequence: full })).toMatchObject({
      verdict: 'high',
      categories: ['package_manager_ssrf'],
    });
  });
});
