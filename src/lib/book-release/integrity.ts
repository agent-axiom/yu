import { createHash } from 'node:crypto';
import { constants as fileConstants, type BigIntStats } from 'node:fs';
import { lstat, open, opendir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve, sep } from 'node:path';
import type {
  ReaderReleaseFileDescriptor,
  ReaderReleaseManifest,
} from './schemas';
import {
  READER_RELEASE_MAX_FILES,
  READER_RELEASE_MAX_FILE_BYTES,
  READER_RELEASE_MAX_TOTAL_BYTES,
} from './schemas';
import { assertApprovedReaderSvgBytes } from './svg-policy';

const PAYLOAD_DOMAIN = 'yu-reader-payload-v1';
const RELEASE_DOMAIN = 'yu-reader-release-v1';
const utf8 = new TextEncoder();
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

export type RawReaderReleaseFile = {
  path: string;
  bytes: Uint8Array;
};

type FilesystemIdentity = {
  path: string;
  kind: 'file' | 'directory';
  dev: bigint;
  ino: bigint;
  mode: bigint;
  nlink: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
};

type IntegritySnapshot = {
  projectRoot: string;
  paths: readonly string[];
  files: readonly FilesystemIdentity[];
  directories: readonly FilesystemIdentity[];
};

export type ReaderReleaseIntegrityObserver = {
  onFileReadStarted?: (path: string) => void | Promise<void>;
};

const integritySnapshots = new WeakMap<RawReaderReleaseFile[], IntegritySnapshot>();

