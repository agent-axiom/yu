import { constants as fileConstants, existsSync, readdirSync, type Dirent } from 'node:fs';
import { lstat, open, opendir, type FileHandle } from 'node:fs/promises';
import { join, posix, relative, sep, win32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DataStore, Loader, LoaderContext } from 'astro/loaders';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { z } from 'zod';
import { parseStrictUtf8Json } from './strict-json';

export const AGENT_REVIEW_DISCLOSURE =
  'Материал проверен независимой коллегией AI-агентов по источникам, хронологии, объектам и сравнительному методу. Это не человеческая научная рецензия, не медицинская консультация и не подтверждение прав на изображения.';

export const publicEntryIdSchema = z.string()
  .regex(/^(?:prologue|chapter-\d{2}|interlude-[a-z0-9-]+)$/u);
export const publicNoteIdSchema = z.string().regex(/^note-[a-z0-9-]+$/u);
export const publicSourceIdSchema = z.string().regex(/^source-[a-z0-9-]+$/u);
export const publicObjectIdSchema = z.string().regex(/^object-[a-z0-9-]+$/u);
export const publicMediaIdSchema = z.string().regex(/^media-[a-z0-9-]+$/u);
export const publicAnchorSchema = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u);

const fortyCharLowerHexSchema = z.string().regex(/^[0-9a-f]{40}$/u);
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const safeCycleIdSchema = z.string().regex(/^cycle-(?:0[1-9]|[1-9][0-9])$/u);

type PrivateRepositoryScan = 'safe' | 'private' | 'invalid';

function scanPrivateRepositoryReference(value: string): PrivateRepositoryScan {
  let current = value;
  let successfulDecodes = 0;
  while (true) {
    if (containsPrivateRepositoryPair(current)) return 'private';
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      if (successfulDecodes === 0) return 'invalid';
      return /%[0-9a-f]{2}/iu.test(current) ? 'invalid' : 'safe';
    }
    if (next === current) return 'safe';
    if (successfulDecodes >= 8) return 'invalid';
    current = next;
    successfulDecodes += 1;
  }
}

function containsPrivateRepositoryPair(value: string): boolean {
  const canonical = value.toLowerCase().replace(/\\/gu, '/').replace(/\/+/gu, '/');
  return new RegExp(
    `(?:^|[^a-z0-9_%-])agent-axiom/${'yu' + '-book'}(?:\\.git)?(?=$|[^a-z0-9._%-])`,
    'u',
  ).test(canonical);
}

function publicUrlSafetyProblem(value: string): string | null {
  const url = new URL(value);
  if (url.protocol !== 'https:') return 'public external URLs must use HTTPS';
  if (url.username || url.password) return 'public external URLs must not contain credentials';

  const scan = scanPrivateRepositoryReference(`${url.pathname}${url.search}${url.hash}`);
  if (scan === 'invalid') return 'public external URLs must have canonical path and redirect components';
  return scan === 'private' ? 'private yu-book URLs are not public evidence URLs' : null;
}

export const httpsUrlSchema = z.url().superRefine((value, context) => {
  const problem = publicUrlSafetyProblem(value);
  if (problem) context.addIssue({ code: 'custom', message: problem });
});

function uniqueArray<T extends z.ZodType>(itemSchema: T, minimum = 0) {
  return z.array(itemSchema).min(minimum).superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: 'custom', message: 'array values must be unique' });
    }
  });
}

export const readingSequenceSchema = z.object({
  interludeId: z.string().regex(/^interlude-[a-z0-9-]+$/u),
  portalAnchor: publicAnchorSchema,
  returnAnchor: publicAnchorSchema,
}).strict().superRefine((sequence, context) => {
  if (sequence.portalAnchor === sequence.returnAnchor) {
    context.addIssue({
      code: 'custom',
      path: ['returnAnchor'],
      message: 'portal and return anchors must be distinct',
    });
  }
});

export const readerEntrySchema = z.object({
  id: publicEntryIdSchema,
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  kind: z.enum(['prologue', 'chapter', 'interlude']),
  title: z.string().min(3),
  subtitle: z.string().min(10),
  order: z.number().int().nonnegative(),
  part: z.number().int().min(0).max(5),
  readingMinutes: z.number().int().positive(),
  noteIds: uniqueArray(publicNoteIdSchema, 1),
  objectIds: uniqueArray(publicObjectIdSchema),
  mediaIds: uniqueArray(publicMediaIdSchema),
  readingSequence: readingSequenceSchema.optional(),
}).strict().superRefine((entry, context) => {
  const expectedKind = entry.id === 'prologue'
    ? 'prologue'
    : entry.id.startsWith('chapter-') ? 'chapter' : 'interlude';
  if (entry.kind !== expectedKind) {
    context.addIssue({
      code: 'custom',
      path: ['kind'],
      message: `kind must be ${expectedKind} for id ${entry.id}`,
    });
  }
  if (entry.readingSequence && entry.kind !== 'chapter') {
    context.addIssue({
      code: 'custom',
      path: ['readingSequence'],
      message: 'only a chapter may define a reading sequence portal',
    });
  }
  if (entry.readingSequence?.interludeId === entry.id) {
    context.addIssue({
      code: 'custom',
      path: ['readingSequence', 'interludeId'],
      message: 'a reading sequence cannot target its own entry',
    });
  }
});

export const readerNoteSchema = z.object({
  id: publicNoteIdSchema,
  anchor: publicAnchorSchema,
  statement: z.string().min(20),
  confidence: z.enum(['high', 'medium', 'contested']),
  limitation: z.string().min(20),
  sourceIds: uniqueArray(publicSourceIdSchema, 1),
}).strict();

export const readerSourceTypeSchema = z.enum([
  'primary-text',
  'excavation-report',
  'journal-article',
  'book',
  'book-chapter',
  'museum-record',
  'institutional-page',
  'modern-retelling',
]);

const doiSchema = z.string().regex(/^10\.\d{4,9}\/\S+$/iu);

