import { constants as fileConstants } from 'node:fs';
import { lstat, open, opendir, type FileHandle } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve, sep } from 'node:path';
import { parse as parseAstro } from '@astrojs/compiler/sync';
import type { Node as AstroNode } from '@astrojs/compiler/types';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { directiveFromMarkdown } from 'mdast-util-directive';
import { directive } from 'micromark-extension-directive';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import {
  computeReadingMinutes,
  publicAnchorSchema,
  readerEntrySchema,
} from './schemas';
import { DuplicateJsonKeyError, parseStrictJsonText } from './strict-json';
import { assertApprovedReaderSvgBytes } from './svg-policy';
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
    readonly volume?: string;
    readonly issue?: string;
    readonly pages?: string;
    readonly doi?: string;
    readonly url?: string;
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
    readonly licenseUrl: string;
    readonly sourceUrl?: string;
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
const directiveNodeTypes = new Set(['textDirective', 'leafDirective', 'containerDirective']);
const markdownDirectiveOptions = {
  extensions: [directive()],
  mdastExtensions: [directiveFromMarkdown()],
};
const privateRepositoryOrganization = 'agent' + '-axiom';
const privateRepositoryName = 'yu' + '-book';
const externalHttpsTokenPattern = /https:\/\/[^\s<>{}\[\]"'`()]+/giu;
const rootedLocalPathCandidatePattern = /(?:[a-z]:[\\/]|~[\\/]|[\\/]{1,2})[^\s<>"'`()\[\]{}]+/giu;
const percentRunPattern = /(?:%[0-9a-f]{2})+/giu;
const securityEntityNames = 'sol|bsol|frasl|num|percnt|colon|period|hyphen|minus|lowbar|commat|tab|newline';
const numericSecurityEntity = '#(?:' + 'x[0-9a-f]+' + '|[0-9]+)';
const securityEntityPattern = new RegExp(`&(?:${numericSecurityEntity}|${securityEntityNames});`, 'giu');
const residualSecurityEncodingPattern = new RegExp(
  `(?:%[0-9a-f]{2})|&(?:${numericSecurityEntity}|${securityEntityNames});`,
  'iu',
);
const namedSecurityEntities: Readonly<Record<string, string>> = {
  colon: ':',
  sol: '/',
  bsol: '\\',
  frasl: '/',
  period: '.',
  hyphen: '-',
  minus: '-',
  num: '#',
  percnt: '%',
  lowbar: '_',
  commat: '@',
  tab: '\t',
  newline: '\n',
};

/** Reader text may contain structural TAB/LF/CR, but no other Cc or any Cf. */
const forbiddenUnicodeFormatControlPattern = /\p{Cf}/u;
const forbiddenUnicodeTextControlPattern = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]|\p{Cf}/u;
const securityHyphenPattern = /[\u2010\u2011\u2212]/gu;
const securitySlashPattern = /[\u2044\u2215]/gu;
const securityReverseSolidusPattern = /[\u2216\u27cd\u29f5\u29f9\ufe68\uff3c]/gu;

function assertNoForbiddenUnicodeControls(value: string, label: string, allowByteControls = false): void {
  const pattern = allowByteControls
    ? forbiddenUnicodeFormatControlPattern
    : forbiddenUnicodeTextControlPattern;
  if (pattern.test(value)) {
    throw new Error(`${label} contains a forbidden Unicode control, format or bidi character`);
  }
}

/**
 * Shared security skeleton. NFKC and confusable separator folding happen at
 * every canonical decode boundary so an entity or percent layer cannot reveal
 * a new path separator or control after an earlier check.
 */
function securitySkeleton(value: string, allowByteControls = false): string {
  const skeleton = value
    .normalize('NFKC')
    .replace(securityHyphenPattern, '-')
    .replace(securitySlashPattern, '/')
    .replace(securityReverseSolidusPattern, '\\');
  assertNoForbiddenUnicodeControls(skeleton, 'security text', allowByteControls);
  return skeleton;
}

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
  let current = securitySkeleton(value);
  for (let depth = 0; depth < 8; depth += 1) {
    const percentDecoded = securitySkeleton(decodePercentRuns(current));
    const entityDecoded = securitySkeleton(decodeSecurityEntities(percentDecoded));
    const next = securitySkeleton(entityDecoded);
    if (next === current) return next;
    current = next;
  }
  if (residualSecurityEncodingPattern.test(current)) {
    throw new Error('reader text contains excessive nested canonical encoding');
  }
  return current;
}

function canonicalizeMixedPathSegments(value: string): string {
  const resolved: string[] = [];
  const slashed = value.replace(/\\/gu, '/');
  const driveRoot = /^[a-z]:\//iu.exec(slashed)?.[0] ?? '';
  const root = slashed.startsWith('//') ? '//' : slashed.startsWith('/') ? '/' : driveRoot;
  const remainder = root ? slashed.slice(root.length) : slashed;
  for (const segment of remainder.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      const previous = resolved.at(-1);
      if (previous && previous !== '..') resolved.pop();
      else resolved.push(segment);
      continue;
    }
    resolved.push(segment);
  }
  return `${root}${resolved.join('/')}`;
}

