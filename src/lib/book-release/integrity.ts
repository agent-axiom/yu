import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve, sep } from 'node:path';
import type {
  ReaderReleaseFileDescriptor,
  ReaderReleaseManifest,
} from './schemas';

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
  dev: number;
  ino: number;
  nlink: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
};

type IntegritySnapshot = {
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

async function assertRegularSingleLink(path: string, label: string) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`);
  }
  if (metadata.nlink !== 1) throw new Error(`${label} must have exactly one hard link`);
  return metadata;
}

function identityOf(
  path: string,
  kind: FilesystemIdentity['kind'],
  metadata: Stats,
): FilesystemIdentity {
  return {
    path,
    kind,
    dev: metadata.dev,
    ino: metadata.ino,
    nlink: metadata.nlink,
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
    ctimeMs: metadata.ctimeMs,
  };
}

function sameIdentity(left: FilesystemIdentity, right: FilesystemIdentity): boolean {
  return left.kind === right.kind
    && left.dev === right.dev
    && left.ino === right.ino
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function retainDirectoryIdentity(
  identities: Map<string, FilesystemIdentity>,
  path: string,
  metadata: Stats,
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
  const pendingRead = readFile(path);
  try {
    await observer?.onFileReadStarted?.(observerPath);
  } catch (error) {
    await pendingRead.catch(() => undefined);
    throw error;
  }
  const bytes = await pendingRead;
  const after = await assertRegularSingleLink(path, label);
  if (!sameIdentity(identityOf(path, 'file', before), identityOf(path, 'file', after))
    || bytes.byteLength !== after.size) {
    throw new Error(`${label} changed while its exact bytes were being read`);
  }
  return { bytes, identity: identityOf(path, 'file', after) };
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
      metadata = await lstat(current);
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
      metadata = await lstat(identity.path);
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

async function collectTreeFiles(
  projectRoot: string,
  directory: string,
  files: string[],
  directoryIdentities: Map<string, FilesystemIdentity>,
): Promise<void> {
  let directoryMetadata;
  try {
    directoryMetadata = await lstat(directory);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
    throw new Error(`reader release directory must not be a symbolic link: ${directory}`);
  }
  retainDirectoryIdentity(directoryIdentities, directory, directoryMetadata);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  entries.sort((left, right) => compareCodeUnits(left.name, right.name));
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) throw new Error(`reader release rejects symbolic link: ${absolutePath}`);
    if (metadata.isDirectory()) {
      await collectTreeFiles(projectRoot, absolutePath, files, directoryIdentities);
      continue;
    }
    if (!metadata.isFile()) throw new Error(`reader release requires regular files: ${absolutePath}`);
    if (metadata.nlink !== 1) throw new Error(`reader release rejects multi-link file: ${absolutePath}`);
    const relativePath = relative(projectRoot, absolutePath).split(sep).join('/');
    if (relativePath !== 'src/content/book-release/manifest.json') files.push(relativePath);
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
  await collectTreeFiles(
    projectRoot,
    join(projectRoot, 'src/content/book-release'),
    actualPaths,
    directoryIdentities,
  );
  await collectTreeFiles(
    projectRoot,
    join(projectRoot, 'public/images/book-release'),
    actualPaths,
    directoryIdentities,
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
}
