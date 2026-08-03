import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DataStore, Loader, LoaderContext } from 'astro/loaders';
import { describe, expect, it } from 'vitest';
import {
  computeReadingMinutes,
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
  withReaderEntryValidation(baseLoader: Loader): Loader;
  withReaderManifestValidation(baseLoader: Loader): Loader;
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

function createLoaderContext(root: URL, store = createMemoryStore(), watcher?: LoaderContext['watcher']): LoaderContext {
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
      warn: () => undefined,
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
    expect(() => readerReleaseFileDescriptorSchema.parse({ ...validEntryFileDescriptor, sha256: 'ABC' })).toThrow();
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
  it('wires aggregate wrappers around the official glob loaders', async () => {
    const config = await readFile(join(process.cwd(), 'src/content.config.ts'), 'utf8');
    expect(config).toContain('withReaderEntryValidation(glob(');
    expect(config).toContain('withReaderManifestValidation(glob(');
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
    await expect(wrapped.load(createLoaderContext(pathToFileURL(`${tmpdir()}/`))))
      .rejects.toThrow(/reading minutes/i);
  });

  it('keeps watcher entry reloads behind the same reading-time gate', async () => {
    const { withReaderEntryValidation } = await loadFactories();
    const callbacks = new Map<string, (...args: unknown[]) => unknown>();
    const watcher = {
      add: () => undefined,
      on: (event: string, callback: (...args: unknown[]) => unknown) => {
        callbacks.set(event, callback);
        return watcher;
      },
    } as unknown as LoaderContext['watcher'];
    const body = Array.from({ length: 221 }, () => 'слово').join(' ');
    const baseLoader: Loader = {
      name: 'watching-entry-loader',
      load: async ({ store, watcher: activeWatcher }) => {
        store.set({
          id: validEntry.id,
          data: validEntry,
          body,
          filePath: 'src/content/book-release/entries/chapter-04.md',
        });
        activeWatcher?.on('change', () => store.set({
          id: validEntry.id,
          data: { ...validEntry, readingMinutes: 1 },
          body,
          filePath: 'src/content/book-release/entries/chapter-04.md',
        }));
      },
    };
    const store = createMemoryStore();
    await withReaderEntryValidation(baseLoader).load(createLoaderContext(pathToFileURL(`${tmpdir()}/`), store, watcher));
    expect(() => callbacks.get('change')?.('entry.md')).toThrow(/reading minutes/i);
    expect(store.get(validEntry.id)?.data.readingMinutes).toBe(2);
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

  it('clears the manifest gate when a watched payload change breaks aggregate counts', async () => {
    const { withReaderManifestValidation } = await loadFactories();
    const tree = await createReleaseTree();
    const callbacks = new Map<string, (...args: unknown[]) => unknown>();
    const watcher = {
      add: () => undefined,
      on: (event: string, callback: (...args: unknown[]) => unknown) => {
        callbacks.set(event, callback);
        return watcher;
      },
    } as unknown as LoaderContext['watcher'];
    try {
      const store = createMemoryStore();
      const baseLoader: Loader = {
        name: 'watching-manifest-loader',
        load: async ({ store: activeStore }) => {
          activeStore.set({ id: 'manifest', data: validManifest });
        },
      };
      await withReaderManifestValidation(baseLoader)
        .load(createLoaderContext(tree.root, store, watcher));
      expect(store.values()).toHaveLength(1);

      const removedNote = join(tree.rootPath, 'src/content/book-release/notes/note-001.json');
      await rm(removedNote);
      await callbacks.get('unlink')?.(removedNote);
      expect(store.values()).toEqual([]);
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
