import { createHash } from 'node:crypto';
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  truncate,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canonicalJsonBytes,
  computeReaderPayloadDigest,
  computeReaderReleaseDigest,
  frameBytes,
  verifyReaderReleaseIntegrity,
} from '../src/lib/book-release/integrity';
import { loadValidatedReaderRelease } from '../src/lib/book-release/load';
import { EXPECTED_READER_ENTRY_ORDER } from '../src/lib/book-release/routes';
import { readerReleaseManifestSchema } from '../src/lib/book-release/schemas';
import { APPROVED_READER_SVG_DIGESTS } from '../src/lib/book-release/svg-policy';
import { scanReaderReleaseLayers } from '../src/lib/book-release/validate';
import {
  agentReviewDisclosure,
  reviewEvidenceCommit,
  targetCommit,
} from './helpers/book-release-fixture';

type JsonObject = { [key: string]: unknown };

type SyntheticRelease = {
  root: string;
  manifestPath: string;
  imagePath: string;
  entryPaths: Record<'prologue' | 'chapter' | 'interlude', string>;
  notePaths: Record<'prologue' | 'chapter' | 'interlude', string>;
};

const textEncoder = new TextEncoder();

function compareCodeUnits(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function referenceFrame(bytes: Uint8Array): Buffer {
  const header = Buffer.alloc(8);
  header.writeBigUInt64BE(BigInt(bytes.byteLength));
  return Buffer.concat([header, Buffer.from(bytes)]);
}

function referenceCanonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite test fixture number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => referenceCanonicalJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as JsonObject;
    return `{${Object.keys(record).sort(compareCodeUnits).map((key) =>
      `${JSON.stringify(key)}:${referenceCanonicalJson(record[key])}`).join(',')}}`;
  }
  throw new TypeError('unsupported test fixture value');
}

