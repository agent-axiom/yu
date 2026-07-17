import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { missingSourceIds } from '../src/lib/content';

const contentRoot = join(process.cwd(), 'src/content');

function readCollection<T>(name: string): Array<T & { id: string }> {
  return readdirSync(join(contentRoot, name))
    .filter((file) => file.endsWith('.json'))
    .map((file) => ({
      id: file.replace(/\.json$/, ''),
      ...(JSON.parse(readFileSync(join(contentRoot, name, file), 'utf8')) as T),
    }));
}

describe('editorial content integrity', () => {
  const sources = readCollection<{ region: 'asia' | 'west' | 'global' }>(
    'sources',
  );
  const eras = readCollection<{ order: number; citations: string[] }>('eras');
  const myths = readCollection<{ citations: string[] }>('myths');
  const materials = readCollection<{ citations: string[] }>('materials');
  const medicine = readCollection<{ safety: string; citations: string[] }>(
    'medicine',
  );

  it('balances Asian and Western research perspectives', () => {
    expect(sources.filter((source) => source.region === 'asia').length).toBeGreaterThanOrEqual(4);
    expect(sources.filter((source) => source.region === 'west').length).toBeGreaterThanOrEqual(4);
  });

  it('contains the planned depth of content', () => {
    expect(eras).toHaveLength(8);
    expect(myths).toHaveLength(4);
    expect(materials).toHaveLength(2);
    expect(medicine).toHaveLength(4);
  });

  it('uses unique source ids and resolves every citation', () => {
    const sourceIds = sources.map(({ id }) => id);
    const allCitations = [...eras, ...myths, ...materials, ...medicine].flatMap(
      ({ citations }) => citations,
    );

    expect(new Set(sourceIds).size).toBe(sourceIds.length);
    expect(missingSourceIds(allCitations, new Set(sourceIds))).toEqual([]);
  });

  it('keeps chronology ordered and medical warnings substantial', () => {
    const orders = eras.map(({ order }) => order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(medicine.every(({ safety }) => safety.length >= 40)).toBe(true);
  });
});
