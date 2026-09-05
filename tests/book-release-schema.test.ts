import {
  link,
  mkdtemp,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  truncate,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DataStore, Loader, LoaderContext } from 'astro/loaders';
import { describe, expect, it } from 'vitest';
import {
  computeReadingMinutes,
  isReaderWatcherRelativePathInsideRoot,
  readerContentBindingSchema,
  readerEntrySchema,
  readerMediaSchema,
  readerNoteSchema,
  readerObjectSchema,
  readerReleaseFileDescriptorSchema,
  readerReleaseManifestSchema,
  readerReviewAttestationSchema,
  readerReviewedPayloadSchema,
  readerSourceSchema,
  validateReaderReleaseCollections,
} from '../src/lib/book-release/schemas';
import {
  targetCommit,
  validAuthoredDiagramMedia,
  validBinaryFileDescriptor,
  validCollectionSnapshot,
  validDocumentaryMedia,
  validEntry,
  validEntryFileDescriptor,
  validGenerativeMedia,
  validManifest,
  validNote,
  validObject,
  validPublishedInventoryObject,
  validSource,
} from './helpers/book-release-fixture';

type LoaderFactories = {
  countReaderVisibleWords(markdown: string): number;
  withImmutableReaderCollection(
    baseLoader: Loader,
    jsonScope?: 'manifest' | 'notes' | 'sources' | 'objects' | 'media',
  ): Loader;
  withReaderEntryValidation(baseLoader: Loader): Loader;
  withReaderManifestValidation(baseLoader: Loader): Loader;
  validateReaderReleaseCollectionSummary(input: unknown): unknown;
  validateReaderEntryLoad(input: unknown): unknown;
};

type StoredEntry = {
  id: string;
  data: Record<string, unknown>;
  body?: string;
  filePath?: string;
};

function createMemoryStore(seed: StoredEntry[] = []): DataStore {
  const entries = new Map(seed.map((entry) => [entry.id, entry]));
  const store = {
    get: (key: string) => entries.get(key),
    entries: () => [...entries.entries()],
    values: () => [...entries.values()],
    keys: () => [...entries.keys()],
    set: (entry: StoredEntry) => {
      entries.set(entry.id, entry);
      return true;
    },
    delete: (key: string) => { entries.delete(key); },
    clear: () => { entries.clear(); },
    has: (key: string) => entries.has(key),
    addModuleImport: () => undefined,
  };
  return store as unknown as DataStore;
}

function createLoaderContext(
  root: URL,
  store = createMemoryStore(),
  watcher?: LoaderContext['watcher'],
  logs: string[] = [],
): LoaderContext {
  const meta = new Map<string, string>();
  const context = {
    collection: 'book-test',
    store,
    meta: {
      get: (key: string) => meta.get(key),
      set: (key: string, value: string) => { meta.set(key, value); },
      has: (key: string) => meta.has(key),
      delete: (key: string) => { meta.delete(key); },
    },
    logger: {
      info: () => undefined,
      warn: (message: string) => { logs.push(message); },
      error: () => undefined,
      debug: () => undefined,
      fork: () => undefined,
      label: 'book-test',
      options: {},
    },
    config: { root },
    parseData: async ({ data }: { data: Record<string, unknown> }) => data,
    renderMarkdown: async () => ({ html: '' }),
    generateDigest: () => 'digest',
    watcher,
  };
  return context as unknown as LoaderContext;
}

type SyntheticWatcherEvent = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

function createMultiListenerWatcher() {
  const listeners = new Map<string, Set<(changedPath: string) => void>>();
  const watchedPaths: string[] = [];
  const watcher = {
    add(paths: string | readonly string[]) {
      watchedPaths.push(...(typeof paths === 'string' ? [paths] : paths));
      return watcher;
    },
    on(event: string, callback: (changedPath: string) => void) {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(callback);
      listeners.set(event, eventListeners);
      return watcher;
    },
    off(event: string, callback: (changedPath: string) => void) {
      listeners.get(event)?.delete(callback);
      return watcher;
    },
    listeners(event: string) {
      return [...(listeners.get(event) ?? [])];
    },
    removeAllTrackedListeners() {
      listeners.clear();
    },
  };
  return {
    watcher: watcher as unknown as LoaderContext['watcher'],
    emit(event: SyntheticWatcherEvent, changedPath: string) {
      for (const callback of listeners.get(event) ?? []) callback(changedPath);
    },
    listenerCount(event: SyntheticWatcherEvent) {
      return listeners.get(event)?.size ?? 0;
    },
    removeAllTrackedListeners() {
      watcher.removeAllTrackedListeners();
    },
    watchedPaths,
  };
}

function createSixReaderLoaders(
  factories: LoaderFactories,
  beforeWrite: (index: number) => void | Promise<void> = () => undefined,
): Loader[] {
  const body = Array.from({ length: 221 }, () => 'слово').join(' ');
  const writes: Array<(store: DataStore) => void> = [
    (store) => { store.set({ id: 'manifest', data: validManifest }); },
    (store) => {
      store.set({
        id: validEntry.id,
        data: validEntry,
        body,
        filePath: 'src/content/book-release/entries/chapter-04.md',
      });
    },
    (store) => { store.set({ id: validNote.id, data: validNote }); },
    (store) => { store.set({ id: validSource.id, data: validSource }); },
    (store) => { store.set({ id: validObject.id, data: validObject }); },
    (store) => { store.set({ id: validDocumentaryMedia.id, data: validDocumentaryMedia }); },
  ];
  const baseLoaders = writes.map((write, index): Loader => ({
    name: `six-reader-loader-${index}`,
    async load({ store }) {
      await beforeWrite(index);
      write(store);
    },
  }));
  return [
    factories.withReaderManifestValidation(baseLoaders[0]),
    factories.withReaderEntryValidation(baseLoaders[1]),
    ...baseLoaders.slice(2).map((loader) => factories.withImmutableReaderCollection(loader)),
  ];
}

async function createReleaseTree(options: { manifest?: boolean; omit?: 'notes'; payload?: boolean } = {}) {
  const rootPath = await mkdtemp(join(tmpdir(), 'yu-reader-loader-'));
  const releasePath = join(rootPath, 'src/content/book-release');
  const files = [
    ['entries', 'chapter-04.md'],
    ['notes', 'note-001.json'],
    ['sources', 'source-henan-museum.json'],
    ['objects', 'object-han-jade-suit.json'],
    ['media', 'media-han-jade-suit.json'],
    ['media', 'media-nephrite-fibre.json'],
    ['media', 'media-site-context.json'],
  ] as const;
  await mkdir(releasePath, { recursive: true });
  if (options.payload !== false) {
    for (const [directory, name] of files) {
      if (directory === options.omit) continue;
      await mkdir(join(releasePath, directory), { recursive: true });
      await writeFile(join(releasePath, directory, name), directory === 'entries' ? '# Глава\n\nТекст.' : '{}');
    }
  }
  if (options.manifest !== false) {
    await writeFile(join(releasePath, 'manifest.json'), JSON.stringify(validManifest));
  }
  return { rootPath, root: pathToFileURL(`${rootPath}/`) };
}

async function loadFactories(): Promise<LoaderFactories> {
  return await import('../src/lib/book-release/schemas') as unknown as LoaderFactories;
}

function withoutKey<T extends object>(value: T, key: string) {
  const copy = { ...value };
  delete (copy as Record<string, unknown>)[key];
  return copy;
}

