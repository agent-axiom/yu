import { link, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

  it.each([
    ['runtime source', 'src/pages/book/index.astro', '<main>Jade</main>'],
    ['built artifact', 'dist/book/index.html', '<main>Jade</main>'],
  ])('rejects a multiply linked %s', async (_label, path, contents) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-hardlink-'));
    try {
      await writeLayerFile(root, path, contents);
      const alias = join(root, `${path}.alias`);
      await link(join(root, path), alias);
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/hard link|multiple links|nlink|regular file/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts neutral public structural IDs in runtime source layers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-runtime-public-id-'));
    try {
      await writeLayerFile(
        root,
        'src/layouts/Reader.astro',
        '<main data-source-id="source-museum">Jade</main>',
      );
      await writeLayerFile(root, 'src/lib/book-release/public-id.ts', 'const id = "source-museum";');
      await writeLayerFile(root, 'src/styles/book.css', '.source-museum{color:inherit}');
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

  it.each([
    ['inline dangerous scheme', '<p>java<em>script:alert(1)</em></p>'],
    ['inline directive', '<p>:<em>:private</em></p>'],
    [
      'template inline dangerous scheme',
      '<template><p>java<em>script:alert(1)</em></p></template><main>Jade</main>',
    ],
    ['srcdoc inline directive', nestedSrcdoc(1, '<p>:<em>:private</em></p>')],
  ])('rejects a forbidden token reconstructed from %s', async (_label, markup) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-dist-inline-security-'));
    try {
      await writeLayerFile(root, 'dist/book/index.html', markup);
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(
        /directive|scheme|sentinel|srcdoc|index\.html/iu,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['block elements', '<p>java</p><p>script: ordinary prose</p>'],
    ['line break', '<p>java<br>script: ordinary prose</p>'],
    [
      'template block elements',
      '<template><p>java</p><p>script: ordinary prose</p></template><main>Jade</main>',
    ],
  ])('keeps %s as a reconstructed security boundary', async (_label, markup) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-dist-security-boundary-'));
    try {
      await writeLayerFile(root, 'dist/book/index.html', markup);
      await expect(scanReaderReleaseLayers(root)).resolves.toBeUndefined();
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
    ['option-group label', '<select><optgroup label="claim-secret"><option>Jade</option></optgroup></select>'],
    ['schema itemprop description', '<meta itemprop="description" content="claim-secret"><main>Jade</main>'],
    [
      'schema itemprop description token',
      '<meta itemprop="name description" content="claim-secret"><main>Jade</main>',
    ],
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
    [
      'script object keys',
      '<script>const row = { data: 1, file: 2 };</script><main>Jade</main>',
    ],
    [
      'event-handler object keys',
      '<button onclick="const row = { data: 1, file: 2 }">Jade</button>',
    ],
  ])('allows ordinary data and file grammar in a built HTML %s', async (_label, markup) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-html-script-grammar-'));
    try {
      await writeLayerFile(root, 'dist/book/index.html', markup);
      await expect(scanReaderReleaseLayers(root)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('allows ordinary data and file grammar in a static Astro script', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-astro-script-grammar-'));
    try {
      await writeLayerFile(
        root,
        'src/layouts/Reader.astro',
        '<script>const row = { data: 1, file: 2 };</script><main>Jade</main>',
      );
      await expect(scanReaderReleaseLayers(root)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    [
      'JSON-LD',
      '<script type="application/ld+json">{"name":"Jade","data":{"file":"catalogue"}}</script><main>Jade</main>',
    ],
    [
      'application/json',
      '<script type="application/json">{"name":"Jade","data":{"file":"catalogue"}}</script><main>Jade</main>',
    ],
  ])('allows safe structured data in a built HTML %s script', async (_label, markup) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-html-json-'));
    try {
      await writeLayerFile(root, 'dist/book/index.html', markup);
      await expect(scanReaderReleaseLayers(root)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    [
      'Unicode-escaped scheme',
      '<script type="application/ld+json">{"url":"java\\u0073cript:alert(1)"}</script>',
    ],
    [
      'WHATWG control-folded scheme',
      '<script type="application/ld+json">{"url":"java\\tscript:alert(1)"}</script>',
    ],
    [
      'Unicode-escaped repository',
      '<script type="application/ld+json">{"repo":"agent-axiom\\u002fyu-book"}</script>',
    ],
    [
      'Unicode-escaped directive',
      '<script type="application/ld+json">{"control":"\\u003a\\u003aprivate"}</script>',
    ],
    [
      'Unicode-escaped format control',
      '<script type="application/ld+json">{"control":"jade\\u202esecret"}</script>',
    ],
    [
      'mixed-separator absolute path',
      '<script type="application/ld+json">{"path":"\\u002fUsers\\u005creader\\u005csecret.md"}</script>',
    ],
    [
      'malformed JSON',
      '<script type="application/ld+json">{"name":}</script>',
    ],
  ])('rejects unsafe structured data in a built HTML %s script', async (_label, markup) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-html-json-unsafe-'));
    try {
      await writeLayerFile(root, 'dist/book/index.html', markup);
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(
        /JSON|scheme|URL|Unicode|control|index\.html/iu,
      );
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
    ['zero-width open quote token', '.jade::before{content:"claim-" no-open-quote "secret"}'],
    ['zero-width close quote token', '.jade::before{content:"research" no-close-quote "/claims/secret"}'],
    [
      'accessible alternate text with zero-width quote token',
      '.jade::before{content:url("/jade.webp") / "claim-" no-open-quote "secret"}',
    ],
    ['unknown dynamic function', '.jade::before{content:target-text(url)}'],
    ['excessively encoded generated prose', `.jade::before{content:"${nestedPercentEncoding('claim-secret', 9)}"}`],
    ['nested directive in pseudo arguments', '::highlight(::private){color:inherit}'],
    ['malformed stylesheet', '.jade::before{content:"safe"'],
    ['WHATWG JavaScript URL', '.jade{background-image:url("javascript: alert(1)")}'],
    ['WHATWG data URL', '.jade{background-image:url("data: text/html,secret")}'],
    ['escaped WHATWG JavaScript URL', String.raw`.jade{background-image:url("jav\61script: alert(1)")}`],
    ['escaped WHATWG data URL', String.raw`.jade{background-image:url("\64 ata: text/html,secret")}`],
    ['escaped URL function', String.raw`.jade{background-image:u\72 l("javascript: alert(1)")}`],
    ['import string URL', '@import "javascript: alert(1)";'],
    ['image-set string URL', '.jade{background-image:image-set("javascript: alert(1)" 1x)}'],
    ['custom-property URL', '.jade{--cover:url("javascript: alert(1)")}'],
    ['escaped custom-property URL', String.raw`.jade{--cover:url("jav\61script: alert(1)")}`],
    ['import escaped repository', String.raw`@import "agent-axiom\2f yu-book";`],
    [
      'image-set escaped repository',
      String.raw`.jade{background-image:image-set("agent-axiom\2f yu-book" 1x)}`,
    ],
    ['custom-property escaped repository', String.raw`.jade{--source:"agent-axiom\2f yu-book"}`],
    [
      'custom-property unquoted escaped repository',
      String.raw`.jade{--source:agent-axiom\2f yu-book}`,
    ],
    ['custom-property escaped control', String.raw`.jade{--source:"jade\1b secret"}`],
    [
      'custom-property mixed-separator absolute path',
      String.raw`.jade{--source:"\2f Users\5c reader\5c secret.md"}`,
    ],
  ])('rejects unsafe CSS-generated prose in %s', async (_label, stylesheet) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-css-content-'));
    try {
      const isDocument = stylesheet.startsWith('<style>');
      await writeLayerFile(root, isDocument ? 'dist/book/index.html' : 'dist/book/styles.css', stylesheet);
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(
        /private|sentinel|CSS|content|attr|Unicode|control|index\.html|styles\.css/iu,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['direct content', '<span style="content:&quot;claim-secret&quot;">Jade</span>'],
    ['escaped property and value', String.raw`<span style="\63 ontent:&quot;claim\2d secret&quot;">Jade</span>`],
    [
      'nested srcdoc content',
      nestedSrcdoc(2, '<span style="content:&quot;claim-secret&quot;">Jade</span>'),
    ],
  ])('rejects private CSS-generated prose in an inline %s style', async (_label, markup) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-inline-style-'));
    try {
      await writeLayerFile(root, 'dist/book/index.html', markup);
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/private|sentinel|CSS|content|style|srcdoc|index\.html/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts sentinel-free static inline CSS declarations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-inline-style-safe-'));
    try {
      await writeLayerFile(
        root,
        'dist/book/index.html',
        '<span style="color:inherit;content:&quot;safe jade&quot;">Jade</span>',
      );
      await expect(scanReaderReleaseLayers(root)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    [
      'style block',
      String.raw`<style>.jade{background-image:u\72 l("javascript: alert(1)")}</style><main>Jade</main>`,
    ],
    [
      'inline style',
      String.raw`<main style="background-image:u\72 l('javascript: alert(1)')">Jade</main>`,
    ],
    [
      'nested srcdoc style',
      nestedSrcdoc(
        2,
        String.raw`<style>.jade{background-image:u\72 l("javascript: alert(1)")}</style><main>Jade</main>`,
      ),
    ],
  ])('rejects an escaped CSS URL function in a built %s', async (_label, markup) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-css-escaped-url-context-'));
    try {
      await writeLayerFile(root, 'dist/book/index.html', markup);
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/URL|scheme|CSS|style|srcdoc|index\.html/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['custom highlight', '::highlight(search){color:inherit}'],
    ['functional part', '.jade::part(label){color:inherit}'],
    ['public structural selector', '.source-museum{color:inherit}'],
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

  it('allows an escaped neutral public ID in a runtime CSS selector', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-runtime-css-selector-'));
    try {
      await writeLayerFile(root, 'src/styles/book.css', String.raw`.sou\72 ce-museum{color:inherit}`);
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

  it('rejects an escaped dangerous CSS URL in a static Astro inline style', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-astro-inline-url-'));
    try {
      await writeLayerFile(
        root,
        'src/layouts/Reader.astro',
        String.raw`<main style="background-image:url('jav\61script: alert(1)')">Jade</main>`,
      );
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/URL|scheme|CSS|style|Reader\.astro/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['dynamic style expression', '<main style={readerStyle}>Jade</main>'],
    [
      'dynamic escaped URL style',
      '<main style={`background-image:u\\72 l("javascript: alert(1)")`}>Jade</main>',
    ],
    ['style define variables', '<style define:vars={{ shade }}>.jade{color:var(--shade)}</style>'],
    ['spread attribute', '<main {...props}>Jade</main>'],
  ])('fails closed for an Astro %s', async (_label, markup) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-astro-dynamic-style-'));
    try {
      await writeLayerFile(root, 'src/layouts/Reader.astro', markup);
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/dynamic|CSS|style|define|Reader\.astro/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['rendered text', '<main>javascript: alert(1)</main>'],
    ['entity-folded rendered text', '<main>java&Tab;script: alert(1)</main>'],
    ['HTML comment', '<!-- javascript: alert(1) --><main>Jade</main>'],
    ['static script', '<script>location.href = "javascript: alert(1)";</script><main>Jade</main>'],
  ])('rejects a dangerous scheme in Astro %s', async (_label, markup) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-astro-exact-text-'));
    try {
      await writeLayerFile(root, 'src/layouts/Reader.astro', markup);
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/scheme|URL|sentinel|Reader\.astro/iu);
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
    ['built JavaScript WHATWG scheme', 'dist/book/runtime.js', 'const value = "javascript: alert(1)";'],
    ['built JavaScript newline scheme', 'dist/book/runtime.js', 'const value = `javascript:\nalert(1)`;'],
    ['built JavaScript template head', 'dist/book/runtime.js', 'const value = `javascript: ${payload}`;'],
    ['built JavaScript escaped template head', 'dist/book/runtime.js', 'const value = `java\\u0073cript: ${payload}`;'],
    ['built JavaScript folded scheme', 'dist/book/runtime.js', 'const value = "java\\nscript:alert(1)";'],
    [
      'built JavaScript escaped repository',
      'dist/book/runtime.js',
      'const value = "agent-axiom\\u002fyu-book";',
    ],
    [
      'built JavaScript escaped directive',
      'dist/book/runtime.js',
      'const value = "\\u003a\\u003aprivate";',
    ],
    ['built JavaScript escaped C0 control', 'dist/book/runtime.js', 'const value = "jade\\u001bsecret";'],
    [
      'built JavaScript escaped format control',
      'dist/book/runtime.js',
      'const value = "jade\\u202esecret";',
    ],
    [
      'built JavaScript escaped invalid percent run',
      'dist/book/runtime.js',
      'const value = "\\u0025FF";',
    ],
    [
      'built JavaScript decoded mixed-separator path',
      'dist/book/runtime.js',
      'const value = "\\u002fUsers\\u005creader\\u005csecret.md";',
    ],
    [
      'built JSON decoded mixed-separator path',
      'dist/book/catalogue.json',
      '{"path":"\\u002fUsers\\u005creader\\u005csecret.md"}',
    ],
    ['built JSX rendered scheme', 'dist/book/runtime.js', 'const value = <span>javascript: alert(1)</span>;'],
    ['HTML comment with scheme whitespace', 'dist/book/index.html', '<!-- javascript: alert(1) --><main>Jade</main>'],
    ['CSS comment with scheme whitespace', 'dist/book/styles.css', '/* javascript: alert(1) */.jade{color:inherit}'],
    [
      'hidden template URL',
      'dist/book/index.html',
      '<template><a href="javascript: alert(1)">Jade</a></template><main>Jade</main>',
    ],
    [
      'hidden template content',
      'dist/book/index.html',
      '<template><p>javascript: alert(1)</p></template><main>Jade</main>',
    ],
    [
      'entity-folded visible text',
      'dist/book/index.html',
      '<main>java&Tab;script: alert(1)</main>',
    ],
    [
      'entity-folded hidden template content',
      'dist/book/index.html',
      '<template><p>java&Tab;script: alert(1)</p></template><main>Jade</main>',
    ],
    [
      'event-handler URL',
      'dist/book/index.html',
      '<button onclick="location=\'javascript: alert(1)\'">Jade</button>',
    ],
    [
      'event-handler escaped repository',
      'dist/book/index.html',
      '<button onclick="location=\'agent-axiom\\u002fyu-book\'">Jade</button>',
    ],
    [
      'meta refresh URL',
      'dist/book/index.html',
      '<meta http-equiv="refresh" content="0;url=javascript: alert(1)"><main>Jade</main>',
    ],
    ['object data URL', 'dist/book/index.html', '<object data="javascript: alert(1)"></object>'],
    ['responsive image URL', 'dist/book/index.html', '<img srcset="javascript: alert(1) 1x" alt="Jade">'],
    ['plain text URL', 'dist/book/reader.txt', 'javascript: alert(1)'],
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

  it.each([
    ['literal JSX text', 'dist/book/runtime.jsx', '<span>javascript: alert(1)</span>'],
    ['entity-folded TSX text', 'dist/book/runtime.tsx', '<span>java&#9;script: alert(1)</span>'],
  ])('rejects a dangerous scheme in standalone built %s', async (_label, path, contents) => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-dist-jsx-'));
    try {
      await writeLayerFile(root, path, contents);
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/scheme|URL|runtime\.(?:jsx|tsx)/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed for invalid built JavaScript syntax', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-invalid-script-'));
    try {
      await writeLayerFile(root, 'dist/book/runtime.js', 'const =');
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/invalid|syntax|runtime\.js/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed for invalid UTF-8 in a known runtime text source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-runtime-utf8-'));
    try {
      const path = join(root, 'src/pages/book/invalid.ts');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.concat([
        Buffer.from('const value = "jade'),
        Buffer.from([0xff]),
        Buffer.from('";'),
      ]));
      await expect(scanReaderReleaseLayers(root)).rejects.toThrow(/UTF-8|invalid\.ts/iu);
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
    ['JavaScript scheme with a space', 'const value = "javascript: alert(1)";'],
    ['JavaScript scheme with a newline', 'const value = `javascript:\nalert(1)`;'],
    ['data scheme with a space', 'const value = "data: text/html,secret";'],
    ['file scheme with a space', 'const value = "file: /Users/reader/private.md";'],
    ['VBScript scheme with a space', 'const value = "vbscript: msgbox(1)";'],
    ['mixed repository separators', String.raw`const value = "agent-axiom/\yu-book";`],
    ['template-head scheme', 'const value = `javascript: ${payload}`;'],
    ['escaped template-head scheme', 'const value = `java\\u0073cript: ${payload}`;'],
    ['WHATWG folded scheme', 'const value = "java\\nscript:alert(1)";'],
    ['dot mixed repository separators', String.raw`const value = "agent-axiom/.\yu-book";`],
    ['backslash dot repository separators', String.raw`const value = "agent-axiom\.\yu-book";`],
    ['backslash traversal repository separators', String.raw`const value = "agent-axiom\temp\..\yu-book";`],
    ['case-folded repository traversal', String.raw`const value = "AGENT-AXIOM\temp\..\YU-BOOK";`],
    [
      'decoded mixed-separator absolute path',
      'const value = "\\x2fUsers\\x5creader\\x5csecret.md";',
    ],
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
    ['built dangerous scheme with whitespace', 'dist/book/javascript: payload.js'],
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

  it('allows ordinary data and file identifiers in TypeScript syntax', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-runtime-identifiers-'));
    try {
      await writeLayerFile(root, 'src/lib/book-release/safe-syntax.ts', [
        'type ReaderRow = { data: string };',
        'function inspect(file: ReaderRow) {',
        '  return { data: file.data };',
        '}',
      ].join('\n'));
      await expect(scanReaderReleaseLayers(root)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('allows a TypeScript angle-bracket assertion in a .ts source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yu-reader-layer-runtime-typescript-'));
    try {
      await writeLayerFile(
        root,
        'src/lib/book-release/assertion.ts',
        'declare const input: unknown; const value = <string>input;',
      );
      await expect(scanReaderReleaseLayers(root)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