export const readerSourceSchema = z.object({
  id: publicSourceIdSchema,
  authors: uniqueArray(z.string().min(2), 1),
  title: z.string().min(3),
  year: z.number().int().min(1).max(2100).nullable(),
  type: readerSourceTypeSchema,
  publisher: z.string().min(2),
  containerTitle: z.string().min(2).optional(),
  volume: z.string().min(1).optional(),
  issue: z.string().min(1).optional(),
  pages: z.string().min(1).optional(),
  doi: doiSchema.optional(),
  url: httpsUrlSchema.optional(),
  locators: uniqueArray(z.string().min(2), 1),
}).strict().superRefine((source, context) => {
  if (!source.doi && !source.url) {
    context.addIssue({ code: 'custom', path: ['url'], message: 'a public source requires a DOI or HTTPS URL' });
  }
  if (source.type === 'journal-article'
    && (!source.containerTitle || !source.volume || !source.pages)) {
    context.addIssue({
      code: 'custom',
      path: ['containerTitle'],
      message: 'journal articles require container title, volume, and pages',
    });
  }
  if (source.type === 'book-chapter' && (!source.containerTitle || !source.pages)) {
    context.addIssue({
      code: 'custom',
      path: ['containerTitle'],
      message: 'book chapters require container title and pages',
    });
  }
});

export const inventorySchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('published'), number: z.string().min(1) }).strict(),
  z.object({ status: z.literal('not-published'), statement: z.string().min(20) }).strict(),
]);

export const readerObjectSchema = z.object({
  id: publicObjectIdSchema,
  title: z.string().min(3),
  culture: z.string().min(2),
  date: z.string().min(2),
  material: z.string().min(2),
  materialQualification: z.string().min(20),
  materialAttribution: z.string().min(2),
  collection: z.string().min(2),
  inventory: inventorySchema,
  provenanceBoundary: z.string().min(20),
  credits: uniqueArray(z.string().min(2), 1),
  sourceIds: uniqueArray(publicSourceIdSchema, 1),
  mediaIds: uniqueArray(publicMediaIdSchema, 1),
}).strict();

const mediaShape = {
  id: publicMediaIdSchema,
  outputName: z.string()
    .regex(/^[a-z0-9](?!.*\.\.)[a-z0-9._-]*\.(?:svg|webp)$/u),
  alt: z.string().min(20),
  caption: z.string().min(20),
  credit: z.string().min(2),
  license: z.string().min(2),
  licenseUrl: httpsUrlSchema,
  sourceUrl: httpsUrlSchema.optional(),
};

const readerDocumentaryMediaSchema = z.object({
  ...mediaShape,
  kind: z.literal('documentary'),
}).strict();

const ccByFourUrlSchema = httpsUrlSchema.refine((value) => {
  const url = new URL(value);
  return url.hostname.toLowerCase() === 'creativecommons.org'
    && /^\/licenses\/by\/4\.0\/?$/u.test(url.pathname);
}, 'authored diagrams require the CC BY 4.0 license URL');

const readerAuthoredDiagramMediaSchema = z.object({
  ...mediaShape,
  kind: z.literal('authored-diagram'),
  licenseUrl: ccByFourUrlSchema,
  author: z.string().min(2),
  changeNote: z.string().min(20),
}).strict();

const readerGenerativeMediaSchema = z.object({
  ...mediaShape,
  kind: z.literal('generative'),
  nondocumentaryDisclosure: z.string().min(20).refine(
    (value) => /недокументальн/iu.test(value),
    'generative media require an explicit nondocumentary disclosure',
  ),
}).strict();

export const readerMediaSchema = z.discriminatedUnion('kind', [
  readerDocumentaryMediaSchema,
  readerAuthoredDiagramMediaSchema,
  readerGenerativeMediaSchema,
]);

const entryPayloadPathPattern = /^src\/content\/book-release\/entries\/((?:prologue|chapter-\d{2}|interlude-[a-z0-9-]+))\.md$/u;
const notePayloadPathPattern = /^src\/content\/book-release\/notes\/note-[a-z0-9-]+\.json$/u;
const sourcePayloadPathPattern = /^src\/content\/book-release\/sources\/source-[a-z0-9-]+\.json$/u;
const objectPayloadPathPattern = /^src\/content\/book-release\/objects\/object-[a-z0-9-]+\.json$/u;
const mediaPayloadPathPattern = /^src\/content\/book-release\/media\/media-[a-z0-9-]+\.json$/u;
const imagePayloadPathPattern = /^public\/images\/book-release\/[a-z0-9](?!.*\.\.)[a-z0-9._-]*\.(?:svg|webp)$/u;
const nulSeparator = String.fromCodePoint(0);

export const READER_RELEASE_MAX_FILE_BYTES = 64 * 1024 * 1024;
export const READER_RELEASE_MAX_TOTAL_BYTES = 256 * 1024 * 1024;
export const READER_RELEASE_MAX_FILES = 10_000;

function isExactPayloadPath(value: string): boolean {
  return entryPayloadPathPattern.test(value)
    || notePayloadPathPattern.test(value)
    || sourcePayloadPathPattern.test(value)
    || objectPayloadPathPattern.test(value)
    || mediaPayloadPathPattern.test(value)
    || imagePayloadPathPattern.test(value);
}

const payloadPathSchema = z.string().min(1).superRefine((value, context) => {
  if (value.includes('\\') || value.includes('%') || value.includes(nulSeparator) || posix.normalize(value) !== value) {
    context.addIssue({ code: 'custom', message: 'payload paths must be normalized POSIX paths without aliases' });
  }
  if (!isExactPayloadPath(value)) {
    context.addIssue({ code: 'custom', message: 'payload path is outside the reader release roots' });
  }
});

export const readerReleaseFileDescriptorSchema = z.object({
  path: payloadPathSchema,
  kind: z.enum(['text', 'binary']),
  byteLength: z.number().int().nonnegative().max(
    READER_RELEASE_MAX_FILE_BYTES,
    'reader release file exceeds the bounded byte size',
  ),
  sha256: sha256HexSchema,
}).strict().superRefine((file, context) => {
  const expectedKind = file.path.startsWith('public/images/book-release/') ? 'binary' : 'text';
  if (file.kind !== expectedKind) {
    context.addIssue({
      code: 'custom',
      path: ['kind'],
      message: `${file.path} must be described as ${expectedKind}`,
    });
  }
});

export const readerReviewedPayloadSchema = z.object({
  format: z.literal('yu-reader-payload-v1'),
  projection: z.literal('reader-v1'),
  transformer: z.literal('reader-markdown-v1'),
  digest: sha256HexSchema,
}).strict();

export const readerContentBindingSchema = z.object({
  algorithm: z.literal('sha256'),
  format: z.literal('yu-reader-release-v1'),
  digest: sha256HexSchema,
}).strict();