function hasPrivateRepositoryCoordinate(value: string): boolean {
  const lowerValue = value.toLowerCase();
  let searchOffset = 0;
  while (searchOffset < value.length) {
    const start = lowerValue.indexOf(privateRepositoryOrganization, searchOffset);
    if (start < 0) return false;
    const previous = value[start - 1];
    if (previous && /[a-z0-9._-]/iu.test(previous)) {
      searchOffset = start + 1;
      continue;
    }
    let end = start + privateRepositoryOrganization.length;
    while (end < value.length && /[a-z0-9._/\\-]/iu.test(value[end]!)) end += 1;
    const normalized = canonicalizeMixedPathSegments(value.slice(start, end)).toLowerCase();
    const coordinate = `${privateRepositoryOrganization}/${privateRepositoryName}`;
    const suffix = normalized.slice(coordinate.length);
    if (normalized.startsWith(coordinate)
      && (suffix === '' || suffix.startsWith('/') || suffix.startsWith('.'))) {
      return true;
    }
    searchOffset = start + 1;
  }
  return false;
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

function hasPrivatePath(value: string): boolean {
  const pathText = externalUrlQueryAndFragmentScan(value);
  const scanValues = [
    canonicalizeMixedPathSegments(pathText),
    ...(pathText.match(rootedLocalPathCandidatePattern) ?? [])
      .map((candidate) => canonicalizeMixedPathSegments(candidate)),
  ];
  const privateRoots = ['rig' + 'hts', 'manu' + 'script', 'resea' + 'rch', 'edito' + 'rial'].join('|');
  const privateRootPattern = new RegExp(`(?:^|[^a-z0-9._-])(?:${privateRoots})/`, 'iu');
  return scanValues.some((slashed) =>
    privateRootPattern.test(slashed)
      || /(?:^|[^a-z0-9._-])\/(?:Users|home|private)\//iu.test(slashed)
      || /(?:^|[^a-z0-9._-])(?:[a-z]:\/|~\/)/iu.test(slashed)
      || /(?:^|[^a-z0-9._:-])\/\/[^/\s]+\//iu.test(slashed));
}

function privateSentinel(value: string): string | null {
  assertNoForbiddenUnicodeControls(value, 'reader text');
  const canonical = canonicalSecurityValue(value);
  assertNoForbiddenUnicodeControls(canonical, 'decoded reader text');
  if (hasPrivateRepositoryCoordinate(canonical)) {
    return 'private repository coordinate';
  }
  if (privateIdPattern.test(canonical)) return 'private-prefixed identifier';
  if (hasPrivatePath(canonical)) return 'private repository path';
  return null;
}

function runtimeSourceSentinel(
  value: string,
  directiveScanValue = value,
  scanDangerousExactText = true,
  scanPrivateExactText = true,
): string | null {
  if (forbiddenUnicodeTextControlPattern.test(value)) return 'Unicode control';
  const canonical = canonicalSecurityValue(value);
  if (forbiddenUnicodeTextControlPattern.test(canonical)) return 'decoded Unicode control';
  if (scanPrivateExactText && hasPrivateRepositoryCoordinate(canonical)) {
    return 'private repository coordinate';
  }
  if (scanPrivateExactText && hasPrivatePath(canonical)) return 'private repository path';
  if (exactArtifactDirectivePattern.test(canonicalSecurityValue(directiveScanValue))) return 'raw directive';
  if (scanDangerousExactText && hasDangerousSchemeInCanonicalText(canonical)) return 'dangerous URL scheme';
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

function assertSafeReaderUrl(input: string): string {
  assertNoForbiddenUnicodeControls(input, 'reader URL');
  if (!input
    || /[\u0000-\u001f\u007f-\u009f\s]/u.test(input)
    || input.includes('\\')
    || /%(?![0-9a-f]{2})/iu.test(input)) {
    throw new Error(`unsafe reader URL controls or whitespace: ${input}`);
  }
  const value = canonicalSecurityValue(input);
  assertNoForbiddenUnicodeControls(value, 'decoded reader URL');
  if (/[\u0000-\u001f\u007f-\u009f\s]/u.test(value) || value.includes('\\')) {
    throw new Error(`unsafe decoded reader URL controls or whitespace: ${input}`);
  }
  assertNoPrivateSentinel(value, 'reader URL');
  if (value.startsWith('#')) {
    if (!publicAnchorSchema.safeParse(value.slice(1)).success) {
      throw new Error(`unsafe reader anchor URL: ${input}`);
    }
    return value;
  }
  if (value === '/book/' || /^\/book\/(?:prologue|virtue-immortality|jade-immortality|sources)\/$/u.test(value)) {
    return value;
  }
  if (value.startsWith('/book/')) {
    if (value.includes('?') || value.includes('..') || value.includes('//')) {
      throw new Error(`unsafe internal reader route: ${input}`);
    }
    const match = /^\/book\/(?:objects|media|read)\/([a-z0-9-]+)\/(?:#([a-z][a-z0-9]*(?:-[a-z0-9]+)*))?$/u.exec(value);
    if (!match?.[1] || !safeNeutralSlug(match[1])) {
      throw new Error(`unsafe internal reader route: ${input}`);
    }
    return value;
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
  return value;
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

function directiveMatches(value: string, inlineCodeEnds: ReadonlySet<number> = new Set()): DirectiveMatch[] {
  const matches: DirectiveMatch[] = [];
  const pattern = /(:{3}|:{2}|:)([a-z][a-z0-9-]*)(\[[^\]\r\n]*\])?(\{[^{}\r\n]*\})?/giu;
  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0;
    const preceding = start > 0 ? value[start - 1] : undefined;
    if (preceding === '\\' || preceding === ':') continue;
    const colonCount = match[1]!.length;
    const hasLabel = match[3] !== undefined;
    const hasAttributes = match[4] !== undefined;
    const atLineStart = start === 0 || preceding === '\n' || preceding === '\r';
    if (colonCount === 1 && !hasLabel) continue;
    if (colonCount >= 2
      && !hasLabel
      && !hasAttributes
      && !atLineStart
      && !inlineCodeEnds.has(start)) continue;
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
  const codeEnds = new Set(spans.map((span) => span.end));
  const markedMatches = directiveMatches(text, codeEnds);
  for (const match of markedMatches) {
    if (!spans.some((span) => span.start <= match.start && match.end <= span.end)) return true;
  }
  return !sameDirectiveMultiset(directiveMatches(unmarkedText, codeEnds), markedMatches);
}

function parseReaderMarkdown(markdown: string) {
  return fromMarkdown(markdown, markdownDirectiveOptions);
}

export function readerMarkdownLinks(markdown: string): string[] {
  const links: string[] = [];
  visitMarkdown(parseReaderMarkdown(markdown), (node) => {
    if (node.type === 'link' && typeof node.url === 'string') links.push(assertSafeReaderUrl(node.url));
  });
  return links;
}

export function assertReaderMarkdownSafe(markdown: string): void {
  assertNoPrivateSentinel(markdown, 'reader Markdown');
  const tree = parseReaderMarkdown(markdown);
  visitMarkdown(tree, (node) => {
    if (node.type && directiveNodeTypes.has(node.type)) {
      const start = node.position?.start?.offset;
      if (typeof start === 'number' && markdown.slice(Math.max(0, start - 2), start) === '\\:') return;
      throw new Error('residual Markdown directives are forbidden outside code');
    }
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
    if (source.volume) values.push(source.volume);
    if (source.issue) values.push(source.issue);
    if (source.pages) values.push(source.pages);
    if (source.doi) values.push(source.doi);
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

function readerUrlValues(snapshot: ReaderProseSnapshot): string[] {
  const values: string[] = [];
  for (const source of snapshot.sources ?? []) {
    if (source.url) values.push(source.url);
  }
  for (const media of snapshot.media ?? []) {
    values.push(media.licenseUrl);
    if (media.sourceUrl) values.push(media.sourceUrl);
  }
  return values;
}

export function assertReaderProseFieldsSafe(snapshot: ReaderProseSnapshot): void {
  for (const value of proseValues(snapshot)) assertNoPrivateSentinel(value, 'reader prose field');
  for (const value of readerUrlValues(snapshot)) assertSafeReaderUrl(value);
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
      if (url.startsWith('#note-') && !linkedNote) {
        throw new Error(`${entry.data.id} contains a dangling note marker: ${url}`);
      }
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

const runtimeScanRoots = [
  'src/layouts',
  'src/pages/book',
  'src/components/book',
  'src/lib/book-release',
  'src/styles/book.css',
] as const;
const generatedReaderContentRoot = 'src/content/book-release';
const generatedReaderImageRoot = 'public/images/book-release';
const builtReaderRoot = 'dist/book';
const builtReaderImageRoot = 'dist/images/book-release';
const scriptLikeArtifactExtensionNames = [
  'cjs',
  'cts',
  'js',
  'jsx',
  'json',
  'map',
  'mjs',
  'mts',
  'ts',
  'tsx',
  'webmanifest',
] as const;
const scriptLikeArtifactExtensions = new RegExp(
  `\\.(?:${scriptLikeArtifactExtensionNames.join('|')})$`,
  'iu',
);
const builtTextExtensionNames = [
  ...scriptLikeArtifactExtensionNames,
  'css',
  'csv',
  'htm',
  'html',
  'md',
  'svg',
  'txt',
  'xml',
] as const;
const builtTextExtensions = new RegExp(`\\.(?:${builtTextExtensionNames.join('|')})$`, 'iu');
const runtimeTextExtensions = new RegExp(
  `\\.(?:${[...builtTextExtensionNames, 'astro'].join('|')})$`,
  'iu',
);
const builtHtmlExtensions = /\.(?:html?|svg|xml)$/iu;
const builtPlainProseExtensions = /\.(?:csv|md|txt)$/iu;
const builtUrlAttributeNames = new Set(['action', 'cite', 'formaction', 'href', 'poster', 'src']);
const builtAccessibleTextAttributeNames = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'placeholder',
  'title',
]);
const builtPublicMetadataNames = new Set([
  'author',
  'description',
  'og:description',
  'og:image:alt',
  'og:title',
  'twitter:description',
  'twitter:title',
]);
const builtHiddenTextElements = new Set(['script', 'style', 'template']);
const builtBlockElements = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'caption',
  'dd',
  'details',
  'dialog',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hgroup',
  'hr',
  'li',
  'main',
  'menu',
  'nav',
  'ol',
  'option',
  'optgroup',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'title',
  'tr',
  'ul',
]);
const exactArtifactDirectivePattern = /(?::{2,3}[a-z][a-z0-9-]*(?:\[[^\]\r\n]*\])?(?:\{[^{}\r\n]*\})?|:[a-z][a-z0-9-]*\[[^\]\r\n]*\](?:\{[^{}\r\n]*\})?)/iu;
const dangerousSchemeNames = [
  'da' + 'ta',
  'fi' + 'le',
  'java' + 'script',
  'vb' + 'script',
];
const asciiC0PatternSource = `[${String.fromCodePoint(0)}-${String.fromCodePoint(0x20)}]*`;
const dangerousSchemePattern = new RegExp(
  `(?:^|[^a-z0-9+.-])(?:${dangerousSchemeNames.join('|')}):${asciiC0PatternSource}`,
  'iu',
);
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });
const maxReleaseFileBytes = 64 * 1024 * 1024;
const maxReleaseSnapshotBytes = 256 * 1024 * 1024;
const maxReleaseSnapshotEntries = 100_000;
const maxReleaseSnapshotDepth = 64;
const maxSrcdocDepth = 8;
const maxCssSourceLength = 1_000_000;
const maxCssNodes = 20_000;
const maxCssNestingDepth = 128;
const maxEmbeddedStyleBlocks = 64;
const maxInlineStyleAttributes = 10_000;
const zeroWidthCssContentIdentifiers = new Set(['no-close-quote', 'no-open-quote']);
const allowedStaticCssContentFunctions = new Set([
  'conic-gradient',
  'counter',
  'counters',
  'cross-fade',
  'image',
  'image-set',
  'linear-gradient',
  'radial-gradient',
  'repeating-conic-gradient',
  'repeating-linear-gradient',
  'repeating-radial-gradient',
]);

type ArtifactSyntaxContext = 'css' | 'html' | 'astro' | 'generic';
type OffsetRange = { start: number; end: number };
type CssLocation = { start: { offset: number }; end: { offset: number } };
type CssNode = {
  type: string;
  loc?: CssLocation | null;
  name?: string;
  property?: string;
  value?: CssNode | string;
  children?: Iterable<CssNode> | null;
};
type CssParse = (source: string, options?: {
  context?: 'stylesheet' | 'declarationList' | 'value';
  positions?: boolean;
  onParseError?: (error: unknown) => void;
}) => CssNode;
type CssWalkOptions = {
  enter?: (node: CssNode) => unknown;
  leave?: (node: CssNode) => unknown;
};
type CssWalk = ((root: CssNode, visitor: ((node: CssNode) => unknown) | CssWalkOptions) => void) & {
  skip: symbol;
};

const cssTreeRequire = createRequire(import.meta.url);
const parseCss = cssTreeRequire('css-tree/parser') as CssParse;
const walkCss = cssTreeRequire('css-tree/walker') as CssWalk;
const tsCompiler = cssTreeRequire('typescript') as typeof import('typescript');
const decodeCssIdentifier = (cssTreeRequire('css-tree/utils') as {
  ident: { decode: (value: string) => string };
}).ident.decode;

function hasDangerousSchemeInCanonicalText(value: string): boolean {
  return dangerousSchemePattern.test(value.replace(/[\u0009\u000a\u000d]/gu, ''));
}

type DecodedFragmentPolicy = Readonly<{
  privateIds: boolean;
  privatePaths: boolean;
  directives: boolean;
  schemes: boolean;
}>;

const decodedArtifactPolicy: DecodedFragmentPolicy = {
  privateIds: false,
  privatePaths: true,
  directives: true,
  schemes: true,
};
const decodedProsePolicy: DecodedFragmentPolicy = {
  ...decodedArtifactPolicy,
  privateIds: true,
};

function decodedFragmentSentinel(
  value: string,
  policy: DecodedFragmentPolicy = decodedArtifactPolicy,
): string | null {
  assertNoForbiddenUnicodeControls(value, 'decoded syntax fragment');
  const canonical = canonicalSecurityValue(value);
  assertNoForbiddenUnicodeControls(canonical, 'canonical decoded syntax fragment');
  if (hasPrivateRepositoryCoordinate(canonical)) return 'private repository coordinate';
  if (policy.privateIds && privateIdPattern.test(canonical)) return 'private-prefixed identifier';
  if (policy.privatePaths && hasPrivatePath(canonical)) {
    return 'private repository path';
  }
  if (policy.directives && exactArtifactDirectivePattern.test(canonical)) return 'raw directive';
  if (policy.schemes && hasDangerousSchemeInCanonicalText(canonical)) return 'dangerous URL scheme';
  return null;
}

function scriptKindForLabel(label: string): import('typescript').ScriptKind {
  if (/\.(?:json|map|webmanifest)$/iu.test(label)) return tsCompiler.ScriptKind.JSON;
  if (/\.tsx$/iu.test(label)) return tsCompiler.ScriptKind.TSX;
  if (/\.jsx$/iu.test(label)) return tsCompiler.ScriptKind.JSX;
  if (/\.(?:ts|mts|cts)$/iu.test(label)) return tsCompiler.ScriptKind.TS;
  return tsCompiler.ScriptKind.JS;
}

function scanDecodedTextRuns(
  runs: readonly string[],
  policy: DecodedFragmentPolicy,
): string | null {
  for (const run of runs) {
    const sentinel = decodedFragmentSentinel(run, policy);
    if (sentinel) return sentinel;
  }
  return null;
}

function jsxRenderedTextSentinel(
  root: import('typescript').JsxElement | import('typescript').JsxFragment,
): string | null {
  const runs: string[] = [];
  let run = '';
  const flush = () => {
    if (run) runs.push(run);
    run = '';
  };
  const tagName = (node: import('typescript').JsxElement | import('typescript').JsxSelfClosingElement) => {
    const tag = tsCompiler.isJsxElement(node) ? node.openingElement.tagName : node.tagName;
    return tsCompiler.isIdentifier(tag) ? tag.text.toLowerCase() : null;
  };
  const visitChild = (node: import('typescript').JsxChild): void => {
    if (tsCompiler.isJsxText(node)) {
      run += node.text;
      return;
    }
    if (tsCompiler.isJsxExpression(node)) {
      const expression = node.expression;
      if (expression && tsCompiler.isStringLiteralLike(expression)) run += expression.text;
      else if (expression && (tsCompiler.isJsxElement(expression) || tsCompiler.isJsxFragment(expression))) {
        visitContainer(expression);
      }
      return;
    }
    if (tsCompiler.isJsxSelfClosingElement(node)) {
      const name = tagName(node);
      if (name === 'br' || (name !== null && builtBlockElements.has(name))) flush();
      return;
    }
    visitContainer(node);
  };
  const visitContainer = (
    node: import('typescript').JsxElement | import('typescript').JsxFragment,
  ): void => {
    const name = tsCompiler.isJsxElement(node) ? tagName(node) : null;
    const boundary = name !== null
      && (builtBlockElements.has(name) || name === 'script' || name === 'style' || name === 'template');
    if (boundary) flush();
    for (const child of node.children) visitChild(child);
    if (boundary) flush();
  };
  visitContainer(root);
  flush();
  return scanDecodedTextRuns(runs, decodedProsePolicy);
}

function jsxNodeHasRenderedParent(node: import('typescript').Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (tsCompiler.isJsxElement(parent) || tsCompiler.isJsxFragment(parent)) return true;
  return tsCompiler.isJsxExpression(parent)
    && (tsCompiler.isJsxElement(parent.parent) || tsCompiler.isJsxFragment(parent.parent));
}

function scriptSourceSentinel(
  source: string,
  label: string,
  policy: DecodedFragmentPolicy = decodedArtifactPolicy,
): string | null {
  if (scriptKindForLabel(label) === tsCompiler.ScriptKind.JSON) {
    return jsonSourceSentinel(source, label);
  }
  const sourceFile = tsCompiler.createSourceFile(
    label,
    source,
    tsCompiler.ScriptTarget.Latest,
    true,
    scriptKindForLabel(label),
  );
  const parseDiagnostics = (sourceFile as typeof sourceFile & {
    parseDiagnostics?: readonly import('typescript').Diagnostic[];
  }).parseDiagnostics;
  if (parseDiagnostics && parseDiagnostics.length > 0) {
    throw new Error(`${label} contains invalid TypeScript or JavaScript syntax`);
  }
  let found: string | null = null;
  const seenComments = new Set<number>();
  const scanCommentRanges = (ranges: readonly import('typescript').CommentRange[] | undefined) => {
    for (const range of ranges ?? []) {
      if (seenComments.has(range.pos)) continue;
      seenComments.add(range.pos);
      found = decodedFragmentSentinel(source.slice(range.pos, range.end), policy) ?? found;
    }
  };
  const visit = (node: import('typescript').Node): void => {
    scanCommentRanges(tsCompiler.getLeadingCommentRanges(source, node.getFullStart()));
    scanCommentRanges(tsCompiler.getTrailingCommentRanges(source, node.end));
    if ((tsCompiler.isJsxElement(node) || tsCompiler.isJsxFragment(node))
      && !jsxNodeHasRenderedParent(node)) {
      found = jsxRenderedTextSentinel(node) ?? found;
    }
    if (tsCompiler.isJsxText(node)) {
      found = decodedFragmentSentinel(node.text, decodedProsePolicy) ?? found;
    } else if (tsCompiler.isStringLiteralLike(node) || tsCompiler.isTemplateLiteralToken(node)) {
      found = decodedFragmentSentinel(node.text, policy) ?? found;
      if (tsCompiler.isStringLiteralLike(node)) {
        const sourceToken = source.slice(node.getStart(sourceFile), node.end);
        const delimiter = sourceToken[0];
        if ((delimiter === '"' || delimiter === "'" || delimiter === '`')
          && sourceToken.at(-1) === delimiter) {
          found = decodedFragmentSentinel(sourceToken.slice(1, -1), policy) ?? found;
        }
      }
      if (tsCompiler.isTemplateLiteralToken(node)) {
        const rawText = (node as typeof node & { rawText?: string }).rawText;
        if (rawText !== undefined && rawText !== node.text) {
          found = decodedFragmentSentinel(rawText, policy) ?? found;
        }
      }
    }
    if (!found) tsCompiler.forEachChild(node, visit);
  };
  visit(sourceFile);
  scanCommentRanges(tsCompiler.getLeadingCommentRanges(source, sourceFile.endOfFileToken.getFullStart()));
  return found;
}

function astroRenderedTextSentinel(root: AstroNode): string | null {
  const runs: string[] = [];
  let run = '';
  const flush = () => {
    if (run) runs.push(run);
    run = '';
  };
  const visit = (node: AstroNode): void => {
    if (node.type === 'text') {
      run += node.value;
      return;
    }
    if (node.type === 'element') {
      const name = node.name.toLowerCase();
      if (name === 'script' || name === 'style') {
        flush();
        return;
      }
      if (name === 'template') {
        flush();
        for (const child of node.children) visit(child);
        flush();
        return;
      }
      if (name === 'br') {
        flush();
        return;
      }
      const block = builtBlockElements.has(name);
      if (block) flush();
      for (const child of node.children) visit(child);
      if (block) flush();
      return;
    }
    if (node.type === 'component'
      || node.type === 'custom-element'
      || node.type === 'fragment'
      || node.type === 'root') {
      for (const child of node.children) visit(child);
      return;
    }
    if (node.type === 'expression') {
      for (const child of node.children) {
        if (child.type !== 'text') visit(child);
      }
    }
  };
  visit(root);
  flush();
  return scanDecodedTextRuns(runs, decodedProsePolicy);
}

function astroSourceSentinel(source: string, label: string): string | null {
  const parsed = parseAstro(source, { position: true });
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === 1)) {
    throw new Error(`${label} contains invalid Astro syntax`);
  }
  let found: string | null = astroRenderedTextSentinel(parsed.ast);
  const scanScript = (value: string, suffix: string) => {
    if (!found) found = scriptSourceSentinel(value, `${label}${suffix}.tsx`);
  };
  const visit = (node: AstroNode): void => {
    if (found) return;
    if (node.type === 'text') {
      found = decodedFragmentSentinel(node.value, decodedProsePolicy) ?? found;
    }
    if (node.type === 'comment') {
      found = decodedFragmentSentinel(node.value) ?? found;
    }
    if (node.type === 'frontmatter') scanScript(node.value, '.frontmatter');
    if (node.type === 'expression') {
      scanScript(
        node.children.map((child) => child.type === 'text' ? child.value : '').join(''),
        '.expression',
      );
    }
    if ((node.type === 'element' || node.type === 'component' || node.type === 'custom-element')) {
      for (const attribute of node.attributes) {
        if (attribute.kind === 'spread') {
          throw new Error(`${label} contains a dynamic Astro spread attribute`);
        }
        if (attribute.kind === 'quoted' || attribute.kind === 'empty') {
          const attributeName = attribute.name.toLowerCase();
          const policy = builtAccessibleTextAttributeNames.has(attributeName)
            || attributeName === 'abbr'
            || attributeName === 'label'
            ? decodedProsePolicy
            : decodedArtifactPolicy;
          found = decodedFragmentSentinel(attribute.value, policy) ?? found;
        } else {
          scanScript(attribute.value, `.attribute-${attribute.name}`);
        }
      }
      if (node.type === 'element') {
        const elementName = node.name.toLowerCase();
        if (elementName === 'script') {
          const scriptSource = node.children
            .map((child) => child.type === 'text' ? child.value : '')
            .join('');
          const type = node.attributes.find((attribute) =>
            attribute.name.toLowerCase() === 'type'
              && (attribute.kind === 'quoted' || attribute.kind === 'empty'))?.value ?? null;
          const kind = builtScriptPayloadKind(type);
          if (kind === 'json') {
            found = jsonSourceSentinel(scriptSource, `${label}.script.json`) ?? found;
          } else if (kind === 'javascript') {
            scanScript(scriptSource, '.script');
          } else {
            found = decodedFragmentSentinel(scriptSource) ?? found;
          }
          return;
        }
        if (elementName === 'style') return;
      }
    }
    if ('children' in node) {
      for (const child of node.children) visit(child);
    }
  };
  visit(parsed.ast);
  return found;
}

