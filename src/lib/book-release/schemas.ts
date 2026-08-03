import { posix } from 'node:path';
import { z } from 'zod';

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

function repeatedlyDecodeUrlComponent(value: string): string | null {
  let decoded = value;
  for (let pass = 0; pass < 8; pass += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return null;
    }
    if (next === decoded) return next;
    decoded = next;
  }
  return null;
}

function containsPrivateRepositoryPair(value: string): boolean {
  const canonical = value.toLowerCase().replace(/\\/gu, '/').replace(/\/+/gu, '/');
  return /(?:^|[^a-z0-9-])agent-axiom\/yu-book(?:\.git)?(?=$|[^a-z0-9.-])/u.test(canonical);
}

function publicUrlSafetyProblem(value: string): string | null {
  const url = new URL(value);
  if (url.protocol !== 'https:') return 'public external URLs must use HTTPS';
  if (url.username || url.password) return 'public external URLs must not contain credentials';

  const publicReference = repeatedlyDecodeUrlComponent(`${url.pathname}${url.search}${url.hash}`);
  if (publicReference === null) return 'public external URLs must have canonical path and redirect components';
  return containsPrivateRepositoryPair(publicReference)
    ? 'private yu-book URLs are not public evidence URLs'
    : null;
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
    .regex(/^[a-z0-9](?!.*\.\.)[a-z0-9._-]*\.(?:avif|jpe?g|png|svg|webp)$/u),
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
const imagePayloadPathPattern = /^public\/images\/book-release\/[a-z0-9](?!.*\.\.)[a-z0-9._-]*\.(?:avif|jpe?g|png|svg|webp)$/u;

function isExactPayloadPath(value: string): boolean {
  return entryPayloadPathPattern.test(value)
    || notePayloadPathPattern.test(value)
    || sourcePayloadPathPattern.test(value)
    || objectPayloadPathPattern.test(value)
    || mediaPayloadPathPattern.test(value)
    || imagePayloadPathPattern.test(value);
}

const payloadPathSchema = z.string().min(1).superRefine((value, context) => {
  if (value.includes('\\') || value.includes('%') || value.includes('\0') || posix.normalize(value) !== value) {
    context.addIssue({ code: 'custom', message: 'payload paths must be normalized POSIX paths without aliases' });
  }
  if (!isExactPayloadPath(value)) {
    context.addIssue({ code: 'custom', message: 'payload path is outside the reader release roots' });
  }
});

export const readerReleaseFileDescriptorSchema = z.object({
  path: payloadPathSchema,
  kind: z.enum(['text', 'binary']),
  byteLength: z.number().int().nonnegative(),
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
  files: z.array(readerReleaseFileDescriptorSchema).min(1),
  reviewAttestation: readerReviewAttestationSchema,
}).strict().superRefine((manifest, context) => {
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
  for (const key of Object.keys(actualCounts) as Array<keyof typeof actualCounts>) {
    if (actualCounts[key] !== release.manifest.counts[key]) {
      context.addIssue({
        code: 'custom',
        path: [key],
        message: `${key} collection size must match manifest counts`,
      });
    }
  }

  const actualEntryIds = new Set(release.entries.map((entry) => entry.data.id));
  if (actualEntryIds.size !== release.manifest.readingOrder.length
    || release.manifest.readingOrder.some((id) => !actualEntryIds.has(id))) {
    context.addIssue({
      code: 'custom',
      path: ['entries'],
      message: 'loaded entries must match the manifest reading order exactly',
    });
  }

  release.entries.forEach((entry, index) => {
    if (entry.data.readingMinutes !== computeReadingMinutes(entry.projectedText)) {
      context.addIssue({
        code: 'custom',
        path: ['entries', index, 'data', 'readingMinutes'],
        message: 'reading minutes must be recomputed from projected text at 220 words per minute',
      });
    }
  });
});

export function computeReadingMinutes(projectedText: string): number {
  const wordCount = projectedText.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  return Math.max(1, Math.ceil(wordCount / 220));
}

export function validateReaderReleaseCollections(input: unknown) {
  return readerReleaseCollectionsSchema.parse(input);
}

export type ReaderEntry = z.infer<typeof readerEntrySchema>;
export type ReaderNote = z.infer<typeof readerNoteSchema>;
export type ReaderSource = z.infer<typeof readerSourceSchema>;
export type ReaderObject = z.infer<typeof readerObjectSchema>;
export type ReaderMedia = z.infer<typeof readerMediaSchema>;
export type ReaderReleaseFileDescriptor = z.infer<typeof readerReleaseFileDescriptorSchema>;
export type ReaderReviewAttestation = z.infer<typeof readerReviewAttestationSchema>;
export type ReaderReleaseManifest = z.infer<typeof readerReleaseManifestSchema>;
