import { lstat, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve, sep } from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import {
  computeReadingMinutes,
  publicAnchorSchema,
} from './schemas';
import type { LoadedReaderRelease } from './load';

type MarkdownNode = {
  type?: string;
  value?: unknown;
  url?: unknown;
  title?: unknown;
  lang?: unknown;
  meta?: unknown;
  children?: unknown;
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
};

type ReaderProseSnapshot = {
  notes?: readonly {
    readonly statement: string;
    readonly limitation: string;
  }[];
  sources?: readonly {
    readonly authors: readonly string[];
    readonly title: string;
    readonly publisher: string;
    readonly locators: readonly string[];
    readonly containerTitle?: string;
  }[];
  objects?: readonly {
    readonly title: string;
    readonly culture: string;
    readonly date: string;
    readonly material: string;
    readonly materialQualification: string;
    readonly materialAttribution: string;
    readonly collection: string;
    readonly provenanceBoundary: string;
    readonly credits: readonly string[];
    readonly inventory: {
      readonly status: string;
      readonly number?: string;
      readonly statement?: string;
    };
  }[];
  media?: readonly {
    readonly kind: string;
    readonly alt: string;
    readonly caption: string;
    readonly credit: string;
    readonly license: string;
    readonly author?: string;
    readonly changeNote?: string;
    readonly nondocumentaryDisclosure?: string;
  }[];
};