type HtmlNode = DefaultTreeAdapterMap['node'];
type HtmlParentNode = DefaultTreeAdapterMap['parentNode'];
type HtmlElement = DefaultTreeAdapterMap['element'];
type HtmlTemplate = DefaultTreeAdapterMap['template'];
type HtmlTextNode = DefaultTreeAdapterMap['textNode'];
type HtmlSourceLocation = { startOffset: number; endOffset: number };
type HtmlElementSourceLocation = HtmlSourceLocation & {
  attrs?: Record<string, HtmlSourceLocation>;
  startTag?: HtmlSourceLocation;
  endTag?: HtmlSourceLocation;
};
type StaticStyleBlock = { source: string; startOffset: number };

function isHtmlElement(node: HtmlNode): node is HtmlElement {
  return 'tagName' in node && 'attrs' in node;
}

function isHtmlTextNode(node: HtmlNode): node is HtmlTextNode {
  return node.nodeName === '#text' && 'value' in node;
}

function isHtmlParentNode(node: HtmlNode): node is HtmlParentNode {
  return 'childNodes' in node;
}

function isHtmlTemplate(node: HtmlNode): node is HtmlTemplate {
  return isHtmlElement(node) && node.tagName.toLowerCase() === 'template' && 'content' in node;
}

function htmlChildNodes(node: HtmlNode): readonly HtmlNode[] {
  if (isHtmlTemplate(node)) return node.content.childNodes;
  return isHtmlParentNode(node) ? node.childNodes : [];
}

