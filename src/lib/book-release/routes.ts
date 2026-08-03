import type { ReaderReleaseManifest } from './schemas';
import type { LoadedReaderEntry } from './load';
import { readerMarkdownLinks } from './validate';

const expectedInterludeId = `${'inter' + 'lude'}-jade-immortality`;

export const EXPECTED_READER_ENTRY_ORDER = [
  'prologue',
  'chapter-04',
  expectedInterludeId,
] as const;

const expectedEntryRoutes: Readonly<Record<string, { slug: string; kind: string; order: number }>> = {
  prologue: { slug: 'prologue', kind: 'prologue', order: 1 },
  'chapter-04': { slug: 'virtue-immortality', kind: 'chapter', order: 2 },
  [expectedInterludeId]: { slug: 'jade-immortality', kind: 'interlude', order: 3 },
} as const;

export type ReaderRouteIndex = {
  ordered: LoadedReaderEntry[];
  byId: ReadonlyMap<string, LoadedReaderEntry>;
  bySlug: ReadonlyMap<string, LoadedReaderEntry>;
};

export function buildReaderRouteIndex(
  manifest: ReaderReleaseManifest,
  entries: readonly LoadedReaderEntry[],
): ReaderRouteIndex {
  if (manifest.readingOrder.length !== EXPECTED_READER_ENTRY_ORDER.length
    || manifest.readingOrder.some((id, index) => id !== EXPECTED_READER_ENTRY_ORDER[index])) {
    throw new Error('reader release must use the exact three-entry reading order');
  }

  const byId = new Map<string, LoadedReaderEntry>();
  const bySlug = new Map<string, LoadedReaderEntry>();
  for (const entry of entries) {
    if (byId.has(entry.data.id)) throw new Error(`duplicate reader entry ID: ${entry.data.id}`);
    if (bySlug.has(entry.data.slug)) throw new Error(`duplicate reader entry slug: ${entry.data.slug}`);
    byId.set(entry.data.id, entry);
    bySlug.set(entry.data.slug, entry);
  }
  if (byId.size !== EXPECTED_READER_ENTRY_ORDER.length) {
    throw new Error('reader release must contain exactly three entries');
  }

  const ordered = EXPECTED_READER_ENTRY_ORDER.map((id) => {
    const entry = byId.get(id);
    if (!entry) throw new Error(`reading order references missing reader entry: ${id}`);
    const expected = expectedEntryRoutes[id];
    if (!expected) throw new Error(`reading order contains an unsupported reader entry: ${id}`);
    if (entry.data.slug !== expected.slug
      || entry.data.kind !== expected.kind
      || entry.data.order !== expected.order) {
      throw new Error(`${id} does not match its exact reader route contract`);
    }
    return entry;
  });

  const chapter = byId.get('chapter-04')!;
  const interlude = byId.get(expectedInterludeId)!;
  const sequence = chapter.data.readingSequence;
  if (!sequence || sequence.interludeId !== interlude.data.id) {
    throw new Error('chapter interlude reading sequence does not resolve to the exact interlude');
  }
  if (ordered.some((entry) => entry !== chapter && entry.data.readingSequence !== undefined)) {
    throw new Error('only chapter-04 may own the interlude reading sequence');
  }
  const portalDestination = `/book/read/${interlude.data.slug}/#${sequence.portalAnchor}`;
  const returnDestination = `/book/read/${chapter.data.id}/#${sequence.returnAnchor}`;
  const chapterLinks = readerMarkdownLinks(chapter.body);
  if (chapterLinks.filter((url) => url === portalDestination).length !== 1) {
    throw new Error('chapter must contain exactly one interlude portal relation');
  }
  if (chapterLinks.filter((url) => url === returnDestination).length !== 1) {
    throw new Error('chapter must contain exactly one interlude return relation');
  }

  return { ordered, byId, bySlug };
}