export const readerReviewAttestationSchema = z.object({
  schemaVersion: z.literal(3),
  reviewMode: z.literal('ai-agent-panel'),
  panelType: z.literal('five-agent'),
  cycleId: safeCycleIdSchema,
  targetCommit: fortyCharLowerHexSchema,
  reviewEvidenceCommit: fortyCharLowerHexSchema,
  publicationGate: z.literal('agent-reviewed'),
  disclosure: z.literal(AGENT_REVIEW_DISCLOSURE),
  reviewedPayload: readerReviewedPayloadSchema,
  contentBinding: readerContentBindingSchema,
}).strict().superRefine((attestation, context) => {
  if (attestation.targetCommit === attestation.reviewEvidenceCommit) {
    context.addIssue({
      code: 'custom',
      path: ['reviewEvidenceCommit'],
      message: 'review evidence commit must differ from the target commit',
    });
  }
});

const readerCountsSchema = z.object({
  entries: z.number().int().positive(),
  notes: z.number().int().nonnegative(),
  sources: z.number().int().nonnegative(),
  objects: z.number().int().nonnegative(),
  media: z.number().int().nonnegative(),
}).strict();

function compareCodeUnits(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

export const readerReleaseManifestSchema = z.object({
  version: z.literal(4),
  projection: z.literal('reader-v1'),
  transformer: z.literal('reader-markdown-v1'),
  cycleId: safeCycleIdSchema,
  targetCommit: fortyCharLowerHexSchema,
  reviewEvidenceCommit: fortyCharLowerHexSchema,
  releaseId: z.string().regex(/^living-jade-reader-v1-[0-9a-f]{40}$/u),
  readerPayloadDigest: sha256HexSchema,
  readingOrder: uniqueArray(publicEntryIdSchema, 1),
  counts: readerCountsSchema,
  files: z.array(readerReleaseFileDescriptorSchema)
    .min(1)
    .max(READER_RELEASE_MAX_FILES, 'reader release exceeds the maximum descriptor count'),
  reviewAttestation: readerReviewAttestationSchema,
}).strict().superRefine((manifest, context) => {
  const totalBytes = manifest.files.reduce((total, file) => total + file.byteLength, 0);
  if (totalBytes > READER_RELEASE_MAX_TOTAL_BYTES) {
    context.addIssue({
      code: 'custom',
      path: ['files'],
      message: 'reader release descriptors exceed the aggregate byte budget',
    });
  }
  if (manifest.targetCommit === manifest.reviewEvidenceCommit) {
    context.addIssue({
      code: 'custom',
      path: ['reviewEvidenceCommit'],
      message: 'review evidence commit must differ from the target commit',
    });
  }

  const expectedReleaseId = `living-jade-reader-v1-${manifest.targetCommit}`;
  if (manifest.releaseId !== expectedReleaseId) {
    context.addIssue({ code: 'custom', path: ['releaseId'], message: 'release ID must contain the full target commit' });
  }

  const attestation = manifest.reviewAttestation;
  const equalities: Array<[unknown, unknown, (string | number)[]]> = [
    [attestation.cycleId, manifest.cycleId, ['reviewAttestation', 'cycleId']],
    [attestation.targetCommit, manifest.targetCommit, ['reviewAttestation', 'targetCommit']],
    [attestation.reviewEvidenceCommit, manifest.reviewEvidenceCommit, ['reviewAttestation', 'reviewEvidenceCommit']],
    [attestation.reviewedPayload.projection, manifest.projection, ['reviewAttestation', 'reviewedPayload', 'projection']],
    [attestation.reviewedPayload.transformer, manifest.transformer, ['reviewAttestation', 'reviewedPayload', 'transformer']],
    [attestation.reviewedPayload.digest, manifest.readerPayloadDigest, ['reviewAttestation', 'reviewedPayload', 'digest']],
  ];
  for (const [actual, expected, path] of equalities) {
    if (actual !== expected) {
      context.addIssue({ code: 'custom', path, message: 'manifest and review attestation identities must match exactly' });
    }
  }

  const filePaths = manifest.files.map((file) => file.path);
  const sortedPaths = [...filePaths].sort(compareCodeUnits);
  if (filePaths.some((path, index) => path !== sortedPaths[index])) {
    context.addIssue({ code: 'custom', path: ['files'], message: 'manifest files must use code-unit path order' });
  }
  if (new Set(filePaths).size !== filePaths.length) {
    context.addIssue({ code: 'custom', path: ['files'], message: 'manifest file paths must be unique' });
  }
  const normalizedPaths = filePaths.map((path) => path.normalize('NFC'));
  if (new Set(normalizedPaths).size !== normalizedPaths.length) {
    context.addIssue({ code: 'custom', path: ['files'], message: 'manifest file paths must not collide after Unicode normalization' });
  }

  const observedCounts = {
    entries: filePaths.filter((path) => path.startsWith('src/content/book-release/entries/')).length,
    notes: filePaths.filter((path) => path.startsWith('src/content/book-release/notes/')).length,
    sources: filePaths.filter((path) => path.startsWith('src/content/book-release/sources/')).length,
    objects: filePaths.filter((path) => path.startsWith('src/content/book-release/objects/')).length,
    media: filePaths.filter((path) => path.startsWith('src/content/book-release/media/')).length,
  };
  for (const key of Object.keys(observedCounts) as Array<keyof typeof observedCounts>) {
    if (manifest.counts[key] !== observedCounts[key]) {
      context.addIssue({ code: 'custom', path: ['counts', key], message: `${key} count must match manifest files` });
    }
  }
  if (manifest.readingOrder.length !== manifest.counts.entries) {
    context.addIssue({ code: 'custom', path: ['readingOrder'], message: 'reading order must contain every entry exactly once' });
  }
  const entryIds = filePaths.flatMap((path) => {
    const match = entryPayloadPathPattern.exec(path);
    return match?.[1] ? [match[1]] : [];
  });
  const readingOrderSet = new Set(manifest.readingOrder);
  if (entryIds.length !== manifest.readingOrder.length
    || entryIds.some((entryId) => !readingOrderSet.has(entryId))) {
    context.addIssue({
      code: 'custom',
      path: ['readingOrder'],
      message: 'reading order must match the exact set of entry file public IDs',
    });
  }
});

const readerReleaseCollectionsSchema = z.object({
  manifest: readerReleaseManifestSchema,
  entries: z.array(z.object({
    data: readerEntrySchema,
    projectedText: z.string(),
  }).strict()),
  notes: z.array(readerNoteSchema),
  sources: z.array(readerSourceSchema),
  objects: z.array(readerObjectSchema),
  media: z.array(readerMediaSchema),
}).strict().superRefine((release, context) => {
  const actualCounts = {
    entries: release.entries.length,
    notes: release.notes.length,
    sources: release.sources.length,
    objects: release.objects.length,
    media: release.media.length,
  };
  addCollectionSummaryIssues(
    release.manifest,
    actualCounts,
    release.entries.map((entry) => entry.data.id),
    context,
  );
  release.entries.forEach((entry, index) => {
    addReadingMinutesIssue(entry.data, entry.projectedText, ['entries', index], context);
  });
});

const actualReaderCountsSchema = z.object({
  entries: z.number().int().nonnegative(),
  notes: z.number().int().nonnegative(),
  sources: z.number().int().nonnegative(),
  objects: z.number().int().nonnegative(),
  media: z.number().int().nonnegative(),
}).strict();

const readerReleaseCollectionSummarySchema = z.object({
  manifest: readerReleaseManifestSchema,
  actualCounts: actualReaderCountsSchema,
  actualEntryIds: uniqueArray(publicEntryIdSchema),
}).strict().superRefine((release, context) => {
  addCollectionSummaryIssues(
    release.manifest,
    release.actualCounts,
    release.actualEntryIds,
    context,
  );
});

const readerEntryLoadSchema = z.object({
  entries: z.array(z.object({
    data: readerEntrySchema,
    body: z.string(),
    filePath: z.string(),
  }).strict()),
}).strict().superRefine((release, context) => {
  release.entries.forEach((entry, index) => {
    addReadingMinutesIssue(entry.data, entry.body, ['entries', index], context);
  });
});

type ReaderCounts = z.infer<typeof actualReaderCountsSchema>;

function addCollectionSummaryIssues(
  manifest: ReaderReleaseManifest,
  actualCounts: ReaderCounts,
  actualEntryIds: string[],
  context: z.RefinementCtx,
) {
  for (const key of Object.keys(actualCounts) as Array<keyof ReaderCounts>) {
    if (actualCounts[key] !== manifest.counts[key]) {
      context.addIssue({
        code: 'custom',
        path: ['actualCounts', key],
        message: `${key} collection size must match manifest counts`,
      });
    }
  }
  const actualEntryIdSet = new Set(actualEntryIds);
  if (actualEntryIdSet.size !== manifest.readingOrder.length
    || manifest.readingOrder.some((id) => !actualEntryIdSet.has(id))) {
    context.addIssue({
      code: 'custom',
      path: ['actualEntryIds'],
      message: 'loaded entries must match the manifest reading order exactly',
    });
  }
}

function addReadingMinutesIssue(
  entry: ReaderEntry,
  projectedText: string,
  path: (string | number)[],
  context: z.RefinementCtx,
) {
  if (entry.readingMinutes !== computeReadingMinutes(projectedText)) {
    context.addIssue({
      code: 'custom',
      path: [...path, 'data', 'readingMinutes'],
      message: 'reading minutes must be recomputed from projected text at 220 words per minute',
    });
  }
}

function collectReaderVisibleText(node: unknown, values: string[]): void {
  if (typeof node !== 'object' || node === null) return;
  const markdownNode = node as { type?: unknown; value?: unknown; children?: unknown };
  if ((markdownNode.type === 'text' || markdownNode.type === 'inlineCode' || markdownNode.type === 'code')
    && typeof markdownNode.value === 'string') {
    values.push(markdownNode.value);
  }
  if (Array.isArray(markdownNode.children)) {
    for (const child of markdownNode.children) collectReaderVisibleText(child, values);
  }
}

export function projectReaderVisibleText(markdown: string): string {
  const values: string[] = [];
  collectReaderVisibleText(fromMarkdown(markdown), values);
  return values.join(' ');
}

export function countReaderVisibleWords(markdown: string): number {
  return projectReaderVisibleText(markdown)
    .match(/[\p{L}\p{N}]+(?:[\p{M}'’-][\p{L}\p{M}\p{N}]+)*/gu)?.length ?? 0;
}

export function computeReadingMinutes(projectedText: string): number {
  const wordCount = countReaderVisibleWords(projectedText);
  return Math.max(1, Math.ceil(wordCount / 220));
}

export type ReaderReleaseCollectionSnapshot = z.infer<typeof readerReleaseCollectionsSchema>;
export type ReaderReleaseCollectionSummary = z.infer<typeof readerReleaseCollectionSummarySchema>;
export type ReaderEntryLoad = z.infer<typeof readerEntryLoadSchema>;

export function validateReaderReleaseCollections(input: unknown): ReaderReleaseCollectionSnapshot {
  return readerReleaseCollectionsSchema.parse(input);
}

export function validateReaderReleaseCollectionSummary(input: unknown): ReaderReleaseCollectionSummary {
  return readerReleaseCollectionSummarySchema.parse(input);
}

export function validateReaderEntryLoad(input: unknown): ReaderEntryLoad {
  if (typeof input !== 'object' || input === null) {
    throw new Error('reader entry loader requires an object');
  }
  assertLoadedEntryFileBindings(input);
  return readerEntryLoadSchema.parse(input);
}

function entryPublicIdFromFilePath(filePath: unknown): string | null {
  if (typeof filePath !== 'string'
    || filePath.includes('\\')
    || filePath.includes('%')
    || filePath.includes(nulSeparator)
    || posix.normalize(filePath) !== filePath) {
    return null;
  }
  if (!entryPayloadPathPattern.test(filePath)) return null;
  const publicId = posix.basename(filePath, '.md');
  return publicEntryIdSchema.safeParse(publicId).success ? publicId : null;
}

function assertLoadedEntryFileBindings(input: object): void {
  if (!('entries' in input) || !Array.isArray(input.entries)) {
    throw new Error('reader entry loader requires an entries array');
  }
  for (const entry of input.entries) {
    const data = typeof entry === 'object' && entry !== null && 'data' in entry ? entry.data : null;
    const filePath = typeof entry === 'object' && entry !== null && 'filePath' in entry ? entry.filePath : null;
    const publicId = entryPublicIdFromFilePath(filePath);
    const dataId = typeof data === 'object' && data !== null && 'id' in data ? data.id : null;
    if (typeof dataId !== 'string' || publicId === null || dataId !== publicId) {
      throw new Error('reader entry frontmatter id must match the filename public id');
    }
  }
}

function validatingEntryStore(store: DataStore): DataStore {
  const validatingSet: DataStore['set'] = (entry) => {
    validateReaderEntryLoad({
      entries: [{ data: entry.data, body: entry.body, filePath: entry.filePath }],
    });
    return store.set(entry);
  };
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property === 'set') return validatingSet;
      return Reflect.get(target, property, receiver);
    },
  });
}