function assertCssLexicalBounds(source: string, label: string): void {
  if (source.length > maxCssSourceLength) throw new Error(`${label} exceeds the CSS input-size bound`);
  const stack: string[] = [];
  let quote: '"' | "'" | null = null;
  let inComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    const next = source[index + 1];
    if (inComment) {
      if (character === '*' && next === '/') {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '/' && next === '*') {
      inComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '{' || character === '[' || character === '(') {
      stack.push(character);
      if (stack.length > maxCssNestingDepth) throw new Error(`${label} exceeds the CSS nesting bound`);
      continue;
    }
    const expected = character === '}' ? '{' : character === ']' ? '[' : character === ')' ? '(' : null;
    if (expected && stack.pop() !== expected) throw new Error(`${label} contains unbalanced CSS delimiters`);
  }
  if (quote || inComment || stack.length > 0) throw new Error(`${label} contains unterminated CSS syntax`);
}

function parseCssSecurityAst(
  source: string,
  label: string,
  context: 'stylesheet' | 'declarationList' | 'value' = 'stylesheet',
): CssNode {
  try {
    assertCssLexicalBounds(source, label);
    const ast = parseCss(source, {
      context,
      positions: true,
      onParseError(error) {
        throw error;
      },
    });
    let depth = 0;
    let nodeCount = 0;
    walkCss(ast, {
      enter(node) {
        depth += 1;
        nodeCount += 1;
        if (depth > maxCssNestingDepth) throw new Error(`${label} exceeds the CSS AST nesting bound`);
        if (nodeCount > maxCssNodes) throw new Error(`${label} exceeds the CSS AST node bound`);
        if (node.type !== 'Block') return;
        const start = node.loc?.start.offset;
        const end = node.loc?.end.offset;
        if (typeof start !== 'number'
          || typeof end !== 'number'
          || source[start] !== '{'
          || source[end - 1] !== '}') {
          throw new Error('CSS block delimiters are incomplete');
        }
      },
      leave() {
        depth -= 1;
      },
    });
    return ast;
  } catch (error) {
    throw new Error(`${label} contains invalid or unparseable CSS`, { cause: error });
  }
}

function cssPseudoPrefixRanges(source: string, label: string, baseOffset = 0): OffsetRange[] {
  const ranges: OffsetRange[] = [];
  const ast = parseCssSecurityAst(source, label);
  walkCss(ast, (node) => {
    if (node.type !== 'PseudoElementSelector') return;
    const start = node.loc?.start.offset;
    const name = node.name;
    if (typeof start !== 'number' || typeof name !== 'string') {
      throw new Error(`${label} contains a CSS pseudo-element without a source location`);
    }
    const end = start + 2 + name.length;
    if (source.slice(start, start + 2) !== '::'
      || source.slice(start + 2, end) !== name
      || end > source.length) {
      throw new Error(`${label} contains an inconsistent CSS pseudo-element source range`);
    }
    ranges.push({ start: baseOffset + start, end: baseOffset + end });
  });
  return ranges;
}

function maskSourceRanges(source: string, ranges: readonly OffsetRange[]): string {
  let cursor = 0;
  let masked = '';
  for (const range of [...ranges].sort((first, second) => first.start - second.start)) {
    if (range.start < cursor || range.start < 0 || range.end > source.length || range.end < range.start) {
      throw new Error('CSS security ranges overlap or fall outside their source');
    }
    masked += source.slice(cursor, range.start);
    masked += ' '.repeat(range.end - range.start);
    cursor = range.end;
  }
  return masked + source.slice(cursor);
}

function htmlStaticStyleBlocks(source: string): StaticStyleBlock[] {
  const blocks: StaticStyleBlock[] = [];
  const visit = (node: HtmlNode): void => {
    if (isHtmlElement(node) && node.tagName.toLowerCase() === 'style') {
      for (const child of node.childNodes) {
        if (!isHtmlTextNode(child)) {
          throw new Error('HTML style block contains non-static content');
        }
      }
      const location = (node as HtmlNode & { sourceCodeLocation?: HtmlElementSourceLocation }).sourceCodeLocation;
      const startOffset = location?.startTag?.endOffset;
      const endOffset = location?.endTag?.startOffset;
      if (typeof startOffset !== 'number' || typeof endOffset !== 'number' || endOffset < startOffset) {
        throw new Error('HTML style block has incomplete source locations');
      }
      blocks.push({ source: source.slice(startOffset, endOffset), startOffset });
      return;
    }
    for (const child of htmlChildNodes(node)) visit(child);
  };
  visit(parse(source, { scriptingEnabled: false, sourceCodeLocationInfo: true }));
  return blocks;
}

function htmlSrcdocAttributeRanges(source: string): OffsetRange[] {
  const ranges: OffsetRange[] = [];
  const visit = (node: HtmlNode): void => {
    if (isHtmlElement(node) && node.tagName.toLowerCase() === 'iframe') {
      const hasSrcdoc = node.attrs.some((attribute) => attribute.name.toLowerCase() === 'srcdoc');
      if (hasSrcdoc) {
        const location = (node as HtmlNode & { sourceCodeLocation?: HtmlElementSourceLocation })
          .sourceCodeLocation?.attrs?.srcdoc;
        if (!location) throw new Error('iframe srcdoc attribute has no source location');
        ranges.push({ start: location.startOffset, end: location.endOffset });
      }
    }
    for (const child of htmlChildNodes(node)) visit(child);
  };
  visit(parse(source, { scriptingEnabled: false, sourceCodeLocationInfo: true }));
  return ranges;
}

function htmlExecutableCodeRanges(source: string): OffsetRange[] {
  const ranges: OffsetRange[] = [];
  const visit = (node: HtmlNode): void => {
    if (isHtmlElement(node)) {
      const location = (node as HtmlNode & { sourceCodeLocation?: HtmlElementSourceLocation })
        .sourceCodeLocation;
      if (node.tagName.toLowerCase() === 'script') {
        const start = location?.startTag?.endOffset;
        const end = location?.endTag?.startOffset;
        if (typeof start !== 'number' || typeof end !== 'number' || end < start) {
          throw new Error('HTML script block has incomplete source locations');
        }
        ranges.push({ start, end });
      }
      for (const attribute of node.attrs) {
        if (!/^on[a-z]/iu.test(attribute.name)) continue;
        const attributeLocation = location?.attrs?.[attribute.name];
        if (!attributeLocation) throw new Error('HTML event handler has no source location');
        ranges.push({ start: attributeLocation.startOffset, end: attributeLocation.endOffset });
      }
    }
    for (const child of htmlChildNodes(node)) visit(child);
  };
  visit(parse(source, { scriptingEnabled: false, sourceCodeLocationInfo: true }));
  return ranges;
}

function utf8ByteOffsetToCodeUnitIndex(source: string, targetOffset: number): number {
  let byteOffset = 0;
  let codeUnitIndex = 0;
  while (codeUnitIndex < source.length && byteOffset < targetOffset) {
    const codePoint = source.codePointAt(codeUnitIndex);
    if (codePoint === undefined) break;
    const character = String.fromCodePoint(codePoint);
    byteOffset += Buffer.byteLength(character, 'utf8');
    codeUnitIndex += character.length;
  }
  if (byteOffset !== targetOffset) throw new Error('Astro style location splits a UTF-8 code point');
  return codeUnitIndex;
}

function astroStaticStyleBlocks(source: string, label: string): StaticStyleBlock[] {
  const parsed = parseAstro(source, { position: true });
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === 1)) {
    throw new Error(`${label} contains invalid Astro syntax`);
  }
  const blocks: StaticStyleBlock[] = [];
  const visit = (node: AstroNode): void => {
    if (node.type === 'element' && node.name.toLowerCase() === 'style') {
      if (node.attributes.some((attribute) => attribute.name.toLowerCase() === 'define:vars')) {
        throw new Error(`${label} contains a dynamic Astro style define:vars boundary`);
      }
      const lang = node.attributes.find((attribute) => attribute.name.toLowerCase() === 'lang');
      if (lang && lang.value.toLowerCase() !== 'css') {
        throw new Error(`${label} contains a non-CSS Astro style block`);
      }
      if (!node.children.every((child) => child.type === 'text')) {
        throw new Error(`${label} contains a dynamic Astro style block`);
      }
      if (node.children.length === 0) {
        blocks.push({ source: '', startOffset: 0 });
        return;
      }
      const firstChild = node.children[0]!;
      const lastChild = node.children.at(-1)!;
      if (firstChild.type !== 'text'
        || lastChild.type !== 'text'
        || !firstChild.position
        || !lastChild.position?.end) {
        throw new Error(`${label} contains an unlocated Astro style block`);
      }
      const startOffset = utf8ByteOffsetToCodeUnitIndex(source, firstChild.position.start.offset);
      const endOffset = utf8ByteOffsetToCodeUnitIndex(source, lastChild.position.end.offset);
      const rawSource = source.slice(startOffset, endOffset);
      const parsedSource = node.children.map((child) => child.type === 'text' ? child.value : '').join('');
      if (rawSource !== parsedSource) throw new Error(`${label} has an inconsistent Astro style source range`);
      blocks.push({ source: rawSource, startOffset });
      return;
    }
    if ('children' in node) {
      for (const child of node.children) visit(child);
    }
  };
  visit(parsed.ast);
  return blocks;
}

function astroStaticInlineStyles(source: string, label: string): string[] {
  const parsed = parseAstro(source, { position: true });
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === 1)) {
    throw new Error(`${label} contains invalid Astro syntax`);
  }
  const styles: string[] = [];
  const visit = (node: AstroNode): void => {
    if (node.type === 'element' || node.type === 'component' || node.type === 'custom-element') {
      const style = node.attributes.find((attribute) => attribute.name.toLowerCase() === 'style');
      if (style?.kind === 'quoted') styles.push(style.value);
      else if (style && style.kind !== 'empty') {
        throw new Error(`${label} contains a dynamic Astro style attribute`);
      }
    }
    if ('children' in node) {
      for (const child of node.children) visit(child);
    }
  };
  visit(parsed.ast);
  if (styles.length > maxInlineStyleAttributes
    || styles.reduce((total, style) => total + style.length, 0) > maxCssSourceLength) {
    throw new Error(`${label} exceeds the inline CSS input bound`);
  }
  return styles;
}

