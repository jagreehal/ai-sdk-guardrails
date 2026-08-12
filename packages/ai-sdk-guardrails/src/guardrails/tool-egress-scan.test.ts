import { describe, expect, it } from 'vitest';
import {
  extractToolCallPayloads,
  scanTextEgressViolations,
  scanToolCallEgress,
} from './tool-egress-scan';
import type { AIResult } from '../types';

describe('tool-egress-scan', () => {
  it('extracts tool payloads from content array', () => {
    const payloads = extractToolCallPayloads({
      content: [
        {
          type: 'tool-call',
          toolName: 'fetch',
          input: JSON.stringify({ url: 'https://huggingface.co/x' }),
        },
      ],
    } as unknown as AIResult);
    expect(payloads[0]?.argsText).toContain('huggingface');
  });

  it('scanToolCallEgress denies registry writes when configured', () => {
    const v = scanToolCallEgress(
      [{ toolName: 'artifactoryUpload', argsText: '{"path":"note.txt"}' }],
      {
        registryTools: ['artifactoryUpload'],
        denyRegistryWrites: true,
        sharedStoreId: 'eval-1',
      },
    );
    expect(v[0]).toContain('registry writes denied');
  });

  it('scanTextEgressViolations blocks metadata SSRF', () => {
    const v = scanTextEgressViolations(
      'http://169.254.169.254/latest/meta-data/',
      { blockedHosts: [/169\.254\.169\.254/] },
      'test',
    );
    expect(v.some((x) => x.includes('169.254'))).toBe(true);
  });
});