describe('strict reader records', () => {
  it('accepts the golden entry, note, source and both inventory branches', () => {
    expect(readerEntrySchema.parse(validEntry)).toEqual(validEntry);
    expect(readerNoteSchema.parse(validNote)).toEqual(validNote);
    expect(readerSourceSchema.parse(validSource)).toEqual(validSource);
    expect(readerObjectSchema.parse(validObject)).toEqual(validObject);
    expect(readerObjectSchema.parse(validPublishedInventoryObject)).toEqual(validPublishedInventoryObject);
  });

  it.each([
    ['entry', readerEntrySchema, validEntry, Object.keys(validEntry).filter((key) => key !== 'readingSequence')],
    ['note', readerNoteSchema, validNote, Object.keys(validNote)],
    ['source', readerSourceSchema, validSource, Object.keys(validSource)],
    ['object', readerObjectSchema, validObject, Object.keys(validObject)],
  ])('requires every golden %s field', (_name, schema, record, requiredKeys) => {
    for (const key of requiredKeys) {
      expect(() => schema.parse(withoutKey(record, key))).toThrow();
    }
  });

  it('rejects a manifest swapped to malicious JSON and restored during Astro parsing', async () => {
    const factories = await loadFactories();
    const tree = await createReleaseTree();
    try {
      const target = join(tree.rootPath, 'src/content/book-release/manifest.json');
      const original = join(tree.rootPath, 'manifest-original.json');
      const malicious = join(tree.rootPath, 'manifest-malicious.json');
      await writeFile(malicious, String.raw`{"projection":"private-v1","\u0070rojection":"reader-v1"}`);
      const baseLoader: Loader = {
        name: 'transient-manifest-swap-loader',
        load: async ({ store }) => {
          await rename(target, original);
          await rename(malicious, target);
          store.set({ id: 'manifest', data: validManifest });
          await unlink(target);
          await rename(original, target);
        },
      };
      await expect(factories.withReaderManifestValidation(baseLoader)
        .load(createLoaderContext(tree.root)))
        .rejects.toThrow(/changed|directory|metadata|snapshot|topology|parse/iu);
    } finally {
      await rm(tree.rootPath, { recursive: true, force: true });
    }
  });

  it('rejects a missing JSON scope created, parsed, and removed during Astro parsing', async () => {
    const factories = await loadFactories();
    const tree = await createReleaseTree();
    const notesDirectory = join(tree.rootPath, 'src/content/book-release/notes');
    await rm(notesDirectory, { recursive: true, force: true });
    try {
      const baseLoader: Loader = {
        name: 'transient-missing-scope-loader',
        load: async ({ store }) => {
          await mkdir(notesDirectory);
          await writeFile(
            join(notesDirectory, 'note-001.json'),
            String.raw`{"id":"claim-private","\u0069d":"note-001"}`,
          );
          store.set({ id: validNote.id, data: validNote });
          await rm(notesDirectory, { recursive: true, force: true });
        },
      };
      await expect(factories.withImmutableReaderCollection(baseLoader, 'notes')
        .load(createLoaderContext(tree.root)))
        .rejects.toThrow(/changed|directory|metadata|snapshot|topology|parse/iu);
    } finally {
      await rm(tree.rootPath, { recursive: true, force: true });
    }
  });

  it.each([
    ['entry', readerEntrySchema, { ...validEntry, claimIds: ['claim-private'] }],
    ['note', readerNoteSchema, { ...validNote, claimId: 'claim-private' }],
    ['source', readerSourceSchema, { ...validSource, evidenceSegments: [] }],
    ['object', readerObjectSchema, { ...validObject, provenance: 'private provenance' }],
  ])('rejects an unknown %s field', (_name, schema, mutation) => {
    expect(() => schema.parse(mutation)).toThrow();
  });

  it.each([
    ['an unsafe entry ID', readerEntrySchema, { ...validEntry, id: '../chapter-04' }],
    ['a kind/ID mismatch', readerEntrySchema, { ...validEntry, kind: 'interlude' }],
    ['an unsupported confidence', readerNoteSchema, { ...validNote, confidence: 'low' }],
    ['duplicate source IDs', readerNoteSchema, { ...validNote, sourceIds: ['source-henan-museum', 'source-henan-museum'] }],
    ['a source without DOI or URL', readerSourceSchema, { ...validSource, url: undefined }],
    ['an HTTP URL', readerSourceSchema, { ...validSource, url: 'http://example.com/source' }],
    ['a credentialed URL', readerSourceSchema, { ...validSource, url: 'https://user:pass@example.com/source' }],
  ])('rejects %s', (_name, schema, mutation) => {
    expect(() => schema.parse(mutation)).toThrow();
  });

  it.each([
    'https://github.com/agent-axiom/yu-book/blob/main/research/source.json',
    'https://www.github.com/agent-axiom/yu-book/blob/main/research/source.json',
    'https://github.com./agent-axiom/yu-book.git/blob/main/research/source.json',
    'https://raw.githubusercontent.com/agent-axiom/yu-book/main/research/source.json',
    'https://api.github.com/repos/agent-axiom/yu-book/contents/research/source.json',
    'https://api.github.com/repos/agent-axiom%252Fyu-book/contents/research/source.json',
    'https://codeload.github.com/agent-axiom/yu-book/zip/refs/heads/main',
    'https://github.com/login?return_to=%252Fagent-axiom%252Fyu-book',
    'https://github.com/login?return_to=https%253A%252F%252Fgithub.com%252Fagent-axiom%252Fyu-book%252egit',
    'https://github.dev/agent-axiom/yu-book',
    'https://vscode.dev/github/agent-axiom/yu-book',
    'https://host.example/open?repo=agent-axiom%2Fyu-book',
    'https://host.example/open?redirect=https%253A%252F%252Fgithub.dev%252Fagent-axiom%252Fyu-book%252egit',
    'https://host.example/open?q=100%25&repo=agent-axiom%252Fyu-book',
    'https://host.example/%25/agent-axiom%252Fyu-book',
  ])('rejects the private repository URL form %s', (url) => {
    expect(() => readerSourceSchema.parse({ ...validSource, url })).toThrow();
  });

  it.each([
    'https://github.com/agent-axiom/yu/blob/main/CREDITS.md',
    'https://raw.githubusercontent.com/agent-axiom/yu/main/public/credits.json',
    'https://api.github.com/repos/agent-axiom/yu',
    'https://codeload.github.com/agent-axiom/yu/zip/refs/heads/main',
    'https://host.example/open?repo=agent-axiom%2Fyu',
    'https://github.dev/agent-axiom/yu-book-notes',
    'https://museum.example/exhibitions/yu-book?curator=agent-axiom',
  ])('preserves the public repository URL %s', (url) => {
    expect(readerSourceSchema.parse({ ...validSource, url }).url).toBe(url);
  });

  it('enforces the exact reading-sequence shape', () => {
    expect(() => readerEntrySchema.parse({
      ...validEntry,
      readingSequence: { ...validEntry.readingSequence, returnAnchor: validEntry.readingSequence.portalAnchor },
    })).toThrow();
    expect(() => readerEntrySchema.parse({
      ...validEntry,
      id: 'interlude-jade-immortality',
      kind: 'interlude',
    })).toThrow();
    expect(() => readerEntrySchema.parse({
      ...validEntry,
      readingSequence: { ...validEntry.readingSequence, privateLine: 42 },
    })).toThrow();
  });

  it('requires every nested reading-sequence field and rejects unknown nested keys', () => {
    for (const key of Object.keys(validEntry.readingSequence)) {
      expect(() => readerEntrySchema.parse({
        ...validEntry,
        readingSequence: withoutKey(validEntry.readingSequence, key),
      })).toThrow();
    }
    expect(() => readerEntrySchema.parse({
      ...validEntry,
      readingSequence: { ...validEntry.readingSequence, privateOffset: 42 },
    })).toThrow();
  });

  it.each([validObject, validPublishedInventoryObject])('requires the exact inventory branch %#', (record) => {
    for (const key of Object.keys(record.inventory)) {
      expect(() => readerObjectSchema.parse({
        ...record,
        inventory: withoutKey(record.inventory, key),
      })).toThrow();
    }
    expect(() => readerObjectSchema.parse({
      ...record,
      inventory: { ...record.inventory, internalNote: 'private' },
    })).toThrow();
  });
});