function staticStyleBlocks(source: string, context: ArtifactSyntaxContext, label: string): StaticStyleBlock[] {
  const blocks = context === 'html'
    ? htmlStaticStyleBlocks(source)
    : context === 'astro' ? astroStaticStyleBlocks(source, label) : [];
  if (blocks.length > maxEmbeddedStyleBlocks) throw new Error(`${label} exceeds the embedded CSS style-block bound`);
  if (blocks.reduce((total, block) => total + block.source.length, 0) > maxCssSourceLength) {
    throw new Error(`${label} exceeds the embedded CSS input-size bound`);
  }
  return blocks;
}

function directiveScanSource(source: string, context: ArtifactSyntaxContext, label: string): string {
  if (context === 'css') return maskSourceRanges(source, cssPseudoPrefixRanges(source, label));
  if (context === 'html' || context === 'astro') {
    const ranges = staticStyleBlocks(source, context, label).flatMap((block) =>
      cssPseudoPrefixRanges(block.source, label, block.startOffset));
    if (context === 'html') ranges.push(...htmlSrcdocAttributeRanges(source));
    return maskSourceRanges(source, ranges);
  }
  return source;
}

function artifactContext(relativePath: string, runtime: boolean): ArtifactSyntaxContext {
  if (/\.css$/iu.test(relativePath)) return 'css';
  if (runtime && /\.astro$/iu.test(relativePath)) return 'astro';
  if (builtHtmlExtensions.test(relativePath)) return 'html';
  return 'generic';
}

function scanCssGeneratedProse(
  stylesheet: string,
  label: string,
  context: 'stylesheet' | 'declarationList' = 'stylesheet',
  decodedPolicy: DecodedFragmentPolicy = decodedArtifactPolicy,
): void {
  const ast = parseCssSecurityAst(stylesheet, label, context);
  const scanAst = (root: CssNode, rawDepth: number): void => {
    walkCss(root, (node) => {
      const decodedNames = [node.name, node.property]
        .filter((value): value is string => typeof value === 'string')
        .map((value) => decodeCssIdentifier(value));
      for (const value of decodedNames) {
        const sentinel = decodedFragmentSentinel(value, decodedPolicy);
        if (sentinel) throw new Error(`${label} contains forbidden decoded CSS syntax (${sentinel})`);
      }
      if (node.type === 'String') {
        if (typeof node.value !== 'string') throw new Error(`${label} contains unresolved CSS text`);
        const sentinel = decodedFragmentSentinel(node.value, decodedPolicy);
        if (sentinel) throw new Error(`${label} contains forbidden decoded CSS text (${sentinel})`);
        return;
      }
      if (node.type === 'Url') {
        if (typeof node.value !== 'string') throw new Error(`${label} contains an unresolved CSS URL`);
        assertBuiltReaderUrlSafe(node.value, `${label} CSS URL`);
        return;
      }
      if (node.type === 'Raw') {
        if (typeof node.value !== 'string' || rawDepth >= 8) {
          throw new Error(`${label} contains unresolved raw CSS`);
        }
        scanAst(parseCssSecurityAst(node.value, `${label} raw value`, 'value'), rawDepth + 1);
        return;
      }
      if (node.type !== 'Declaration'
        || typeof node.property !== 'string'
        || decodeCssIdentifier(node.property).toLowerCase() !== 'content'
        || typeof node.value !== 'object') return;
      const scanChildren = (parent: CssNode): void => {
        let currentRun = '';
        const flush = () => {
          if (!currentRun) return;
          const sentinel = decodedFragmentSentinel(currentRun, decodedProsePolicy);
          if (sentinel) throw new Error(`${label} contains forbidden CSS-generated prose (${sentinel})`);
          currentRun = '';
        };
        for (const child of parent.children ? [...parent.children] : []) {
          if (child.type === 'String' && typeof child.value === 'string') {
            currentRun += child.value;
            continue;
          }
          if (child.type === 'Identifier'
            && typeof child.name === 'string'
            && zeroWidthCssContentIdentifiers.has(decodeCssIdentifier(child.name).toLowerCase())) {
            continue;
          }
          flush();
          if (child.type === 'Raw') throw new Error(`${label} contains unresolved dynamic CSS content`);
          if (child.type === 'Function') {
            const name = child.name ? decodeCssIdentifier(child.name).toLowerCase() : null;
            if (!name || !allowedStaticCssContentFunctions.has(name)) {
              throw new Error(`${label} contains unresolved dynamic CSS content function`);
            }
          }
          scanChildren(child);
        }
        flush();
      };
      scanChildren(node.value);
    });
  };
  scanAst(ast, 0);
}

function scanEmbeddedCssGeneratedProse(
  source: string,
  context: ArtifactSyntaxContext,
  label: string,
  decodedPolicy: DecodedFragmentPolicy = decodedArtifactPolicy,
): void {
  if (context === 'css') {
    scanCssGeneratedProse(source, label, 'stylesheet', decodedPolicy);
    return;
  }
  for (const block of staticStyleBlocks(source, context, label)) {
    scanCssGeneratedProse(block.source, `${label} style block`, 'stylesheet', decodedPolicy);
  }
  if (context === 'astro') {
    for (const style of astroStaticInlineStyles(source, label)) {
      scanCssGeneratedProse(style, `${label} inline style`, 'declarationList', decodedPolicy);
    }
  }
}

function releasePathSentinel(relativePath: string): string | null {
  const canonical = canonicalSecurityValue(relativePath);
  if (canonical.includes('\\')) return 'ambiguous reverse solidus';
  const repositoryPath = canonicalizeMixedPathSegments(canonical);
  if (hasPrivateRepositoryCoordinate(repositoryPath)) {
    return 'private repository coordinate';
  }
  if (hasPrivatePath(canonical)) return 'private repository path';
  if (exactArtifactDirectivePattern.test(canonical)) return 'raw directive';
  if (hasDangerousSchemeInCanonicalText(canonical)) return 'dangerous URL scheme';
  return null;
}

function assertReleasePathSafe(relativePath: string): void {
  let sentinel: string | null;
  try {
    sentinel = releasePathSentinel(relativePath);
  } catch (error) {
    throw new Error(`${relativePath} contains invalid canonical security text in its relative path`, { cause: error });
  }
  if (sentinel) throw new Error(`${relativePath} contains a forbidden relative path sentinel (${sentinel})`);
}

function rootPath(input: string | URL): string {
  return resolve(input instanceof URL ? fileURLToPath(input) : input);
}

