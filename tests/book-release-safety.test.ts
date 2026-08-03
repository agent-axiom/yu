import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertReaderMarkdownSafe,
  assertReaderProseFieldsSafe,
  scanReaderReleaseLayers,
} from '../src/lib/book-release/validate';
import {
  validDocumentaryMedia,
  validNote,
  validObject,
  validSource,
} from './helpers/book-release-fixture';

async function writeLayerFile(root: string, path: string, contents: string): Promise<void> {
  const absolutePath = join(root, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}

describe('reader Markdown safety', () => {
  it.each([
    ['raw HTML', '<aside>Скрытый блок</aside>'],
    ['HTML comment', '<!-- private note -->'],
    ['inline image', '![Нефрит](jade.webp)'],
    ['reference image', '![Нефрит][jade]\n\n[jade]: jade.webp'],
    ['known residual directive', '::figure{id="jade-suit"}'],
    ['unknown residual directive', '::private-note{id="draft"}'],
    ['fragmented directive', 'Visible ::fig**ure**{id="example"}.'],
    ['partial inline-code directive', 'Visible ::fig`ure`{id="example"}.'],
    ['directive crossing out of code', 'Visible `::fig`ure{id="example"}.'],
    ['encoded directive split by code', 'Visible ::fig%`75`re{id="example"}.'],
    ['duplicate safe and unsafe directive', '`::figure{id="example"}` and ::figure{id="example"}.'],
    ['same directive adjacent to code', '`::figure{id="x"}`::figure{id="x"}'],
    ['different directive adjacent to code', '`::figure{id="x"}`::interlude{id="y"}'],
    ['encoded adjacent directive', '`::figure{id="x"}`%3A%3Ainterlude{id="y"}'],
    ['two adjacent ordinary directives', '::figure{id="x"}::interlude{id="y"}'],
  ])('rejects %s', (_label, markdown) => {
    expect(() => assertReaderMarkdownSafe(markdown)).toThrow(/HTML|image|directive|unsafe/iu);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html;base64,WA==',
    'file:///Users/if/private.md',
    '/Users/if/private.md',
    '//example.org/book',
    '../book/chapter/',
    '/book/rights/contracts/',
    'https://reader:secret@example.org/book',
    'https://github.com/agent-axiom/yu-book',
    'https://example.org/open?repo=agent-axiom%252Fyu-book',
    'https://example.org/jade?file=research%252Fclaims%252Fclaim.json',
    'https://example.org/a%20b',
    'https://example.org/a%0Ab',
    'https://example.org/a%2',
    'https&colon;&sol;&sol;reader&colon;secret&commat;example.org/book',
  ])('rejects dangerous or private destination %s', (url) => {
    expect(() => assertReaderMarkdownSafe(`[ссылка](${url})`)).toThrow(/private|unsafe|URL|scheme|route/iu);
  });

  it.each([
    'A leaked claim-secret remains.',
    'A leaked object-secret remains.',
    'A leaked media-secret remains.',
    'A leaked source-secret remains.',
    'A leaked interlude-secret remains.',
    'Private file manuscript/entries/chapter-04.md remains.',
    'Private report editorial/agent-review-cycles/cycle-02/report.md remains.',
    'Private note research/claims/claim-secret.json remains.',
    'Private dossier rights/media-secret.md remains.',
    'Leaked cl&percnt;61im&minus;secret remains.',
    'Leaked agent&minus;axiom&sol;yu&minus;book coordinate remains.',
    'Leaked agent-axiom&sol;yu&minus;book&commat;example.invalid coordinate remains.',
    'Leaked agent-axiom/./yu-book coordinate remains.',
    'Leaked agent-axiom/x/../yu-book coordinate remains.',
    'Leaked claim-**secret** remains.',
    'Leaked media-[secret](https://example.org/jade) remains.',
    'Leaked source-`secret` remains.',
    'Leaked agent-axiom/**yu-book** coordinate remains.',
  ])('rejects private prose sentinel: %s', (markdown) => {
    expect(() => assertReaderMarkdownSafe(markdown)).toThrow(/private|sentinel|reader/iu);
  });

  it.each([
    'https://example.org/jade',
    '/book/read/chapter-04/',
    '/book/read/jade-immortality/#portal-jade-immortality',
    '/book/objects/jade-suit/',
    '/book/media/jade-suit/',
    '/book/',
    '/book/prologue/',
    '/book/virtue-immortality/',
    '/book/jade-immortality/',
    '/book/sources/',
    '#note-001',
  ])('allows an exact reader destination %s', (url) => {
    expect(() => assertReaderMarkdownSafe(`[ссылка](${url})`)).not.toThrow();
  });

  it('allows directive examples inside inline and fenced code only', () => {
    expect(() => assertReaderMarkdownSafe([
      'Синтаксис `::figure{id="example"}` показан как код.',
      '',
      '```md',
      '::interlude{id="example"}',
      '```',
      '',
      '`::fig%75re{id="encoded"}` is encoded code.',
    ].join('\n'))).not.toThrow();
  });

  it('allows escaped or visibly separated control-like prose', () => {
    expect(() => assertReaderMarkdownSafe([
      String.raw`Escaped \::figure{id="example"} remains prose.`,
      'Visible ::fig `ure`{id="example"} has a real space boundary.',
    ].join('\n'))).not.toThrow();
  });

  it.each([
    '`::figure{id="x"}`*`::interlude{id="y"}`*',
    '`::figure{id="x"}`\\\\::interlude{id="y"}',
    '`::figure{id="x"}`:::interlude{id="y"}',
  ])('allows adjacent complete-code or escaped control neighbors: %s', (markdown) => {
    expect(() => assertReaderMarkdownSafe(markdown)).not.toThrow();
  });

  it('allows ordinary scholarly HTTPS path words', () => {
    expect(() => assertReaderMarkdownSafe([
      '[Исследование](https://example.org/research/jade)',
      '[Каталог](https://example.org/rights/catalogue)',
      '[Исследовательский архив](https://example.org/research/claims/catalogue)',
      'Источник: https://example.org/editorial/policy.',
    ].join('\n'))).not.toThrow();
  });

  it.each([
    'Invalid entity: %26%23x110000%3B.',
    'Invalid surrogate entity: %26%23xD800%3B.',
  ])('rejects an invalid canonical entity deterministically: %s', (markdown) => {
    expect(() => assertReaderMarkdownSafe(markdown)).toThrow(/entity|code point|canonical/iu);
  });
});

describe('record prose safety is structural, not a blanket public-ID ban', () => {
  it('accepts declared public IDs while scanning reader-facing prose', () => {
    expect(() => assertReaderProseFieldsSafe({
      notes: [validNote],
      sources: [validSource],
      objects: [validObject],
      media: [validDocumentaryMedia],
    })).not.toThrow();
  });

  it.each([
    ['note statement', { notes: [{ ...validNote, statement: 'Внутренняя ссылка claim-secret не должна попасть в читательский текст.' }] }],
    ['source locator', { sources: [{ ...validSource, locators: ['research/claims/claim-secret.json'] }] }],
    ['object boundary', { objects: [{ ...validObject, provenanceBoundary: 'См. закрытый файл rights/media-secret.md для внутренней проверки.' }] }],
    ['media caption', { media: [{ ...validDocumentaryMedia, caption: 'Черновая подпись содержит media-secret и не является публичной.' }] }],
  ])('rejects a private sentinel in %s', (_label, snapshot) => {
    expect(() => assertReaderProseFieldsSafe({
      notes: [],
      sources: [],
      objects: [],
      media: [],
      ...snapshot,
    })).toThrow(/private|sentinel/iu);
  });
});

describe('release-layer sentinel scan', () => {
  it('accepts the checked-in runtime source when generated roots are absent', async () => {
    await expect(scanReaderReleaseLayers(process.cwd())).resolves.toBeUndefined();
  });

  it.each([
    'src/layouts/BookLayout.astro',
    'src/pages/book/index.astro',
    'src/components/book/ObjectPassport.astro',
    'src/lib/book-release/example.ts',
    'src/styles/book.css',
    'src/content/book-release/entries/prologue.md',
    'public/images/book-release/leak.svg',
    'dist/book/index.html',
  ])('rejects a forbidden token planted in %s', async (path) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-'));
    try {
      await writeLayerFile(root, path, '<p>claim-private-layer</p>');
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(new RegExp(path.split('/').at(-1)!, 'iu'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('ignores missing optional layers and accepts sentinel-free bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-safe-'));
    try {
      await writeLayerFile(root, 'src/pages/book/index.astro', '<main>Живой нефрит</main>');
      await writeLayerFile(root, 'dist/book/index.html', '<main>Живой нефрит</main>');
      await expect(scanReaderReleaseLayers(root)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
