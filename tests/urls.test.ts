import { describe, expect, it } from 'vitest';
import { withBase } from '../src/lib/urls';

describe('withBase', () => {
  it('prefixes project routes exactly once', () => {
    expect(withBase('/history/', '/yu/')).toBe('/yu/history/');
    expect(withBase('/yu/history/', '/yu/')).toBe('/yu/history/');
  });
});