describe('strict reader media', () => {
  it.each([
    ['documentary', validDocumentaryMedia],
    ['authored diagram', validAuthoredDiagramMedia],
    ['generative', validGenerativeMedia],
  ])('accepts the golden %s discriminator', (_name, media) => {
    expect(readerMediaSchema.parse(media)).toEqual(media);
  });

  it.each([
    ['authored diagram without author', { ...validAuthoredDiagramMedia, author: undefined }],
    ['authored diagram without change note', { ...validAuthoredDiagramMedia, changeNote: undefined }],
    ['authored diagram without CC BY 4.0', { ...validAuthoredDiagramMedia, licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' }],
    ['generative media without disclosure', { ...validGenerativeMedia, nondocumentaryDisclosure: undefined }],
    ['generative media with a documentary claim', { ...validGenerativeMedia, nondocumentaryDisclosure: 'Исторически точная реконструкция древнего ритуала.' }],
    ['documentary media with authored metadata', { ...validDocumentaryMedia, author: 'Unknown author' }],
    ['media with a path-like output name', { ...validDocumentaryMedia, outputName: '../jade.webp' }],
    ['media with a private URL', { ...validDocumentaryMedia, sourceUrl: 'https://raw.githubusercontent.com/agent-axiom/yu-book/main/assets/jade.webp' }],
    ['media with an unknown field', { ...validDocumentaryMedia, rightsEvidence: [] }],
  ])('rejects malformed %s', (_name, media) => {
    expect(() => readerMediaSchema.parse(media)).toThrow();
  });

  it.each(['jade.avif', 'jade.jpeg', 'jade.jpg', 'jade.png', 'jade.SVG', 'jade.WEBP'])(
    'rejects the unsupported or non-canonical media output extension %s',
    (outputName) => {
      expect(() => readerMediaSchema.parse({ ...validDocumentaryMedia, outputName })).toThrow();
    },
  );

  it.each([
    ...Object.keys(validDocumentaryMedia).filter((key) => key !== 'sourceUrl').map((key) => ['documentary', validDocumentaryMedia, key] as const),
    ...Object.keys(validAuthoredDiagramMedia).filter((key) => key !== 'sourceUrl').map((key) => ['authored diagram', validAuthoredDiagramMedia, key] as const),
    ...Object.keys(validGenerativeMedia).filter((key) => key !== 'sourceUrl').map((key) => ['generative', validGenerativeMedia, key] as const),
  ])('requires the golden %s field %s', (_name, media, key) => {
    expect(() => readerMediaSchema.parse(withoutKey(media, key))).toThrow();
  });
});

describe('manifest v4 and attestation v3', () => {
  it('accepts the exact golden manifest', () => {
    expect(readerReleaseManifestSchema.parse(validManifest)).toEqual(validManifest);
  });

  it.each([-1, 0, 1, 2, 3, 5, 4.1, '4', null])('rejects non-v4 manifest version %s', (version) => {
    expect(() => readerReleaseManifestSchema.parse({ ...validManifest, version })).toThrow();
  });

  it.each([-1, 0, 1, 2, 4, 5, 3.1, '3', null])('rejects non-v3 attestation version %s', (schemaVersion) => {
    expect(() => readerReviewAttestationSchema.parse({
      ...validManifest.reviewAttestation,
      schemaVersion,
    })).toThrow();
  });

  it.each([
    ['manifest v3', { version: 3 }],
    ['wrong projection', { projection: 'full-records-v1' }],
    ['wrong transformer', { transformer: 'reader-markdown-v2' }],
    ['unknown manifest key', { generatedAt: '2026-08-03' }],
    ['wrong attestation version', { reviewAttestation: { ...validManifest.reviewAttestation, schemaVersion: 2 } }],
    ['wrong gate', { reviewAttestation: { ...validManifest.reviewAttestation, publicationGate: 'agent-changes-required' } }],
    ['unknown attestation key', { reviewAttestation: { ...validManifest.reviewAttestation, reviewer: 'human' } }],
    ['changed disclosure', { reviewAttestation: { ...validManifest.reviewAttestation, disclosure: 'Проверено.' } }],
  ])('rejects %s', (_name, override) => {
    expect(() => readerReleaseManifestSchema.parse({ ...validManifest, ...override })).toThrow();
  });

  it('accepts a valid binary public image descriptor', () => {
    expect(readerReleaseFileDescriptorSchema.parse(validBinaryFileDescriptor)).toEqual(validBinaryFileDescriptor);
  });

  it.each(['jade.avif', 'jade.jpeg', 'jade.jpg', 'jade.png', 'jade.SVG', 'jade.WEBP'])(
    'rejects the unsupported or non-canonical image descriptor extension %s',
    (outputName) => {
      expect(() => readerReleaseFileDescriptorSchema.parse({
        ...validBinaryFileDescriptor,
        path: `public/images/book-release/${outputName}`,
      })).toThrow();
    },
  );

  it('requires the exact strict file descriptor and validates kind, length and SHA', () => {
    for (const descriptor of [validBinaryFileDescriptor, validEntryFileDescriptor]) {
      for (const key of Object.keys(descriptor)) {
        expect(() => readerReleaseFileDescriptorSchema.parse(withoutKey(descriptor, key))).toThrow();
      }
      expect(() => readerReleaseFileDescriptorSchema.parse({ ...descriptor, privatePath: 'rights/file' })).toThrow();
    }
    expect(() => readerReleaseFileDescriptorSchema.parse({ ...validBinaryFileDescriptor, kind: 'text' })).toThrow();
    expect(() => readerReleaseFileDescriptorSchema.parse({ ...validEntryFileDescriptor, kind: 'binary' })).toThrow();
    expect(() => readerReleaseFileDescriptorSchema.parse({ ...validEntryFileDescriptor, byteLength: -1 })).toThrow();
    expect(() => readerReleaseFileDescriptorSchema.parse({ ...validEntryFileDescriptor, byteLength: 1.5 })).toThrow();
    expect(() => readerReleaseFileDescriptorSchema.parse({
      ...validEntryFileDescriptor,
      byteLength: (64 * 1024 * 1024) + 1,
    })).toThrow(/size|bound|less|equal|number/iu);
    expect(() => readerReleaseFileDescriptorSchema.parse({ ...validEntryFileDescriptor, sha256: 'ABC' })).toThrow();
  });

  it('rejects a manifest whose bounded descriptors exceed the aggregate byte budget', () => {
    const files = validManifest.files.map((file) => ({ ...file, byteLength: 64 * 1024 * 1024 }));
    expect(() => readerReleaseManifestSchema.parse({ ...validManifest, files }))
      .toThrow(/aggregate|total|size|bound|bytes/iu);
  });

  it('rejects a manifest exceeding the bounded descriptor count', () => {
    const notes = Array.from({ length: 10_000 }, (_, index) => ({
      path: `src/content/book-release/notes/note-limit-${String(index).padStart(5, '0')}.json`,
      kind: 'text' as const,
      byteLength: 1,
      sha256: 'a'.repeat(64),
    }));
    const files = [validEntryFileDescriptor, ...notes];
    expect(() => readerReleaseManifestSchema.parse({
      ...validManifest,
      counts: { entries: 1, notes: notes.length, sources: 0, objects: 0, media: 0 },
      files,
    })).toThrow(/descriptor count|file count|too many|maximum entries|array/iu);
  });

  it.each([
    ['counts', validManifest.counts, (value: object) => ({ ...validManifest, counts: value }), Object.keys(validManifest.counts)],
    ['reviewed payload', validManifest.reviewAttestation.reviewedPayload, (value: object) => ({
      ...validManifest.reviewAttestation,
      reviewedPayload: value,
    }), Object.keys(validManifest.reviewAttestation.reviewedPayload)],
    ['content binding', validManifest.reviewAttestation.contentBinding, (value: object) => ({
      ...validManifest.reviewAttestation,
      contentBinding: value,
    }), Object.keys(validManifest.reviewAttestation.contentBinding)],
  ])('requires every nested %s field', (name, nested, wrap, keys) => {
    for (const key of keys) {
      const mutation = wrap(withoutKey(nested, key));
      if (name === 'counts') {
        expect(() => readerReleaseManifestSchema.parse(mutation)).toThrow();
      } else {
        expect(() => readerReviewAttestationSchema.parse(mutation)).toThrow();
      }
    }
  });

  it('rejects unknown fields in every nested manifest record', () => {
    expect(() => readerReleaseManifestSchema.parse({
      ...validManifest,
      counts: { ...validManifest.counts, drafts: 1 },
    })).toThrow();
    expect(() => readerReleaseFileDescriptorSchema.parse({
      ...validEntryFileDescriptor,
      mtime: 123,
    })).toThrow();
    expect(() => readerReviewedPayloadSchema.parse({
      ...validManifest.reviewAttestation.reviewedPayload,
      reviewer: 'private',
    })).toThrow();
    expect(() => readerContentBindingSchema.parse({
      ...validManifest.reviewAttestation.contentBinding,
      canonicalizer: 'private',
    })).toThrow();
  });

  it('requires every top-level review-attestation field', () => {
    for (const key of Object.keys(validManifest.reviewAttestation)) {
      expect(() => readerReviewAttestationSchema.parse(
        withoutKey(validManifest.reviewAttestation, key),
      )).toThrow();
    }
  });

  it('rejects wrong reviewed-payload and content-binding identities', () => {
    expect(() => readerReviewedPayloadSchema.parse({
      ...validManifest.reviewAttestation.reviewedPayload,
      format: 'yu-reader-payload-v2',
    })).toThrow();
    expect(() => readerContentBindingSchema.parse({
      ...validManifest.reviewAttestation.contentBinding,
      algorithm: 'sha512',
    })).toThrow();
    expect(() => readerContentBindingSchema.parse({
      ...validManifest.reviewAttestation.contentBinding,
      format: 'yu-reader-release-v2',
    })).toThrow();
  });

  it.each([
    ['cycle', { reviewAttestation: { ...validManifest.reviewAttestation, cycleId: 'cycle-03' } }],
    ['target', { reviewAttestation: { ...validManifest.reviewAttestation, targetCommit: '1'.repeat(40) } }],
    ['evidence', { reviewAttestation: { ...validManifest.reviewAttestation, reviewEvidenceCommit: '2'.repeat(40) } }],
    ['projection', { reviewAttestation: { ...validManifest.reviewAttestation, reviewedPayload: { ...validManifest.reviewAttestation.reviewedPayload, projection: 'reader-v2' } } }],
    ['transformer', { reviewAttestation: { ...validManifest.reviewAttestation, reviewedPayload: { ...validManifest.reviewAttestation.reviewedPayload, transformer: 'reader-markdown-v2' } } }],
    ['payload digest', { reviewAttestation: { ...validManifest.reviewAttestation, reviewedPayload: { ...validManifest.reviewAttestation.reviewedPayload, digest: '3'.repeat(64) } } }],
    ['release ID target', { releaseId: `living-jade-reader-v1-${'4'.repeat(40)}` }],
  ])('rejects mismatched %s identity', (_name, override) => {
    expect(() => readerReleaseManifestSchema.parse({ ...validManifest, ...override })).toThrow();
  });

  it.each(['cycle-2', 'cycle-00', 'cycle-002', 'cycle-100', 'review-02', 'cycle-aa'])('rejects malformed cycle ID %s', (cycleId) => {
    expect(() => readerReleaseManifestSchema.parse({
      ...validManifest,
      cycleId,
      reviewAttestation: { ...validManifest.reviewAttestation, cycleId },
    })).toThrow();
  });

  it('rejects equal target/evidence commits in the standalone attestation', () => {
    expect(() => readerReviewAttestationSchema.parse({
      ...validManifest.reviewAttestation,
      reviewEvidenceCommit: targetCommit,
    })).toThrow();
  });

  it.each([
    ['nested entry file', 'src/content/book-release/entries/nested/chapter-04.md'],
    ['nested note file', 'src/content/book-release/notes/nested/note-001.json'],
    ['nested image file', 'public/images/book-release/nested/jade.webp'],
    ['path alias', 'src/content/book-release/entries/../chapter-04.md'],
    ['manifest self inclusion', 'src/content/book-release/manifest.json'],
    ['outside root', 'editorial/reader-preview/chapter-04.md'],
  ])('rejects %s', (_name, path) => {
    const files = validManifest.files.map((file, index) => index === 0 ? { ...file, path } : file);
    expect(() => readerReleaseManifestSchema.parse({ ...validManifest, files })).toThrow();
  });

  it('rejects an unsorted or duplicate file list', () => {
    expect(() => readerReleaseManifestSchema.parse({ ...validManifest, files: [...validManifest.files].reverse() })).toThrow();
    expect(() => readerReleaseManifestSchema.parse({ ...validManifest, files: [validManifest.files[0], ...validManifest.files] })).toThrow();
  });

  it('requires readingOrder to be the exact set of entry descriptor IDs', () => {
    expect(() => readerReleaseManifestSchema.parse({ ...validManifest, readingOrder: ['prologue'] })).toThrow();
    const extraEntry = {
      ...validManifest.files[0],
      path: 'src/content/book-release/entries/prologue.md',
    };
    const files = [...validManifest.files, extraEntry].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    expect(() => readerReleaseManifestSchema.parse({
      ...validManifest,
      files,
      counts: { ...validManifest.counts, entries: 2 },
      readingOrder: ['chapter-04', 'interlude-jade-immortality'],
    })).toThrow();
  });

  it('requires every manifest field', () => {
    for (const key of Object.keys(validManifest)) {
      expect(() => readerReleaseManifestSchema.parse(withoutKey(validManifest, key))).toThrow();
    }
  });
});

describe('production reader collection loaders', () => {
  it.each([
    ['POSIX parent', '../outside.json', '/'],
    ['Windows parent', '..\\outside.json', '\\'],
    ['exact POSIX parent', '..', '/'],
    ['exact Windows parent', '..', '\\'],
    ['POSIX absolute', '/outside.json', '/'],
    ['Windows drive absolute', 'C:\\outside.json', '\\'],
  ] as const)('rejects a host-independent %s watcher-relative path', (_label, relativePath, separator) => {
    expect(isReaderWatcherRelativePathInsideRoot(relativePath, separator)).toBe(false);
  });

  it.each([
    ['POSIX child', 'notes/note-001.json', '/'],
    ['Windows child', 'notes\\note-001.json', '\\'],
    ['root itself', '', '/'],
  ] as const)('accepts a host-independent safe %s watcher-relative path', (_label, relativePath, separator) => {
    expect(isReaderWatcherRelativePathInsideRoot(relativePath, separator)).toBe(true);
  });

  it('wires aggregate wrappers around the official glob loaders', async () => {
    const config = await readFile(join(process.cwd(), 'src/content.config.ts'), 'utf8');
    expect(config).toContain('withReaderEntryValidation(glob(');
    expect(config).toContain('withReaderManifestValidation(glob(');
    expect(config.match(/withImmutableReaderCollection\(/gu)).toHaveLength(4);
    for (const scope of ['notes', 'sources', 'objects', 'media']) {
      expect(config).toContain(`base: './src/content/book-release/${scope}' }),\n    '${scope}',`);
    }
  });

  it.each([
    [
      'manifest',
      'manifest.json',
      String.raw`{"projection":"private-v1","\u0070rojection":"reader-v1"}`,
      validManifest,
    ],
    [
      'notes',
      'notes/note-001.json',
      String.raw`{"id":"claim-private","\u0069d":"note-001"}`,
      validNote,
    ],
    [
      'sources',
      'sources/source-henan-museum.json',
      String.raw`{"url":"file:///Users/reader/private.md","\u0075rl":"https://museum.example/source"}`,
      validSource,
    ],
    [
      'objects',
      'objects/object-han-jade-suit.json',
      String.raw`{"inventory":{"status":"private","\u0073tatus":"published"}}`,
      validObject,
    ],
    [
      'media',
      'media/media-han-jade-suit.json',
      String.raw`{"sourceUrl":"javascript:alert(1)","\u0073ourceUrl":"https://museum.example/image"}`,
      validDocumentaryMedia,
    ],
  ] as const)('rejects duplicate raw JSON keys before the parsed %s collection reaches Astro', async (
    scope,
    relativePath,
    rawJson,
    safeData,
  ) => {
    const factories = await loadFactories();
    const tree = await createReleaseTree();
    try {
      await writeFile(join(tree.rootPath, 'src/content/book-release', relativePath), rawJson);
      const baseLoader: Loader = {
        name: `parsed-${scope}-loader`,
        load: async ({ store }) => {
          store.set({ id: scope === 'manifest' ? 'manifest' : safeData.id, data: safeData });
        },
      };
      const wrapped = scope === 'manifest'
        ? factories.withReaderManifestValidation(baseLoader)
        : factories.withImmutableReaderCollection(baseLoader, scope);
      await expect(wrapped.load(createLoaderContext(tree.root))).rejects.toThrow(/duplicate|JSON|key/iu);
    } finally {
      await rm(tree.rootPath, { recursive: true, force: true });
    }
  });

  it.each([
    ['trailing comma', String.raw`{"id":"note-001",}`],
    ['trailing token', String.raw`{"id":"note-001"} private`],
    ['malformed object', String.raw`{"id":`],
  ])('rejects %s in raw generated JSON before Astro stores parsed data', async (_label, rawJson) => {
    const factories = await loadFactories();
    const tree = await createReleaseTree();
    try {
      await writeFile(join(tree.rootPath, 'src/content/book-release/notes/note-001.json'), rawJson);
      const baseLoader: Loader = {
        name: 'parsed-note-loader',
        load: async ({ store }) => { store.set({ id: validNote.id, data: validNote }); },
      };
      await expect(factories.withImmutableReaderCollection(baseLoader, 'notes')
        .load(createLoaderContext(tree.root)))
        .rejects.toThrow(/invalid|JSON|syntax|trailing/iu);
    } finally {
      await rm(tree.rootPath, { recursive: true, force: true });
    }
  });

  it.each([
    ['manifest', 'manifest.json'],
    ['notes', 'notes/note-001.json'],
  ] as const)('rejects a duplicate-key raw %s JSON file reached through a symlink', async (
    scope,
    relativePath,
  ) => {
    const factories = await loadFactories();
    const tree = await createReleaseTree();
    try {
      const releaseRoot = join(tree.rootPath, 'src/content/book-release');
      const target = join(releaseRoot, relativePath);
      const symlinkPayload = join(tree.rootPath, `${scope}-duplicate-target.json`);
      await writeFile(symlinkPayload, String.raw`{"id":"claim-private","\u0069d":"safe-public-id"}`);
      await unlink(target);
      await symlink(symlinkPayload, target);
      const baseLoader: Loader = {
        name: `symlink-${scope}-loader`,
        load: async ({ store }) => {
          const data = scope === 'manifest' ? validManifest : validNote;
          store.set({ id: scope === 'manifest' ? 'manifest' : validNote.id, data });
        },
      };
      const wrapped = scope === 'manifest'
        ? factories.withReaderManifestValidation(baseLoader)
        : factories.withImmutableReaderCollection(baseLoader, 'notes');
      await expect(wrapped.load(createLoaderContext(tree.root)))
        .rejects.toThrow(/symbolic|symlink|regular file|link/iu);
    } finally {
      await rm(tree.rootPath, { recursive: true, force: true });
    }
  });

  it('rejects a multiply linked raw JSON collection file', async () => {
    const factories = await loadFactories();
    const tree = await createReleaseTree();
    try {
      const target = join(tree.rootPath, 'src/content/book-release/notes/note-001.json');
      await link(target, join(tree.rootPath, 'note-hardlink-alias.json'));
      const baseLoader: Loader = {
        name: 'hardlink-note-loader',
        load: async ({ store }) => { store.set({ id: validNote.id, data: validNote }); },
      };
      await expect(factories.withImmutableReaderCollection(baseLoader, 'notes')
        .load(createLoaderContext(tree.root)))
        .rejects.toThrow(/hard link|multiple links|nlink|regular file/iu);
    } finally {
      await rm(tree.rootPath, { recursive: true, force: true });
    }
  });

  it('rejects an oversized raw JSON collection file before allocating it', async () => {
    const factories = await loadFactories();
    const tree = await createReleaseTree();
    try {
      const target = join(tree.rootPath, 'src/content/book-release/notes/note-001.json');
      await truncate(target, (8 * 1024 * 1024) + 1);
      const baseLoader: Loader = {
        name: 'oversized-note-loader',
        load: async ({ store }) => { store.set({ id: validNote.id, data: validNote }); },
      };
      await expect(factories.withImmutableReaderCollection(baseLoader, 'notes')
        .load(createLoaderContext(tree.root)))
        .rejects.toThrow(/size|bound|large/iu);
    } finally {
      await rm(tree.rootPath, { recursive: true, force: true });
    }
  });

  it('rejects a raw JSON collection above the aggregate byte budget before reading any member', async () => {
    const factories = await loadFactories();
    const tree = await createReleaseTree();
    const notesDirectory = join(tree.rootPath, 'src/content/book-release/notes');
    for (let index = 0; index < 33; index += 1) {
      const path = join(notesDirectory, `note-aggregate-${String(index).padStart(2, '0')}.json`);
      await writeFile(path, '{}');
      await truncate(path, 8 * 1024 * 1024);
    }
    const probe = await open(join(notesDirectory, 'note-001.json'), 'r');
    type ReadMethod = (...args: never[]) => Promise<{ bytesRead: number; buffer: unknown }>;
    const prototype = Object.getPrototypeOf(probe) as { read: ReadMethod };
    const originalRead = prototype.read;
    await probe.close();
    let memberReadStarted = false;
    prototype.read = async function patchedRead(...args: never[]) {
      memberReadStarted = true;
      return originalRead.apply(this, args);
    };
    try {
      const baseLoader: Loader = {
        name: 'aggregate-note-loader',
        load: async () => undefined,
      };
      await expect(factories.withImmutableReaderCollection(baseLoader, 'notes')
        .load(createLoaderContext(tree.root)))
        .rejects.toThrow(/aggregate|total|budget|bound/iu);
      expect(memberReadStarted).toBe(false);
    } finally {
      prototype.read = originalRead;
      await rm(tree.rootPath, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')(
    'closes each raw JSON member handle before invoking the Astro base loader',
    async () => {
    const factories = await loadFactories();
    const tree = await createReleaseTree();
    const notesDirectory = join(tree.rootPath, 'src/content/book-release/notes');
    for (let index = 0; index < 24; index += 1) {
      await writeFile(join(notesDirectory, `note-fd-${String(index).padStart(2, '0')}.json`), '{}');
    }
    const descriptorRoot = process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd';
    const descriptorCountBefore = (await readdir(descriptorRoot)).length;
    let retainedDescriptorDelta = Number.POSITIVE_INFINITY;
    try {
      const baseLoader: Loader = {
        name: 'bounded-fd-note-loader',
        load: async () => {
          retainedDescriptorDelta = (await readdir(descriptorRoot)).length - descriptorCountBefore;
        },
      };
      await expect(factories.withImmutableReaderCollection(baseLoader, 'notes')
        .load(createLoaderContext(tree.root)))
        .resolves.toBeUndefined();
      expect(retainedDescriptorDelta).toBeLessThan(15);
    } finally {
      await rm(tree.rootPath, { recursive: true, force: true });
    }
    },
  );

  it('rejects raw JSON mutated while its bounded bytes are read', async () => {
    const factories = await loadFactories();
    const tree = await createReleaseTree();
    const target = join(tree.rootPath, 'src/content/book-release/notes/note-001.json');
    await writeFile(target, JSON.stringify(validNote));
    const probe = await open(target, 'r');
    type ReadMethod = (...args: never[]) => Promise<{ bytesRead: number; buffer: unknown }>;
    const prototype = Object.getPrototypeOf(probe) as { read: ReadMethod };
    const originalRead = prototype.read;
    await probe.close();
    let mutated = false;
    prototype.read = async function patchedRead(...args: never[]) {
      const result = await originalRead.apply(this, args);
      if (!mutated && result.bytesRead > 0) {
        mutated = true;
        await writeFile(target, JSON.stringify({ ...validNote, confidence: 'medium' }));
      }
      return result;
    };
    try {
      const baseLoader: Loader = {
        name: 'mutating-note-loader',
        load: async ({ store }) => { store.set({ id: validNote.id, data: validNote }); },
      };
      await expect(factories.withImmutableReaderCollection(baseLoader, 'notes')
        .load(createLoaderContext(tree.root)))
        .rejects.toThrow(/changed|identity|metadata|size|reading/iu);
      expect(mutated).toBe(true);
    } finally {
      prototype.read = originalRead;
      await rm(tree.rootPath, { recursive: true, force: true });
    }
  });

  it.each([
    ['manifest', 'manifest.json'],
    ['notes', 'notes/note-001.json'],
  ] as const)('rejects an atomic raw %s JSON replacement between pre-scan and Astro parsing', async (
    scope,
    relativePath,
  ) => {
    const factories = await loadFactories();
    const tree = await createReleaseTree();
    try {
      const target = join(tree.rootPath, 'src/content/book-release', relativePath);
      const replacement = join(tree.rootPath, `${scope}-gap-replacement.json`);
      await writeFile(replacement, String.raw`{"id":"claim-private","\u0069d":"safe-public-id"}`);
      const baseLoader: Loader = {
        name: `gap-${scope}-loader`,
        load: async ({ store }) => {
          await rename(replacement, target);
          const data = scope === 'manifest' ? validManifest : validNote;
          store.set({ id: scope === 'manifest' ? 'manifest' : validNote.id, data });
        },
      };
      const wrapped = scope === 'manifest'
        ? factories.withReaderManifestValidation(baseLoader)
        : factories.withImmutableReaderCollection(baseLoader, 'notes');
      await expect(wrapped.load(createLoaderContext(tree.root)))
        .rejects.toThrow(/changed|identity|metadata|snapshot|replace|topology/iu);
    } finally {
      await rm(tree.rootPath, { recursive: true, force: true });
    }
  });

  it.each([
    ['non-JSON file', 'README.txt', false],
    ['nested directory', 'nested', true],
  ] as const)('rejects an unexpected %s in a generated JSON collection', async (
    _label,
    name,
    directory,
  ) => {
    const factories = await loadFactories();
    const tree = await createReleaseTree();
    try {
      const path = join(tree.rootPath, 'src/content/book-release/notes', name);
      if (directory) await mkdir(path);
      else await writeFile(path, 'not a generated JSON record');
      const baseLoader: Loader = {
        name: 'unexpected-note-entry-loader',
        load: async ({ store }) => { store.set({ id: validNote.id, data: validNote }); },
      };
      await expect(factories.withImmutableReaderCollection(baseLoader, 'notes')
        .load(createLoaderContext(tree.root)))
        .rejects.toThrow(/unexpected|JSON|entry|regular file/iu);
    } finally {
      await rm(tree.rootPath, { recursive: true, force: true });
    }
  });

  it('rejects readingMinutes that disagree with a real Markdown body', async () => {
    const { withReaderEntryValidation } = await loadFactories();
    const body = `# Глава\n\n${Array.from({ length: 221 }, () => 'слово').join(' ')}`;
    const baseLoader: Loader = {
      name: 'fixture-entry-loader',
      load: async ({ store }) => {
        store.set({
          id: validEntry.id,
          data: { ...validEntry, readingMinutes: 1 },
          body,
          filePath: 'src/content/book-release/entries/chapter-04.md',
        });
      },
    };
    const wrapped = withReaderEntryValidation(baseLoader);
    const store = createMemoryStore([{
      id: validEntry.id,
      data: validEntry,
      body: Array.from({ length: 221 }, () => 'слово').join(' '),
      filePath: 'src/content/book-release/entries/chapter-04.md',
    }]);
    await expect(wrapped.load(createLoaderContext(pathToFileURL(`${tmpdir()}/`), store)))
      .rejects.toThrow(/reading minutes/i);
    expect(store.values()).toEqual([]);
  });

  it('invalidates entry content on any watched release change without registering the base watcher', async () => {
    const { withReaderEntryValidation } = await loadFactories();
    const syntheticWatcher = createMultiListenerWatcher();
    let baseReceivedWatcher = false;
    const logs: string[] = [];
    const body = Array.from({ length: 221 }, () => 'слово').join(' ');
    const baseLoader: Loader = {
      name: 'watching-entry-loader',
      load: async ({ store, watcher: activeWatcher }) => {
        baseReceivedWatcher = activeWatcher !== undefined;
        store.set({
          id: validEntry.id,
          data: validEntry,
          body,
          filePath: 'src/content/book-release/entries/chapter-04.md',
        });
      },
    };
    const store = createMemoryStore();
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-watch-'));
    try {
      await withReaderEntryValidation(baseLoader).load(createLoaderContext(
        pathToFileURL(`${root}/`), store, syntheticWatcher.watcher, logs,
      ));
      expect(baseReceivedWatcher).toBe(false);
      syntheticWatcher.emit('change', join(root, 'src/content/book-release/notes/note-002.json'));
      expect(store.values()).toEqual([]);
      expect(logs.join('\n')).toMatch(/restart required/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('forwards hidden DataStore methods while intercepting only set', async () => {
    const { withReaderEntryValidation } = await loadFactories();
    const store = createMemoryStore() as DataStore & { addAssetImport(asset: string): string };
    const importedAssets: string[] = [];
    Object.defineProperty(store, 'addAssetImport', {
      enumerable: false,
      value(asset: string) {
        importedAssets.push(asset);
        return `asset:${asset}`;
      },
    });
    const baseLoader: Loader = {
      name: 'asset-aware-entry-loader',
      load: async ({ store: activeStore }) => {
        expect((activeStore as typeof store).addAssetImport('jade.webp')).toBe('asset:jade.webp');
        activeStore.set({
          id: validEntry.id,
          data: validEntry,
          body: Array.from({ length: 221 }, () => 'слово').join(' '),
          filePath: 'src/content/book-release/entries/chapter-04.md',
        });
      },
    };
    await withReaderEntryValidation(baseLoader)
      .load(createLoaderContext(pathToFileURL(`${tmpdir()}/`), store));
    expect(importedAssets).toEqual(['jade.webp']);
  });

  it('clears stale JSON data when an immutable collection fails its initial load', async () => {
    const { withImmutableReaderCollection } = await loadFactories();
    const store = createMemoryStore([{ id: 'note-001', data: validNote }]);
    const baseLoader: Loader = {
      name: 'invalid-json-loader',
      load: async () => { throw new Error('invalid JSON payload'); },
    };
    await expect(withImmutableReaderCollection(baseLoader)
      .load(createLoaderContext(pathToFileURL(`${tmpdir()}/`), store)))
      .rejects.toThrow(/invalid JSON payload/i);
    expect(store.values()).toEqual([]);
  });

  it.each(['prologue', 'chapter-05'])('rejects frontmatter id %s that disagrees with the Markdown filename', async (id) => {
    const { withReaderEntryValidation } = await loadFactories();
    const baseLoader: Loader = {
      name: 'mismatched-entry-loader',
      load: async ({ store }) => {
        store.set({
          id: 'chapter-04',
          data: { ...validEntry, id },
          body: Array.from({ length: 221 }, () => 'слово').join(' '),
          filePath: 'src/content/book-release/entries/chapter-04.md',
        });
      },
    };
    await expect(withReaderEntryValidation(baseLoader)
      .load(createLoaderContext(pathToFileURL(`${tmpdir()}/`))))
      .rejects.toThrow(/filename public id/i);
  });

  it('rejects manifest counts that differ from real single-level collection files', async () => {
    const { withReaderManifestValidation } = await loadFactories();
    const tree = await createReleaseTree({ omit: 'notes' });
    try {
      const baseLoader: Loader = {
        name: 'fixture-manifest-loader',
        load: async ({ store }) => {
          store.set({ id: 'manifest', data: validManifest });
        },
      };
      await expect(withReaderManifestValidation(baseLoader).load(createLoaderContext(tree.root)))
        .rejects.toThrow(/collection size/i);
    } finally {
      await rm(tree.rootPath, { recursive: true, force: true });
    }
  });

  it('keeps a baseline without a manifest buildable and clears a stale cached manifest', async () => {
    const { withReaderManifestValidation } = await loadFactories();
    const tree = await createReleaseTree({ manifest: false, payload: false });
    try {
      const store = createMemoryStore([{ id: 'manifest', data: validManifest }]);
      const baseLoader: Loader = { name: 'empty-manifest-loader', load: async () => undefined };
      await expect(withReaderManifestValidation(baseLoader).load(createLoaderContext(tree.root, store)))
        .resolves.toBeUndefined();
      expect(store.values()).toEqual([]);
    } finally {
      await rm(tree.rootPath, { recursive: true, force: true });
    }
  });

  it('rejects orphan content records when the manifest is absent', async () => {
    const { withReaderManifestValidation } = await loadFactories();
    const tree = await createReleaseTree({ manifest: false });
    try {
      const baseLoader: Loader = { name: 'orphan-content-loader', load: async () => undefined };
      await expect(withReaderManifestValidation(baseLoader).load(createLoaderContext(tree.root)))
        .rejects.toThrow(/payload.*without manifest/i);
    } finally {
      await rm(tree.rootPath, { recursive: true, force: true });
    }
  });

  it('rejects an orphan public image when the manifest is absent', async () => {
    const { withReaderManifestValidation } = await loadFactories();
    const tree = await createReleaseTree({ manifest: false, payload: false });
    try {
      const imageDirectory = join(tree.rootPath, 'public/images/book-release');
      await mkdir(imageDirectory, { recursive: true });
      await writeFile(join(imageDirectory, 'orphan.webp'), 'orphan image bytes');
      const baseLoader: Loader = { name: 'orphan-image-loader', load: async () => undefined };
      await expect(withReaderManifestValidation(baseLoader).load(createLoaderContext(tree.root)))
        .rejects.toThrow(/payload.*without manifest/i);
    } finally {
      await rm(tree.rootPath, { recursive: true, force: true });
    }
  });

  it('clears the manifest gate on any watched payload change without auto-reloading', async () => {
    const { withReaderManifestValidation } = await loadFactories();
    const tree = await createReleaseTree();
    const syntheticWatcher = createMultiListenerWatcher();
    try {
      const store = createMemoryStore();
      const baseLoader: Loader = {
        name: 'watching-manifest-loader',
        load: async ({ store: activeStore }) => {
          activeStore.set({ id: 'manifest', data: validManifest });
        },
      };
      await withReaderManifestValidation(baseLoader)
        .load(createLoaderContext(tree.root, store, syntheticWatcher.watcher));
      expect(store.values()).toHaveLength(1);

      const changedImage = join(tree.rootPath, 'public/images/book-release/changed.webp');
      syntheticWatcher.emit('change', changedImage);
      expect(store.values()).toEqual([]);
    } finally {
      await rm(tree.rootPath, { recursive: true, force: true });
    }
  });

  it('fails closed across all six stores when a shared watcher fires during initial load', async () => {
    const factories = await loadFactories();
    const tree = await createReleaseTree();
    const syntheticWatcher = createMultiListenerWatcher();
    const stores = Array.from({ length: 6 }, () => createMemoryStore());
    const logs: string[] = [];
    let started = 0;
    let releaseLoads: () => void = () => undefined;
    const allLoadsStarted = new Promise<void>((resolve) => { releaseLoads = resolve; });
    const loaders = createSixReaderLoaders(factories, async (index) => {
      started += 1;
      if (started === 6) releaseLoads();
      await allLoadsStarted;
      if (index === 0) {
        syntheticWatcher.emit('addDir', join(tree.rootPath, 'public/images/book-release'));
      }
    });
    try {
      const results = await Promise.allSettled(loaders.map((loader, index) => loader.load(
        createLoaderContext(tree.root, stores[index], syntheticWatcher.watcher, logs),
      )));
      expect(results.every((result) => result.status === 'rejected')).toBe(true);
      expect(stores.every((store) => store.values().length === 0)).toBe(true);
      expect(logs.join('\n')).toMatch(/restart required/i);
    } finally {
      await rm(tree.rootPath, { recursive: true, force: true });
    }
  });

  it('re-arms one shared listener generation after Astro removes tracked listeners', async () => {
    const factories = await loadFactories();
    const tree = await createReleaseTree();
    const syntheticWatcher = createMultiListenerWatcher();
    const generationOneStores = Array.from({ length: 6 }, () => createMemoryStore());
    const generationTwoStores = Array.from({ length: 6 }, () => createMemoryStore());
    const logs: string[] = [];
    try {
      await Promise.all(createSixReaderLoaders(factories).map((loader, index) => loader.load(
        createLoaderContext(tree.root, generationOneStores[index], syntheticWatcher.watcher),
      )));
      for (const event of ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const) {
        expect(syntheticWatcher.listenerCount(event)).toBe(1);
      }

      syntheticWatcher.removeAllTrackedListeners();
      for (const event of ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const) {
        expect(syntheticWatcher.listenerCount(event)).toBe(0);
      }

      await Promise.all(createSixReaderLoaders(factories).map((loader, index) => loader.load(
        createLoaderContext(tree.root, generationTwoStores[index], syntheticWatcher.watcher, logs),
      )));
      for (const event of ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const) {
        expect(syntheticWatcher.listenerCount(event)).toBe(1);
      }
      expect(syntheticWatcher.watchedPaths).toHaveLength(4);

      syntheticWatcher.emit('change', join(tree.rootPath, 'public/images/book-release/changed.webp'));
      expect(generationTwoStores.every((store) => store.values().length === 0)).toBe(true);
      expect(generationOneStores.every((store) => store.values().length === 1)).toBe(true);
      expect(logs.filter((message) => /restart required/iu.test(message))).toHaveLength(1);

      const blockedStores = Array.from({ length: 6 }, () => createMemoryStore());
      const blockedResults = await Promise.allSettled(createSixReaderLoaders(factories).map((loader, index) => loader.load(
        createLoaderContext(tree.root, blockedStores[index], syntheticWatcher.watcher, logs),
      )));
      expect(blockedResults.every((result) => result.status === 'rejected')).toBe(true);
      expect(blockedStores.every((store) => store.values().length === 0)).toBe(true);
      expect(logs.filter((message) => /restart required/iu.test(message))).toHaveLength(1);
    } finally {
      await rm(tree.rootPath, { recursive: true, force: true });
    }
  });

  it('keeps an invalidated watcher blocked after Astro removes tracked listeners', async () => {
    const factories = await loadFactories();
    const tree = await createReleaseTree();
    const syntheticWatcher = createMultiListenerWatcher();
    const initialStores = Array.from({ length: 6 }, () => createMemoryStore());
    const logs: string[] = [];
    try {
      await Promise.all(createSixReaderLoaders(factories).map((loader, index) => loader.load(
        createLoaderContext(tree.root, initialStores[index], syntheticWatcher.watcher, logs),
      )));
      syntheticWatcher.emit('unlinkDir', join(tree.rootPath, 'src/content/book-release'));
      expect(initialStores.every((store) => store.values().length === 0)).toBe(true);
      expect(logs.filter((message) => /restart required/iu.test(message))).toHaveLength(1);

      syntheticWatcher.removeAllTrackedListeners();
      const blockedStores = Array.from({ length: 6 }, () => createMemoryStore());
      const blockedResults = await Promise.allSettled(createSixReaderLoaders(factories).map((loader, index) => loader.load(
        createLoaderContext(tree.root, blockedStores[index], syntheticWatcher.watcher, logs),
      )));
      expect(blockedResults.every((result) => result.status === 'rejected')).toBe(true);
      expect(blockedStores.every((store) => store.values().length === 0)).toBe(true);
      expect(initialStores.every((store) => store.values().length === 0)).toBe(true);
      expect(logs.filter((message) => /restart required/iu.test(message))).toHaveLength(1);
      for (const event of ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const) {
        expect(syntheticWatcher.listenerCount(event)).toBe(1);
      }
      expect(syntheticWatcher.watchedPaths).toHaveLength(4);

      const newProcessWatcher = createMultiListenerWatcher();
      const newProcessStores = Array.from({ length: 6 }, () => createMemoryStore());
      await Promise.all(createSixReaderLoaders(factories).map((loader, index) => loader.load(
        createLoaderContext(tree.root, newProcessStores[index], newProcessWatcher.watcher),
      )));
      expect(newProcessStores.every((store) => store.values().length === 1)).toBe(true);
    } finally {
      await rm(tree.rootPath, { recursive: true, force: true });
    }
  });

  it.each([
    ['add', 'src/content/book-release/notes/note-002.json'],
    ['change', 'public/images/book-release/changed.webp'],
    ['unlink', 'src/content/book-release/media/media-site-context.json'],
    ['addDir', 'public/images/book-release'],
    ['unlinkDir', 'src/content/book-release'],
  ] as const)('clears all six stores after a shared %s event', async (event, relativePath) => {
    const factories = await loadFactories();
    const tree = await createReleaseTree();
    const syntheticWatcher = createMultiListenerWatcher();
    const stores = Array.from({ length: 6 }, () => createMemoryStore());
    const loaders = createSixReaderLoaders(factories);
    try {
      await Promise.all(loaders.map((loader, index) => loader.load(
        createLoaderContext(tree.root, stores[index], syntheticWatcher.watcher),
      )));
      expect(stores.every((store) => store.values().length === 1)).toBe(true);
      for (const watchedEvent of ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const) {
        expect(syntheticWatcher.listenerCount(watchedEvent)).toBe(1);
      }
      syntheticWatcher.emit(event, join(tree.rootPath, relativePath));
      expect(stores.every((store) => store.values().length === 0)).toBe(true);
    } finally {
      await rm(tree.rootPath, { recursive: true, force: true });
    }
  });
});

describe('safe repeated URL decoding', () => {
  it.each([
    'https://museum.example/search?q=100%25+jade',
    'https://museum.example/media/100%25-jade.jpg',
    'https://host.example/open?repo=agent-axiom%2Fyu-book_notes',
  ])('accepts valid percent and non-exact repository coordinates: %s', (url) => {
    expect(readerSourceSchema.parse({ ...validSource, url }).url).toBe(url);
  });
});

describe('collection-level validation', () => {
  it('provides separate aggregate, summary and entry-load validators', async () => {
    const validators = await loadFactories();
    expect(validateReaderReleaseCollections).toBeTypeOf('function');
    expect(validators.validateReaderReleaseCollectionSummary).toBeTypeOf('function');
    expect(validators.validateReaderEntryLoad).toBeTypeOf('function');
  });

  it('counts only visible labels and code content in reader Markdown', async () => {
    const { countReaderVisibleWords } = await loadFactories();
    const markdown = [
      '**e\u0301lan** [видимая метка](https://museum.example/a/b/c/d/e/f "скрытый заголовок") `код внутри`',
      '```ts',
      'const value = 1;',
      '```',
    ].join('\n');
    expect(countReaderVisibleWords(markdown)).toBe(8);
  });

  it('accepts the exporter reading time at a visible-link boundary', () => {
    const markdown = `${Array.from({ length: 219 }, (_, index) => `слово${index + 1}`).join(' ')} [источник](https://museum.example/a/b/c/d/e/f/g/h/i/j)`;
    const snapshot = {
      ...validCollectionSnapshot,
      entries: [{
        data: { ...validCollectionSnapshot.entries[0].data, readingMinutes: 1 },
        projectedText: markdown,
      }],
    };
    expect(computeReadingMinutes(markdown)).toBe(1);
    expect(validateReaderReleaseCollections(snapshot)).toEqual(snapshot);
  });

  it('still rejects frontmatter reading time that disagrees with visible Markdown', () => {
    const markdown = `${Array.from({ length: 219 }, (_, index) => `слово${index + 1}`).join(' ')} [источник](https://museum.example/a/b/c/d/e/f/g/h/i/j)`;
    expect(() => validateReaderReleaseCollections({
      ...validCollectionSnapshot,
      entries: [{
        data: { ...validCollectionSnapshot.entries[0].data, readingMinutes: 2 },
        projectedText: markdown,
      }],
    })).toThrow(/reading minutes/iu);
  });

  it('recomputes reading time at 220 words/minute, ceiling, minimum one', () => {
    expect(computeReadingMinutes('')).toBe(1);
    expect(computeReadingMinutes(Array.from({ length: 220 }, () => 'слово').join(' '))).toBe(1);
    expect(computeReadingMinutes(Array.from({ length: 221 }, () => 'слово').join(' '))).toBe(2);
  });

  it('accepts matching manifest counts and entry reading time', () => {
    expect(validateReaderReleaseCollections(validCollectionSnapshot)).toEqual(validCollectionSnapshot);
  });

  it('rejects a manifest count that differs from the actual collections', () => {
    expect(() => validateReaderReleaseCollections({
      ...validCollectionSnapshot,
      notes: [],
    })).toThrow();
  });

  it('rejects a reading time that differs from the projected text', () => {
    expect(() => validateReaderReleaseCollections({
      ...validCollectionSnapshot,
      entries: [{ ...validCollectionSnapshot.entries[0], projectedText: 'одно слово' }],
    })).toThrow();
  });
});