const prefixNames = ['cl' + 'aim', 'obj' + 'ect', 'me' + 'dia', 'sou' + 'rce', 'inter' + 'lude'];
const privateIdPattern = new RegExp(
  `(?:^|[^A-Za-z0-9_])(?:${prefixNames.join('|')})-[a-z0-9-]+(?=$|[^A-Za-z0-9_])`,
  'iu',
);
const allowedMarkdownNodes = new Set([
  'root',
  'heading',
  'paragraph',
  'text',
  'emphasis',
  'strong',
  'list',
  'listItem',
  'blockquote',
  'thematicBreak',
  'code',
  'inlineCode',
  'link',
  'break',
]);
const privateRepositoryPattern = new RegExp(
  `(?:^|[^a-z0-9_%-])agent-axiom/${'yu' + '-book'}(?:\\.git)?(?=$|[^a-z0-9._%-])`,
  'iu',
);
const externalHttpsTokenPattern = /https:\/\/[^\s<>{}\[\]"'`()]+/giu;
const percentRunPattern = /(?:%[0-9a-f]{2})+/giu;
const securityEntityPattern = /&(?:#(?:x[0-9a-f]+|[0-9]+)|sol|bsol|num|percnt|colon|period|hyphen|minus|lowbar|commat);/giu;
const namedSecurityEntities: Readonly<Record<string, string>> = {
  colon: ':',
  sol: '/',
  bsol: '\\',
  period: '.',
  hyphen: '-',
  minus: '-',
  num: '#',
  percnt: '%',
  lowbar: '_',
  commat: '@',
};

function decodeSecurityEntities(value: string): string {
  return value.replace(securityEntityPattern, (entity) => {
    const body = entity.slice(1, -1).toLowerCase();
    const codePoint = body.startsWith('#x')
      ? Number.parseInt(body.slice(2), 16)
      : body.startsWith('#') ? Number.parseInt(body.slice(1), 10) : null;
    if (codePoint !== null) {
      if (!Number.isSafeInteger(codePoint)
        || codePoint < 0
        || codePoint > 0x10ffff
        || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        throw new Error(`reader text contains an invalid canonical entity code point: ${entity}`);
      }
      return String.fromCodePoint(codePoint);
    }
    return namedSecurityEntities[body] ?? entity;
  });
}

function decodePercentRuns(value: string): string {
  return value.replace(percentRunPattern, (run) => {
    const bytes = new Uint8Array(run.length / 3);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Number.parseInt(run.slice(index * 3 + 1, index * 3 + 3), 16);
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Error(`reader text contains invalid canonical percent encoding: ${run}`);
    }
  });
}

function canonicalSecurityValue(value: string): string {
  let current = value.normalize('NFKC');
  for (let depth = 0; depth < 8; depth += 1) {
    const next = decodeSecurityEntities(decodePercentRuns(current)).normalize('NFKC');
    if (next === current) return next;
    current = next;
  }
  if (/(?:%[0-9a-f]{2})|&(?:#|sol;|bsol;|num;|percnt;|colon;|period;|hyphen;|minus;|lowbar;|commat;)/iu.test(current)) {
    throw new Error('reader text contains excessive nested canonical encoding');
  }
  return current;
}

function canonicalizeRepositoryScanValue(value: string, normalizeBackslashes = true): string {
  const resolved: string[] = [];
  const slashed = normalizeBackslashes ? value.replace(/\\/gu, '/') : value;
  for (const segment of slashed.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      const previous = resolved.at(-1);
      if (previous && previous !== '..') resolved.pop();
      else resolved.push(segment);
      continue;
    }
    resolved.push(segment);
  }
  return resolved.join('/');
}

function externalUrlQueryAndFragmentScan(value: string): string {
  return value.replace(externalHttpsTokenPattern, (token) => {
    try {
      const url = new URL(token);
      return url.protocol === 'https:' ? ` ${url.search}${url.hash} ` : token;
    } catch {
      return token;
    }
  });
}

function hasPrivatePath(value: string, normalizeBackslashes = true): boolean {
  const pathValue = normalizeBackslashes ? value.replace(/\\/gu, '/') : value;
  const slashed = externalUrlQueryAndFragmentScan(pathValue);
  const privateRoots = ['rig' + 'hts', 'manu' + 'script', 'resea' + 'rch', 'edito' + 'rial'].join('|');
  if (new RegExp(`(?:^|[^a-z0-9._-])(?:${privateRoots})/`, 'iu').test(slashed)) return true;
  if (/(?:^|[^a-z0-9._-])\/(?:Users|home|private)\//iu.test(slashed)) return true;
  if (/(?:^|[^a-z0-9._-])(?:[a-z]:\/|~\/)/iu.test(slashed)) return true;
  if (/(?:^|[^a-z0-9._:-])\/\/[^/\s]+\//iu.test(slashed)) return true;
  return false;
}

function privateSentinel(value: string): string | null {
  const canonical = canonicalSecurityValue(value);
  if (privateRepositoryPattern.test(canonicalizeRepositoryScanValue(canonical))) {
    return 'private repository coordinate';
  }
  if (privateIdPattern.test(canonical)) return 'private-prefixed identifier';
  if (hasPrivatePath(canonical)) return 'private repository path';
  return null;
}

function runtimeSourceSentinel(value: string): string | null {
  if (privateRepositoryPattern.test(canonicalizeRepositoryScanValue(value, false))) {
    return 'private repository coordinate';
  }
  if (privateIdPattern.test(value)) return 'private-prefixed identifier';
  if (hasPrivatePath(value, false)) return 'private repository path';
  return null;
}

function assertNoPrivateSentinel(value: string, label: string): void {
  const problem = privateSentinel(value);
  if (problem) throw new Error(`${label} contains a private sentinel (${problem})`);
}

function safeNeutralSlug(value: string): boolean {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)) return false;
  return !prefixNames.some((prefix) => value.startsWith(`${prefix}-`));
}

function assertSafeReaderUrl(input: string): void {
  if (!input
    || /[\u0000-\u001f\u007f-\u009f\s]/u.test(input)
    || input.includes('\\')
    || /%(?![0-9a-f]{2})/iu.test(input)) {
    throw new Error(`unsafe reader URL controls or whitespace: ${input}`);
  }
  const value = canonicalSecurityValue(input);
  if (/[\u0000-\u001f\u007f-\u009f\s]/u.test(value) || value.includes('\\')) {
    throw new Error(`unsafe decoded reader URL controls or whitespace: ${input}`);
  }
  assertNoPrivateSentinel(value, 'reader URL');
  if (value.startsWith('#')) {
    if (!publicAnchorSchema.safeParse(value.slice(1)).success) {
      throw new Error(`unsafe reader anchor URL: ${input}`);
    }
    return;
  }
  if (value === '/book/' || /^\/book\/(?:prologue|virtue-immortality|jade-immortality|sources)\/$/u.test(value)) {
    return;
  }
  if (value.startsWith('/book/')) {
    if (value.includes('?') || value.includes('..') || value.includes('//')) {
      throw new Error(`unsafe internal reader route: ${input}`);
    }
    const match = /^\/book\/(?:objects|media|read)\/([a-z0-9-]+)\/(?:#([a-z][a-z0-9]*(?:-[a-z0-9]+)*))?$/u.exec(value);
    if (!match?.[1] || !safeNeutralSlug(match[1])) {
      throw new Error(`unsafe internal reader route: ${input}`);
    }
    return;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`unsafe reader URL: ${input}`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || value.startsWith('//')) {
    throw new Error(`unsafe reader URL scheme or credentials: ${input}`);
  }
}

function visitMarkdown(node: unknown, visitor: (node: MarkdownNode) => void): void {
  if (typeof node !== 'object' || node === null) return;
  const markdownNode = node as MarkdownNode;
  visitor(markdownNode);
  if (Array.isArray(markdownNode.children)) {
    for (const child of markdownNode.children) visitMarkdown(child, visitor);
  }
}

function renderedInlineText(node: MarkdownNode): string {
  if ((node.type === 'text' || node.type === 'inlineCode') && typeof node.value === 'string') {
    return node.value;
  }
  if (node.type === 'break') return '\n';
  if (Array.isArray(node.children)) {
    return node.children.map((child) =>
      typeof child === 'object' && child !== null ? renderedInlineText(child as MarkdownNode) : '').join('');
  }
  return '';
}

type InlineCodeSpan = { start: number; end: number };

function sourceText(node: MarkdownNode, source: string): string {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return typeof start === 'number' && typeof end === 'number'
    ? source.slice(start, end)
    : typeof node.value === 'string' ? node.value : '';
}

function markedControlText(
  node: MarkdownNode,
  source: string,
  startMarker = '',
  endMarker = '',
): string {
  if (node.type === 'text') return sourceText(node, source);
  if (node.type === 'inlineCode' && typeof node.value === 'string') {
    return `${startMarker}${node.value}${endMarker}`;
  }
  if (node.type === 'break') return '\n';
  if (Array.isArray(node.children)) {
    return node.children.map((child) =>
      typeof child === 'object' && child !== null
        ? markedControlText(child as MarkdownNode, source, startMarker, endMarker)
        : '').join('');
  }
  return '';
}

function controlTextAndCodeSpans(
  node: MarkdownNode,
  source: string,
): { text: string; unmarkedText: string; spans: InlineCodeSpan[] } {
  const unmarkedText = canonicalSecurityValue(markedControlText(node, source));
  const markers: string[] = [];
  for (let codePoint = 0xe000; codePoint <= 0xf8ff && markers.length < 2; codePoint += 1) {
    const marker = String.fromCodePoint(codePoint);
    if (!unmarkedText.includes(marker)) markers.push(marker);
  }
  if (markers.length !== 2) throw new Error('reader directive scan marker space exhausted');
  const [startMarker, endMarker] = markers as [string, string];
  const marked = canonicalSecurityValue(markedControlText(node, source, startMarker, endMarker));
  const text: string[] = [];
  const spans: InlineCodeSpan[] = [];
  let start: number | null = null;
  for (const character of marked) {
    if (character === startMarker) {
      if (start !== null) throw new Error('nested reader inline-code marker');
      start = text.length;
    } else if (character === endMarker) {
      if (start === null) throw new Error('unmatched reader inline-code marker');
      spans.push({ start, end: text.length });
      start = null;
    } else {
      text.push(character);
    }
  }
  if (start !== null) throw new Error('unterminated reader inline-code marker');
  return { text: text.join(''), unmarkedText, spans };
}

type DirectiveMatch = { syntax: string; start: number; end: number };

function directiveMatches(value: string): DirectiveMatch[] {
  const matches: DirectiveMatch[] = [];
  for (const match of value.matchAll(/::[a-z][a-z0-9-]*\{[^{}\r\n]*\}/giu)) {
    const start = match.index ?? 0;
    const preceding = start > 0 ? value[start - 1] : undefined;
    if (preceding === '\\' || preceding === ':') continue;
    const syntax = match[0];
    matches.push({ syntax, start, end: start + syntax.length });
  }
  return matches;
}

function sameDirectiveMultiset(first: readonly DirectiveMatch[], second: readonly DirectiveMatch[]): boolean {
  const counts = new Map<string, number>();
  for (const match of first) {
    const key = match.syntax.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const match of second) {
    const key = match.syntax.toLowerCase();
    const count = counts.get(key) ?? 0;
    if (count === 0) return false;
    if (count === 1) counts.delete(key);
    else counts.set(key, count - 1);
  }
  return counts.size === 0;
}

function hasResidualDirectiveOutsideCode(node: MarkdownNode, source: string): boolean {
  const { text, unmarkedText, spans } = controlTextAndCodeSpans(node, source);
  const markedMatches = directiveMatches(text);
  for (const match of markedMatches) {
    if (!spans.some((span) => span.start <= match.start && match.end <= span.end)) return true;
  }
  return !sameDirectiveMultiset(directiveMatches(unmarkedText), markedMatches);
}

export function readerMarkdownLinks(markdown: string): string[] {
  const links: string[] = [];
  visitMarkdown(fromMarkdown(markdown), (node) => {
    if (node.type === 'link' && typeof node.url === 'string') links.push(node.url);
  });
  return links;
}

export function assertReaderMarkdownSafe(markdown: string): void {
  assertNoPrivateSentinel(markdown, 'reader Markdown');
  const tree = fromMarkdown(markdown);
  visitMarkdown(tree, (node) => {
    if (!node.type || !allowedMarkdownNodes.has(node.type)) {
      throw new Error(`unsupported reader Markdown node: ${node.type ?? 'unknown'}`);
    }
    if (node.type === 'html') throw new Error('raw HTML and HTML comments are forbidden in reader Markdown');
    if (node.type === 'image' || node.type === 'imageReference') {
      throw new Error('Markdown images are forbidden in reader Markdown');
    }
    if (typeof node.url === 'string') assertSafeReaderUrl(node.url);
    if (typeof node.title === 'string') assertNoPrivateSentinel(node.title, 'reader link title');
    if ((node.type === 'paragraph' || node.type === 'heading')) {
      assertNoPrivateSentinel(renderedInlineText(node), 'rendered reader prose');
    }
    if ((node.type === 'paragraph' || node.type === 'heading') && hasResidualDirectiveOutsideCode(node, markdown)) {
      throw new Error('residual Markdown directives are forbidden outside code');
    }
    if (node.type === 'code') {
      if (typeof node.value === 'string') assertNoPrivateSentinel(node.value, 'reader code');
      if (typeof node.lang === 'string') assertNoPrivateSentinel(node.lang, 'reader code language');
      if (typeof node.meta === 'string') assertNoPrivateSentinel(node.meta, 'reader code metadata');
    }
  });
}

function proseValues(snapshot: ReaderProseSnapshot): string[] {
  const values: string[] = [];
  for (const note of snapshot.notes ?? []) {
    values.push(note.statement, note.limitation);
  }
  for (const source of snapshot.sources ?? []) {
    values.push(...source.authors, source.title, source.publisher, ...source.locators);
    if (source.containerTitle) values.push(source.containerTitle);
  }
  for (const object of snapshot.objects ?? []) {
    values.push(
      object.title,
      object.culture,
      object.date,
      object.material,
      object.materialQualification,
      object.materialAttribution,
      object.collection,
      object.provenanceBoundary,
      ...object.credits,
    );
    if (object.inventory.status === 'published' && object.inventory.number) values.push(object.inventory.number);
    if (object.inventory.status !== 'published' && object.inventory.statement) values.push(object.inventory.statement);
  }
  for (const media of snapshot.media ?? []) {
    values.push(media.alt, media.caption, media.credit, media.license);
    if (media.kind === 'authored-diagram' && media.author && media.changeNote) {
      values.push(media.author, media.changeNote);
    }
    if (media.kind === 'generative' && media.nondocumentaryDisclosure) {
      values.push(media.nondocumentaryDisclosure);
    }
  }
  return values;
}

export function assertReaderProseFieldsSafe(snapshot: ReaderProseSnapshot): void {
  for (const value of proseValues(snapshot)) assertNoPrivateSentinel(value, 'reader prose field');
}

function uniqueRecordMap<T extends { id: string }>(records: readonly T[], label: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const record of records) {
    if (map.has(record.id)) throw new Error(`duplicate ${label} ID: ${record.id}`);
    map.set(record.id, record);
  }
  return map;
}

function requireEdge<T>(map: ReadonlyMap<string, T>, id: string, label: string): void {
  if (!map.has(id)) throw new Error(`missing ${label} graph reference: ${id}`);
}

function requireExactClosure<T extends { id: string }>(
  records: readonly T[],
  referenced: ReadonlySet<string>,
  label: string,
): void {
  const orphan = records.find((record) => !referenced.has(record.id));
  if (orphan) throw new Error(`unreferenced ${label} record is outside the reader closure: ${orphan.id}`);
}

export function validateReaderReleaseGraph(release: LoadedReaderRelease): void {
  const notes = uniqueRecordMap(release.notes, 'note');
  const sources = uniqueRecordMap(release.sources, 'source');
  const objects = uniqueRecordMap(release.objects, 'object');
  const media = uniqueRecordMap(release.media, 'media');
  const referencedNotes = new Set<string>();
  const referencedObjects = new Set<string>();
  const referencedMedia = new Set<string>();
  const referencedSources = new Set<string>();
  const anchors = new Set<string>();
  const noteByAnchor = new Map(release.notes.map((note) => [note.anchor, note]));

  for (const note of release.notes) {
    if (anchors.has(note.anchor)) throw new Error(`duplicate reader anchor: ${note.anchor}`);
    anchors.add(note.anchor);
  }
  for (const entry of release.entries) {
    if (!entry.data.readingSequence) continue;
    for (const anchor of [entry.data.readingSequence.portalAnchor, entry.data.readingSequence.returnAnchor]) {
      if (anchors.has(anchor)) throw new Error(`duplicate reader anchor: ${anchor}`);
      anchors.add(anchor);
    }
  }

  for (const entry of release.entries) {
    if (entry.data.readingMinutes !== computeReadingMinutes(entry.body)) {
      throw new Error(`reading minutes do not match projected Markdown for ${entry.data.id}`);
    }
    assertReaderMarkdownSafe(entry.body);
    const links = readerMarkdownLinks(entry.body);
    assertNoPrivateSentinel(entry.data.title, 'entry title');
    assertNoPrivateSentinel(entry.data.subtitle, 'entry subtitle');
    for (const id of entry.data.noteIds) {
      requireEdge(notes, id, 'note');
      referencedNotes.add(id);
      const anchor = notes.get(id)!.anchor;
      if (links.filter((url) => url === `#${anchor}`).length !== 1) {
        throw new Error(`${entry.data.id} is missing its declared note anchor link: ${anchor}`);
      }
    }
    for (const id of entry.data.objectIds) {
      requireEdge(objects, id, 'object');
      referencedObjects.add(id);
    }
    for (const id of entry.data.mediaIds) {
      requireEdge(media, id, 'media');
      referencedMedia.add(id);
    }
    for (const url of links) {
      if (!url.startsWith('#')) continue;
      const linkedNote = noteByAnchor.get(url.slice(1));
      if (linkedNote && !entry.data.noteIds.includes(linkedNote.id)) {
        throw new Error(`${entry.data.id} contains an undeclared note marker: ${linkedNote.id}`);
      }
    }

    const expectedObjectRoutes = new Set(entry.data.objectIds.map((id) =>
      `/book/objects/${id.slice('object-'.length)}/`));
    const expectedMediaRoutes = new Set(entry.data.mediaIds.map((id) =>
      `/book/media/${id.slice('media-'.length)}/`));
    for (const route of expectedObjectRoutes) {
      if (links.filter((url) => url === route).length !== 1) {
        throw new Error(`${entry.data.id} is missing its declared object marker link: ${route}`);
      }
    }
    for (const route of expectedMediaRoutes) {
      if (links.filter((url) => url === route).length !== 1) {
        throw new Error(`${entry.data.id} is missing its declared media marker link: ${route}`);
      }
    }
    for (const url of links) {
      if (url.startsWith('/book/objects/') && !expectedObjectRoutes.has(url)) {
        throw new Error(`${entry.data.id} contains an undeclared object marker: ${url}`);
      }
      if (url.startsWith('/book/media/') && !expectedMediaRoutes.has(url)) {
        throw new Error(`${entry.data.id} contains an undeclared media marker: ${url}`);
      }
    }
  }

  for (const note of release.notes) {
    for (const id of note.sourceIds) {
      requireEdge(sources, id, 'source');
      referencedSources.add(id);
    }
  }
  for (const object of release.objects) {
    for (const id of object.sourceIds) {
      requireEdge(sources, id, 'source');
      referencedSources.add(id);
    }
    for (const id of object.mediaIds) {
      requireEdge(media, id, 'media');
      referencedMedia.add(id);
    }
  }

  requireExactClosure(release.notes, referencedNotes, 'note');
  requireExactClosure(release.objects, referencedObjects, 'object');
  requireExactClosure(release.media, referencedMedia, 'media');
  requireExactClosure(release.sources, referencedSources, 'source');

  const imagePaths = new Set(release.files
    .filter((file) => file.path.startsWith('public/images/book-release/'))
    .map((file) => file.path));
  const declaredImages = new Set(release.media.map((item) => `public/images/book-release/${item.outputName}`));
  for (const path of declaredImages) {
    if (!imagePaths.has(path)) throw new Error(`missing image graph reference: ${path}`);
  }
  for (const path of imagePaths) {
    if (!declaredImages.has(path)) throw new Error(`unreferenced image is outside the reader closure: ${path}`);
  }
  assertReaderProseFieldsSafe(release);
}

const scanRoots = [
  'src/layouts',
  'src/pages/book',
  'src/components/book',
  'src/lib/book-release',
  'src/styles/book.css',
  'src/content/book-release',
  'public/images/book-release',
  'dist/book',
] as const;

function rootPath(input: string | URL): string {
  return resolve(input instanceof URL ? fileURLToPath(input) : input);
}

async function scanPath(projectRoot: string, path: string): Promise<void> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  const relativePath = relative(projectRoot, path).split(sep).join('/');
  if (metadata.isSymbolicLink()) throw new Error(`release-layer scan rejects symbolic link: ${relativePath}`);
  if (metadata.isDirectory()) {
    const names = await readdir(path);
    for (const name of names) await scanPath(projectRoot, join(path, name));
    return;
  }
  if (!metadata.isFile()) throw new Error(`release-layer scan requires regular files: ${relativePath}`);
  const contents = (await readFile(path)).toString('utf8');
  const isRuntimeSource = relativePath.startsWith('src/layouts/')
    || relativePath.startsWith('src/pages/book/')
    || relativePath.startsWith('src/components/book/')
    || relativePath.startsWith('src/lib/book-release/')
    || relativePath === 'src/styles/book.css';
  const sentinel = isRuntimeSource ? runtimeSourceSentinel(contents) : privateSentinel(contents);
  if (sentinel) throw new Error(`${relativePath} contains a forbidden private sentinel (${sentinel})`);
}

export async function scanReaderReleaseLayers(root: string | URL): Promise<void> {
  const projectRoot = rootPath(root);
  for (const path of scanRoots) await scanPath(projectRoot, join(projectRoot, ...path.split('/')));
}
