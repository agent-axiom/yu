import { describe, expect, it } from 'vitest';
import {
  computeReadingMinutes,
  readerEntrySchema,
  readerMediaSchema,
  readerNoteSchema,
  readerObjectSchema,
  readerReleaseManifestSchema,
  readerReviewAttestationSchema,
  readerSourceSchema,
  validateReaderReleaseCollections,
} from '../src/lib/book-release/schemas';
import {
  targetCommit,
  validAuthoredDiagramMedia,
  validCollectionSnapshot,
  validDocumentaryMedia,
  validEntry,
  validGenerativeMedia,
  validManifest,
  validNote,
  validObject,
  validPublishedInventoryObject,
  validSource,
} from './helpers/book-release-fixture';

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