function validateLoadedEntries(store: DataStore): void {
  validateReaderEntryLoad({
    entries: store.values().map((entry) => ({
      data: entry.data,
      body: entry.body,
      filePath: entry.filePath,
    })),
  });
}

export function withReaderEntryValidation(baseLoader: Loader): Loader {
  const validatingLoader: Loader = {
    name: `reader-entry-validation:${baseLoader.name}`,
    async load(context) {
      await baseLoader.load({ ...context, store: validatingEntryStore(context.store) });
      validateLoadedEntries(context.store);
    },
  };
  return withImmutableReaderCollection(validatingLoader);
}

const releaseCollectionSpecs = [
  ['entries', '.md'],
  ['notes', '.json'],
  ['sources', '.json'],
  ['objects', '.json'],
  ['media', '.json'],
] as const;

export type ReaderReleaseJsonScope = 'manifest' | 'notes' | 'sources' | 'objects' | 'media';

function releaseRootUrl(context: LoaderContext): URL {
  return new URL('./src/content/book-release/', context.config.root);
}

function publicImageRootUrl(context: LoaderContext): URL {
  return new URL('./public/images/book-release/', context.config.root);
}

const maxRawReaderJsonBytes = 8 * 1024 * 1024;
const maxRawReaderJsonTotalBytes = READER_RELEASE_MAX_TOTAL_BYTES;
const maxRawReaderJsonEntries = READER_RELEASE_MAX_FILES;

