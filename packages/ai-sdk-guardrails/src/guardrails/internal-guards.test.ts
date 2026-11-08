import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { isCallable, isObjectLike } from './internal';

describe('cross-realm guards', () => {
  const foreignFn: () => string = runInNewContext('(() => "ok")');
  const foreignObj: object = runInNewContext('({ doGenerate() {} })');

  it('recognises functions and objects from another realm', () => {
    expect(foreignFn instanceof Function).toBe(false);
    expect(isCallable(foreignFn)).toBe(true);
    expect(isCallable(async () => 1)).toBe(true);
    expect(isObjectLike(foreignObj)).toBe(true);
  });

  it('rejects non-functions and primitives', () => {
    expect(isCallable('fn')).toBe(false);
    expect(isCallable(undefined)).toBe(false);
    expect(isObjectLike(null)).toBe(false);
    expect(isObjectLike('x')).toBe(false);
  });
});
