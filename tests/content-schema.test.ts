import { describe, expect, it } from 'vitest';
import { evidenceLabel, missingSourceIds } from '../src/lib/content';

describe('content contracts', () => {
  it('uses explicit Russian evidence labels', () => {
    expect(evidenceLabel('traditional')).toBe('Традиционное представление');
    expect(evidenceLabel('none')).toBe('Доказательств нет');
  });

  it('reports unresolved citations', () => {
    expect(
      missingSourceIds(['museum-a', 'paper-b'], new Set(['museum-a'])),
    ).toEqual(['paper-b']);
  });
});