async function rawReaderJsonMetadata(path: URL) {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

type RawReaderJsonMetadata = NonNullable<Awaited<ReturnType<typeof rawReaderJsonMetadata>>>;

function sameRawReaderJsonMetadata(
  left: RawReaderJsonMetadata,
  right: RawReaderJsonMetadata,
): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function assertRawReaderJsonFile(
  metadata: RawReaderJsonMetadata,
  label: string,
): void {
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`generated reader JSON must be a regular non-symbolic-link file at ${label}`);
  }
  if (metadata.nlink !== 1n) {
    throw new Error(`generated reader JSON rejects files with multiple hard links: ${label}`);
  }
  if (metadata.size > BigInt(maxRawReaderJsonBytes)) {
    throw new Error(`generated reader JSON exceeds the bounded input size: ${label}`);
  }
}

type RawReaderJsonFileSnapshot = {
  path: URL;
  label: string;
  metadata: RawReaderJsonMetadata;
  bytes: Buffer;
};

type RawReaderJsonDirectorySnapshot = {
  path: URL;
  label: string;
  metadata: RawReaderJsonMetadata;
  names: string[];
  handle: FileHandle;
};

type RawReaderJsonScopeSnapshot = {
  scopePath: URL;
  scopeMetadata: RawReaderJsonMetadata | null;
  guards: RawReaderJsonDirectorySnapshot[];
  directory?: RawReaderJsonDirectorySnapshot;
  files: RawReaderJsonFileSnapshot[];
};

async function readExactRawReaderJsonBytes(
  handle: FileHandle,
  metadata: RawReaderJsonMetadata,
  label: string,
): Promise<Buffer> {
  assertRawReaderJsonFile(metadata, label);
  const expectedByteLength = Number(metadata.size);
  const bytes = Buffer.allocUnsafe(expectedByteLength);
  let offset = 0;
  while (offset < expectedByteLength) {
    const { bytesRead } = await handle.read(bytes, offset, expectedByteLength - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset !== expectedByteLength) {
    throw new Error(`generated reader JSON size changed while reading: ${label}`);
  }
  const overflow = Buffer.allocUnsafe(1);
  const { bytesRead: overflowBytes } = await handle.read(overflow, 0, 1, expectedByteLength);
  if (overflowBytes !== 0) {
    throw new Error(`generated reader JSON size changed while reading: ${label}`);
  }
  return bytes;
}

async function captureStableRawReaderJson(
  path: URL,
  expectedMetadata?: RawReaderJsonMetadata,
): Promise<RawReaderJsonFileSnapshot> {
  const label = fileURLToPath(path);
  const expected = expectedMetadata ?? await rawReaderJsonMetadata(path);
  if (!expected) throw new Error(`generated reader JSON disappeared before reading: ${label}`);
  assertRawReaderJsonFile(expected, label);

  const handle = await open(path, fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    assertRawReaderJsonFile(opened, label);
    if (!sameRawReaderJsonMetadata(expected, opened)) {
      throw new Error(`generated reader JSON identity or metadata changed before reading: ${label}`);
    }

    const bytes = await readExactRawReaderJsonBytes(handle, opened, label);
    const verified = await handle.stat({ bigint: true });
    const current = await rawReaderJsonMetadata(path);
    if (!verified.isFile()
      || verified.nlink !== 1n
      || !sameRawReaderJsonMetadata(opened, verified)
      || BigInt(bytes.byteLength) !== verified.size
      || !current
      || !sameRawReaderJsonMetadata(opened, current)) {
      throw new Error(`generated reader JSON identity or metadata changed while reading: ${label}`);
    }
    return { path, label, metadata: opened, bytes };
  } finally {
    await handle.close();
  }
}

async function closeRawReaderJsonScopeSnapshot(snapshot: RawReaderJsonScopeSnapshot): Promise<void> {
  const handles: FileHandle[] = [];
  if (snapshot.directory) handles.push(snapshot.directory.handle);
  handles.push(...snapshot.guards.map(({ handle }) => handle));
  await Promise.all(handles.map(async (handle) => handle.close()));
}

async function readBoundedRawReaderJsonDirectoryEntries(
  path: URL,
  label: string,
): Promise<Dirent[]> {
  const directory = await opendir(path);
  const entries: Dirent[] = [];
  try {
    while (true) {
      const entry = await directory.read();
      if (!entry) break;
      if (entries.length >= maxRawReaderJsonEntries) {
        throw new Error(`generated reader JSON directory exceeds the bounded entry count: ${label}`);
      }
      entries.push(entry);
    }
  } finally {
    await directory.close();
  }
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  return entries;
}

async function readBoundedRawReaderJsonDirectoryNames(
  path: URL,
  label: string,
): Promise<string[]> {
  return (await readBoundedRawReaderJsonDirectoryEntries(path, label)).map(({ name }) => name);
}

async function captureRawReaderJsonDirectoryGuard(
  path: URL,
): Promise<RawReaderJsonDirectorySnapshot | null> {
  const label = fileURLToPath(path);
  const expected = await rawReaderJsonMetadata(path);
  if (!expected) return null;
  if (expected.isSymbolicLink() || !expected.isDirectory()) {
    throw new Error(`generated reader JSON guard must be a regular directory: ${label}`);
  }
  const handle = await open(
    path,
    fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW | fileConstants.O_DIRECTORY,
  );
  let retained = false;
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isDirectory() || !sameRawReaderJsonMetadata(expected, opened)) {
      throw new Error(`generated reader JSON guard changed before reading: ${label}`);
    }
    const names = await readBoundedRawReaderJsonDirectoryNames(path, label);
    const verified = await handle.stat({ bigint: true });
    const current = await rawReaderJsonMetadata(path);
    if (!sameRawReaderJsonMetadata(opened, verified)
      || !current
      || !sameRawReaderJsonMetadata(opened, current)) {
      throw new Error(`generated reader JSON guard changed while reading: ${label}`);
    }
    retained = true;
    return { path, label, metadata: opened, names, handle };
  } finally {
    if (!retained) await handle.close();
  }
}

