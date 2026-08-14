import { lstat, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, join, posix, resolve } from 'node:path';
import { parseFrontmatter } from 'astro/markdown';
import {
  readerEntrySchema,
  readerMediaSchema,
  readerNoteSchema,
  readerObjectSchema,
  readerReleaseManifestSchema,
  readerSourceSchema,
  validateReaderReleaseCollections,
  type ReaderEntry,
  type ReaderMedia,
  type ReaderNote,
  type ReaderObject,
  type ReaderReleaseManifest,
  type ReaderSource,
} from './schemas';
import {
  recheckVerifiedReaderRelease,
  verifyReaderReleaseIntegrity,
  type RawReaderReleaseFile,
} from './integrity';
import { buildReaderRouteIndex, type ReaderRouteIndex } from './routes';
import { parseStrictUtf8Json } from './strict-json';
import { validateReaderReleaseGraph } from './validate';

export type LoadedReaderEntry = {
  data: ReaderEntry;
  body: string;
  filePath: string;
};

export type LoadedReaderRelease = {
  manifest: ReaderReleaseManifest;
  entries: LoadedReaderEntry[];
  notes: ReaderNote[];
  sources: ReaderSource[];
  objects: ReaderObject[];
  media: ReaderMedia[];
  files: RawReaderReleaseFile[];
  routes: ReaderRouteIndex;
};

function rootPath(input: string | URL): string {
  return resolve(input instanceof URL ? fileURLToPath(input) : input);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function containsAnyEntry(path: string, ignoredName?: string): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name === ignoredName) continue;
    if (entry.isDirectory()) {
      if (await containsAnyEntry(join(path, entry.name))) return true;
    } else {
      return true;
    }
  }
  return false;
}

async function assertManifestIsRegular(path: string) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('reader release manifest must be a regular file');
  }
  if (metadata.nlink !== 1) throw new Error('reader release manifest must have exactly one hard link');
  return metadata;
}

async function readStableManifest(path: string): Promise<Buffer> {
  const before = await assertManifestIsRegular(path);
  const bytes = await readFile(path);
  const after = await assertManifestIsRegular(path);
  if (before.dev !== after.dev
    || before.ino !== after.ino
    || before.size !== after.size
    || before.mtimeMs !== after.mtimeMs
    || before.ctimeMs !== after.ctimeMs
    || bytes.byteLength !== after.size) {
    throw new Error('reader release manifest changed while it was being read');
  }
  return bytes;
}

function parseJson(bytes: Uint8Array, path: string): unknown {
  return parseStrictUtf8Json(bytes, `reader JSON in ${path}`);
}

function assertRecordFileId(path: string, id: string): void {
  const expected = basename(path, '.json');
  if (id !== expected) throw new Error(`${path} public ID must match its filename`);
}

function parseEntry(file: RawReaderReleaseFile): LoadedReaderEntry {
  const markdown = Buffer.from(file.bytes).toString('utf8');
  let parsed;
  try {
    parsed = parseFrontmatter(markdown);
  } catch (error) {
    throw new Error(`invalid reader frontmatter in ${file.path}`, { cause: error });
  }
  const data = readerEntrySchema.parse(parsed.frontmatter);
  const expectedId = posix.basename(file.path, '.md');
  if (data.id !== expectedId) throw new Error(`${file.path} public ID must match its filename`);
  return { data, body: parsed.content, filePath: file.path };
}

function parseRecords<T extends { id: string }>(
  files: readonly RawReaderReleaseFile[],
  rootPrefix: string,
  schema: { parse(value: unknown): T },
): T[] {
  return files.filter((file) => file.path.startsWith(rootPrefix)).map((file) => {
    const record = schema.parse(parseJson(file.bytes, file.path));
    assertRecordFileId(file.path, record.id);
    return record;
  });
}

export async function loadValidatedReaderRelease(root: string | URL): Promise<LoadedReaderRelease | null> {
  const projectRoot = rootPath(root);
  const contentRoot = join(projectRoot, 'src/content/book-release');
  const imageRoot = join(projectRoot, 'public/images/book-release');
  const manifestPath = join(contentRoot, 'manifest.json');
  if (!await pathExists(manifestPath)) {
    const orphanContent = await containsAnyEntry(contentRoot, 'manifest.json');
    const orphanImages = await containsAnyEntry(imageRoot);
    if (orphanContent || orphanImages) {
      throw new Error('orphan reader payload must not exist without a manifest');
    }
    return null;
  }

  const manifestBytes = await readStableManifest(manifestPath);
  const manifestJson = parseStrictUtf8Json(manifestBytes, 'reader release manifest');
  const manifest = readerReleaseManifestSchema.parse(manifestJson);
  const files = await verifyReaderReleaseIntegrity(projectRoot, manifest);
  const entries = files
    .filter((file) => file.path.startsWith('src/content/book-release/entries/'))
    .map(parseEntry);
  const notes = parseRecords(files, 'src/content/book-release/notes/', readerNoteSchema);
  const sources = parseRecords(files, 'src/content/book-release/sources/', readerSourceSchema);
  const objects = parseRecords(files, 'src/content/book-release/objects/', readerObjectSchema);
  const media = parseRecords(files, 'src/content/book-release/media/', readerMediaSchema);

  validateReaderReleaseCollections({
    manifest,
    entries: entries.map((entry) => ({ data: entry.data, projectedText: entry.body })),
    notes,
    sources,
    objects,
    media,
  });

  const routes = buildReaderRouteIndex(manifest, entries);
  const release: LoadedReaderRelease = {
    manifest,
    entries,
    notes,
    sources,
    objects,
    media,
    files,
    routes,
  };
  validateReaderReleaseGraph(release);
  const finalManifestBytes = await readStableManifest(manifestPath);
  if (!manifestBytes.equals(finalManifestBytes)) {
    throw new Error('reader release manifest changed during validation');
  }
  await recheckVerifiedReaderRelease(files);
  return release;
}