function referencePrettyJson(value: unknown, depth = 0): string {
  if (value === null || typeof value !== 'object') return referenceCanonicalJson(value);
  const indentation = '  '.repeat(depth + 1);
  const closing = '  '.repeat(depth);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((item) => `${indentation}${referencePrettyJson(item, depth + 1)}`).join(',\n')}\n${closing}]`;
  }
  const record = value as JsonObject;
  const keys = Object.keys(record).sort(compareCodeUnits);
  if (keys.length === 0) return '{}';
  return `{\n${keys.map((key) =>
    `${indentation}${JSON.stringify(key)}: ${referencePrettyJson(record[key], depth + 1)}`).join(',\n')}\n${closing}}`;
}

function referenceStableJsonBytes(value: unknown): Buffer {
  return Buffer.from(`${referencePrettyJson(value)}\n`, 'utf8');
}

function referenceDigest(domain: string, files: Array<{ path: string; bytes: Uint8Array }>): string {
  const hash = createHash('sha256');
  hash.update(domain, 'utf8');
  for (const file of files) {
    hash.update(referenceFrame(textEncoder.encode(file.path)));
    hash.update(referenceFrame(file.bytes));
  }
  return hash.digest('hex');
}

function withoutContentBinding(manifest: JsonObject): JsonObject {
  const reviewAttestation = manifest.reviewAttestation as JsonObject;
  const { contentBinding: _contentBinding, ...attestationProjection } = reviewAttestation;
  return { ...manifest, reviewAttestation: attestationProjection };
}

function referenceReleaseDigest(
  manifest: JsonObject,
  files: Array<{ path: string; bytes: Uint8Array }>,
): string {
  const hash = createHash('sha256');
  hash.update('yu-reader-release-v1', 'utf8');
  hash.update(referenceFrame(referenceStableJsonBytes(withoutContentBinding(manifest))));
  for (const file of files) {
    hash.update(referenceFrame(textEncoder.encode(file.path)));
    hash.update(referenceFrame(file.bytes));
  }
  return hash.digest('hex');
}

function stableJson(value: unknown): string {
  return referenceStableJsonBytes(value).toString('utf8');
}

function serializeEntry(data: JsonObject, body: string): string {
  return `---\n${stableJson(data)}---\n${body.trim()}\n`;
}

const source = {
  id: 'source-museum',
  authors: ['Museum Research Team'],
  title: 'A documented jade object',
  year: 2024,
  type: 'museum-record',
  publisher: 'Museum of Jade',
  url: 'https://museum.example/objects/jade',
  locators: ['Catalogue record and material statement'],
};

const media = {
  id: 'media-jade-suit',
  outputName: 'jade-suit.webp',
  alt: 'Нефритовые пластины погребального костюма, соединённые проволокой.',
  caption: 'Погребальный костюм эпохи Хань в музейной экспозиции.',
  credit: 'Museum of Jade',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  sourceUrl: 'https://museum.example/images/jade-suit',
  kind: 'documentary',
};

const object = {
  id: 'object-jade-suit',
  title: 'Погребальный костюм из пластин',
  culture: 'Хань, Китай',
  date: 'II век до н. э.',
  material: 'Нефритовые пластины',
  materialQualification: 'Музейная атрибуция; минералогический анализ отдельно не опубликован.',
  materialAttribution: 'Museum of Jade',
  collection: 'Museum of Jade',
  inventory: { status: 'published', number: 'MJ-24' },
  provenanceBoundary: 'Паспорт ограничен сведениями опубликованной музейной карточки.',
  credits: ['Museum of Jade'],
  sourceIds: ['source-museum'],
  mediaIds: ['media-jade-suit'],
};

const entries = {
  prologue: {
    id: 'prologue',
    slug: 'prologue',
    kind: 'prologue',
    title: 'Пролог. Живой камень',
    subtitle: 'Как читать историю нефрита через вещи, тексты и ограничения',
    order: 1,
    part: 0,
    readingMinutes: 1,
    noteIds: ['note-prologue'],
    objectIds: [],
    mediaIds: [],
  },
  chapter: {
    id: 'chapter-04',
    slug: 'virtue-immortality',
    kind: 'chapter',
    title: 'Добродетель и бессмертие',
    subtitle: 'Как нефрит стал языком ритуала, памяти и надежды',
    order: 2,
    part: 1,
    readingMinutes: 1,
    noteIds: ['note-chapter'],
    objectIds: ['object-jade-suit'],
    mediaIds: ['media-jade-suit'],
    readingSequence: {
      interludeId: 'interlude-jade-immortality',
      portalAnchor: 'portal-jade-immortality',
      returnAnchor: 'after-jade-immortality',
    },
  },
  interlude: {
    id: 'interlude-jade-immortality',
    slug: 'jade-immortality',
    kind: 'interlude',
    title: 'Интерлюдия. Нефритовое бессмертие',
    subtitle: 'Археологические вещи и древняя надежда на сохранение тела',
    order: 3,
    part: 1,
    readingMinutes: 1,
    noteIds: ['note-interlude'],
    objectIds: ['object-jade-suit'],
    mediaIds: ['media-jade-suit'],
  },
} satisfies Record<string, JsonObject>;

const bodies = {
  prologue: '# Живой камень\n\nИстория начинается с проверяемого свидетельства [1](#note-prologue).',
  chapter: [
    '# Добродетель и бессмертие',
    '',
    'Тексты связывали качества камня с добродетелью [2](#note-chapter).',
    '',
    '[Паспорт предмета](/book/objects/jade-suit/) · [Изображение](/book/media/jade-suit/)',
    '',
    '[Перейти к интерлюдии](/book/read/jade-immortality/#portal-jade-immortality) · [Вернуться к главе](/book/read/chapter-04/#after-jade-immortality)',
  ].join('\n'),
  interlude: [
    '# Нефритовое бессмертие',
    '',
    'Погребальный обычай подтверждает надежду, но не действие камня [3](#note-interlude).',
    '',
    '[Паспорт предмета](/book/objects/jade-suit/) · [Изображение](/book/media/jade-suit/)',
  ].join('\n'),
};

const notes = {
  prologue: {
    id: 'note-prologue',
    anchor: 'note-prologue',
    statement: 'Археологический контекст отделяется от поздней литературной интерпретации.',
    confidence: 'high',
    limitation: 'Фрагментарность находок ограничивает реконструкцию первоначального смысла.',
    sourceIds: ['source-museum'],
  },
  chapter: {
    id: 'note-chapter',
    anchor: 'note-chapter',
    statement: 'Поздние тексты сравнивают качества камня с нравственными достоинствами.',
    confidence: 'medium',
    limitation: 'Текстовую метафору нельзя автоматически переносить на каждый ранний предмет.',
    sourceIds: ['source-museum'],
  },
  interlude: {
    id: 'note-interlude',
    anchor: 'note-interlude',
    statement: 'Нефритовые погребальные костюмы документированы археологически и музейно.',
    confidence: 'high',
    limitation: 'Находка костюма не доказывает буквальную способность материала сохранять тело.',
    sourceIds: ['source-museum'],
  },
} satisfies Record<string, JsonObject>;

async function writePayload(root: string, path: string, bytes: string | Uint8Array): Promise<void> {
  const absolutePath = join(root, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
}

async function readManifest(root: string): Promise<JsonObject> {
  return JSON.parse(await readFile(join(root, 'src/content/book-release/manifest.json'), 'utf8')) as JsonObject;
}

async function writeBoundManifest(root: string, input: JsonObject): Promise<JsonObject> {
  const manifest = structuredClone(input);
  const descriptors = manifest.files as Array<JsonObject>;
  const files = await Promise.all(descriptors.map(async (descriptor) => ({
    path: descriptor.path as string,
    bytes: await readFile(join(root, descriptor.path as string)),
  })));
  const readerPayloadDigest = referenceDigest('yu-reader-payload-v1', files);
  manifest.readerPayloadDigest = readerPayloadDigest;
  const attestation = manifest.reviewAttestation as JsonObject;
  const reviewedPayload = attestation.reviewedPayload as JsonObject;
  reviewedPayload.digest = readerPayloadDigest;
  attestation.contentBinding = {
    algorithm: 'sha256',
    format: 'yu-reader-release-v1',
    digest: '0'.repeat(64),
  };
  (attestation.contentBinding as JsonObject).digest = referenceReleaseDigest(manifest, files);
  await writePayload(root, 'src/content/book-release/manifest.json', stableJson(manifest));
  return manifest;
}

async function rebindManifest(root: string, mutate?: (manifest: JsonObject) => void): Promise<JsonObject> {
  const manifest = await readManifest(root);
  mutate?.(manifest);
  const descriptors = manifest.files as Array<JsonObject>;
  for (const descriptor of descriptors) {
    const bytes = await readFile(join(root, descriptor.path as string));
    descriptor.byteLength = bytes.byteLength;
    descriptor.sha256 = createHash('sha256').update(bytes).digest('hex');
  }
  return writeBoundManifest(root, manifest);
}

async function replaceSyntheticReleaseImage(
  release: SyntheticRelease,
  outputName: string,
  bytes: Uint8Array,
): Promise<void> {
  const previousPath = 'public/images/book-release/jade-suit.webp';
  const nextPath = `public/images/book-release/${outputName}`;
  await unlink(release.imagePath);
  await writePayload(release.root, nextPath, bytes);
  await writeFile(
    join(release.root, 'src/content/book-release/media/media-jade-suit.json'),
    stableJson({
      ...media,
      outputName,
      kind: 'authored-diagram',
      author: 'agent-axiom',
      changeNote: 'Авторская схема для публичного ридера.',
    }),
  );
  await rebindManifest(release.root, (manifest) => {
    const descriptor = (manifest.files as Array<JsonObject>)
      .find((file) => file.path === previousPath)!;
    descriptor.path = nextPath;
    (manifest.files as Array<JsonObject>)
      .sort((left, right) => compareCodeUnits(left.path as string, right.path as string));
  });
  release.imagePath = join(release.root, nextPath);
}

async function injectHiddenDuplicateJsonValue(
  path: string,
  key: string,
  safeValue: string,
  hiddenValue: string,
  escapedKey: string,
  indentation = '  ',
): Promise<void> {
  const raw = await readFile(path, 'utf8');
  const safeLine = `${indentation}${JSON.stringify(key)}: ${JSON.stringify(safeValue)}`;
  if (!raw.includes(safeLine)) throw new Error(`fixture key not found: ${key}`);
  const duplicateLine = `${indentation}"${escapedKey}": ${JSON.stringify(hiddenValue)},\n${safeLine}`;
  await writeFile(path, raw.replace(safeLine, duplicateLine));
}

async function createSyntheticRelease(): Promise<SyntheticRelease> {
  const root = await mkdtemp(join(tmpdir(), 'yu-reader-release-'));
  const payloads = new Map<string, string | Uint8Array>([
    ['src/content/book-release/entries/prologue.md', serializeEntry(entries.prologue, bodies.prologue)],
    ['src/content/book-release/entries/chapter-04.md', serializeEntry(entries.chapter, bodies.chapter)],
    ['src/content/book-release/entries/interlude-jade-immortality.md', serializeEntry(entries.interlude, bodies.interlude)],
    ['src/content/book-release/notes/note-prologue.json', stableJson(notes.prologue)],
    ['src/content/book-release/notes/note-chapter.json', stableJson(notes.chapter)],
    ['src/content/book-release/notes/note-interlude.json', stableJson(notes.interlude)],
    ['src/content/book-release/sources/source-museum.json', stableJson(source)],
    ['src/content/book-release/objects/object-jade-suit.json', stableJson(object)],
    ['src/content/book-release/media/media-jade-suit.json', stableJson(media)],
    ['public/images/book-release/jade-suit.webp', Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 1, 2, 3, 0xfe, 0xff])],
  ]);
  for (const [path, bytes] of payloads) await writePayload(root, path, bytes);

  const files = [...payloads.keys()].sort(compareCodeUnits).map((path) => {
    const bytes = Buffer.from(payloads.get(path)!);
    return {
      path,
      kind: path.startsWith('public/images/book-release/') ? 'binary' : 'text',
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  });
  const manifest: JsonObject = {
    version: 4,
    projection: 'reader-v1',
    transformer: 'reader-markdown-v1',
    cycleId: 'cycle-02',
    targetCommit,
    reviewEvidenceCommit,
    releaseId: `living-jade-reader-v1-${targetCommit}`,
    readerPayloadDigest: '0'.repeat(64),
    readingOrder: [...EXPECTED_READER_ENTRY_ORDER],
    counts: { entries: 3, notes: 3, sources: 1, objects: 1, media: 1 },
    files,
    reviewAttestation: {
      schemaVersion: 3,
      reviewMode: 'ai-agent-panel',
      panelType: 'five-agent',
      cycleId: 'cycle-02',
      targetCommit,
      reviewEvidenceCommit,
      publicationGate: 'agent-reviewed',
      disclosure: agentReviewDisclosure,
      reviewedPayload: {
        format: 'yu-reader-payload-v1',
        projection: 'reader-v1',
        transformer: 'reader-markdown-v1',
        digest: '0'.repeat(64),
      },
      contentBinding: {
        algorithm: 'sha256',
        format: 'yu-reader-release-v1',
        digest: '0'.repeat(64),
      },
    },
  };
  await writeBoundManifest(root, manifest);
  return {
    root,
    manifestPath: join(root, 'src/content/book-release/manifest.json'),
    imagePath: join(root, 'public/images/book-release/jade-suit.webp'),
    entryPaths: {
      prologue: join(root, 'src/content/book-release/entries/prologue.md'),
      chapter: join(root, 'src/content/book-release/entries/chapter-04.md'),
      interlude: join(root, 'src/content/book-release/entries/interlude-jade-immortality.md'),
    },
    notePaths: {
      prologue: join(root, 'src/content/book-release/notes/note-prologue.json'),
      chapter: join(root, 'src/content/book-release/notes/note-chapter.json'),
      interlude: join(root, 'src/content/book-release/notes/note-interlude.json'),
    },
  };
}

async function withRelease(run: (release: SyntheticRelease) => Promise<void>): Promise<void> {
  const release = await createSyntheticRelease();
  try {
    await run(release);
  } finally {
    await rm(release.root, { recursive: true, force: true });
  }
}

describe('reader release canonical framing', () => {
  it('uses an exact unsigned eight-byte big-endian length frame', () => {
    expect(Buffer.from(frameBytes(textEncoder.encode('jade'))).toString('hex'))
      .toBe('00000000000000046a616465');
  });

  it('recursively code-unit sorts canonical JSON with two spaces and one terminal LF', () => {
    const value = { z: 1, a: { β: 2, A: 3 }, arr: [{ b: 1, a: 2 }], accent: 'e\u0301' };
    expect(Buffer.from(canonicalJsonBytes(value)).toString('utf8')).toBe([
      '{',
      '  "a": {',
      '    "A": 3,',
      '    "β": 2',
      '  },',
      '  "accent": "é",',
      '  "arr": [',
      '    {',
      '      "a": 2,',
      '      "b": 1',
      '    }',
      '  ],',
      '  "z": 1',
      '}',
      '',
    ].join('\n'));
  });

  it('matches an independent golden payload vector', () => {
    const files = [
      { path: 'a.txt', bytes: textEncoder.encode('A') },
      { path: 'β.bin', bytes: Uint8Array.from([0, 1, 255]) },
    ];
    expect(computeReaderPayloadDigest(files))
      .toBe('59c165b932af15afa62671bd10729d70f62a9fd90fda1881b02580364bb9824e');
  });

  it('removes only contentBinding from the release projection', async () => {
    await withRelease(async ({ root }) => {
      const manifest = await readManifest(root);
      const files = await Promise.all((manifest.files as Array<JsonObject>).map(async (descriptor) => ({
        path: descriptor.path as string,
        bytes: await readFile(join(root, descriptor.path as string)),
      })));
      expect(computeReaderReleaseDigest(manifest as never, files))
        .toBe(((manifest.reviewAttestation as JsonObject).contentBinding as JsonObject).digest);

      const mutated = structuredClone(manifest);
      ((mutated.reviewAttestation as JsonObject).contentBinding as JsonObject).digest = 'f'.repeat(64);
      expect(computeReaderReleaseDigest(mutated as never, files))
        .toBe(computeReaderReleaseDigest(manifest as never, files));

      ((mutated.reviewAttestation as JsonObject).reviewedPayload as JsonObject).digest = 'e'.repeat(64);
      expect(computeReaderReleaseDigest(mutated as never, files))
        .not.toBe(computeReaderReleaseDigest(manifest as never, files));
    });
  });
});

describe('validated reader release loading', () => {
  it('freezes the exact two approved authored SVG digests and no others', async () => {
    expect(Object.isFrozen(APPROVED_READER_SVG_DIGESTS)).toBe(true);
    expect(APPROVED_READER_SVG_DIGESTS).toEqual([
      '9c4401faf995b0bd954379e56087ac818bf35f73657a335f3d91835bd6ba482d',
      '4c129fe85208d046c53cee25d8309a7069efef7f47e1ceb18885cfdb429117a9',
    ]);
    const fixtureNames = ['05-xishan-site-context.svg', '09-pilot-sites-map.svg'];
    const fixtureDigests = await Promise.all(fixtureNames.map(async (name) =>
      createHash('sha256').update(await readFile(join(
        process.cwd(),
        'tests/fixtures/book-release/approved',
        name,
      ))).digest('hex')));
    expect(fixtureDigests).toEqual(APPROVED_READER_SVG_DIGESTS);
  });

  it('accepts exact raw bytes and builds the immutable three-entry route index', async () => {
    await withRelease(async ({ root }) => {
      const release = await loadValidatedReaderRelease(root);
      expect(release).not.toBeNull();
      expect(release?.routes.ordered.map((entry) => entry.data.id)).toEqual(EXPECTED_READER_ENTRY_ORDER);
      expect(release?.routes.bySlug.get('virtue-immortality')?.data.id).toBe('chapter-04');
      expect(Array.from(release?.files.find((file) => file.path.endsWith('.webp'))?.bytes ?? []))
        .toEqual([0x52, 0x49, 0x46, 0x46, 0, 1, 2, 3, 0xfe, 0xff]);
    });
  });

  it('accepts a fully valid layer bundle with structural public IDs and sentinel-like binary bytes', async () => {
    await withRelease(async (release) => {
      await writeFile(release.imagePath, Buffer.from('RIFF\0claim-private-layer\0\xff', 'latin1'));
      await rebindManifest(release.root);
      await expect(scanReaderReleaseLayers(release.root)).resolves.toBeUndefined();
    });
  });

  it.each([
    '05-xishan-site-context.svg',
    '09-pilot-sites-map.svg',
  ])('accepts the exact immutable approved SVG bytes for %s', async (fixtureName) => {
    await withRelease(async (release) => {
      const bytes = await readFile(join(
        process.cwd(),
        'tests/fixtures/book-release/approved',
        fixtureName,
      ));
      await replaceSyntheticReleaseImage(release, fixtureName, bytes);
      await expect(scanReaderReleaseLayers(release.root)).resolves.toBeUndefined();
    });
  });

  it.each([
    ['script', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ['external href', '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/pixel"/></svg>'],
    ['private path', '<svg xmlns="http://www.w3.org/2000/svg"><text>/Users/reader/private.md</text></svg>'],
    ['external paint URL', '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://evil.example/pixel)"/></svg>'],
    ['safe but unapproved synthetic bytes', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'],
  ] as const)('rejects fully rebound generated SVG %s independently of manifest digests', async (_label, svg) => {
    await withRelease(async (release) => {
      await replaceSyntheticReleaseImage(release, 'site-context.svg', Buffer.from(svg));
      await expect(scanReaderReleaseLayers(release.root))
        .rejects.toThrow(/SVG|approved|allowlist|immutable|digest/iu);
    });
  });

  it('rejects an unapproved SVG copied into the built static image scope', async () => {
    await withRelease(async (release) => {
      const approved = await readFile(join(
        process.cwd(),
        'tests/fixtures/book-release/approved/05-xishan-site-context.svg',
      ));
      await replaceSyntheticReleaseImage(release, 'copied.svg', approved);
      await writePayload(
        release.root,
        'dist/images/book-release/copied.svg',
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      );
      await expect(scanReaderReleaseLayers(release.root))
        .rejects.toThrow(/SVG|approved|allowlist|immutable|digest/iu);
    });
  });

  it('accepts an exact approved SVG copied into the built static image scope', async () => {
    await withRelease(async (release) => {
      const bytes = await readFile(join(
        process.cwd(),
        'tests/fixtures/book-release/approved/05-xishan-site-context.svg',
      ));
      await replaceSyntheticReleaseImage(release, 'copied.svg', bytes);
      await writePayload(release.root, 'dist/images/book-release/copied.svg', bytes);
      await expect(scanReaderReleaseLayers(release.root)).resolves.toBeUndefined();
    });
  });

  it('keeps copied WebP bytes opaque even when they resemble a private text sentinel', async () => {
    await withRelease(async (release) => {
      const bytes = Buffer.from('RIFF\0claim-private-layer\0\xff', 'latin1');
      await writeFile(release.imagePath, bytes);
      await rebindManifest(release.root);
      await writePayload(
        release.root,
        'dist/images/book-release/jade-suit.webp',
        bytes,
      );
      await expect(scanReaderReleaseLayers(release.root)).resolves.toBeUndefined();
    });
  });

  it('rejects an extra opaque WebP without a same-name generated source', async () => {
    await withRelease(async (release) => {
      await writePayload(release.root, 'dist/images/book-release/extra.webp', Buffer.from('RIFF'));
      await expect(scanReaderReleaseLayers(release.root))
        .rejects.toThrow(/same-name|copy|image|extra|source/iu);
    });
  });

  it('rejects a tampered same-name opaque WebP copy', async () => {
    await withRelease(async (release) => {
      const bytes = await readFile(release.imagePath);
      bytes[bytes.byteLength - 1] ^= 1;
      await writePayload(release.root, 'dist/images/book-release/jade-suit.webp', bytes);
      await expect(scanReaderReleaseLayers(release.root))
        .rejects.toThrow(/same-name|exact|copy|image|bytes/iu);
    });
  });

  it.each([
    ['HTML', 'copied.html', '<script>alert(1)</script>'],
    ['JavaScript', 'copied.js', 'alert(1)'],
    ['opaque extension', 'copied.bin', 'opaque'],
    ['uppercase WebP extension', 'copied.WEBP', 'RIFF'],
    ['uppercase SVG extension', 'copied.SVG', '<svg xmlns="http://www.w3.org/2000/svg"/>'],
  ])('rejects an unexpected %s file in the built static image scope', async (_label, name, bytes) => {
    await withRelease(async (release) => {
      await writePayload(release.root, `dist/images/book-release/${name}`, bytes);
      await expect(scanReaderReleaseLayers(release.root))
        .rejects.toThrow(/image|extension|unexpected|static|format/iu);
    });
  });

  it.each([
    ['in-place file mutation', async (release: SyntheticRelease) => {
      return async () => writeFile(release.notePaths.prologue, '{}\n');
    }],
    ['file addition', async (release: SyntheticRelease) => {
      return async () => writePayload(release.root, 'src/content/book-release/notes/note-added.json', '{}\n');
    }],
    ['file removal', async (release: SyntheticRelease) => {
      return async () => unlink(release.notePaths.prologue);
    }],
    ['generated root swap', async (release: SyntheticRelease) => {
      const contentRoot = join(release.root, 'src/content/book-release');
      const replacement = join(release.root, '.scanner-fixtures/replacement-content');
      await mkdir(replacement, { recursive: true });
      await writeFile(join(replacement, 'manifest.json'), '{}\n');
      return async () => {
        await rename(contentRoot, join(release.root, '.scanner-fixtures/original-content'));
        await rename(replacement, contentRoot);
      };
    }],
    ['atomic file replacement', async (release: SyntheticRelease) => {
      const replacement = join(release.root, '.scanner-fixtures/replacement-note.json');
      await mkdir(dirname(replacement), { recursive: true });
      await writeFile(replacement, '{}\n');
      return async () => rename(replacement, release.notePaths.prologue);
    }],
    ['collection directory swap', async (release: SyntheticRelease) => {
      const notesRoot = join(release.root, 'src/content/book-release/notes');
      const replacement = join(release.root, '.scanner-fixtures/replacement-notes');
      await mkdir(replacement, { recursive: true });
      await writeFile(join(replacement, 'note-replacement.json'), '{}\n');
      return async () => {
        await rename(notesRoot, join(release.root, '.scanner-fixtures/original-notes'));
        await rename(replacement, notesRoot);
      };
    }],
  ] as const)('rejects a generated release %s after validated load completes', async (_label, prepare) => {
    await withRelease(async (release) => {
      const trigger = 'dist/book/zzzz-after-load.html';
      await writePayload(release.root, trigger, '<main>Jade</main>');
      const mutate = await prepare(release);
      let mutated = false;
      await expect(scanReaderReleaseLayers(release.root, {
        afterEntryScan: async (relativePath) => {
          if (!mutated && relativePath === trigger) {
            mutated = true;
            await mutate();
          }
        },
      })).rejects.toThrow(/snapshot|tree|identity|metadata|changed|missing|extra/iu);
      expect(mutated).toBe(true);
    });
  });

  it.each([
    ['in-place mutation restored to exact bytes', async (release: SyntheticRelease) => {
      const original = await readFile(release.notePaths.prologue);
      return async () => {
        await writeFile(release.notePaths.prologue, '{}\n');
        await writeFile(release.notePaths.prologue, original);
      };
    }],
    ['atomic file swap restored to the original inode', async (release: SyntheticRelease) => {
      const target = release.notePaths.prologue;
      const saved = join(release.root, '.scanner-fixtures/saved-note.json');
      const replacement = join(release.root, '.scanner-fixtures/replacement-note.json');
      await mkdir(dirname(saved), { recursive: true });
      await writeFile(replacement, '{}\n');
      return async () => {
        await rename(target, saved);
        await rename(replacement, target);
        await rename(target, replacement);
        await rename(saved, target);
      };
    }],
    ['file add then remove', async (release: SyntheticRelease) => {
      const added = join(release.root, 'src/content/book-release/notes/note-transient.json');
      return async () => {
        await writeFile(added, '{}\n');
        await unlink(added);
      };
    }],
    ['content root swap then restore', async (release: SyntheticRelease) => {
      const target = join(release.root, 'src/content/book-release');
      const saved = join(release.root, '.scanner-fixtures/saved-content');
      const replacement = join(release.root, '.scanner-fixtures/replacement-content');
      await mkdir(replacement, { recursive: true });
      return async () => {
        await rename(target, saved);
        await rename(replacement, target);
        await rename(target, replacement);
        await rename(saved, target);
      };
    }],
    ['collection directory swap then restore', async (release: SyntheticRelease) => {
      const target = join(release.root, 'src/content/book-release/notes');
      const saved = join(release.root, '.scanner-fixtures/saved-notes');
      const replacement = join(release.root, '.scanner-fixtures/replacement-notes');
      await mkdir(replacement, { recursive: true });
      return async () => {
        await rename(target, saved);
        await rename(replacement, target);
        await rename(target, replacement);
        await rename(saved, target);
      };
    }],
    ['public image root swap then restore', async (release: SyntheticRelease) => {
      const target = join(release.root, 'public/images/book-release');
      const saved = join(release.root, '.scanner-fixtures/saved-images');
      const replacement = join(release.root, '.scanner-fixtures/replacement-images');
      await mkdir(replacement, { recursive: true });
      return async () => {
        await rename(target, saved);
        await rename(replacement, target);
        await rename(target, replacement);
        await rename(saved, target);
      };
    }],
  ] as const)('rejects transient generated release %s after validated load', async (_label, prepare) => {
    await withRelease(async (release) => {
      const trigger = 'dist/book/zzzz-after-load.html';
      await writePayload(release.root, trigger, '<main>Jade</main>');
      const mutateAndRestore = await prepare(release);
      let mutated = false;
      await expect(scanReaderReleaseLayers(release.root, {
        afterEntryScan: async (relativePath) => {
          if (!mutated && relativePath === trigger) {
            mutated = true;
            await mutateAndRestore();
          }
        },
      })).rejects.toThrow(/snapshot|tree|identity|metadata|changed|topology/iu);
      expect(mutated).toBe(true);
    });
  });

  it.each([
    ['built reader add then remove', async (release: SyntheticRelease) => {
      await writePayload(release.root, 'dist/book/index.html', '<main>Jade</main>');
      const transient = join(release.root, 'dist/book/transient.html');
      return async () => {
        await writeFile(transient, '<main>Transient</main>');
        await unlink(transient);
      };
    }],
    ['built reader root swap then restore', async (release: SyntheticRelease) => {
      const target = join(release.root, 'dist/book');
      const saved = join(release.root, '.scanner-fixtures/saved-dist-book');
      const replacement = join(release.root, '.scanner-fixtures/replacement-dist-book');
      await writePayload(release.root, 'dist/book/index.html', '<main>Jade</main>');
      await mkdir(replacement, { recursive: true });
      return async () => {
        await rename(target, saved);
        await rename(replacement, target);
        await rename(target, replacement);
        await rename(saved, target);
      };
    }],
    ['built image add then remove', async (release: SyntheticRelease) => {
      const transient = join(release.root, 'dist/images/book-release/transient.webp');
      return async () => {
        await mkdir(dirname(transient), { recursive: true });
        await writeFile(transient, 'RIFF');
        await unlink(transient);
        await rm(join(release.root, 'dist'), { recursive: true });
      };
    }],
    ['built image root swap then restore', async (release: SyntheticRelease) => {
      const target = join(release.root, 'dist/images/book-release');
      const saved = join(release.root, '.scanner-fixtures/saved-dist-images');
      const replacement = join(release.root, '.scanner-fixtures/replacement-dist-images');
      await writePayload(
        release.root,
        'dist/images/book-release/jade-suit.webp',
        await readFile(release.imagePath),
      );
      await mkdir(replacement, { recursive: true });
      return async () => {
        await rename(target, saved);
        await rename(replacement, target);
        await rename(target, replacement);
        await rename(saved, target);
      };
    }],
  ] as const)('rejects transient %s after validated load', async (_label, prepare) => {
    await withRelease(async (release) => {
      const trigger = 'src/content/book-release/entries/chapter-04.md';
      const mutateAndRestore = await prepare(release);
      let mutated = false;
      await expect(scanReaderReleaseLayers(release.root, {
        afterEntryScan: async (relativePath) => {
          if (!mutated && relativePath === trigger) {
            mutated = true;
            await mutateAndRestore();
          }
        },
      })).rejects.toThrow(/snapshot|tree|identity|metadata|changed|topology/iu);
      expect(mutated).toBe(true);
    });
  });

  it('rejects a fully rebound entry carrying a private sentinel only in raw frontmatter bytes', async () => {
    await withRelease(async (release) => {
      const raw = await readFile(release.entryPaths.prologue, 'utf8');
      await writeFile(
        release.entryPaths.prologue,
        raw.replace('---\n', '---\n# research/claims/private.json\n'),
      );
      await rebindManifest(release.root);
      await expect(scanReaderReleaseLayers(release.root))
        .rejects.toThrow(/frontmatter|JSON|private|sentinel|path/iu);
    });
  });

  it('rejects a private sentinel planted in strict-loaded generated prose', async () => {
    await withRelease(async (release) => {
      const raw = await readFile(release.entryPaths.prologue, 'utf8');
      await writeFile(release.entryPaths.prologue, `${raw}\nclaim-private-layer\n`);
      await rebindManifest(release.root);
      await expect(scanReaderReleaseLayers(release.root)).rejects.toThrow(/private|sentinel|prose/iu);
    });
  });

  it('uses byte integrity rather than text scanning for a planted binary mutation', async () => {
    await withRelease(async (release) => {
      await writeFile(release.imagePath, Buffer.from('claim-private-layer', 'utf8'));
      await expect(scanReaderReleaseLayers(release.root)).rejects.toThrow(/SHA|digest|byte length/iu);
    });
  });

  it('keeps a project without generated roots buildable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-empty-'));
    try {
      await expect(loadValidatedReaderRelease(root)).resolves.toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects orphan payload when the manifest is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-orphan-'));
    try {
      await writePayload(root, 'src/content/book-release/notes/note-orphan.json', '{}\n');
      await expect(loadValidatedReaderRelease(root)).rejects.toThrow(/manifest|orphan/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['Markdown', async (release: SyntheticRelease) => {
      const bytes = await readFile(release.entryPaths.chapter);
      bytes[bytes.byteLength - 2] ^= 1;
      await writeFile(release.entryPaths.chapter, bytes);
    }],
    ['image', async (release: SyntheticRelease) => {
      const bytes = await readFile(release.imagePath);
      bytes[5] ^= 1;
      await writeFile(release.imagePath, bytes);
    }],
  ] as const)('rejects a one-byte %s mutation', async (_kind, mutate) => {
    await withRelease(async (release) => {
      await mutate(release);
      await expect(loadValidatedReaderRelease(release.root)).rejects.toThrow(/sha|digest|byte/iu);
    });
  });

  it.each([
    ['file order', (manifest: JsonObject) => {
      const files = manifest.files as Array<JsonObject>;
      [files[0], files[1]] = [files[1]!, files[0]!];
    }],
    ['release ID SHA', (manifest: JsonObject) => { manifest.releaseId = `living-jade-reader-v1-${'4'.repeat(40)}`; }],
    ['payload digest', (manifest: JsonObject) => {
      manifest.readerPayloadDigest = '4'.repeat(64);
      ((manifest.reviewAttestation as JsonObject).reviewedPayload as JsonObject).digest = '4'.repeat(64);
    }],
    ['release digest', (manifest: JsonObject) => {
      ((manifest.reviewAttestation as JsonObject).contentBinding as JsonObject).digest = '4'.repeat(64);
    }],
    ['target identity', (manifest: JsonObject) => {
      (manifest.reviewAttestation as JsonObject).targetCommit = '4'.repeat(40);
    }],
    ['evidence identity', (manifest: JsonObject) => {
      (manifest.reviewAttestation as JsonObject).reviewEvidenceCommit = '4'.repeat(40);
    }],
    ['cycle identity', (manifest: JsonObject) => {
      (manifest.reviewAttestation as JsonObject).cycleId = 'cycle-03';
    }],
    ['path normalization', (manifest: JsonObject) => {
      ((manifest.files as Array<JsonObject>)[0]!).path = 'public/images/book-release/../jade-suit.webp';
    }],
    ['file kind', (manifest: JsonObject) => {
      ((manifest.files as Array<JsonObject>)[0]!).kind = 'text';
    }],
    ['byte length', (manifest: JsonObject) => {
      ((manifest.files as Array<JsonObject>)[0]!).byteLength = 999;
    }],
    ['file SHA', (manifest: JsonObject) => {
      ((manifest.files as Array<JsonObject>)[0]!).sha256 = '4'.repeat(64);
    }],
  ] as const)('rejects a mutated %s contract', async (_label, mutate) => {
    await withRelease(async (release) => {
      const manifest = await readManifest(release.root);
      mutate(manifest);
      await writeFile(release.manifestPath, stableJson(manifest));
      await expect(loadValidatedReaderRelease(release.root)).rejects.toThrow();
    });
  });

  it('rejects an extra payload file not named by the manifest', async () => {
    await withRelease(async (release) => {
      await writePayload(release.root, 'src/content/book-release/notes/note-extra.json', stableJson(notes.prologue));
      await expect(loadValidatedReaderRelease(release.root)).rejects.toThrow(/extra|bijection|manifest/iu);
    });
  });

  it('rejects a missing payload file named by the manifest', async () => {
    await withRelease(async (release) => {
      await unlink(release.notePaths.prologue);
      await expect(loadValidatedReaderRelease(release.root)).rejects.toThrow(/missing|manifest|ENOENT/iu);
    });
  });

  it('rejects a symlink payload even when its bytes match', async () => {
    await withRelease(async (release) => {
      const target = join(release.root, 'safe-copy.json');
      await writeFile(target, await readFile(release.notePaths.prologue));
      await unlink(release.notePaths.prologue);
      await symlink(target, release.notePaths.prologue);
      await expect(loadValidatedReaderRelease(release.root)).rejects.toThrow(/link|regular/iu);
    });
  });

  it('rejects a multi-link payload file', async () => {
    await withRelease(async (release) => {
      await link(release.notePaths.prologue, join(release.root, 'second-hard-link.json'));
      await expect(loadValidatedReaderRelease(release.root)).rejects.toThrow(/link|regular/iu);
    });
  });

  it('rejects a sparse payload above the per-file bound before starting its read', async () => {
    await withRelease(async (release) => {
      const oversizedBytes = (64 * 1024 * 1024) + 1;
      await truncate(release.imagePath, oversizedBytes);
      const manifest = await readManifest(release.root);
      const descriptor = (manifest.files as Array<JsonObject>)
        .find((file) => file.path === 'public/images/book-release/jade-suit.webp')!;
      descriptor.byteLength = oversizedBytes;
      let oversizedReadStarted = false;
      await expect(verifyReaderReleaseIntegrity(release.root, manifest as never, {
        onFileReadStarted: (path) => {
          if (path === descriptor.path) oversizedReadStarted = true;
        },
      })).rejects.toThrow(/size|bound|large|maximum/iu);
      expect(oversizedReadStarted).toBe(false);
    });
  });

  it('rejects an oversized sparse manifest before JSON parsing', async () => {
    await withRelease(async (release) => {
      await truncate(release.manifestPath, (64 * 1024 * 1024) + 1);
      await expect(loadValidatedReaderRelease(release.root))
        .rejects.toThrow(/manifest.*size|size.*manifest|bound|large|maximum/iu);
    });
  });

  it('rejects an aggregate sparse payload above the byte budget before reading payload files', async () => {
    await withRelease(async (release) => {
      const manifest = await readManifest(release.root);
      const descriptors = manifest.files as Array<JsonObject>;
      for (let index = 0; index < 5; index += 1) {
        const path = `public/images/book-release/aggregate-${index}.webp`;
        const absolutePath = join(release.root, path);
        await writePayload(release.root, path, new Uint8Array());
        await truncate(absolutePath, 64 * 1024 * 1024);
        descriptors.push({
          path,
          kind: 'binary',
          byteLength: 64 * 1024 * 1024,
          sha256: '0'.repeat(64),
        });
      }
      descriptors.sort((left, right) => compareCodeUnits(left.path as string, right.path as string));
      let payloadReadStarted = false;
      await expect(verifyReaderReleaseIntegrity(release.root, manifest as never, {
        onFileReadStarted: (path) => {
          if (path !== 'src/content/book-release/manifest.json') payloadReadStarted = true;
        },
      })).rejects.toThrow(/aggregate|total|size|bound|budget/iu);
      expect(payloadReadStarted).toBe(false);
    });
  });

  it('rejects an over-count manifest before traversing or reading descriptor payloads', async () => {
    await withRelease(async (release) => {
      const manifest = await readManifest(release.root);
      const entryDescriptor = (manifest.files as Array<JsonObject>)
        .find((file) => file.path === 'src/content/book-release/entries/chapter-04.md')!;
      manifest.files = [
        entryDescriptor,
        ...Array.from({ length: 10_000 }, (_, index) => ({
          path: `src/content/book-release/notes/note-limit-${String(index).padStart(5, '0')}.json`,
          kind: 'text',
          byteLength: 1,
          sha256: '0'.repeat(64),
        })),
      ];
      let payloadReadStarted = false;
      await expect(verifyReaderReleaseIntegrity(release.root, manifest as never, {
        onFileReadStarted: (path) => {
          if (path !== 'src/content/book-release/manifest.json') payloadReadStarted = true;
        },
      })).rejects.toThrow(/descriptor count|file count|too many|maximum entries/iu);
      expect(payloadReadStarted).toBe(false);
    });
  });

  it('rejects an over-count generated topology made only of empty directories', async () => {
    await withRelease(async (release) => {
      const emptyRoot = join(release.root, 'src/content/book-release/empty-topology');
      await mkdir(emptyRoot, { recursive: true });
      for (let offset = 0; offset < 10_001; offset += 250) {
        await Promise.all(Array.from({ length: Math.min(250, 10_001 - offset) }, (_, index) =>
          mkdir(join(emptyRoot, `dir-${String(offset + index).padStart(5, '0')}`))));
      }
      await expect(loadValidatedReaderRelease(release.root))
        .rejects.toThrow(/topology|entry count|too many|maximum/iu);
    });
  }, 30_000);

  it('rejects a non-regular descriptor target', async () => {
    await withRelease(async (release) => {
      await unlink(release.imagePath);
      await mkdir(release.imagePath);
      await expect(loadValidatedReaderRelease(release.root)).rejects.toThrow(/regular|file|directory/iu);
    });
  });

  it('rejects a generated-root directory symlink before reading through it', async () => {
    await withRelease(async (release) => {
      const contentRoot = join(release.root, 'src/content/book-release');
      const movedRoot = join(release.root, 'moved-private-release');
      await rename(contentRoot, movedRoot);
      await symlink(movedRoot, contentRoot);
      await expect(loadValidatedReaderRelease(release.root)).rejects.toThrow(/symbolic link|regular/iu);
    });
  });

  it('rejects a public image-root directory symlink before reading through it', async () => {
    await withRelease(async (release) => {
      const imageRoot = join(release.root, 'public/images/book-release');
      const movedRoot = join(release.root, 'moved-private-images');
      await rename(imageRoot, movedRoot);
      await symlink(movedRoot, imageRoot);
      await expect(loadValidatedReaderRelease(release.root)).rejects.toThrow(/symbolic link|regular/iu);
    });
  });

  it('rejects invalid UTF-8 in the unframed manifest before JSON/schema parsing', async () => {
    await withRelease(async (release) => {
      const bytes = await readFile(release.manifestPath);
      const cycle = Buffer.from('cycle-02');
      const offset = bytes.indexOf(cycle);
      expect(offset).toBeGreaterThan(-1);
      bytes[offset + 2] = 0xff;
      await writeFile(release.manifestPath, bytes);
      await expect(loadValidatedReaderRelease(release.root)).rejects.toThrow(/UTF-8|encoding/iu);
    });
  });

  it('rejects an escaped-equivalent duplicate manifest key with a hidden forbidden first value', async () => {
    await withRelease(async (release) => {
      await injectHiddenDuplicateJsonValue(
        release.manifestPath,
        'projection',
        'reader-v1',
        'private-v1',
        String.raw`\u0070rojection`,
      );
      await expect(loadValidatedReaderRelease(release.root)).rejects.toThrow(/duplicate|JSON|key/iu);
    });
  });

  it.each([
    [
      'note',
      'src/content/book-release/notes/note-prologue.json',
      'confidence',
      'high',
      'private',
      String.raw`\u0063onfidence`,
      '  ',
    ],
    [
      'source',
      'src/content/book-release/sources/source-museum.json',
      'url',
      'https://museum.example/objects/jade',
      'file:///Users/reader/private.md',
      String.raw`\u0075rl`,
      '  ',
    ],
    [
      'object nested inventory',
      'src/content/book-release/objects/object-jade-suit.json',
      'status',
      'published',
      'private',
      String.raw`\u0073tatus`,
      '    ',
    ],
    [
      'media',
      'src/content/book-release/media/media-jade-suit.json',
      'sourceUrl',
      'https://museum.example/images/jade-suit',
      'javascript:alert(1)',
      String.raw`\u0073ourceUrl`,
      '  ',
    ],
  ] as const)('rejects a fully rebound %s record with a hidden duplicate key', async (
    _label,
    relativePath,
    key,
    safeValue,
    hiddenValue,
    escapedKey,
    indentation,
  ) => {
    await withRelease(async (release) => {
      await injectHiddenDuplicateJsonValue(
        join(release.root, relativePath),
        key,
        safeValue,
        hiddenValue,
        escapedKey,
        indentation,
      );
      await rebindManifest(release.root);
      await expect(loadValidatedReaderRelease(release.root)).rejects.toThrow(/duplicate|JSON|key/iu);
    });
  });

  it('rejects mutation of an early file while a later 32 MiB file read is in flight', async () => {
    await withRelease(async (release) => {
      const latePath = 'public/images/book-release/zzzz-race.webp';
      const lateAbsolutePath = join(release.root, latePath);
      await writePayload(release.root, latePath, new Uint8Array());
      await truncate(lateAbsolutePath, 32 * 1024 * 1024);
      const manifestJson = await rebindManifest(release.root, (manifest) => {
        (manifest.files as Array<JsonObject>).push({
          path: latePath,
          kind: 'binary',
          byteLength: 0,
          sha256: '0'.repeat(64),
        });
        (manifest.files as Array<JsonObject>).sort((left, right) =>
          compareCodeUnits(left.path as string, right.path as string));
      });
      const manifest = readerReleaseManifestSchema.parse(manifestJson);
      let mutatedDuringLaterRead = false;

      const verification = verifyReaderReleaseIntegrity(release.root, manifest, {
        onFileReadStarted: async (path: string) => {
          if (path !== latePath) return;
          const earlyBytes = await readFile(release.imagePath);
          earlyBytes[0] ^= 1;
          await writeFile(release.imagePath, earlyBytes);
          mutatedDuringLaterRead = true;
        },
      }).then(() => undefined);
      await expect(verification).rejects.toThrow(/changed|identity|integrity/iu);
      expect(mutatedDuringLaterRead).toBe(true);
    });
  }, 30_000);
});

describe('reader release relationship contract', () => {
  it.each([
    ['missing note edge', async (release: SyntheticRelease) => {
      const raw = await readFile(release.entryPaths.prologue, 'utf8');
      await writeFile(release.entryPaths.prologue, raw.replace('"note-prologue"', '"note-missing"'));
    }],
    ['missing source edge', async (release: SyntheticRelease) => {
      const note = JSON.parse(await readFile(release.notePaths.chapter, 'utf8')) as JsonObject;
      note.sourceIds = ['source-missing'];
      await writeFile(release.notePaths.chapter, stableJson(note));
    }],
    ['missing object edge', async (release: SyntheticRelease) => {
      const raw = await readFile(release.entryPaths.chapter, 'utf8');
      await writeFile(release.entryPaths.chapter, raw.replace('"object-jade-suit"', '"object-missing"'));
    }],
    ['missing media edge', async (release: SyntheticRelease) => {
      const raw = await readFile(release.entryPaths.chapter, 'utf8');
      await writeFile(release.entryPaths.chapter, raw.replace('"media-jade-suit"', '"media-missing"'));
    }],
  ] as const)('rejects a %s', async (_label, mutate) => {
    await withRelease(async (release) => {
      await mutate(release);
      await rebindManifest(release.root);
      await expect(loadValidatedReaderRelease(release.root)).rejects.toThrow(/missing|reference|edge/iu);
    });
  });

  it('rejects duplicate public anchors', async () => {
    await withRelease(async (release) => {
      const note = JSON.parse(await readFile(release.notePaths.interlude, 'utf8')) as JsonObject;
      note.anchor = 'note-prologue';
      await writeFile(release.notePaths.interlude, stableJson(note));
      await rebindManifest(release.root);
      await expect(loadValidatedReaderRelease(release.root)).rejects.toThrow(/duplicate.*anchor|anchor.*unique/iu);
    });
  });

  it('rejects an altered interlude return relation', async () => {
    await withRelease(async (release) => {
      const raw = await readFile(release.entryPaths.chapter, 'utf8');
      await writeFile(release.entryPaths.chapter, raw.replace(
        '/book/read/chapter-04/#after-jade-immortality',
        '/book/read/prologue/#after-jade-immortality',
      ));
      await rebindManifest(release.root);
      await expect(loadValidatedReaderRelease(release.root)).rejects.toThrow(/return|interlude|reading sequence/iu);
    });
  });

  it('rejects a duplicate interlude portal marker', async () => {
    await withRelease(async (release) => {
      const raw = await readFile(release.entryPaths.chapter, 'utf8');
      const marker = '[Перейти к интерлюдии](/book/read/jade-immortality/#portal-jade-immortality)';
      await writeFile(release.entryPaths.chapter, `${raw}\n${marker}\n`);
      await rebindManifest(release.root);
      await expect(loadValidatedReaderRelease(release.root)).rejects.toThrow(/portal|exactly once|interlude/iu);
    });
  });

  it('does not accept an interlude marker hidden inside inline code', async () => {
    await withRelease(async (release) => {
      const raw = await readFile(release.entryPaths.chapter, 'utf8');
      const marker = '[Перейти к интерлюдии](/book/read/jade-immortality/#portal-jade-immortality)';
      await writeFile(release.entryPaths.chapter, raw.replace(marker, `\`${marker}\``));
      await rebindManifest(release.root);
      await expect(loadValidatedReaderRelease(release.root)).rejects.toThrow(/portal|interlude|link/iu);
    });
  });

  it('does not accept an interlude return marker hidden inside inline code', async () => {
    await withRelease(async (release) => {
      const raw = await readFile(release.entryPaths.chapter, 'utf8');
      const marker = '[Вернуться к главе](/book/read/chapter-04/#after-jade-immortality)';
      await writeFile(release.entryPaths.chapter, raw.replace(marker, `\`${marker}\``));
      await rebindManifest(release.root);
      await expect(loadValidatedReaderRelease(release.root)).rejects.toThrow(/return|interlude|link/iu);
    });
  });

  it.each([
    ['note', 'prologue', '[1](#note-prologue)'],
    ['object', 'chapter', '[Паспорт предмета](/book/objects/jade-suit/)'],
    ['media', 'chapter', '[Изображение](/book/media/jade-suit/)'],
  ] as const)('does not accept a declared %s relation hidden inside inline code', async (_label, entry, marker) => {
    await withRelease(async (release) => {
      const entryPath = release.entryPaths[entry];
      const raw = await readFile(entryPath, 'utf8');
      await writeFile(entryPath, raw.replace(marker, `\`${marker}\``));
      await rebindManifest(release.root);
      await expect(loadValidatedReaderRelease(release.root)).rejects.toThrow(/note|object|media|marker|link/iu);
    });
  });

  it('requires every declared object and media edge to have an exact structural marker', async () => {
    await withRelease(async (release) => {
      const raw = await readFile(release.entryPaths.chapter, 'utf8');
      await writeFile(release.entryPaths.chapter, raw.replace(
        '[Паспорт предмета](/book/objects/jade-suit/) · ',
        '',
      ));
      await rebindManifest(release.root);
      await expect(loadValidatedReaderRelease(release.root)).rejects.toThrow(/object|marker|link/iu);
    });
  });

  it('rejects an undeclared media marker in reader Markdown', async () => {
    await withRelease(async (release) => {
      const raw = await readFile(release.entryPaths.prologue, 'utf8');
      await writeFile(release.entryPaths.prologue, `${raw}\n[Лишнее изображение](/book/media/extra-image/)\n`);
      await rebindManifest(release.root);
      await expect(loadValidatedReaderRelease(release.root)).rejects.toThrow(/media|undeclared|marker/iu);
    });
  });

  it('rejects a dangling unknown note marker', async () => {
    await withRelease(async (release) => {
      const raw = await readFile(release.entryPaths.prologue, 'utf8');
      await writeFile(release.entryPaths.prologue, `${raw}\n[Лишняя сноска](#note-dangling)\n`);
      await rebindManifest(release.root);
      await expect(loadValidatedReaderRelease(release.root)).rejects.toThrow(/note|dangling|undeclared|marker/iu);
    });
  });

  it('rejects any extra reader route outside the exact portal/return relation', async () => {
    await withRelease(async (release) => {
      const raw = await readFile(release.entryPaths.prologue, 'utf8');
      await writeFile(release.entryPaths.prologue, `${raw}\n[Лишний переход](/book/read/extra-chapter/)\n`);
      await rebindManifest(release.root);
      await expect(loadValidatedReaderRelease(release.root)).rejects.toThrow(/read|route|portal|return|undeclared/iu);
    });
  });

  it.each([
    ['encoded note hyphen', '#note%2Dmissing'],
    ['encoded note name', '#%6eote-missing'],
    ['encoded book root', '/%62ook/read/extra-chapter/'],
    ['encoded read segment', '/book/%72ead/extra-chapter/'],
    ['encoded object segment', '/book/%6fbjects/extra-object/'],
    ['encoded media segment', '/book/%6dedia/extra-media/'],
  ])('rejects a structural relation alias with %s', async (_label, destination) => {
    await withRelease(async (release) => {
      const raw = await readFile(release.entryPaths.prologue, 'utf8');
      await writeFile(release.entryPaths.prologue, `${raw}\n[Лишняя связь](${destination})\n`);
      await rebindManifest(release.root);
      const validation = loadValidatedReaderRelease(release.root).then(() => undefined);
      await expect(validation).rejects.toThrow(/note|object|media|read|route|relation|marker|undeclared|dangling/iu);
    });
  });

  it('rejects a changed three-entry reading order even with a fresh release digest', async () => {
    await withRelease(async (release) => {
      await rebindManifest(release.root, (manifest) => {
        manifest.readingOrder = ['chapter-04', 'prologue', 'interlude-jade-immortality'];
      });
      await expect(loadValidatedReaderRelease(release.root)).rejects.toThrow(/reading order|entry order/iu);
    });
  });

  it('rejects stale readingMinutes after a content-preserving rebind', async () => {
    await withRelease(async (release) => {
      const raw = await readFile(release.entryPaths.prologue, 'utf8');
      await writeFile(release.entryPaths.prologue, raw.replace('"readingMinutes": 1', '"readingMinutes": 2'));
      await rebindManifest(release.root);
      await expect(loadValidatedReaderRelease(release.root)).rejects.toThrow(/reading minutes/iu);
    });
  });
});