async function captureRawReaderJsonDirectoryGuards(
  context: LoaderContext,
): Promise<RawReaderJsonDirectorySnapshot[]> {
  const guards: RawReaderJsonDirectorySnapshot[] = [];
  const paths = [
    new URL('./', context.config.root),
    new URL('./src/', context.config.root),
    new URL('./src/content/', context.config.root),
    releaseRootUrl(context),
  ];
  try {
    for (const path of paths) {
      const guard = await captureRawReaderJsonDirectoryGuard(path);
      if (guard) guards.push(guard);
    }
    return guards;
  } catch (error) {
    await Promise.all(guards.map(async ({ handle }) => handle.close()));
    throw error;
  }
}

async function captureStrictReaderJsonScope(
  context: LoaderContext,
  scope: ReaderReleaseJsonScope,
): Promise<RawReaderJsonScopeSnapshot> {
  const releaseRoot = releaseRootUrl(context);
  const guards = await captureRawReaderJsonDirectoryGuards(context);
  if (scope === 'manifest') {
    const path = new URL('manifest.json', releaseRoot);
    const snapshot: RawReaderJsonScopeSnapshot = {
      scopePath: path,
      scopeMetadata: null,
      guards,
      files: [],
    };
    try {
      const expected = await rawReaderJsonMetadata(path);
      snapshot.scopeMetadata = expected;
      if (expected) {
        const file = await captureStableRawReaderJson(path, expected);
        snapshot.files.push(file);
        parseStrictUtf8Json(file.bytes, file.label);
      }
      return snapshot;
    } catch (error) {
      await closeRawReaderJsonScopeSnapshot(snapshot);
      throw error;
    }
  }
  const directory = new URL(`${scope}/`, releaseRoot);
  const snapshot: RawReaderJsonScopeSnapshot = {
    scopePath: directory,
    scopeMetadata: null,
    guards,
    files: [],
  };
  try {
    const expectedDirectory = await rawReaderJsonMetadata(directory);
    snapshot.scopeMetadata = expectedDirectory;
    if (!expectedDirectory) return snapshot;
    const directoryLabel = fileURLToPath(directory);
    if (expectedDirectory.isSymbolicLink() || !expectedDirectory.isDirectory()) {
      throw new Error(`generated reader JSON collection must be a regular directory: ${directoryLabel}`);
    }

    const directoryHandle = await open(
      directory,
      fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW | fileConstants.O_DIRECTORY,
    );
    snapshot.directory = {
      path: directory,
      label: directoryLabel,
      metadata: expectedDirectory,
      names: [],
      handle: directoryHandle,
    };
    const openedDirectory = await directoryHandle.stat({ bigint: true });
    if (!openedDirectory.isDirectory()
      || !sameRawReaderJsonMetadata(expectedDirectory, openedDirectory)) {
      throw new Error(`generated reader JSON collection changed before reading: ${directoryLabel}`);
    }
    const entries = await readBoundedRawReaderJsonDirectoryEntries(directory, directoryLabel);
    snapshot.directory.metadata = openedDirectory;
    snapshot.directory.names = entries.map(({ name }) => name);
    const candidates: Array<{
      path: URL;
      metadata: RawReaderJsonMetadata;
    }> = [];
    let totalBytes = 0n;
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw new Error(`generated reader JSON collection rejects symbolic link: ${entry.name}`);
      }
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        throw new Error(`unexpected generated reader JSON collection entry: ${entry.name}`);
      }
      const path = pathToFileURL(join(directoryLabel, entry.name));
      const metadata = await rawReaderJsonMetadata(path);
      if (!metadata) throw new Error(`generated reader JSON disappeared before reading: ${entry.name}`);
      assertRawReaderJsonFile(metadata, fileURLToPath(path));
      totalBytes += metadata.size;
      if (totalBytes > BigInt(maxRawReaderJsonTotalBytes)) {
        throw new Error(`generated reader JSON collection exceeds the aggregate byte budget: ${directoryLabel}`);
      }
      candidates.push({ path, metadata });
    }
    for (const candidate of candidates) {
      const file = await captureStableRawReaderJson(candidate.path, candidate.metadata);
      snapshot.files.push(file);
      parseStrictUtf8Json(file.bytes, file.label);
    }
    const verifiedDirectory = await directoryHandle.stat({ bigint: true });
    const currentDirectory = await rawReaderJsonMetadata(directory);
    if (!verifiedDirectory.isDirectory()
      || !sameRawReaderJsonMetadata(openedDirectory, verifiedDirectory)
      || !currentDirectory
      || !sameRawReaderJsonMetadata(openedDirectory, currentDirectory)) {
      throw new Error(`generated reader JSON collection changed while reading: ${directoryLabel}`);
    }
    return snapshot;
  } catch (error) {
    await closeRawReaderJsonScopeSnapshot(snapshot);
    throw error;
  }
}

async function revalidateRawReaderJsonFile(snapshot: RawReaderJsonFileSnapshot): Promise<void> {
  const current = await captureStableRawReaderJson(snapshot.path, snapshot.metadata);
  if (!current.bytes.equals(snapshot.bytes)
    || !sameRawReaderJsonMetadata(snapshot.metadata, current.metadata)) {
    throw new Error(`generated reader JSON bytes, identity, or metadata changed after parsing: ${snapshot.label}`);
  }
}