async function pathMetadata(path: string) {
  let metadata;
  try {
    metadata = await lstat(path, { bigint: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
  return metadata;
}

type ReleaseFileMetadata = NonNullable<Awaited<ReturnType<typeof pathMetadata>>>;

function sameReleaseFileMetadata(left: ReleaseFileMetadata, right: ReleaseFileMetadata): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

type ReleaseSnapshotLayer = 'guard' | 'runtime' | 'generated-content' | 'generated-image' | 'built' | 'built-image';

type ReleaseSnapshotEntry = {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly layer: ReleaseSnapshotLayer;
  readonly kind: 'missing' | 'directory' | 'file';
  readonly metadata: ReleaseFileMetadata | null;
  readonly bytes?: Buffer;
};

type ReleaseSnapshot = {
  readonly entries: readonly ReleaseSnapshotEntry[];
  readonly handles: readonly {
    readonly relativePath: string;
    readonly metadata: ReleaseFileMetadata;
    readonly handle: FileHandle;
  }[];
};

type ReleaseSnapshotCapture = {
  readonly projectRoot: string;
  readonly includeBytes: boolean;
  readonly retainHandles: boolean;
  readonly entries: ReleaseSnapshotEntry[];
  readonly handles: { relativePath: string; metadata: ReleaseFileMetadata; handle: FileHandle }[];
  readonly seen: Set<string>;
  totalBytes: bigint;
};

type ReleaseSnapshotScope = {
  readonly relativePath: string;
  readonly layer: ReleaseSnapshotLayer;
  readonly recursive: boolean;
  readonly directoryGuard: boolean;
};

export type ReaderReleaseScanOptions = {
  /** Audit/test instrumentation. The complete immutable snapshot is revalidated before success. */
  readonly afterEntryScan?: (relativePath: string) => void | Promise<void>;
};

function normalizedReleaseRelativePath(projectRoot: string, path: string): string {
  return relative(projectRoot, path).split(sep).join('/') || '.';
}

function compareReleasePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function releaseSnapshotScopes(): readonly ReleaseSnapshotScope[] {
  const semanticScopes: ReleaseSnapshotScope[] = [
    ...runtimeScanRoots.map((relativePath) => ({
      relativePath,
      layer: 'runtime' as const,
      recursive: true,
      directoryGuard: false,
    })),
    {
      relativePath: generatedReaderContentRoot,
      layer: 'generated-content',
      recursive: true,
      directoryGuard: false,
    },
    {
      relativePath: generatedReaderImageRoot,
      layer: 'generated-image',
      recursive: true,
      directoryGuard: false,
    },
    {
      relativePath: builtReaderRoot,
      layer: 'built',
      recursive: true,
      directoryGuard: false,
    },
    {
      relativePath: builtReaderImageRoot,
      layer: 'built-image',
      recursive: true,
      directoryGuard: false,
    },
  ];
  const semanticPaths = new Set(semanticScopes.map(({ relativePath }) => relativePath));
  const guardPaths = new Set<string>(['.']);
  for (const { relativePath } of semanticScopes) {
    const segments = relativePath.split('/');
    for (let length = 1; length < segments.length; length += 1) {
      guardPaths.add(segments.slice(0, length).join('/'));
    }
  }
  const guards = [...guardPaths]
    .filter((relativePath) => !semanticPaths.has(relativePath))
    .sort((left, right) => {
      const depth = left.split('/').length - right.split('/').length;
      return depth || compareReleasePaths(left, right);
    })
    .map((relativePath): ReleaseSnapshotScope => ({
      relativePath,
      layer: 'guard',
      recursive: false,
      directoryGuard: true,
    }));
  return [...guards, ...semanticScopes];
}

function releaseSnapshotChanged(relativePath: string): Error {
  return new Error(`release-layer snapshot tree identity or metadata changed: ${relativePath}`);
}

function assertReleaseFileMetadata(
  metadata: ReleaseFileMetadata,
  relativePath: string,
): void {
  if (!metadata.isFile()) throw new Error(`release-layer scan requires regular files: ${relativePath}`);
  if (metadata.nlink !== 1n) {
    throw new Error(`release-layer scan rejects files with multiple hard links: ${relativePath}`);
  }
  if (metadata.size > BigInt(maxReleaseFileBytes)) {
    throw new Error(`release-layer file exceeds the bounded input size: ${relativePath}`);
  }
}

async function readSingleLinkReleaseFile(
  path: string,
  relativePath: string,
  expected: ReleaseFileMetadata,
  remainingSnapshotBytes: bigint,
): Promise<{ readonly bytes: Buffer; readonly metadata: ReleaseFileMetadata }> {
  assertReleaseFileMetadata(expected, relativePath);
  const handle = await open(path, fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    assertReleaseFileMetadata(opened, relativePath);
    if (!sameReleaseFileMetadata(opened, expected)) {
      throw new Error(`release-layer file identity changed or has multiple hard links: ${relativePath}`);
    }
    if (opened.size > remainingSnapshotBytes) {
      throw new Error(`release-layer snapshot exceeds the bounded total input size: ${relativePath}`);
    }
    const expectedByteLength = Number(opened.size);
    const bytes = Buffer.allocUnsafe(expectedByteLength);
    let offset = 0;
    while (offset < expectedByteLength) {
      const { bytesRead } = await handle.read(bytes, offset, expectedByteLength - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== expectedByteLength) {
      throw new Error(`release-layer file size changed while reading: ${relativePath}`);
    }
    const overflow = Buffer.allocUnsafe(1);
    const { bytesRead: overflowBytes } = await handle.read(overflow, 0, 1, expectedByteLength);
    if (overflowBytes !== 0) {
      throw new Error(`release-layer file size changed while reading: ${relativePath}`);
    }
    const verified = await handle.stat({ bigint: true });
    if (!verified.isFile()
      || verified.nlink !== 1n
      || !sameReleaseFileMetadata(verified, opened)
      || BigInt(bytes.length) !== verified.size) {
      throw new Error(`release-layer file identity or metadata changed while reading: ${relativePath}`);
    }
    const current = await pathMetadata(path);
    if (!current || !sameReleaseFileMetadata(current, opened)) {
      throw releaseSnapshotChanged(relativePath);
    }
    return { bytes, metadata: opened };
  } finally {
    await handle.close();
  }
}

function appendSnapshotEntry(capture: ReleaseSnapshotCapture, entry: ReleaseSnapshotEntry): void {
  if (capture.seen.has(entry.relativePath)) {
    throw new Error(`release-layer snapshot contains a duplicate manifest path: ${entry.relativePath}`);
  }
  if (capture.entries.length >= maxReleaseSnapshotEntries) {
    throw new Error(`release-layer snapshot exceeds the bounded manifest entry count: ${entry.relativePath}`);
  }
  capture.seen.add(entry.relativePath);
  capture.entries.push(entry);
}

async function captureReleasePath(
  capture: ReleaseSnapshotCapture,
  scope: ReleaseSnapshotScope,
  absolutePath: string,
  depth: number,
  retainDirectoryHandle: boolean,
): Promise<void> {
  const relativePath = normalizedReleaseRelativePath(capture.projectRoot, absolutePath);
  assertReleasePathSafe(relativePath);
  if (depth > maxReleaseSnapshotDepth) {
    throw new Error(`release-layer snapshot exceeds the bounded directory depth: ${relativePath}`);
  }
  const metadata = await pathMetadata(absolutePath);
  if (!metadata) {
    appendSnapshotEntry(capture, {
      absolutePath,
      relativePath,
      layer: scope.layer,
      kind: 'missing',
      metadata: null,
    });
    return;
  }
  if (metadata.isSymbolicLink()) throw new Error(`release-layer scan rejects symbolic link: ${relativePath}`);
  if (metadata.isDirectory()) {
    const handle = await open(
      absolutePath,
      fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW | fileConstants.O_DIRECTORY,
    );
    let retained = false;
    try {
      const opened = await handle.stat({ bigint: true });
      if (!opened.isDirectory() || !sameReleaseFileMetadata(opened, metadata)) {
        throw releaseSnapshotChanged(relativePath);
      }
      appendSnapshotEntry(capture, {
        absolutePath,
        relativePath,
        layer: scope.layer,
        kind: 'directory',
        metadata: opened,
      });
      if (scope.recursive) {
        const directory = await opendir(absolutePath);
        try {
          let member;
          while ((member = await directory.read()) !== null) {
            await captureReleasePath(
              capture,
              scope,
              join(absolutePath, member.name),
              depth + 1,
              false,
            );
          }
        } finally {
          await directory.close();
        }
      }
      const verified = await handle.stat({ bigint: true });
      const current = await pathMetadata(absolutePath);
      if (!verified.isDirectory()
        || !sameReleaseFileMetadata(verified, opened)
        || !current
        || !sameReleaseFileMetadata(current, opened)) {
        throw releaseSnapshotChanged(relativePath);
      }
      if (capture.retainHandles && retainDirectoryHandle) {
        capture.handles.push({ relativePath, metadata: opened, handle });
        retained = true;
      }
    } finally {
      if (!retained) await handle.close();
    }
    return;
  }
  if (scope.directoryGuard) {
    throw new Error(`release-layer snapshot requires a directory guard: ${relativePath}`);
  }
  assertReleaseFileMetadata(metadata, relativePath);
  if (!capture.includeBytes) {
    const handle = await open(absolutePath, fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW);
    try {
      const opened = await handle.stat({ bigint: true });
      assertReleaseFileMetadata(opened, relativePath);
      const current = await pathMetadata(absolutePath);
      if (!sameReleaseFileMetadata(opened, metadata)
        || !current
        || !sameReleaseFileMetadata(current, opened)) {
        throw releaseSnapshotChanged(relativePath);
      }
      appendSnapshotEntry(capture, {
        absolutePath,
        relativePath,
        layer: scope.layer,
        kind: 'file',
        metadata: opened,
      });
    } finally {
      await handle.close();
    }
    return;
  }
  const remainingSnapshotBytes = BigInt(maxReleaseSnapshotBytes) - capture.totalBytes;
  const captured = await readSingleLinkReleaseFile(
    absolutePath,
    relativePath,
    metadata,
    remainingSnapshotBytes,
  );
  capture.totalBytes += captured.metadata.size;
  appendSnapshotEntry(capture, {
    absolutePath,
    relativePath,
    layer: scope.layer,
    kind: 'file',
    metadata: captured.metadata,
    bytes: captured.bytes,
  });
}

async function closeReleaseSnapshot(snapshot: ReleaseSnapshot): Promise<void> {
  await Promise.all(snapshot.handles.map(async ({ handle }) => handle.close()));
}

async function captureReleaseSnapshot(
  projectRoot: string,
  includeBytes: boolean,
  retainHandles: boolean,
): Promise<ReleaseSnapshot> {
  const capture: ReleaseSnapshotCapture = {
    projectRoot,
    includeBytes,
    retainHandles,
    entries: [],
    handles: [],
    seen: new Set(),
    totalBytes: 0n,
  };
  try {
    for (const scope of releaseSnapshotScopes()) {
      const absolutePath = scope.relativePath === '.'
        ? projectRoot
        : join(projectRoot, ...scope.relativePath.split('/'));
      await captureReleasePath(capture, scope, absolutePath, 0, true);
    }
    capture.entries.sort((left, right) => compareReleasePaths(left.relativePath, right.relativePath));
    return { entries: capture.entries, handles: capture.handles };
  } catch (error) {
    await Promise.all(capture.handles.map(async ({ handle }) => handle.close()));
    throw error;
  }
}

async function assertSnapshotHandlesUnchanged(snapshot: ReleaseSnapshot): Promise<void> {
  for (const { relativePath, metadata, handle } of snapshot.handles) {
    const current = await handle.stat({ bigint: true });
    if (!sameReleaseFileMetadata(current, metadata)) throw releaseSnapshotChanged(relativePath);
  }
}

function assertReleaseSnapshotsEqual(expected: ReleaseSnapshot, current: ReleaseSnapshot): void {
  if (expected.entries.length !== current.entries.length) {
    throw new Error('release-layer snapshot manifest tree changed (missing or extra entry)');
  }
  for (let index = 0; index < expected.entries.length; index += 1) {
    const before = expected.entries[index]!;
    const after = current.entries[index]!;
    if (before.relativePath !== after.relativePath
      || before.kind !== after.kind
      || before.layer !== after.layer
      || (before.metadata === null) !== (after.metadata === null)
      || (before.metadata !== null
        && after.metadata !== null
        && !sameReleaseFileMetadata(before.metadata, after.metadata))
      || (before.bytes === undefined) !== (after.bytes === undefined)
      || (before.bytes !== undefined
        && after.bytes !== undefined
        && !before.bytes.equals(after.bytes))) {
      throw new Error(`release-layer snapshot manifest tree changed: ${before.relativePath}`);
    }
  }
}

function scanRuntimeSnapshotEntry(entry: ReleaseSnapshotEntry): void {
  if (entry.kind !== 'file' || !entry.bytes) return;
  const { bytes, relativePath } = entry;
  let contents: string;
  try {
    contents = runtimeTextExtensions.test(relativePath) ? strictUtf8.decode(bytes) : bytes.toString('utf8');
  } catch (error) {
    throw new Error(`${relativePath} is not valid UTF-8 runtime source`, { cause: error });
  }
  const context = artifactContext(relativePath, true);
  const contextHasSemanticScanner = context === 'astro'
    || (context === 'generic' && scriptLikeArtifactExtensions.test(relativePath));
  let sentinel: string | null;
  try {
    sentinel = runtimeSourceSentinel(
      contents,
      directiveScanSource(contents, context, relativePath),
      !contextHasSemanticScanner,
      !contextHasSemanticScanner,
    );
    if (!sentinel && context === 'astro') {
      sentinel = astroSourceSentinel(contents, relativePath);
    }
    if (!sentinel
      && context === 'generic'
      && scriptLikeArtifactExtensions.test(relativePath)) {
      sentinel = scriptSourceSentinel(contents, relativePath);
    }
    scanEmbeddedCssGeneratedProse(contents, context, relativePath);
  } catch (error) {
    throw new Error(`${relativePath} contains invalid canonical security text`, { cause: error });
  }
  if (sentinel) throw new Error(`${relativePath} contains a forbidden runtime sentinel (${sentinel})`);
}

function assertBuiltReaderUrlSafe(value: string, relativePath: string): void {
  const fragmentSentinel = decodedFragmentSentinel(value);
  if (fragmentSentinel) {
    throw new Error(`${relativePath} contains a forbidden decoded URL sentinel (${fragmentSentinel})`);
  }
  assertNoForbiddenUnicodeControls(value, `${relativePath} reader-facing URL`);
  const canonical = canonicalSecurityValue(value);
  assertNoForbiddenUnicodeControls(canonical, `${relativePath} decoded reader-facing URL`);
  if (/[\u0000-\u001f\u007f-\u009f\s]/u.test(canonical) || canonical.includes('\\')) {
    throw new Error(`${relativePath} contains an unsafe reader-facing URL`);
  }
  if (/^(?:data|file|javascript|vbscript):/iu.test(canonical) || canonical.startsWith('//')) {
    throw new Error(`${relativePath} contains an unsafe reader-facing URL scheme`);
  }
  if (value.startsWith('#') || value.startsWith('?')) return;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(value)) return;
  const rawDestination = value.split(/[?#]/u, 1)[0]!;
  const destination = canonicalSecurityValue(rawDestination);
  const readerRelativePath = relativePath.startsWith(`${builtReaderRoot}/`)
    ? relativePath.slice(builtReaderRoot.length + 1)
    : relativePath;
  const rootAnchoredPath = destination.startsWith('/') || destination.startsWith('~/');
  const baseSegments = rootAnchoredPath ? [] : readerRelativePath.split('/');
  if (!rootAnchoredPath) baseSegments.pop();
  const pathDestination = destination.startsWith('~/') ? destination.slice(2) : destination;
  for (const segment of pathDestination.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (baseSegments.length === 0) {
        throw new Error(`${relativePath} contains a relative URL escaping its allowed root`);
      }
      baseSegments.pop();
    } else {
      baseSegments.push(segment);
    }
  }
}

function tolerantArtifactCanonicalValue(value: string): { value: string; excessive: boolean } {
  const decode = (input: string) => {
    const decodedPercent = securitySkeleton(input.replace(percentRunPattern, (run) => {
      try {
        return decodePercentRuns(run);
      } catch {
        return run;
      }
    }), true);
    return securitySkeleton(decodedPercent.replace(securityEntityPattern, (entity) => {
      try {
        return decodeSecurityEntities(entity);
      } catch {
        return entity;
      }
    }), true);
  };
  let current = securitySkeleton(value, true);
  for (let depth = 0; depth < 8; depth += 1) {
    const decoded = decode(current);
    if (decoded === current) return { value: current, excessive: false };
    current = decoded;
  }
  return { value: current, excessive: decode(current) !== current };
}

function exactArtifactSentinel(
  value: string,
  strictCanonical: boolean,
  directiveValue = value,
  scanDangerousExactText = true,
  dangerousValue = value,
): string | null {
  const forbiddenControlPattern = strictCanonical
    ? forbiddenUnicodeTextControlPattern
    : forbiddenUnicodeFormatControlPattern;
  if (forbiddenControlPattern.test(value)) return 'Unicode control';
  const artifactCanonical = strictCanonical
    ? { value: canonicalSecurityValue(value), excessive: false }
    : tolerantArtifactCanonicalValue(value);
  const canonical = artifactCanonical.value;
  if (artifactCanonical.excessive) return 'excessive nested canonical encoding';
  if (forbiddenControlPattern.test(canonical)) return 'decoded Unicode control';
  const structuralScanValue = canonical.replace(/<!--|-->|\/\*|\*\//gu, ' ');
  if (hasPrivateRepositoryCoordinate(structuralScanValue)) {
    return 'private repository coordinate';
  }
  if (hasPrivatePath(structuralScanValue)) return 'private repository path';
  const canonicalDirectiveValue = strictCanonical
    ? canonicalSecurityValue(directiveValue)
    : tolerantArtifactCanonicalValue(directiveValue).value;
  if (exactArtifactDirectivePattern.test(canonicalDirectiveValue)) {
    return 'raw directive';
  }
  if (scanDangerousExactText) {
    const canonicalDangerousValue = strictCanonical
      ? canonicalSecurityValue(dangerousValue)
      : tolerantArtifactCanonicalValue(dangerousValue).value;
    const structuralDangerousValue = canonicalDangerousValue.replace(/<!--|-->|\/\*|\*\//gu, ' ');
    if (hasDangerousSchemeInCanonicalText(structuralDangerousValue)) return 'dangerous URL scheme';
  }
  return null;
}

function scanBuiltTextArtifact(
  contents: string,
  relativePath: string,
  strictCanonical: boolean,
  context: ArtifactSyntaxContext,
): void {
  let sentinel: string | null;
  const scriptLike = context === 'generic' && scriptLikeArtifactExtensions.test(relativePath);
  try {
    const dangerousValue = context === 'html'
      ? maskSourceRanges(contents, htmlExecutableCodeRanges(contents))
      : contents;
    sentinel = exactArtifactSentinel(
      contents,
      strictCanonical,
      directiveScanSource(contents, context, relativePath),
      !scriptLike,
      dangerousValue,
    );
    if (!sentinel
      && strictCanonical
      && scriptLike) {
      sentinel = scriptSourceSentinel(contents, relativePath);
    }
  } catch (error) {
    throw new Error(`${relativePath} contains invalid canonical security text`, { cause: error });
  }
  if (sentinel) throw new Error(`${relativePath} contains forbidden exact bytes (${sentinel})`);
}

type BuiltScriptSource = { source: string; type: string | null };
type BuiltScriptPayloadKind = 'javascript' | 'json' | 'inert';

const javascriptMimeTypes = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript',
]);

function builtScriptPayloadKind(type: string | null): BuiltScriptPayloadKind {
  const normalized = (type ?? '').trim().toLowerCase();
  if (!normalized || normalized === 'module') return 'javascript';
  if (normalized === 'importmap' || normalized === 'speculationrules') return 'json';
  const mimeType = normalized.split(';', 1)[0]!.trim();
  if (javascriptMimeTypes.has(mimeType)) return 'javascript';
  if (mimeType === 'application/json' || mimeType.endsWith('+json')) return 'json';
  return 'inert';
}

function jsonSourceSentinel(source: string, label: string): string | null {
  let value: unknown;
  try {
    value = parseStrictJsonText(source, label);
  } catch (error) {
    if (error instanceof DuplicateJsonKeyError) return 'duplicate JSON object key';
    throw error;
  }
  const pending: unknown[] = [value];
  let visited = 0;
  while (pending.length > 0) {
    visited += 1;
    if (visited > 100_000) throw new Error(`${label} exceeds the structured-data node bound`);
    const current = pending.pop();
    if (typeof current === 'string') {
      const sentinel = decodedFragmentSentinel(current);
      if (sentinel) return sentinel;
    } else if (Array.isArray(current)) {
      pending.push(...current);
    } else if (current && typeof current === 'object') {
      for (const [key, child] of Object.entries(current)) pending.push(key, child);
    }
  }
  return null;
}

function builtScriptSourceSentinel(script: BuiltScriptSource, label: string): string | null {
  const kind = builtScriptPayloadKind(script.type);
  if (kind === 'javascript') return scriptSourceSentinel(script.source, `${label}.js`);
  if (kind === 'json') return jsonSourceSentinel(script.source, `${label}.json`);
  return decodedFragmentSentinel(script.source);
}

function parsedBuiltReaderDocument(contents: string): {
  visibleText: string;
  securityTextRuns: string[];
  accessibleText: string[];
  urls: string[];
  srcdocs: string[];
  inlineStyles: string[];
  scriptSources: BuiltScriptSource[];
} {
  const text: string[] = [];
  const securityTextRuns: string[] = [];
  let securityRun: string[] = [];
  const accessibleText: string[] = [];
  const urls: string[] = [];
  const srcdocs: string[] = [];
  const inlineStyles: string[] = [];
  const scriptSources: BuiltScriptSource[] = [];
  const boundary = (target: string[]) => {
    if (target.length > 0 && !target.at(-1)?.endsWith('\n')) target.push('\n');
  };
  const flushSecurityRun = () => {
    const value = securityRun.join('');
    if (value) securityTextRuns.push(value);
    securityRun = [];
  };
  const collectUrlAttributes = (element: HtmlElement) => {
    const tagName = element.tagName.toLowerCase();
    for (const attribute of element.attrs) {
      const name = attribute.name.toLowerCase();
      if (builtUrlAttributeNames.has(name) || (tagName === 'object' && name === 'data')) {
        urls.push(attribute.value);
      }
      if (name === 'srcset') {
        for (const candidate of attribute.value.split(',')) {
          const url = candidate.trim().split(/[\u0009-\u000d\u0020]+/u)[0];
          if (url) urls.push(url);
        }
      }
    }
  };
  const visit = (node: HtmlNode, readerVisible = true): void => {
    if (isHtmlTextNode(node)) {
      securityRun.push(node.value);
      if (readerVisible) text.push(node.value);
      return;
    }
    if (!isHtmlElement(node)) {
      for (const child of htmlChildNodes(node)) visit(child, readerVisible);
      return;
    }
    collectUrlAttributes(node);
    const tagName = node.tagName.toLowerCase();
    const attributes = new Map(node.attrs.map((attribute) => [attribute.name.toLowerCase(), attribute.value]));
    if (tagName === 'iframe' && attributes.has('srcdoc')) srcdocs.push(attributes.get('srcdoc')!);
    if (attributes.has('style')) inlineStyles.push(attributes.get('style')!);
    for (const attribute of node.attrs) {
      if (/^on[a-z]/iu.test(attribute.name)) {
        scriptSources.push({ source: attribute.value, type: null });
      }
    }
    if (tagName === 'script') {
      scriptSources.push({
        source: htmlChildNodes(node)
          .filter(isHtmlTextNode)
          .map((child) => child.value)
          .join(''),
        type: attributes.get('type') ?? null,
      });
    }
    if (tagName === 'meta'
      && attributes.get('http-equiv')?.toLowerCase() === 'refresh'
      && attributes.has('content')) {
      const refreshUrl = attributes.get('content')?.match(/(?:^|;)\s*url\s*=\s*([\s\S]*)$/iu)?.[1]
        ?.trim()
        .replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/u, '$1$2');
      if (refreshUrl) urls.push(refreshUrl);
    }
    if (readerVisible
      && (tagName === 'option' || tagName === 'optgroup' || tagName === 'track')
      && attributes.has('label')) {
      accessibleText.push(attributes.get('label')!);
    }
    if (readerVisible && tagName === 'th' && attributes.has('abbr')) {
      accessibleText.push(attributes.get('abbr')!);
    }
    if (isHtmlTemplate(node)) {
      flushSecurityRun();
      for (const child of htmlChildNodes(node)) visit(child, false);
      flushSecurityRun();
      return;
    }
    if (builtHiddenTextElements.has(tagName)) return;
    if (readerVisible) {
      for (const attribute of node.attrs) {
        if (builtAccessibleTextAttributeNames.has(attribute.name.toLowerCase())) {
          accessibleText.push(attribute.value);
        }
      }
    }
    if (readerVisible && tagName === 'input' && attributes.get('type')?.toLowerCase() !== 'hidden') {
      const value = attributes.get('value');
      if (value !== undefined) accessibleText.push(value);
    }
    if (readerVisible && tagName === 'meta') {
      const metadataName = (attributes.get('name') ?? attributes.get('property'))?.toLowerCase();
      const content = attributes.get('content');
      if (metadataName && builtPublicMetadataNames.has(metadataName) && content !== undefined) {
        accessibleText.push(content);
      }
      const itemProperties = attributes.get('itemprop')
        ?.toLowerCase()
        .split(/[\u0009-\u000d\u0020]+/u);
      if (itemProperties?.includes('description') && content !== undefined) {
        accessibleText.push(content);
      }
    }
    if (tagName === 'br') {
      flushSecurityRun();
      if (readerVisible) boundary(text);
      return;
    }
    const isBlock = builtBlockElements.has(tagName);
    if (isBlock) {
      flushSecurityRun();
      if (readerVisible) boundary(text);
    }
    for (const child of htmlChildNodes(node)) visit(child, readerVisible);
    if (isBlock) {
      flushSecurityRun();
      if (readerVisible) boundary(text);
    }
  };
  visit(parse(contents, { scriptingEnabled: false }));
  flushSecurityRun();
  return {
    visibleText: text.join(''),
    securityTextRuns,
    accessibleText,
    urls,
    srcdocs,
    inlineStyles,
    scriptSources,
  };
}

function scanBuiltReaderDocument(contents: string, relativePath: string, srcdocDepth = 0): void {
  scanEmbeddedCssGeneratedProse(contents, 'html', relativePath);
  const {
    visibleText,
    securityTextRuns,
    accessibleText,
    urls,
    srcdocs,
    inlineStyles,
    scriptSources,
  } = parsedBuiltReaderDocument(contents);
  if (inlineStyles.length > maxInlineStyleAttributes
    || inlineStyles.reduce((total, style) => total + style.length, 0) > maxCssSourceLength) {
    throw new Error(`${relativePath} exceeds the inline CSS input bound`);
  }
  for (const style of inlineStyles) {
    scanCssGeneratedProse(style, `${relativePath} inline style`, 'declarationList');
  }
  for (const script of scriptSources) {
    const sentinel = builtScriptSourceSentinel(script, `${relativePath} script`);
    if (sentinel) {
      throw new Error(`${relativePath} contains a forbidden embedded script sentinel (${sentinel})`);
    }
  }
  for (const url of urls) assertBuiltReaderUrlSafe(url, relativePath);
  for (const prose of [...securityTextRuns, ...accessibleText]) {
    const sentinel = decodedFragmentSentinel(prose);
    if (sentinel) {
      throw new Error(`${relativePath} contains a forbidden decoded HTML text sentinel (${sentinel})`);
    }
  }
  for (const prose of [visibleText, ...accessibleText]) {
    const sentinel = privateSentinel(prose);
    if (sentinel) throw new Error(`${relativePath} contains a forbidden private prose sentinel (${sentinel})`);
  }
  if (srcdocs.length > 0 && srcdocDepth >= maxSrcdocDepth) {
    throw new Error(`${relativePath} exceeds the bounded iframe srcdoc nesting depth`);
  }
  for (const srcdoc of srcdocs) {
    const nestedLabel = `${relativePath} iframe[srcdoc]`;
    scanBuiltTextArtifact(srcdoc, nestedLabel, true, 'html');
    scanBuiltReaderDocument(srcdoc, nestedLabel, srcdocDepth + 1);
  }
}

function scanBuiltSnapshotEntry(entry: ReleaseSnapshotEntry): void {
  if (entry.kind !== 'file' || !entry.bytes) return;
  const { bytes, relativePath } = entry;
  const context = artifactContext(relativePath, false);
  scanBuiltTextArtifact(bytes.toString('utf8'), relativePath, false, context);
  if (!builtTextExtensions.test(relativePath)) return;
  let contents: string;
  try {
    contents = strictUtf8.decode(bytes);
  } catch (error) {
    throw new Error(`${relativePath} is not valid UTF-8 reader output`, { cause: error });
  }
  scanBuiltTextArtifact(contents, relativePath, true, context);
  if (context === 'css') scanCssGeneratedProse(contents, relativePath);
  if (builtHtmlExtensions.test(relativePath)) scanBuiltReaderDocument(contents, relativePath);
  if (builtPlainProseExtensions.test(relativePath)) {
    const sentinel = privateSentinel(contents);
    if (sentinel) throw new Error(`${relativePath} contains a forbidden private prose sentinel (${sentinel})`);
  }
}

function scanGeneratedContentSnapshotEntry(entry: ReleaseSnapshotEntry): void {
  if (entry.kind !== 'file' || !entry.bytes) return;
  if (/\.md$/iu.test(entry.relativePath)) {
    let markdown: string;
    try {
      markdown = strictUtf8.decode(entry.bytes);
    } catch (error) {
      throw new Error(`${entry.relativePath} is not valid UTF-8 generated Markdown`, { cause: error });
    }
    const prefix = '---\n';
    const closingMarker = '\n---\n';
    const closingOffset = markdown.indexOf(closingMarker, prefix.length);
    if (!markdown.startsWith(prefix) || closingOffset < 0) {
      throw new Error(`${entry.relativePath} must use exact JSON-object frontmatter delimiters`);
    }
    const frontmatter = markdown.slice(prefix.length, closingOffset + 1);
    const body = markdown.slice(closingOffset + closingMarker.length);
    try {
      const parsedFrontmatter = parseStrictJsonText(frontmatter, `${entry.relativePath} frontmatter`);
      readerEntrySchema.parse(parsedFrontmatter);
      const sentinel = jsonSourceSentinel(frontmatter, `${entry.relativePath} frontmatter`);
      if (sentinel) {
        throw new Error(`forbidden generated frontmatter sentinel (${sentinel})`);
      }
    } catch (error) {
      throw new Error(`${entry.relativePath} contains invalid generated JSON frontmatter`, { cause: error });
    }
    assertReaderMarkdownSafe(body);
    return;
  }
  if (!/\.json$/iu.test(entry.relativePath)) {
    scanBuiltSnapshotEntry(entry);
    return;
  }
  let contents: string;
  try {
    contents = strictUtf8.decode(entry.bytes);
  } catch (error) {
    throw new Error(`${entry.relativePath} is not valid UTF-8 generated JSON`, { cause: error });
  }
  let sentinel: string | null;
  try {
    sentinel = jsonSourceSentinel(contents, entry.relativePath);
  } catch (error) {
    throw new Error(`${entry.relativePath} contains invalid generated JSON`, { cause: error });
  }
  if (sentinel) {
    throw new Error(`${entry.relativePath} contains a forbidden generated JSON sentinel (${sentinel})`);
  }
}

function scanReaderImageSnapshotEntry(entry: ReleaseSnapshotEntry): void {
  if (entry.kind !== 'file' || !entry.bytes) return;
  if (/\.svg$/u.test(entry.relativePath)) {
    assertApprovedReaderSvgBytes(entry.bytes, entry.relativePath);
    return;
  }
  if (/\.webp$/u.test(entry.relativePath)) return;
  throw new Error(`${entry.relativePath} has an unexpected reader static image extension`);
}

export async function scanReaderReleaseLayers(
  root: string | URL,
  options: ReaderReleaseScanOptions = {},
): Promise<void> {
  const projectRoot = rootPath(root);
  const snapshot = await captureReleaseSnapshot(projectRoot, true, true);
  try {
    for (const entry of snapshot.entries) {
      if (entry.layer !== 'runtime' || entry.kind !== 'file') continue;
      scanRuntimeSnapshotEntry(entry);
      await options.afterEntryScan?.(entry.relativePath);
    }
    const { loadValidatedReaderRelease } = await import('./load');
    await loadValidatedReaderRelease(projectRoot);
    for (const entry of snapshot.entries) {
      if (entry.layer !== 'generated-content' || entry.kind !== 'file') continue;
      scanGeneratedContentSnapshotEntry(entry);
      await options.afterEntryScan?.(entry.relativePath);
    }
    for (const entry of snapshot.entries) {
      if (entry.layer !== 'built' || entry.kind !== 'file') continue;
      scanBuiltSnapshotEntry(entry);
      await options.afterEntryScan?.(entry.relativePath);
    }
    const generatedImages = new Map<string, Buffer>();
    for (const entry of snapshot.entries) {
      if (entry.layer !== 'generated-image' || entry.kind !== 'file' || !entry.bytes) continue;
      scanReaderImageSnapshotEntry(entry);
      const name = entry.relativePath.slice(`${generatedReaderImageRoot}/`.length);
      generatedImages.set(name, entry.bytes);
      await options.afterEntryScan?.(entry.relativePath);
    }
    for (const entry of snapshot.entries) {
      if (entry.layer !== 'built-image' || entry.kind !== 'file' || !entry.bytes) continue;
      scanReaderImageSnapshotEntry(entry);
      const name = entry.relativePath.slice(`${builtReaderImageRoot}/`.length);
      const sourceBytes = generatedImages.get(name);
      if (!sourceBytes || !sourceBytes.equals(entry.bytes)) {
        throw new Error(`${entry.relativePath} is not an exact same-name generated image copy`);
      }
      await options.afterEntryScan?.(entry.relativePath);
    }
    await assertSnapshotHandlesUnchanged(snapshot);
    const current = await captureReleaseSnapshot(projectRoot, true, false);
    assertReleaseSnapshotsEqual(snapshot, current);
    await assertSnapshotHandlesUnchanged(snapshot);
  } finally {
    await closeReleaseSnapshot(snapshot);
  }
}
