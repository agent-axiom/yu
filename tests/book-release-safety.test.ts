import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertReaderMarkdownSafe,
  assertReaderProseFieldsSafe,
  readerMarkdownLinks,
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

function nestedPercentEncoding(value: string, depth: number): string {
  let encoded = value;
  for (let index = 0; index < depth; index += 1) encoded = encodeURIComponent(encoded);
  return encoded;
}

const privateSeparatorVariants = [
  ['named hyphen', 'claim&hyphen;secret'],
  ['named minus', 'claim&minus;secret'],
  ['numeric hyphen', 'claim&#x2010;secret'],
  ['numeric minus', 'claim&#x2212;secret'],
  ['named fraction slash', 'research&frasl;claims/secret'],
  ['literal division slash', 'research∕claims/secret'],
  ['literal fraction slash repository', 'agent-axiom⁄yu-book'],
  ['literal set-minus reverse solidus', 'research∖claims/secret'],
  ['literal reverse-solidus operator repository', 'agent-axiom⧵yu-book'],
  ['literal big reverse solidus', 'research⧹claims/secret'],
  ['percent-encoded fraction slash repository', 'agent-axiom%E2%81%84yu-book'],
] as const;

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

function nestedSrcdoc(depth: number, leaf: string): string {
  let document = leaf;
  for (let index = 0; index < depth; index += 1) {
    document = `<iframe srcdoc="${escapeHtmlAttribute(document)}"></iframe>`;
  }
  return document;
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
    ['leaf directive without attributes', '::private'],
    ['figure leaf directive without attributes', '::figure'],
    ['leaf directive with a label', '::private[label]'],
    ['container directive', ':::private'],
    ['text directive', ':private[label]'],
    ['encoded leaf directive', '%3A%3Aprivate%5Blabel%5D'],
    ['formatted leaf directive', '::pri**vate**[label]'],
    ['formatted text directive', ':pri*vate*[label]'],
    ['directive immediately after inline code', '`::private[label]`::figure'],
    ['container directive immediately after inline code', '`::private[label]`:::private'],
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

  it.each(privateSeparatorVariants)('rejects a security-separator alias in Markdown: %s', (_label, value) => {
    expect(() => assertReaderMarkdownSafe(`Leaked ${value} remains.`)).toThrow(/private|sentinel|reader/iu);
  });

  it.each([
    ['NUL', `Visible\u0000text`],
    ['escape', `Visible\u001Btext`],
    ['C1 next-line', `Visible\u0085text`],
  ])('rejects Unicode control %s in reader Markdown', (_label, markdown) => {
    expect(() => assertReaderMarkdownSafe(markdown)).toThrow(/Unicode|control|unsafe/iu);
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

  it('returns one canonical representation for encoded structural links', () => {
    expect(readerMarkdownLinks([
      '[сноска](#note%2D001)',
      '[переход](/book/%72ead/jade-immortality/)',
    ].join('\n'))).toEqual([
      '#note-001',
      '/book/read/jade-immortality/',
    ]);
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
      '`::private` and `::figure` and `::private[label]` are code.',
      '`:::private` and `:private[label]` are code.',
      '',
      '```md',
      '::private',
      '::figure',
      '::private[label]',
      ':::private',
      ':private[label]',
      '```',
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

  it.each([
    ['zero-width space', `Visible\u200Btext`],
    ['soft hyphen', `Visible\u00ADtext`],
    ['right-to-left override', `Visible\u202Etext`],
    ['left-to-right isolate', `Visible\u2066text`],
  ])('rejects Unicode format control %s in reader Markdown', (_label, markdown) => {
    expect(() => assertReaderMarkdownSafe(markdown)).toThrow(/Unicode|format|control|unsafe/iu);
  });

  it.each([
    `https://example.org/ja\u200Bde`,
    `https://example.org/ja\u00ADde`,
    `https://example.org/jade?direction=\u202Esecret`,
  ])('rejects Unicode format controls in a Markdown URL: %s', (url) => {
    expect(() => assertReaderMarkdownSafe(`[source](${url})`)).toThrow(/Unicode|format|control|unsafe/iu);
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

  it.each(privateSeparatorVariants)('rejects a security-separator alias in record prose: %s', (_label, value) => {
    expect(() => assertReaderProseFieldsSafe({
      notes: [{ ...validNote, statement: `Leaked ${value} remains.` }],
    })).toThrow(/private|sentinel|reader/iu);
  });

  it('rejects a Unicode Cc control in record prose', () => {
    expect(() => assertReaderProseFieldsSafe({
      objects: [{ ...validObject, culture: `Han\u0007China` }],
    })).toThrow(/Unicode|control|unsafe/iu);
  });

  it.each([
    ['source volume', { sources: [{ ...validSource, volume: 'claim-secret' }] }],
    ['source issue', { sources: [{ ...validSource, issue: 'research/claims/secret' }] }],
    ['source pages', { sources: [{ ...validSource, pages: 'rights/private-pages' }] }],
    ['source DOI', { sources: [{ ...validSource, doi: '10.1234/claim-secret' }] }],
    ['source URL query', { sources: [{ ...validSource, url: 'https://example.org/jade?repo=agent-axiom%252Fyu-book' }] }],
    ['source URL fragment', { sources: [{ ...validSource, url: 'https://example.org/jade#file=research%252Fclaims%252Fsecret' }] }],
    ['source URL control', { sources: [{ ...validSource, url: 'https://example.org/jade%0Asecret' }] }],
    ['media license URL', { media: [{ ...validDocumentaryMedia, licenseUrl: 'https://example.org/license?repo=agent-axiom%252Fyu-book' }] }],
    ['media source URL', { media: [{ ...validDocumentaryMedia, sourceUrl: 'https://example.org/image#file=research%252Fclaims%252Fsecret' }] }],
  ])('rejects a private or unsafe structured %s', (_label, snapshot) => {
    expect(() => assertReaderProseFieldsSafe({
      notes: [],
      sources: [],
      objects: [],
      media: [],
      ...snapshot,
    })).toThrow(/private|sentinel|URL|unsafe|control/iu);
  });

  it.each([
    ['source metadata', { sources: [{ ...validSource, volume: `4\u200B2` }] }],
    ['object prose', { objects: [{ ...validObject, culture: `Han\u00ADChina` }] }],
    ['media prose', { media: [{ ...validDocumentaryMedia, caption: `Jade\u202Esuit in a museum display.` }] }],
    ['record URL', { sources: [{ ...validSource, url: `https://example.org/ja\u2066de` }] }],
  ])('rejects a Unicode format control in %s', (_label, snapshot) => {
    expect(() => assertReaderProseFieldsSafe({
      notes: [],
      sources: [],
      objects: [],
      media: [],
      ...snapshot,
    })).toThrow(/Unicode|format|control|unsafe/iu);
  });

  it('accepts complete safe scholarly source metadata and external URLs', () => {
    expect(() => assertReaderProseFieldsSafe({
      sources: [{
        ...validSource,
        containerTitle: 'Journal of Archaeological Science',
        volume: '42',
        issue: '3',
        pages: '101–118',
        doi: '10.1234/jade.2024.42',
        url: 'https://example.org/research/claims/catalogue?edition=2#table-1',
      }],
      media: [{
        ...validDocumentaryMedia,
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        sourceUrl: 'https://museum.example/research/rights/catalogue',
      }],
    })).not.toThrow();
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

  it('accepts structural public IDs in non-reader-facing built markup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-dist-'));
    try {
      await writeLayerFile(root, 'dist/book/index.html', [
        '<main data-source-id="source-museum" data-object-id="object-jade-suit"',
        ' data-media-id="media-jade-suit" data-entry-id="interlude-jade-immortality">',
        '<p>Живой нефрит</p>',
        '<a href="/yu/book/read/jade-immortality/#portal-jade-immortality">Читать</a>',
        '</main>',
      ].join(''));
      await expect(scanReaderReleaseLayers(root)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a private sentinel hidden in a built reader-facing URL', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-dist-url-'));
    try {
      await writeLayerFile(
        root,
        'dist/book/index.html',
        '<a href="https://example.org/jade?repo=agent-axiom%252Fyu-book">Источник</a>',
      );
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/private|sentinel|index\.html/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['private ID split by inline emphasis', '<p>claim-<em>secret</em></p>'],
    ['private path split by an inline span', '<p>resea<span>rch/claims/secret</span></p>'],
    ['repository coordinate split by inline strong text', '<p>agent-axiom/<strong>yu-book</strong></p>'],
  ])('rejects %s in the parsed visible text', async (_label, markup) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-dist-visible-'));
    try {
      await writeLayerFile(root, 'dist/book/index.html', markup);
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/private|sentinel|prose|index\.html/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(privateSeparatorVariants.flatMap(([variantLabel, value]) => [
    [`${variantLabel} in visible text`, `<p>${value}</p>`],
    [`${variantLabel} in ARIA text`, `<button aria-label="${value}">Jade</button>`],
  ]))('rejects a security-separator alias in parsed %s', async (_label, markup) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-dist-separator-'));
    try {
      await writeLayerFile(root, 'dist/book/index.html', markup);
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/private|sentinel|prose|index\.html/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['visible text', `<p>Jade\u001Bsecret</p>`],
    ['ARIA text', `<button aria-label="Jade\u001Bsecret">Jade</button>`],
  ])('rejects a Unicode Cc control in parsed %s', async (_label, markup) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-dist-control-'));
    try {
      await writeLayerFile(root, 'dist/book/index.html', markup);
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/Unicode|control|unsafe|index\.html/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['image alternative text', '<img src="/jade.webp" alt="claim-secret">'],
    ['element title', '<span title="object-secret">Нефрит</span>'],
    ['document title', '<title>media-secret</title><main>Нефрит</main>'],
    ['ARIA label', '<button aria-label="source-secret"></button>'],
    ['ARIA value text', '<input type="range" aria-valuetext="claim-secret">'],
    ['ARIA role description', '<section aria-roledescription="object-secret">Нефрит</section>'],
    ['ARIA placeholder', '<input aria-placeholder="source-secret">'],
    ['button input value', '<input type="button" value="media-secret">'],
    ['description metadata', '<meta name="description" content="interlude-secret"><main>Нефрит</main>'],
    ['no-script fallback', '<noscript><p>claim-<em>secret</em></p></noscript>'],
    ['option label', '<select><option label="claim-secret">Jade</option></select>'],
    ['track label', '<video><track label="claim-secret"></video>'],
    ['table-header abbreviation', '<table><tr><th abbr="claim-secret">Jade</th></tr></table>'],
    ['Open Graph image alternative', '<meta property="og:image:alt" content="claim-secret"><main>Jade</main>'],
    ['author metadata', '<meta name="author" content="claim-secret"><main>Jade</main>'],
  ])('rejects a private ID in accessible %s', async (_label, markup) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-dist-accessible-'));
    try {
      await writeLayerFile(root, 'dist/book/index.html', markup);
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/private|sentinel|prose|index\.html/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['visible prose', '<p>claim-secret</p>'],
    ['ARIA prose', '<button aria-label="claim-secret">Jade</button>'],
    ['reader URL', '<a href="javascript:alert(1)">Jade</a>'],
    ['generated CSS prose', '<style>.jade::before{content:"claim-" "secret"}</style><main>Jade</main>'],
  ])('recursively rejects unsafe iframe srcdoc %s', async (_label, nestedDocument) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-srcdoc-'));
    try {
      await writeLayerFile(root, 'dist/book/index.html', nestedSrcdoc(2, nestedDocument));
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/private|sentinel|prose|URL|scheme|CSS|srcdoc|index\.html/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed when iframe srcdoc nesting exceeds the bounded depth', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-srcdoc-depth-'));
    try {
      await writeLayerFile(root, 'dist/book/index.html', nestedSrcdoc(10, '<p>Jade</p>'));
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/srcdoc|depth|nested|index\.html/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps semantic block and line-break boundaries in parsed visible text', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-dist-boundaries-'));
    try {
      await writeLayerFile(root, 'dist/book/index.html', [
        '<p>claim</p><p>-secret</p>',
        '<div>research</div><div>/claims/secret</div>',
        '<p>agent-axiom<br>/yu-book</p>',
      ].join(''));
      await expect(scanReaderReleaseLayers(root)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not treat hidden structural IDs as reader-visible prose', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-dist-hidden-'));
    try {
      await writeLayerFile(root, 'dist/book/index.html', [
        '<!-- claim-private-comment -->',
        '<script>const ids = ["source-museum", "object-private-script"];</script>',
        '<style>.claim-private-style { display: none }</style>',
        '<template><span data-id="media-private-template">hidden</span></template>',
        '<main><p>Живой нефрит</p></main>',
      ].join(''));
      await expect(scanReaderReleaseLayers(root)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['adjacent strings', '.jade::before{content:"claim-" "secret"}'],
    ['escaped adjacent strings', String.raw`.jade::marker{content:"claim\2d " "secret"}`],
    ['escaped property name', String.raw`.jade::before{\63 ontent:"claim\2d secret"}`],
    ['style-block adjacent strings', '<style>.jade::before{content:"agent-axiom" "/yu-book"}</style><main>Jade</main>'],
    [
      'style-block escaped property name',
      String.raw`<style>.jade::before{con\74 ent:"claim\2d secret"}</style><main>Jade</main>`,
    ],
    ['generated attr()', '.jade::before{content:attr(data-label)}'],
    ['generated var()', '.jade::before{content:var(--reader-label)}'],
    ['generated env()', '.jade::before{content:env(reader-label)}'],
    ['nested strings in an unknown function', '.jade::before{content:foo("claim-" "secret")}'],
    ['nested strings in a static image function', '.jade::before{content:image("claim-" "secret")}'],
    ['unknown dynamic function', '.jade::before{content:target-text(url)}'],
    ['excessively encoded generated prose', `.jade::before{content:"${nestedPercentEncoding('claim-secret', 9)}"}`],
    ['nested directive in pseudo arguments', '::highlight(::private){color:inherit}'],
    ['malformed stylesheet', '.jade::before{content:"safe"'],
  ])('rejects unsafe CSS-generated prose in %s', async (_label, stylesheet) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-css-content-'));
    try {
      const isDocument = stylesheet.startsWith('<style>');
      await writeLayerFile(root, isDocument ? 'dist/book/index.html' : 'dist/book/styles.css', stylesheet);
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/private|sentinel|CSS|content|attr|index\.html|styles\.css/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['custom highlight', '::highlight(search){color:inherit}'],
    ['functional part', '.jade::part(label){color:inherit}'],
    ['standard pseudo and safe generated prose', '.jade::before{content:"safe jade"}'],
    ['escaped standard pseudo', String.raw`.jade::be\66 ore{content:"safe jade"}`],
    ['safe counter content', '.jade::before{content:counter(chapter) ". "}'],
  ])('accepts syntactically valid CSS pseudo-elements: %s', async (_label, stylesheet) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-css-pseudo-'));
    try {
      await writeLayerFile(root, 'dist/book/styles.css', stylesheet);
      await expect(scanReaderReleaseLayers(root)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts a legitimate pseudo-element in a static Astro style block', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-astro-pseudo-'));
    try {
      await writeLayerFile(root, 'src/layouts/Reader.astro', [
        '---',
        'const title = "玉 · Jade";',
        '---',
        '<main>{title} — нефрит</main>',
        '<style>::highlight(search){color:inherit}</style>',
      ].join('\n'));
      await expect(scanReaderReleaseLayers(root)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects escaped CSS content property names in a static Astro style block', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-astro-content-escape-'));
    try {
      await writeLayerFile(root, 'src/layouts/Reader.astro', [
        '<main>Jade</main>',
        String.raw`<style>.jade::before{\63 ontent:"claim\2d secret"}</style>`,
      ].join('\n'));
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/private|sentinel|CSS|content|Reader\.astro/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts safe CSS pseudo-elements only after recursively validating iframe srcdoc', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-safe-srcdoc-css-'));
    try {
      await writeLayerFile(root, 'dist/book/index.html', nestedSrcdoc(
        2,
        '<style>.jade::before{content:"safe jade"}</style><main>Jade</main>',
      ));
      await expect(scanReaderReleaseLayers(root)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['stylesheet source size', 'dist/book/styles.css', ' '.repeat(1_000_001)],
    ['stylesheet node count', 'dist/book/styles.css', '.x{}'.repeat(20_001)],
    [
      'stylesheet nesting depth',
      'dist/book/styles.css',
      `${'@media all{'.repeat(140)}.jade{color:inherit}${'}'.repeat(140)}`,
    ],
    ['embedded empty style-block count', 'dist/book/index.html', '<style></style>'.repeat(65)],
  ])('rejects an adversarial CSS %s bound', async (_label, path, contents) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-css-bound-'));
    try {
      await writeLayerFile(root, path, contents);
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/CSS|bound|size|node|nest|style|index\.html|styles\.css/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['HTML pseudo lookalike', 'dist/book/index.html', '<p>::before</p>'],
    ['HTML functional lookalike', 'dist/book/index.html', '<p>::part[label]</p>'],
    ['JavaScript pseudo lookalike', 'dist/book/runtime.js', 'const value = "::selection";'],
    ['JavaScript directive-shaped pseudo', 'dist/book/runtime.js', 'const value = "::before{id=secret}";'],
    ['CSS string directive', 'dist/book/styles.css', '.jade{content:"::before"}'],
    ['CSS comment directive', 'dist/book/styles.css', '/* ::private */ .jade{color:inherit}'],
  ])('rejects directive syntax outside a CSS selector: %s', async (_label, path, contents) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-context-directive-'));
    try {
      await writeLayerFile(root, path, contents);
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/directive|forbidden|index\.html|runtime\.js|styles\.css/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['HTML comment', 'dist/book/index.html', '<!-- agent-axiom/yu-book --><main>Нефрит</main>'],
    ['compact repository comment', 'dist/book/index.html', '<!--agent-axiom/yu-book--><main>Нефрит</main>'],
    ['compact private-path comment', 'dist/book/index.html', '<!--research/claims/secret--><main>Нефрит</main>'],
    ['compact dangerous-scheme comment', 'dist/book/index.html', '<!--javascript:alert(1)--><main>Нефрит</main>'],
    [
      'JSON-LD script',
      'dist/book/index.html',
      '<script type="application/ld+json">{"path":"research/claims/secret"}</script><main>Нефрит</main>',
    ],
    ['template directive', 'dist/book/index.html', '<template>::private</template><main>Нефрит</main>'],
    ['compact comment directive', 'dist/book/index.html', '<!--::private--><main>Нефрит</main>'],
    ['compact block-comment directive', 'dist/book/runtime.js', '/*::private*/'],
    ['compact line-comment directive', 'dist/book/runtime.js', '//::private'],
    ['encoded runtime private path', 'dist/book/runtime.js', 'const path = "research%2Fclaims%2Fsecret";'],
    [
      'excessively nested runtime private path',
      'dist/book/runtime.js',
      `const path = "${nestedPercentEncoding('research/claims/secret', 9)}";`,
    ],
    [
      'mixed nested runtime repository',
      'dist/book/runtime.js',
      `const repository = "${nestedPercentEncoding('agent-axiom&sol;yu-book', 9)}";`,
    ],
    ['invalid canonical UTF-8 run', 'dist/book/runtime.js', 'const malformed = "%FF";'],
    ['stylesheet dangerous scheme', 'dist/book/styles.css', '.cover{background-image:url(javascript:alert(1))}'],
    ['runtime Unicode format control', 'dist/book/runtime.js', `const label = "jade\u200Bsecret";`],
  ])('rejects forbidden exact bytes in a built %s', async (_label, path, contents) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-dist-bytes-'));
    try {
      await writeLayerFile(root, path, contents);
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/private|sentinel|directive|scheme|Unicode|format|control|index\.html|runtime\.js|styles\.css/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('allows declared public IDs in downloadable text and binary payload bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-dist-public-'));
    try {
      await writeLayerFile(root, 'dist/book/runtime.js', [
        'const ids = ["source-museum", "object-jade-suit", "media-jade-suit",',
        '  "interlude-jade-immortality"];',
      ].join('\n'));
      await writeLayerFile(root, 'dist/book/catalogue.json', JSON.stringify({
        sourceId: 'source-museum',
        objectId: 'object-jade-suit',
      }));
      await writeLayerFile(root, 'dist/book/styles.css', [
        '::selection{color:inherit}',
        '@supports selector(::before){.jade::before{content:"safe"}}',
      ].join(''));
      const binaryPath = join(root, 'dist/book/jade.webp');
      await mkdir(dirname(binaryPath), { recursive: true });
      await writeFile(binaryPath, Buffer.concat([
        Buffer.from([0x52, 0x49, 0x46, 0x46, 0xff, 0x00, 0x80]),
        Buffer.from('source-museum', 'utf8'),
      ]));
      await expect(scanReaderReleaseLayers(root)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['binary repository bytes', 'dist/book/jade.webp', 'agent-axiom/yu-book'],
    ['unknown-extension encoded path bytes', 'dist/book/payload.opaque', 'research%2Fclaims%2Fsecret'],
    ['font directive bytes', 'dist/book/jade.woff2', '::private'],
  ])('rejects forbidden raw bytes in %s', async (_label, path, sentinel) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-dist-raw-bytes-'));
    try {
      const absolutePath = join(root, path);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, Buffer.concat([
        Buffer.from([0x00, 0xff, 0x80]),
        Buffer.from(sentinel, 'utf8'),
        Buffer.from([0x00, 0xfe]),
      ]));
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/private|sentinel|directive|bytes|webp|opaque|woff2/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['percent-encoded path', 'src/layouts/Encoded.astro', 'const value = "research%2Fclaims%2Fsecret";'],
    ['entity-encoded repository', 'src/pages/book/encoded.astro', 'const value = "agent-axiom&sol;yu-book";'],
    ['NFKC path', 'src/components/book/Encoded.astro', 'const value = "ｒｅｓｅａｒｃｈ／ｃｌａｉｍｓ／secret";'],
    ['zero-width space', 'src/lib/book-release/encoded.ts', `const value = "jade\u200Bsecret";`],
    ['soft hyphen', 'src/styles/book.css', `.jade::after { content: "jade\u00ADsecret" }`],
    ['encoded zero-width space', 'src/layouts/EncodedControl.astro', 'const value = "jade%E2%80%8Bsecret";'],
    ['entity soft hyphen', 'src/pages/book/encoded-control.astro', 'const value = "jade&#xAD;secret";'],
    [
      'excessively nested path',
      'src/lib/book-release/nested.ts',
      `const value = "${nestedPercentEncoding('research/claims/secret', 9)}";`,
    ],
  ])('rejects canonical or Unicode-hidden runtime source sentinel: %s', async (_label, path, contents) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-runtime-canonical-'));
    try {
      await writeLayerFile(root, path, contents);
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/private|sentinel|Unicode|format|control|canonical|encoded|book\.css/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(privateSeparatorVariants)('rejects a security-separator alias in runtime source: %s', async (_label, value) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-runtime-separator-'));
    try {
      await writeLayerFile(root, 'src/pages/book/separator.astro', `<p>${value}</p>`);
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/private|sentinel|separator\.astro/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['Windows user path', 'const value = String.raw`C:\\Users\\reader\\private.md`;'],
    ['UNC path', 'const value = String.raw`\\\\server\\share\\private.md`;'],
    ['backslash private root', 'const value = String.raw`research\\claims\\secret`;'],
    ['raw directive', 'const value = "::private";'],
    ['JavaScript scheme', 'const value = "javascript:alert(1)";'],
    ['data scheme', 'const value = "data:text/html,secret";'],
    ['file scheme', 'const value = "file:///Users/reader/private.md";'],
    ['VBScript scheme', 'const value = "vbscript:msgbox(1)";'],
    ['C0 control', `const value = "jade\u001Bsecret";`],
  ])('rejects an unsafe runtime source boundary: %s', async (_label, contents) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-runtime-boundary-'));
    try {
      await writeLayerFile(root, 'src/pages/book/boundary.ts', contents);
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/private|sentinel|directive|scheme|Unicode|control|boundary\.ts/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['built private path', 'dist/book/research∕claims/secret.txt'],
    ['built repository coordinate', 'dist/book/agent-axiom⁄yu-book.txt'],
    ['built raw directive', 'dist/book/::private.txt'],
    ['built dangerous scheme', 'dist/book/javascript:payload.js'],
    ['built Unicode control', `dist/book/jade\u200Bsecret.txt`],
    ['built C0 control', `dist/book/jade\u001Bsecret.txt`],
    ['runtime private path', 'src/pages/book/research∕claims/secret.astro'],
    ['runtime repository coordinate', 'src/pages/book/agent-axiom⁄yu-book.astro'],
    ['runtime raw directive', 'src/pages/book/::private.astro'],
    ['runtime dangerous scheme', 'src/pages/book/data:payload.astro'],
    ['runtime Unicode control', `src/pages/book/jade\u200Bsecret.astro`],
    ['runtime C0 control', `src/pages/book/jade\u001Bsecret.astro`],
  ])('rejects a forbidden relative path name: %s', async (_label, path) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-path-name-'));
    try {
      await writeLayerFile(root, path, 'Jade');
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/path|private|repository|directive|scheme|Unicode|control/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('allows neutral public IDs in runtime and built relative path names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-public-path-name-'));
    try {
      await writeLayerFile(root, 'src/pages/book/source-museum.astro', '<main>Jade</main>');
      await writeLayerFile(root, 'dist/book/object-jade-suit/index.html', '<main>Jade</main>');
      await expect(scanReaderReleaseLayers(root)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('allows source code that constructs policy tokens from separate safe literals', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-runtime-split-'));
    try {
      await writeLayerFile(root, 'src/lib/book-release/policy.ts', [
        "const prefix = 'cl' + 'aim';",
        "const privateRoot = 'resea' + 'rch';",
        "const repository = 'agent-' + 'axiom/' + 'yu-' + 'book';",
      ].join('\n'));
      await expect(scanReaderReleaseLayers(root)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
