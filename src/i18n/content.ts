import type { CollectionEntry } from 'astro:content';
import type { Locale } from '../lib/i18n';
import englishContent from './content.en.json';

export type LocalizedCollection = 'eras' | 'myths' | 'materials' | 'medicine';

const fields: Record<LocalizedCollection, readonly string[]> = {
  eras: ['title', 'date', 'summary', 'detail', 'place', 'imageAlt'],
  myths: ['title', 'culture', 'legend', 'context', 'confirmed'],
  materials: ['name', 'family', 'hardness', 'structure', 'toughness', 'note'],
  medicine: ['title', 'tradition', 'assessment', 'safety'],
};

/** Translate only editorial text; preserve entry IDs, citations and factual keys. */

export function localizeCollection<C extends LocalizedCollection>(
  collection: C,
  entries: CollectionEntry<C>[],
  locale: Locale,
): CollectionEntry<C>[] {
  if (locale === 'ru') return entries;
  const translations: Record<string, Record<string, string>> = englishContent[collection];
  return entries.map((entry) => {
    const translation = translations[entry.id];
    if (!translation) throw new Error(`Missing English translation: ${collection}/${entry.id}`);
    const data = { ...entry.data } as Record<string, unknown>;
    for (const field of fields[collection]) {
      if (!(field in data)) continue;
      if (!translation[field]?.trim()) throw new Error(`Missing English translation: ${collection}/${entry.id}.${field}`);
      data[field] = translation[field];
    }
    return { ...entry, data } as CollectionEntry<C>;
  });
}