async function revalidateRawReaderJsonDirectoryGuard(
  snapshot: RawReaderJsonDirectorySnapshot,
): Promise<void> {
  const opened = await snapshot.handle.stat({ bigint: true });
  const current = await rawReaderJsonMetadata(snapshot.path);
  if (!opened.isDirectory()
    || !sameRawReaderJsonMetadata(snapshot.metadata, opened)
    || !current
    || !sameRawReaderJsonMetadata(snapshot.metadata, current)) {
    throw new Error(`generated reader JSON directory identity or metadata changed after parsing: ${snapshot.label}`);
  }
  const names = await readBoundedRawReaderJsonDirectoryNames(snapshot.path, snapshot.label);
  if (names.length !== snapshot.names.length
    || names.some((name, index) => name !== snapshot.names[index])) {
    throw new Error(`generated reader JSON directory topology changed after parsing: ${snapshot.label}`);
  }
  const verified = await snapshot.handle.stat({ bigint: true });
  const final = await rawReaderJsonMetadata(snapshot.path);
  if (!sameRawReaderJsonMetadata(snapshot.metadata, verified)
    || !final
    || !sameRawReaderJsonMetadata(snapshot.metadata, final)) {
    throw new Error(`generated reader JSON directory changed during topology validation: ${snapshot.label}`);
  }
}

async function revalidateStrictReaderJsonScope(snapshot: RawReaderJsonScopeSnapshot): Promise<void> {
  for (const guard of snapshot.guards) await revalidateRawReaderJsonDirectoryGuard(guard);
  if (!snapshot.scopeMetadata) {
    if (await rawReaderJsonMetadata(snapshot.scopePath)) {
      throw new Error('generated reader JSON topology changed after parsing');
    }
    for (const guard of snapshot.guards) await revalidateRawReaderJsonDirectoryGuard(guard);
    if (await rawReaderJsonMetadata(snapshot.scopePath)) {
      throw new Error('generated reader JSON topology changed after parsing');
    }
    return;
  }
  if (!snapshot.directory) {
    for (const file of snapshot.files) await revalidateRawReaderJsonFile(file);
    for (const guard of snapshot.guards) await revalidateRawReaderJsonDirectoryGuard(guard);
    return;
  }

  const directory = snapshot.directory;
  const openedDirectory = await directory.handle.stat({ bigint: true });
  const currentDirectory = await rawReaderJsonMetadata(directory.path);
  if (!openedDirectory.isDirectory()
    || !sameRawReaderJsonMetadata(directory.metadata, openedDirectory)
    || !currentDirectory
    || !sameRawReaderJsonMetadata(directory.metadata, currentDirectory)) {
    throw new Error(`generated reader JSON collection identity or metadata changed after parsing: ${directory.label}`);
  }
  const entries = await readBoundedRawReaderJsonDirectoryEntries(directory.path, directory.label);
  if (entries.length !== directory.names.length
    || entries.some((entry, index) => entry.name !== directory.names[index])) {
    throw new Error(`generated reader JSON collection topology changed after parsing: ${directory.label}`);
  }
  for (const file of snapshot.files) await revalidateRawReaderJsonFile(file);
  const verifiedDirectory = await directory.handle.stat({ bigint: true });
  const finalDirectory = await rawReaderJsonMetadata(directory.path);
  if (!sameRawReaderJsonMetadata(directory.metadata, verifiedDirectory)
    || !finalDirectory
    || !sameRawReaderJsonMetadata(directory.metadata, finalDirectory)) {
    throw new Error(`generated reader JSON collection changed during post-parse validation: ${directory.label}`);
  }
  for (const guard of snapshot.guards) await revalidateRawReaderJsonDirectoryGuard(guard);
}