function compareCodeUnits(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

export function frameBytes(input: Uint8Array): Uint8Array {
  const bytes = Buffer.from(input);
  const header = Buffer.alloc(8);
  header.writeBigUInt64BE(BigInt(bytes.byteLength));
  return Buffer.concat([header, bytes]);
}

function canonicalPrimitive(value: null | boolean | number | string): string {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('canonical JSON rejects non-finite numbers');
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('value is not JSON serializable');
  return serialized;
}

function canonicalJson(
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return canonicalPrimitive(value);
  }
  if (typeof value !== 'object') {
    throw new TypeError(`canonical JSON rejects ${typeof value} values`);
  }
  if (ancestors.has(value)) throw new TypeError('canonical JSON rejects cycles');
  ancestors.add(value);
  try {
    const indentation = '  '.repeat(depth + 1);
    const closingIndentation = '  '.repeat(depth);
    if (Array.isArray(value)) {
      if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new TypeError('canonical JSON rejects symbol properties');
      }
      const ownKeys = Object.keys(value);
      if (ownKeys.length !== value.length || ownKeys.some((key, index) => key !== String(index))) {
        throw new TypeError('canonical JSON rejects sparse or extended arrays');
      }
      if (value.length === 0) return '[]';
      const items = value.map((item) => `${indentation}${canonicalJson(item, depth + 1, ancestors)}`);
      return `[\n${items.join(',\n')}\n${closingIndentation}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('canonical JSON requires plain objects');
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError('canonical JSON rejects symbol properties');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).sort(compareCodeUnits);
    if (keys.length === 0) return '{}';
    const properties = keys.map((key) => {
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('canonical JSON rejects hidden or accessor properties');
      }
      return `${indentation}${canonicalPrimitive(key)}: ${canonicalJson(descriptor.value, depth + 1, ancestors)}`;
    });
    return `{\n${properties.join(',\n')}\n${closingIndentation}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return utf8.encode(`${canonicalJson(value, 0, new WeakSet())}\n`);
}

function updateFramed(hash: ReturnType<typeof createHash>, bytes: Uint8Array): void {
  hash.update(frameBytes(bytes));
}

function requireOrderedUniqueFiles(files: readonly RawReaderReleaseFile[]): void {
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    if (index > 0 && compareCodeUnits(files[index - 1]!.path, file.path) >= 0) {
      throw new Error('reader payload paths must be unique and code-unit sorted');
    }
  }
}

export function computeReaderPayloadDigest(files: readonly RawReaderReleaseFile[]): string {
  requireOrderedUniqueFiles(files);
  const hash = createHash('sha256');
  hash.update(PAYLOAD_DOMAIN, 'utf8');
  for (const file of files) {
    updateFramed(hash, utf8.encode(file.path));
    updateFramed(hash, file.bytes);
  }
  return hash.digest('hex');
}

function manifestProjection(manifest: ReaderReleaseManifest): unknown {
  const { contentBinding: _contentBinding, ...reviewAttestation } = manifest.reviewAttestation;
  return { ...manifest, reviewAttestation };
}

export function computeReaderReleaseDigest(
  manifest: ReaderReleaseManifest,
  files: readonly RawReaderReleaseFile[],
): string {
  requireOrderedUniqueFiles(files);
  const hash = createHash('sha256');
  hash.update(RELEASE_DOMAIN, 'utf8');
  updateFramed(hash, canonicalJsonBytes(manifestProjection(manifest)));
  for (const file of files) {
    updateFramed(hash, utf8.encode(file.path));
    updateFramed(hash, file.bytes);
  }
  return hash.digest('hex');
}

function rootPath(input: string | URL): string {
  return resolve(input instanceof URL ? fileURLToPath(input) : input);
}

async function assertRegularSingleLink(path: string, label: string): Promise<BigIntStats> {
  const metadata = await lstat(path, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`);
  }
  if (metadata.nlink !== 1n) throw new Error(`${label} must have exactly one hard link`);
  if (metadata.size > BigInt(READER_RELEASE_MAX_FILE_BYTES)) {
    throw new Error(`${label} exceeds the bounded per-file size`);
  }
  return metadata;
}

function identityOf(
  path: string,
  kind: FilesystemIdentity['kind'],
  metadata: BigIntStats,
): FilesystemIdentity {
  return {
    path,
    kind,
    dev: metadata.dev,
    ino: metadata.ino,
    mode: metadata.mode,
    nlink: metadata.nlink,
    size: metadata.size,
    mtimeNs: metadata.mtimeNs,
    ctimeNs: metadata.ctimeNs,
  };
}

function sameIdentity(left: FilesystemIdentity, right: FilesystemIdentity): boolean {
  return left.kind === right.kind
    && left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function retainDirectoryIdentity(
  identities: Map<string, FilesystemIdentity>,
  path: string,
  metadata: BigIntStats,
): void {
  const identity = identityOf(path, 'directory', metadata);
  const retained = identities.get(path);
  if (retained && !sameIdentity(retained, identity)) {
    throw new Error(`reader release directory changed during traversal: ${path}`);
  }
  if (!retained) identities.set(path, identity);
}

async function readStableRegularFile(
  path: string,
  label: string,
  observerPath: string,
  observer?: ReaderReleaseIntegrityObserver,
): Promise<{ bytes: Buffer; identity: FilesystemIdentity }> {
  const before = await assertRegularSingleLink(path, label);
  const handle = await open(path, fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile()
      || opened.nlink !== 1n
      || !sameIdentity(identityOf(path, 'file', before), identityOf(path, 'file', opened))) {
      throw new Error(`${label} changed before its exact bytes were read`);
    }
    await observer?.onFileReadStarted?.(observerPath);
    const expectedByteLength = Number(opened.size);
    const bytes = Buffer.allocUnsafe(expectedByteLength);
    let offset = 0;
    while (offset < expectedByteLength) {
      const { bytesRead } = await handle.read(bytes, offset, expectedByteLength - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== expectedByteLength) {
      throw new Error(`${label} size changed while its exact bytes were read`);
    }
    const overflow = Buffer.allocUnsafe(1);
    const { bytesRead: overflowBytes } = await handle.read(overflow, 0, 1, expectedByteLength);
    if (overflowBytes !== 0) {
      throw new Error(`${label} size changed while its exact bytes were read`);
    }
    const verified = await handle.stat({ bigint: true });
    const current = await assertRegularSingleLink(path, label);
    if (!sameIdentity(identityOf(path, 'file', opened), identityOf(path, 'file', verified))
      || !sameIdentity(identityOf(path, 'file', opened), identityOf(path, 'file', current))
      || BigInt(bytes.byteLength) !== verified.size) {
      throw new Error(`${label} changed while its exact bytes were being read`);
    }
    return { bytes, identity: identityOf(path, 'file', verified) };
  } finally {
    await handle.close();
  }
}

export async function readBoundedReaderReleaseFile(path: string, label: string): Promise<Buffer> {
  return (await readStableRegularFile(path, label, label)).bytes;
}

async function captureDirectoryChain(
  projectRoot: string,
  relativeDirectory: string,
  required: boolean,
  identities: Map<string, FilesystemIdentity>,
): Promise<void> {
  let current = projectRoot;
  const segments = relativeDirectory ? relativeDirectory.split('/') : [];
  for (let index = -1; index < segments.length; index += 1) {
    if (index >= 0) current = join(current, segments[index]!);
    let metadata;
    try {
      metadata = await lstat(current, { bigint: true });
    } catch (error) {
      if (!required && error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`reader release directory must not be a symbolic link: ${current}`);
    }
    retainDirectoryIdentity(identities, current, metadata);
  }
}

async function recheckIdentities(identities: readonly FilesystemIdentity[]): Promise<void> {
  for (const identity of identities) {
    let metadata;
    try {
      metadata = await lstat(identity.path, { bigint: true });
    } catch (error) {
      throw new Error(`reader release filesystem identity changed during validation: ${identity.path}`, { cause: error });
    }
    const expectedType = identity.kind === 'file' ? metadata.isFile() : metadata.isDirectory();
    if (!expectedType
      || metadata.isSymbolicLink()
      || !sameIdentity(identity, identityOf(identity.path, identity.kind, metadata))) {
      throw new Error(`reader release filesystem identity changed during validation: ${identity.path}`);
    }
  }
}

type IntegrityTreeBudget = {
  fileCount: number;
  topologyCount: number;
  totalBytes: bigint;
};

const readerReleaseCollectionDirectories = new Set([
  'entries',
  'notes',
  'sources',
  'objects',
  'media',
]);
const readerReleaseMaxTopologyEntries = READER_RELEASE_MAX_FILES + 16;

function retainTopologyBudget(budget: IntegrityTreeBudget, path: string): void {
  budget.topologyCount += 1;
  if (budget.topologyCount > readerReleaseMaxTopologyEntries) {
    throw new Error(`reader release exceeds the maximum topology entry count: ${path}`);
  }
}

function retainPayloadFileBudget(
  budget: IntegrityTreeBudget,
  metadata: BigIntStats,
  relativePath: string,
): void {
  if (metadata.size > BigInt(READER_RELEASE_MAX_FILE_BYTES)) {
    throw new Error(`reader release file exceeds the bounded per-file size: ${relativePath}`);
  }
  budget.fileCount += 1;
  if (budget.fileCount > READER_RELEASE_MAX_FILES) {
    throw new Error('reader release exceeds the maximum file count');
  }
  budget.totalBytes += metadata.size;
  if (budget.totalBytes > BigInt(READER_RELEASE_MAX_TOTAL_BYTES)) {
    throw new Error('reader release exceeds the aggregate byte budget');
  }
}

async function collectTreeFiles(
  projectRoot: string,
  directory: string,
  files: string[],
  directoryIdentities: Map<string, FilesystemIdentity>,
  budget: IntegrityTreeBudget,
): Promise<void> {
  let directoryMetadata;
  try {
    directoryMetadata = await lstat(directory, { bigint: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
    throw new Error(`reader release directory must not be a symbolic link: ${directory}`);
  }
  retainTopologyBudget(budget, directory);
  retainDirectoryIdentity(directoryIdentities, directory, directoryMetadata);
  let openedDirectory;
  try {
    openedDirectory = await opendir(directory);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  const relativeDirectory = relative(projectRoot, directory).split(sep).join('/');
  try {
    while (true) {
      const entry = await openedDirectory.read();
      if (!entry) break;
      const absolutePath = join(directory, entry.name);
      const metadata = await lstat(absolutePath, { bigint: true });
      if (metadata.isSymbolicLink()) throw new Error(`reader release rejects symbolic link: ${absolutePath}`);
      if (metadata.isDirectory()) {
        if (relativeDirectory !== 'src/content/book-release'
          || !readerReleaseCollectionDirectories.has(entry.name)) {
          throw new Error(`unexpected reader release topology directory: ${absolutePath}`);
        }
        await collectTreeFiles(projectRoot, absolutePath, files, directoryIdentities, budget);
        continue;
      }
      retainTopologyBudget(budget, absolutePath);
      if (!metadata.isFile()) throw new Error(`reader release requires regular files: ${absolutePath}`);
      if (metadata.nlink !== 1n) throw new Error(`reader release rejects multi-link file at ${absolutePath}`);
      const relativePath = relative(projectRoot, absolutePath).split(sep).join('/');
      if (relativePath !== 'src/content/book-release/manifest.json') {
        retainPayloadFileBudget(budget, metadata, relativePath);
        files.push(relativePath);
      }
    }
  } finally {
    await openedDirectory.close();
  }
  const verifiedDirectory = await lstat(directory, { bigint: true });
  if (!verifiedDirectory.isDirectory()
    || verifiedDirectory.isSymbolicLink()
    || !sameIdentity(
      identityOf(directory, 'directory', directoryMetadata),
      identityOf(directory, 'directory', verifiedDirectory),
    )) {
    throw new Error(`reader release directory changed during traversal: ${directory}`);
  }
}

function assertManifestResourceBounds(manifest: ReaderReleaseManifest): void {
  if (manifest.files.length > READER_RELEASE_MAX_FILES) {
    throw new Error('reader release exceeds the maximum descriptor count');
  }
  let totalBytes = 0n;
  for (const descriptor of manifest.files) {
    if (!Number.isSafeInteger(descriptor.byteLength) || descriptor.byteLength < 0) {
      throw new Error(`reader release descriptor has an invalid byte size: ${descriptor.path}`);
    }
    if (descriptor.byteLength > READER_RELEASE_MAX_FILE_BYTES) {
      throw new Error(`reader release descriptor exceeds the bounded per-file size: ${descriptor.path}`);
    }
    totalBytes += BigInt(descriptor.byteLength);
    if (totalBytes > BigInt(READER_RELEASE_MAX_TOTAL_BYTES)) {
      throw new Error('reader release descriptors exceed the aggregate byte budget');
    }
  }
}

function assertBijection(
  descriptors: readonly ReaderReleaseFileDescriptor[],
  actualPaths: readonly string[],
): void {
  const expectedPaths = descriptors.map((descriptor) => descriptor.path);
  if (expectedPaths.length !== actualPaths.length
    || expectedPaths.some((path, index) => path !== actualPaths[index])) {
    const expected = new Set(expectedPaths);
    const actual = new Set(actualPaths);
    const missing = expectedPaths.filter((path) => !actual.has(path));
    const extra = actualPaths.filter((path) => !expected.has(path));
    throw new Error(`reader manifest/filesystem bijection failed; missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}`);
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function verifyReaderReleaseIntegrity(
  root: string | URL,
  manifest: ReaderReleaseManifest,
  observer?: ReaderReleaseIntegrityObserver,
): Promise<RawReaderReleaseFile[]> {
  const projectRoot = rootPath(root);
  assertManifestResourceBounds(manifest);
  const manifestPath = join(projectRoot, 'src/content/book-release/manifest.json');
  const directoryIdentities = new Map<string, FilesystemIdentity>();
  await captureDirectoryChain(projectRoot, 'src/content/book-release', true, directoryIdentities);
  await captureDirectoryChain(projectRoot, 'public/images/book-release', false, directoryIdentities);
  const manifestRead = await readStableRegularFile(
    manifestPath,
    'reader release manifest',
    'src/content/book-release/manifest.json',
    observer,
  );

  const actualPaths: string[] = [];
  const treeBudget: IntegrityTreeBudget = { fileCount: 0, topologyCount: 0, totalBytes: 0n };
  await collectTreeFiles(
    projectRoot,
    join(projectRoot, 'src/content/book-release'),
    actualPaths,
    directoryIdentities,
    treeBudget,
  );
  await collectTreeFiles(
    projectRoot,
    join(projectRoot, 'public/images/book-release'),
    actualPaths,
    directoryIdentities,
    treeBudget,
  );
  actualPaths.sort(compareCodeUnits);
  assertBijection(manifest.files, actualPaths);

  const files: RawReaderReleaseFile[] = [];
  const fileIdentities: FilesystemIdentity[] = [manifestRead.identity];
  for (const descriptor of manifest.files) {
    const absolutePath = join(projectRoot, ...descriptor.path.split('/'));
    const pathFromRoot = relative(projectRoot, absolutePath);
    if (pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === '..') {
      throw new Error(`reader payload traversal is forbidden: ${descriptor.path}`);
    }
    const { bytes, identity } = await readStableRegularFile(
      absolutePath,
      descriptor.path,
      descriptor.path,
      observer,
    );
    if (descriptor.kind === 'text') {
      try {
        strictUtf8.decode(bytes);
      } catch {
        throw new Error(`${descriptor.path} is not valid UTF-8 text`);
      }
    }
    if (bytes.byteLength !== descriptor.byteLength) {
      throw new Error(`${descriptor.path} byte length does not match its descriptor`);
    }
    if (sha256(bytes) !== descriptor.sha256) {
      throw new Error(`${descriptor.path} SHA-256 does not match its descriptor`);
    }
    if (/\.svg$/iu.test(descriptor.path)) {
      assertApprovedReaderSvgBytes(bytes, descriptor.path);
    }
    files.push({ path: descriptor.path, bytes });
    fileIdentities.push(identity);
  }

  const payloadDigest = computeReaderPayloadDigest(files);
  if (payloadDigest !== manifest.readerPayloadDigest
    || payloadDigest !== manifest.reviewAttestation.reviewedPayload.digest) {
    throw new Error('reader payload digest does not match the reviewed payload identity');
  }
  const releaseDigest = computeReaderReleaseDigest(manifest, files);
  if (releaseDigest !== manifest.reviewAttestation.contentBinding.digest) {
    throw new Error('reader release content-binding digest does not match exact bytes');
  }
  const snapshot: IntegritySnapshot = {
    projectRoot,
    paths: actualPaths,
    files: fileIdentities,
    directories: [...directoryIdentities.values()],
  };
  integritySnapshots.set(files, snapshot);
  await recheckVerifiedReaderRelease(files);
  return files;
}

export async function recheckVerifiedReaderRelease(
  files: RawReaderReleaseFile[],
): Promise<void> {
  const snapshot = integritySnapshots.get(files);
  if (!snapshot) throw new Error('reader release files do not carry a retained integrity snapshot');
  await recheckIdentities(snapshot.files);
  await recheckIdentities(snapshot.directories);
  const currentPaths: string[] = [];
  const currentDirectories = new Map<string, FilesystemIdentity>();
  const currentBudget: IntegrityTreeBudget = { fileCount: 0, topologyCount: 0, totalBytes: 0n };
  await collectTreeFiles(
    snapshot.projectRoot,
    join(snapshot.projectRoot, 'src/content/book-release'),
    currentPaths,
    currentDirectories,
    currentBudget,
  );
  await collectTreeFiles(
    snapshot.projectRoot,
    join(snapshot.projectRoot, 'public/images/book-release'),
    currentPaths,
    currentDirectories,
    currentBudget,
  );
  currentPaths.sort(compareCodeUnits);
  if (currentPaths.length !== snapshot.paths.length
    || currentPaths.some((path, index) => path !== snapshot.paths[index])) {
    throw new Error('reader release filesystem topology changed during validation');
  }
  await recheckIdentities(snapshot.files);
  await recheckIdentities(snapshot.directories);
}
