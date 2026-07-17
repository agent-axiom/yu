import { describe, expect, it } from 'vitest';
import { eraPanelId, nextEra } from '../src/lib/timeline';

describe('history timeline state', () => {
  it('moves within clamped boundaries', () => {
    expect(nextEra(2, 1, 5)).toBe(3);
    expect(nextEra(2, -1, 5)).toBe(1);
    expect(nextEra(0, -1, 5)).toBe(0);
    expect(nextEra(4, 1, 5)).toBe(4);
  });

  it('builds stable panel identifiers', () => {
    expect(eraPanelId('liangzhu')).toBe('era-panel-liangzhu');
  });
});
