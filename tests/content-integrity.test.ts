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

interface SourceRecord {
  title: string;
  authors: string[];
  publicationYear: number | null;
  accessed: string;
  region: 'asia' | 'west' | 'global';
  url: string;
  locator?: string;
  year?: unknown;
}

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

describe('editorial content integrity', () => {
  const sources = readCollection<SourceRecord>('sources');
  const sourceById = new Map(sources.map((source) => [source.id, source]));
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

  it('separates nullable publication years from ISO access dates', () => {
    for (const source of sources) {
      expect(Object.hasOwn(source, 'year'), `${source.id} still uses ambiguous year`).toBe(false);
      expect(
        source.publicationYear === null || Number.isInteger(source.publicationYear),
        `${source.id} has an invalid publicationYear`,
      ).toBe(true);
      expect(isIsoCalendarDate(source.accessed), `${source.id} has a non-ISO access date`).toBe(true);
    }

    expect(sources.some(({ publicationYear }) => publicationYear === null)).toBe(true);
  });

  it('keeps verified museum and journal metadata exact', () => {
    expect(sourceById.get('murray-virtue-2026')).toMatchObject({
      title: '“Only Jade Can Epitomize Human Virtue”: Ideas on Education and Moral Development in Han-Period China',
      publicationYear: 2016,
      locator: 'Asia Major 29.2, pp. 73–114',
      url: 'https://www1.ihp.sinica.edu.tw/en/Publications/AsiaMajor/1030/Article/814',
    });
    expect(sourceById.get('met-maya-2026')).toMatchObject({
      title: 'Ornament',
      authors: ['Lucia R. Henderson'],
      publicationYear: 2015,
      locator: 'Object 1978.412.57',
      url: 'https://www.metmuseum.org/art/collection/search/310513',
    });
    expect(sourceById.get('met-bi-2026')).toMatchObject({
      title: 'Annular disk (bi)',
      publicationYear: null,
      locator: 'Object 17.118.43',
      url: 'https://www.metmuseum.org/art/collection/search/49371',
    });
  });

  it('does not mistake a 2026 access or copyright year for publication', () => {
    expect(Object.fromEntries(
      [
        'gia-care-2026',
        'gia-jade-2026',
        'met-bi-2026',
        'met-maya-2026',
        'murray-virtue-2026',
        'npm-cabbage-2026',
        'smithsonian-jades-2026',
        'tepapa-pounamu-2026',
      ].map((id) => [id, sourceById.get(id)?.publicationYear]),
    )).toEqual({
      'gia-care-2026': null,
      'gia-jade-2026': null,
      'met-bi-2026': null,
      'met-maya-2026': 2015,
      'murray-virtue-2026': 2016,
      'npm-cabbage-2026': null,
      'smithsonian-jades-2026': null,
      'tepapa-pounamu-2026': null,
    });
  });

  it('keeps chronology ordered and medical warnings substantial', () => {
    const orders = eras.map(({ order }) => order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(medicine.every(({ safety }) => safety.length >= 40)).toBe(true);
  });
});