function directoryHasPayload(directory: URL): boolean {
  try {
    return readdirSync(directory).length > 0;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function hasOrphanReaderPayload(context: LoaderContext): boolean {
  const contentRoot = releaseRootUrl(context);
  return releaseCollectionSpecs.some(([collection]) => directoryHasPayload(new URL(`${collection}/`, contentRoot)))
    || directoryHasPayload(publicImageRootUrl(context));
}

function readReleaseCollectionSummary(root: URL): {
  actualCounts: ReaderCounts;
  actualEntryIds: string[];
} {
  const actualCounts: ReaderCounts = { entries: 0, notes: 0, sources: 0, objects: 0, media: 0 };
  const actualEntryIds: string[] = [];
  for (const [collection, extension] of releaseCollectionSpecs) {
    const directory = new URL(`${collection}/`, root);
    let names: string[] = [];
    try {
      names = readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
        .map((entry) => entry.name);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    actualCounts[collection] = names.length;
    if (collection === 'entries') {
      actualEntryIds.push(...names.map((name) => name.slice(0, -extension.length)));
    }
  }
  return { actualCounts, actualEntryIds };
}

function validateLoadedManifest(context: LoaderContext): void {
  const root = releaseRootUrl(context);
  if (!existsSync(new URL('manifest.json', root))) {
    context.store.clear();
    if (hasOrphanReaderPayload(context)) {
      throw new Error('reader release payload must not exist without manifest');
    }
    return;
  }
  const entries = context.store.values();
  if (entries.length !== 1) {
    context.store.clear();
    throw new Error('reader release must load exactly one manifest');
  }
  try {
    validateReaderReleaseCollectionSummary({
      manifest: entries[0]?.data,
      ...readReleaseCollectionSummary(root),
    });
  } catch (error) {
    context.store.clear();
    throw error;
  }
}

export function isReaderWatcherRelativePathInsideRoot(
  pathFromRoot: string,
  separator: '/' | '\\' = sep as '/' | '\\',
): boolean {
  const pathApi = separator === '\\' ? win32 : posix;
  return pathFromRoot === '' || (pathFromRoot !== '..'
    && !pathFromRoot.startsWith(`..${separator}`)
    && !pathApi.isAbsolute(pathFromRoot));
}

function isInsideReleaseRoot(rootPath: string, changedPath: string): boolean {
  return isReaderWatcherRelativePathInsideRoot(relative(rootPath, changedPath));
}

const READER_RELEASE_RESTART_REQUIRED =
  'Reader release changed; restart required before book content can be loaded again.';

type ReaderInvalidationTarget = {
  store: DataStore;
  logger: LoaderContext['logger'];
  loading: boolean;
  dirtyDuringLoad: boolean;
};

type ReaderInvalidationCoordinator = {
  invalidated: boolean;
  warned: boolean;
  targets: Set<ReaderInvalidationTarget>;
  invalidateRelease: (changedPath: string) => void;
};

type ReaderInvalidationRegistration = {
  coordinator: ReaderInvalidationCoordinator;
  target: ReaderInvalidationTarget;
};

const readerInvalidationCoordinators = new WeakMap<object, Map<string, ReaderInvalidationCoordinator>>();
const readerInvalidationEvents = ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const;

function hasActiveReaderInvalidationListeners(
  watcher: NonNullable<LoaderContext['watcher']>,
  coordinator: ReaderInvalidationCoordinator,
): boolean {
  return readerInvalidationEvents.every((event) =>
    watcher.listeners(event).includes(coordinator.invalidateRelease));
}

function removeReaderInvalidationListeners(
  watcher: NonNullable<LoaderContext['watcher']>,
  coordinator: ReaderInvalidationCoordinator,
): void {
  for (const event of readerInvalidationEvents) watcher.off(event, coordinator.invalidateRelease);
}

function createReaderInvalidationCoordinator(
  watchedPaths: string[],
  previous?: Pick<ReaderInvalidationCoordinator, 'invalidated' | 'warned'>,
): ReaderInvalidationCoordinator {
  const coordinator: ReaderInvalidationCoordinator = {
    invalidated: previous?.invalidated ?? false,
    warned: previous?.warned ?? false,
    targets: new Set(),
    invalidateRelease: () => undefined,
  };
  coordinator.invalidateRelease = (changedPath: string) => {
    if (!watchedPaths.some((rootPath) => isInsideReleaseRoot(rootPath, changedPath))) return;
    coordinator.invalidated = true;
    for (const registeredTarget of coordinator.targets) {
      if (registeredTarget.loading) registeredTarget.dirtyDuringLoad = true;
      registeredTarget.store.clear();
    }
    if (!coordinator.warned) {
      coordinator.targets.values().next().value?.logger.warn(READER_RELEASE_RESTART_REQUIRED);
      coordinator.warned = true;
    }
  };
  return coordinator;
}

function registerReaderInvalidation(context: LoaderContext): ReaderInvalidationRegistration | undefined {
  const watcher = context.watcher;
  if (!watcher) return undefined;

  const watchedPaths = [
    fileURLToPath(releaseRootUrl(context)),
    fileURLToPath(publicImageRootUrl(context)),
  ];
  const coordinatorKey = watchedPaths.join(nulSeparator);
  let watcherCoordinators = readerInvalidationCoordinators.get(watcher);
  if (!watcherCoordinators) {
    watcherCoordinators = new Map();
    readerInvalidationCoordinators.set(watcher, watcherCoordinators);
  }

  let coordinator = watcherCoordinators.get(coordinatorKey);
  let previousState: Pick<ReaderInvalidationCoordinator, 'invalidated' | 'warned'> | undefined;
  if (coordinator && !hasActiveReaderInvalidationListeners(watcher, coordinator)) {
    previousState = { invalidated: coordinator.invalidated, warned: coordinator.warned };
    removeReaderInvalidationListeners(watcher, coordinator);
    watcherCoordinators.delete(coordinatorKey);
    coordinator = undefined;
  }
  const target: ReaderInvalidationTarget = {
    store: context.store,
    logger: context.logger,
    loading: true,
    dirtyDuringLoad: false,
  };
  if (!coordinator) {
    const newCoordinator = createReaderInvalidationCoordinator(watchedPaths, previousState);
    newCoordinator.targets.add(target);
    coordinator = newCoordinator;
    watcherCoordinators.set(coordinatorKey, newCoordinator);
    for (const event of readerInvalidationEvents) watcher.on(event, newCoordinator.invalidateRelease);
    watcher.add(watchedPaths);
  } else {
    coordinator.targets.add(target);
  }

  if (coordinator.invalidated) {
    target.dirtyDuringLoad = true;
    target.store.clear();
  }
  return { coordinator, target };
}

export function withImmutableReaderCollection(
  baseLoader: Loader,
  jsonScope?: ReaderReleaseJsonScope,
): Loader {
  return {
    name: `immutable-reader:${baseLoader.name}`,
    async load(context) {
      let invalidation: ReaderInvalidationRegistration | undefined;
      let rawJsonSnapshot: RawReaderJsonScopeSnapshot | undefined;
      try {
        invalidation = registerReaderInvalidation(context);
        if (invalidation?.coordinator.invalidated) {
          throw new Error(READER_RELEASE_RESTART_REQUIRED);
        }
        if (jsonScope) rawJsonSnapshot = await captureStrictReaderJsonScope(context, jsonScope);
        await baseLoader.load({ ...context, watcher: undefined });
        if (rawJsonSnapshot) await revalidateStrictReaderJsonScope(rawJsonSnapshot);
        if (invalidation?.target.dirtyDuringLoad) {
          context.store.clear();
          throw new Error(READER_RELEASE_RESTART_REQUIRED);
        }
      } catch (error) {
        context.store.clear();
        throw error;
      } finally {
        if (rawJsonSnapshot) await closeRawReaderJsonScopeSnapshot(rawJsonSnapshot);
        if (invalidation) invalidation.target.loading = false;
      }
    },
  };
}

export function withReaderManifestValidation(baseLoader: Loader): Loader {
  const validatingLoader: Loader = {
    name: `reader-manifest-validation:${baseLoader.name}`,
    async load(context) {
      await baseLoader.load(context);
      validateLoadedManifest(context);
    },
  };
  return withImmutableReaderCollection(validatingLoader, 'manifest');
}

export type ReaderEntry = z.infer<typeof readerEntrySchema>;
export type ReaderNote = z.infer<typeof readerNoteSchema>;
export type ReaderSource = z.infer<typeof readerSourceSchema>;
export type ReaderObject = z.infer<typeof readerObjectSchema>;
export type ReaderMedia = z.infer<typeof readerMediaSchema>;
export type ReaderReleaseFileDescriptor = z.infer<typeof readerReleaseFileDescriptorSchema>;
export type ReaderReviewAttestation = z.infer<typeof readerReviewAttestationSchema>;
export type ReaderReleaseManifest = z.infer<typeof readerReleaseManifestSchema>;
