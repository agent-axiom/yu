import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CollectionEntry } from 'astro:content';
import { describe, expect, it } from 'vitest';
import { localizeCollection, type LocalizedCollection } from '../src/i18n/content';

function records<C extends LocalizedCollection>(collection: C): CollectionEntry<C>[] {
  const directory = join(process.cwd(), 'src/content', collection);
  return readdirSync(directory).filter((file) => file.endsWith('.json')).map((file) => ({
    id: file.replace(/\.json$/, ''),
    collection,
    data: JSON.parse(readFileSync(join(directory, file), 'utf8')),
  })) as CollectionEntry<C>[];
}

describe('public collection translations', () => {
  for (const collection of ['eras', 'myths', 'materials', 'medicine'] as const) {
    it(`provides English for every ${collection} entry without changing IDs, citations or Russian originals`, () => {
      const original = records(collection);
      const before = structuredClone(original);
      const english = localizeCollection(collection, original, 'en');

      expect(english.map((entry) => entry.id)).toEqual(original.map((entry) => entry.id));
      english.forEach((entry, index) => {
        expect(JSON.stringify(entry.data)).not.toMatch(/[А-Яа-яЁё]/u);
        expect(entry.data.citations).toEqual(original[index].data.citations);
      });
      expect(original).toEqual(before);
      expect(localizeCollection(collection, original, 'ru')).toBe(original);
    });
  }

  it('preserves non-translated material formulas and chronology ordering', () => {
    const materials = records('materials');
    expect(localizeCollection('materials', materials, 'en').map((entry) => entry.data.chemistry))
      .toEqual(materials.map((entry) => entry.data.chemistry));
    const eras = records('eras');
    expect(localizeCollection('eras', eras, 'en').map((entry) => entry.data.order))
      .toEqual(eras.map((entry) => entry.data.order));
  });

  it('retains specific medical limitations and safety warnings in English', () => {
    const medicine = localizeCollection('medicine', records('medicine'), 'en');
    const cosmetic = medicine.find((entry) => entry.id === '04-cosmetic-effect')!.data;
    expect(cosmetic.assessment).toContain('34 women');
    expect(cosmetic.assessment).toContain('without a group receiving no treatment');
    expect(cosmetic.safety).toContain('persistent swelling, a rash or pain');
    const pain = medicine.find((entry) => entry.id === '03-gua-sha-pain')!.data;
    expect(pain.safety).toContain('anticoagulants');
    expect(pain.evidence).toBe('clinical');
  });

  it('fails explicitly when new source content has no English translation', () => {
    const entry = { ...records('myths')[0], id: 'new-untranslated-story' };
    expect(() => localizeCollection('myths', [entry], 'en')).toThrow(/Missing English translation: myths\/new-untranslated-story/);
  });
});
