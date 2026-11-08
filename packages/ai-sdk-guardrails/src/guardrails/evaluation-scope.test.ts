import { describe, expect, it } from 'vitest';
import { evaluationScopeGuardrail } from './evaluation-scope';
import type { GenerateTextResult, OutputGuardrailContext } from '../types';

function ctx(
  toolName: string,
  args: Record<string, string>,
): OutputGuardrailContext {
  const content: GenerateTextResult['content'] = [
    {
      type: 'tool-call',
      toolCallId: '1',
      toolName,
      input: JSON.stringify(args),
      dynamic: true,
    },
  ];

  return {
    // SAFETY: evaluationScopeGuardrail reads only the tool calls in `content`,
    // so a content-only result stands in for a full one.
    result: { content } as GenerateTextResult,
    input: { prompt: '', messages: [], system: '' },
  };
}

describe('evaluationScopeGuardrail', () => {
  it('passes benign internal registry reads', async () => {
    const guardrail = evaluationScopeGuardrail({
      allowedHosts: [/internal-artifactory\.local/i],
    });

    const result = await guardrail.execute(
      ctx('artifactoryList', { path: '/packages' }),
    );

    expect(result.tripwireTriggered).toBe(false);
  });

  it('blocks external eval-cheat hosts in tool args', async () => {
    const guardrail = evaluationScopeGuardrail();

    const result = await guardrail.execute(
      ctx('artifactoryFetch', {
        url: 'https://huggingface.co/datasets/private-eval/resolve/main/answers.json',
      }),
    );

    expect(result.tripwireTriggered).toBe(true);
    expect(result.message).toContain('huggingface.co');
  });

  it('blocks cross-agent coordination filenames on registry upload', async () => {
    const guardrail = evaluationScopeGuardrail();

    const result = await guardrail.execute(
      ctx('artifactoryUpload', {
        path: 'zz_agent_seek_softtrace_upload_if_found.txt',
        content: 'agent seek softtrace upload if found',
      }),
    );

    expect(result.tripwireTriggered).toBe(true);
    expect(result.message).toMatch(/agent\s*seek|message board/i);
  });

  it('blocks metadata SSRF targets', async () => {
    const guardrail = evaluationScopeGuardrail();

    const result = await guardrail.execute(
      ctx('artifactoryFetch', {
        url: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
      }),
    );

    expect(result.tripwireTriggered).toBe(true);
  });

  it('denies all registry writes when denyRegistryWrites is set', async () => {
    const guardrail = evaluationScopeGuardrail({ denyRegistryWrites: true });

    const result = await guardrail.execute(
      ctx('artifactoryUpload', { path: 'note.txt', content: 'hello' }),
    );

    expect(result.tripwireTriggered).toBe(true);
    expect(result.message).toContain('registry writes denied');
  });
});
