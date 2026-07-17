# Living Jade Pilot Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать приватное каноническое ядро книги, fail-closed экспорт разрешённого контента, печатный PDF-пилот и публичный раздел `/book/` на Astro-сайте `yu`.

**Architecture:** Полная рукопись и реестры живут в приватном `agent-axiom/yu-book`. Скрипт строит транзитивно замкнутый public bundle только из записей `public + approved + rights-cleared`; любое несоответствие останавливает экспорт. Публичный `agent-axiom/yu` проверяет bundle типизированными Astro-коллекциями и генерирует статические маршруты GitHub Pages. Приватный Astro-render той же рукописи пагинируется Vivliostyle CLI.

**Tech Stack:** Node.js 24, TypeScript 6, Astro 7, Astro Content Layer, Zod 4, Vitest 4, plain Markdown with YAML frontmatter, `gray-matter`, Vivliostyle CLI 10, CSS Paged Media, GitHub Actions, GitHub Pages.

---

## Границы плана

Этот план завершается рабочим пилотом: пролог, глава 4, интерлюдия, 28–36-страничный PDF и `/book/`. Волны остальных глав планируются после формальной приёмки пилота.

## Карта файлов

### Приватный `/Users/if/Documents/yu-book`

- `package.json` — команды проверки, экспорта и печати.
- `src/lib/model.ts` — единые Zod-схемы записей.
- `src/lib/store.ts` — загрузка Markdown/JSON и проверка ссылочной целостности.
- `src/lib/public-export.ts` — расчёт замыкания зависимостей и fail-closed проверка.
- `scripts/export-public.ts` — атомарная запись content bundle и web-assets в корень `yu`.
- `manuscript/entries/*.md` — канонические пролог, глава и интерлюдия.
- `research/{claims,sources,objects}/*.json` — тезисы, источники и паспорта предметов.
- `rights/media/*.json` — права по каналам.
- `release/public.json` — единственный allowlist публикации.
- `src/pages/print/pilot.astro`, `src/layouts/PrintLayout.astro`, `src/styles/print.css` — печатный renderer.
- `vivliostyle.config.mjs` — пагинация PDF.
- `tests/model.test.ts`, `tests/store.test.ts`, `tests/public-export.test.ts`, `tests/print-contract.test.ts` — контракты приватного ядра.

### Публичный `/Users/if/Documents/yu`

- `src/content/book-release/` — только сгенерированный публичный bundle.
- `public/images/book-release/` — только web-cleared изображения из того же bundle.
- `src/content.config.ts` — схемы `bookEntries`, `bookClaims`, `bookSources`, `bookObjects`, `bookMedia`.
- `src/lib/book.ts` — проверка ссылок в bundle.
- `src/components/book/BookChapterCard.astro` — карточка главы.
- `src/components/book/ClaimDisclosure.astro` — блок «Как мы это знаем?».
- `src/components/book/ObjectPassport.astro` — музейный паспорт.
- `src/pages/book/index.astro` — манифест и оглавление.
- `src/pages/book/[id].astro` — статические публичные главы.
- `src/styles/book.css` — отдельный ритм веб-книги.
- `tests/book-content.test.ts` — целостность bundle в публичном репозитории.
- `tests/routes.test.ts`, `tests/accessibility-contract.test.ts` — новые маршруты и доступность.

### Task 1: Зафиксировать baseline и создать приватный репозиторий

**Files:**
- Create: `/Users/if/Documents/yu-book/.gitignore`
- Create: `/Users/if/Documents/yu-book/.nvmrc`
- Create: `/Users/if/Documents/yu-book/package.json`
- Create: `/Users/if/Documents/yu-book/tsconfig.json`
- Create: `/Users/if/Documents/yu-book/vitest.config.ts`
- Create: `/Users/if/Documents/yu-book/astro.config.mjs`

- [ ] **Step 1: Проверить публичный baseline**

Run:

```bash
cd /Users/if/Documents/yu
npm test
npm run build
git status --short
```

Expected: Vitest PASS, `astro check` reports no errors, build succeeds, status is empty.

- [ ] **Step 2: Создать локальную основу**

Run:

```bash
mkdir -p /Users/if/Documents/yu-book
cd /Users/if/Documents/yu-book
git init -b main
npm init -y
npm install astro@^7 gray-matter zod
npm install --save-dev @astrojs/check @types/node @vivliostyle/cli@^10.6.0 tsx typescript@^6 vitest@^4
```

Expected: new Git repository, generated lockfile, no npm install error.

- [ ] **Step 3: Записать минимальную конфигурацию**

Set scripts in `package.json` to:

```json
{
  "name": "yu-book",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro check && astro build",
    "test": "vitest run",
    "test:watch": "vitest",
    "export:public": "tsx scripts/export-public.ts",
    "print:pilot": "astro build && vivliostyle build",
    "verify": "npm test && npm run build && npm run print:pilot"
  }
}
```

Keep the dependency blocks written by npm. Write `.nvmrc` as `24`, `.gitignore` as:

```gitignore
node_modules/
dist/
.astro/
.vivliostyle/
artifacts/
research/downloads/
.DS_Store
```

Write `tsconfig.json` and `vitest.config.ts`:

```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": { "types": ["node"] }
}
```

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node' },
});
```

Write `astro.config.mjs`:

```js
import { defineConfig } from 'astro/config';

export default defineConfig({ output: 'static' });
```

- [ ] **Step 4: Проверить типы**

Run: `cd /Users/if/Documents/yu-book && npx astro check`

Expected: `0 errors`.

- [ ] **Step 5: Создать приватный remote и первый коммит**

Run:

```bash
cd /Users/if/Documents/yu-book
git add .gitignore .nvmrc package.json package-lock.json tsconfig.json vitest.config.ts astro.config.mjs
git commit -m "chore: bootstrap private book repository"
gh repo create agent-axiom/yu-book --private --source=. --remote=origin --push
gh repo view agent-axiom/yu-book --json visibility,nameWithOwner
```

Expected: `visibility` is `PRIVATE`; `nameWithOwner` is `agent-axiom/yu-book`.

### Task 2: Определить типизированную модель книги

**Files:**
- Create: `/Users/if/Documents/yu-book/src/lib/model.ts`
- Test: `/Users/if/Documents/yu-book/tests/model.test.ts`

- [ ] **Step 1: Написать падающий тест статусов и прав**

```ts
import { describe, expect, it } from 'vitest';
import { manuscriptEntrySchema, mediaSchema } from '../src/lib/model';

describe('book model', () => {
  it('accepts an approved public chapter', () => {
    expect(manuscriptEntrySchema.parse({
      id: 'chapter-04', kind: 'chapter', slug: 'virtue-immortality',
      title: 'Добродетель и бессмертие', order: 4, part: 2,
      summary: 'История нефрита как языка добродетели, ритуала, погребения и надежды на бессмертие.',
      releaseStatus: 'public', reviewStatus: 'approved',
      claimIds: ['claim-han-jade-virtue'], objectIds: [], mediaIds: [],
    }).id).toBe('chapter-04');
  });

  it('requires web rights before media can be exported', () => {
    expect(() => mediaSchema.parse({
      id: 'media-jade-suit', path: 'assets/jade-suit.svg',
      releaseStatus: 'public', reviewStatus: 'approved', rightsStatus: 'cleared',
      channels: [], rightsHolder: 'Museum', creditLine: 'Museum', license: 'Licensed',
    })).toThrow();
  });
});
```

- [ ] **Step 2: Запустить тест и увидеть ожидаемый FAIL**

Run: `npm test -- tests/model.test.ts`

Expected: FAIL with module-not-found for `src/lib/model.ts`.

- [ ] **Step 3: Реализовать схемы**

```ts
import { z } from 'zod';

export const releaseStatusSchema = z.enum(['private', 'public']);
export const reviewStatusSchema = z.enum(['draft', 'fact-checked', 'approved']);
export const channelSchema = z.enum(['web', 'print', 'epub']);

const publishable = {
  releaseStatus: releaseStatusSchema,
  reviewStatus: reviewStatusSchema,
};

export const manuscriptEntrySchema = z.object({
  id: z.string().regex(/^(?:prologue|chapter-\d{2}|interlude-[a-z0-9-]+)$/),
  kind: z.enum(['prologue', 'chapter', 'interlude']),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(5),
  order: z.number().int().nonnegative(),
  part: z.number().int().min(0).max(5),
  summary: z.string().min(80),
  ...publishable,
  claimIds: z.array(z.string().regex(/^claim-[a-z0-9-]+$/)).min(1),
  objectIds: z.array(z.string().regex(/^object-[a-z0-9-]+$/)),
  mediaIds: z.array(z.string().regex(/^media-[a-z0-9-]+$/)),
});

export const sourceSchema = z.object({
  id: z.string().regex(/^source-[a-z0-9-]+$/),
  title: z.string().min(3), authors: z.array(z.string().min(2)).min(1),
  publicationYear: z.number().int().min(1800).max(2100),
  originalDate: z.string().min(2).optional(), publisher: z.string().min(2),
  region: z.enum(['asia', 'indigenous', 'mesoamerica', 'russia', 'west', 'global']),
  kind: z.enum(['primary-text', 'excavation', 'paper', 'book', 'museum', 'institution']),
  language: z.string().min(2), url: z.string().url().optional(), locator: z.string().optional(),
  ...publishable,
});

export const claimSchema = z.object({
  id: z.string().regex(/^claim-[a-z0-9-]+$/), statement: z.string().min(40),
  kind: z.enum(['fact', 'date', 'translation', 'interpretation', 'tradition', 'medical']),
  sourceIds: z.array(z.string().regex(/^source-[a-z0-9-]+$/)).min(1),
  confidence: z.enum(['high', 'medium', 'contested']),
  notes: z.string().min(20), ...publishable,
});

export const objectSchema = z.object({
  id: z.string().regex(/^object-[a-z0-9-]+$/), title: z.string().min(3),
  culture: z.string().min(2), date: z.string().min(2), material: z.string().min(2),
  collection: z.string().min(2), inventoryNumber: z.string().optional(),
  sourceIds: z.array(z.string().regex(/^source-[a-z0-9-]+$/)).min(1),
  mediaIds: z.array(z.string().regex(/^media-[a-z0-9-]+$/)).min(1),
  ...publishable,
});

export const mediaSchema = z.object({
  id: z.string().regex(/^media-[a-z0-9-]+$/), path: z.string().min(3),
  channels: z.array(channelSchema).min(1), rightsStatus: z.enum(['pending', 'cleared', 'blocked']),
  rightsHolder: z.string().min(2), creditLine: z.string().min(2), license: z.string().min(2),
  ...publishable,
});

export const releaseManifestSchema = z.object({
  version: z.literal(1), entries: z.array(z.string()).min(1), generatedLabel: z.string().min(3),
});

export type ManuscriptEntry = z.infer<typeof manuscriptEntrySchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Claim = z.infer<typeof claimSchema>;
export type BookObject = z.infer<typeof objectSchema>;
export type Media = z.infer<typeof mediaSchema>;
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;
```

- [ ] **Step 4: Запустить тест**

Run: `npm test -- tests/model.test.ts`

Expected: 2 tests PASS.

- [ ] **Step 5: Закоммитить модель**

```bash
git add src/lib/model.ts tests/model.test.ts
git commit -m "feat: define book content contracts"
```

### Task 3: Загружать и проверять каноническое ядро

**Files:**
- Create: `/Users/if/Documents/yu-book/src/lib/store.ts`
- Test: `/Users/if/Documents/yu-book/tests/store.test.ts`
- Create: `/Users/if/Documents/yu-book/tests/fixtures/valid/`

- [ ] **Step 1: Создать минимальную валидную fixture**

Create a Markdown entry with frontmatter matching `chapter-04`, one claim JSON, one source JSON, one object JSON, one media JSON and `release/public.json`. Use the exact IDs from Task 2. Set the media path to `assets/jade-suit.svg` and create this deterministic text fixture:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" role="img" aria-labelledby="title desc">
  <title id="title">Fixture: Han jade burial suit</title>
  <desc id="desc">A labelled geometric placeholder used only by automated tests.</desc>
  <rect width="1200" height="800" fill="#102f29"/>
  <g fill="#9cc9a6" stroke="#e7d8a8" stroke-width="4">
    <rect x="510" y="80" width="180" height="150" rx="42"/>
    <path d="M430 250h340l70 330-240 150-240-150z"/>
  </g>
  <text x="600" y="765" text-anchor="middle" fill="#fff" font-size="34">TEST FIXTURE · NOT FOR PUBLICATION</text>
</svg>
```

- [ ] **Step 2: Написать падающий тест ссылочной целостности**

```ts
import { describe, expect, it } from 'vitest';
import { loadStore, validateStore } from '../src/lib/store';

describe('book store', () => {
  it('loads a valid connected corpus', () => {
    const store = loadStore('tests/fixtures/valid');
    expect(validateStore(store)).toEqual([]);
    expect(store.entries.get('chapter-04')?.body).toContain('нефрит');
  });

  it('reports every missing reference', () => {
    const store = loadStore('tests/fixtures/valid');
    store.claims.get('claim-han-jade-virtue')!.sourceIds.push('source-missing');
    expect(validateStore(store)).toContain('claim-han-jade-virtue -> source-missing');
  });
});
```

- [ ] **Step 3: Запустить тест и увидеть FAIL**

Run: `npm test -- tests/store.test.ts`

Expected: FAIL with module-not-found for `src/lib/store.ts`.

- [ ] **Step 4: Реализовать loader и validator**

Implement `BookStore` with maps for entries, claims, sources, objects and media. Recursively read `.md` with `gray-matter`, read JSON directories, parse each record through the schemas from Task 2, and return errors in this exact relation format: `owner-id -> missing-id`. `validateStore()` must check entry→claim/object/media, claim→source, object→source/media and media→existing file.

```ts
export interface LoadedEntry extends ManuscriptEntry { body: string; sourcePath: string }
export interface BookStore {
  root: string;
  entries: Map<string, LoadedEntry>;
  claims: Map<string, Claim>;
  sources: Map<string, Source>;
  objects: Map<string, BookObject>;
  media: Map<string, Media>;
}
```

- [ ] **Step 5: Запустить тесты**

Run: `npm test -- tests/store.test.ts`

Expected: 2 tests PASS.

- [ ] **Step 6: Закоммитить loader**

```bash
git add src/lib/store.ts tests/store.test.ts tests/fixtures/valid
git commit -m "feat: validate connected book corpus"
```

### Task 4: Сделать public export закрытым по умолчанию

**Files:**
- Create: `/Users/if/Documents/yu-book/src/lib/public-export.ts`
- Create: `/Users/if/Documents/yu-book/scripts/export-public.ts`
- Test: `/Users/if/Documents/yu-book/tests/public-export.test.ts`

- [ ] **Step 1: Написать падающие тесты allowlist и rights gate**

```ts
import { describe, expect, it } from 'vitest';
import { buildPublicBundle } from '../src/lib/public-export';
import { loadStore } from '../src/lib/store';

const manifest = { version: 1 as const, entries: ['chapter-04'], generatedLabel: 'pilot-v1' };

describe('public export', () => {
  it('exports only the dependency closure of allowlisted entries', () => {
    const bundle = buildPublicBundle(loadStore('tests/fixtures/valid'), manifest);
    expect(bundle.entries.map((entry) => entry.id)).toEqual(['chapter-04']);
    expect(bundle.sources.map((source) => source.id)).toEqual(['source-han-jade']);
  });

  it('refuses a public entry when media lacks web clearance', () => {
    const store = loadStore('tests/fixtures/valid');
    store.media.get('media-jade-suit')!.channels = ['print'];
    expect(() => buildPublicBundle(store, manifest)).toThrow(/media-jade-suit.*web/);
  });

  it('refuses a draft dependency', () => {
    const store = loadStore('tests/fixtures/valid');
    store.claims.get('claim-han-jade-virtue')!.reviewStatus = 'draft';
    expect(() => buildPublicBundle(store, manifest)).toThrow(/claim-han-jade-virtue.*approved/);
  });
});
```

- [ ] **Step 2: Запустить тест и увидеть FAIL**

Run: `npm test -- tests/public-export.test.ts`

Expected: FAIL with module-not-found for `src/lib/public-export.ts`.

- [ ] **Step 3: Реализовать транзитивное замыкание**

`buildPublicBundle()` must:

1. parse the manifest;
2. run `validateStore()` and abort on any error;
3. load only listed entries;
4. collect referenced claims, objects, media and their source/media dependencies;
5. require `releaseStatus === 'public'` and `reviewStatus === 'approved'` for every record;
6. require `rightsStatus === 'cleared'` and `channels.includes('web')` for every exported media record;
7. sort every list by ID before returning it.

Export this exact shape:

```ts
export interface PublicBundle {
  manifest: ReleaseManifest;
  entries: LoadedEntry[];
  claims: Claim[];
  sources: Source[];
  objects: BookObject[];
  media: Media[];
}
```

- [ ] **Step 4: Запустить unit tests**

Run: `npm test -- tests/public-export.test.ts`

Expected: 3 tests PASS.

- [ ] **Step 5: Реализовать атомарную запись bundle**

`scripts/export-public.ts` must accept exactly one positional target: the public repository root. Resolve it, require its final directory name to be `yu`, and parse its `package.json` to require `name === 'yu-jade'`. Before replacing anything, build two sibling staging trees and validate their contents. Replace only these exact generated targets after both staging trees are complete:

- `<target>/src/content/book-release` from `.book-release-content-staging`;
- `<target>/public/images/book-release` from `.book-release-assets-staging`.

Write into the content target:

- `manifest.json`;
- Markdown entries reconstructed with their public frontmatter and body;
- one JSON file per claim/source/object/media;
- media metadata whose `path` is the basename below `/images/book-release/`.

Copy web-cleared assets into the public-assets target. Reject symlinks, absolute paths, `..` segments, duplicate basenames and any source path outside the private repository root.

Reject any other target with `Unsafe export target` before writing. On validation or copy failure, remove only the two staging trees and leave both previous generated targets unchanged.

- [ ] **Step 6: Добавить CLI integration test**

Create a temporary `yu/package.json` with `{ "name": "yu-jade" }`, run the exporter against that `yu` root, and assert that exactly one entry and its closure exist, the SVG exists under `public/images/book-release`, and a private sentinel string from an unlisted fixture is absent from every exported text file. Add negative cases for a non-`yu` root, a wrong package name and `../escape.svg`.

- [ ] **Step 7: Закоммитить exporter**

```bash
git add src/lib/public-export.ts scripts/export-public.ts tests/public-export.test.ts
git commit -m "feat: add fail-closed public book export"
```

### Task 5: Подключить public bundle к Astro Content Layer

**Files:**
- Modify: `/Users/if/Documents/yu/src/content.config.ts`
- Create: `/Users/if/Documents/yu/src/lib/book.ts`
- Create: `/Users/if/Documents/yu/tests/book-content.test.ts`

- [ ] **Step 1: Сгенерировать fixture bundle в `yu`**

Run:

```bash
cd /Users/if/Documents/yu-book
npm run export:public -- /Users/if/Documents/yu
```

Expected: `manifest.json`, `entries/`, `claims/`, `sources/`, `objects/`, `media/` exist under `src/content/book-release`; exported images exist under `public/images/book-release`.

- [ ] **Step 2: Написать падающий public integrity test**

```ts
import { describe, expect, it } from 'vitest';
import { loadBookRelease, validateBookRelease } from '../src/lib/book';

describe('public book release', () => {
  it('contains only approved web-safe records with resolved links', () => {
    const release = loadBookRelease();
    expect(validateBookRelease(release)).toEqual([]);
    expect(release.entries.every((entry) => entry.releaseStatus === 'public')).toBe(true);
    expect(release.media.every((media) => media.channels.includes('web'))).toBe(true);
  });
});
```

- [ ] **Step 3: Запустить тест и увидеть FAIL**

Run: `cd /Users/if/Documents/yu && npm test -- tests/book-content.test.ts`

Expected: FAIL with module-not-found for `src/lib/book.ts`.

- [ ] **Step 4: Добавить Astro-коллекции**

In `src/content.config.ts`, define `bookEntries` with `glob({ pattern: '**/*.md', base: './src/content/book-release/entries' })`; define JSON collections for claims, sources, objects and media. Mirror the private schemas, but omit `releaseStatus` alternatives by requiring `z.literal('public')` and `reviewStatus: z.literal('approved')`. Export them with the existing collections.

- [ ] **Step 5: Реализовать public validator**

`src/lib/book.ts` reads the generated bundle for Vitest and validates entry→claim/object/media, claim→source and object→source/media references. Return all failures in `owner -> missing` form.

- [ ] **Step 6: Проверить тест и Astro schema**

Run:

```bash
npm test -- tests/book-content.test.ts
npx astro check
```

Expected: test PASS, Astro reports 0 errors.

- [ ] **Step 7: Закоммитить public content contract**

```bash
git add src/content.config.ts src/content/book-release public/images/book-release src/lib/book.ts tests/book-content.test.ts
git commit -m "feat: validate public book release"
```

### Task 6: Создать `/book/` и статические маршруты глав

**Files:**
- Create: `/Users/if/Documents/yu/src/pages/book/index.astro`
- Create: `/Users/if/Documents/yu/src/pages/book/[id].astro`
- Create: `/Users/if/Documents/yu/src/components/book/BookChapterCard.astro`
- Modify: `/Users/if/Documents/yu/tests/routes.test.ts`

- [ ] **Step 1: Добавить падающие route assertions**

Append `book/index.html` and `book/virtue-immortality/index.html` to `outputs` in `tests/routes.test.ts`.

- [ ] **Step 2: Запустить route test**

Run: `npm test -- tests/routes.test.ts`

Expected: FAIL because both files are absent.

- [ ] **Step 3: Создать landing**

`src/pages/book/index.astro` must load and order `bookEntries`, render the title `Живой нефрит`, explain the staged publishing model, show the 12-chapter future outline as summaries and render public entries with `BookChapterCard`. Every URL must use `withBase()`.

- [ ] **Step 4: Создать dynamic static route**

Use the Astro 7 Content Layer pattern:

```astro
---
import { getCollection, render } from 'astro:content';
import BaseLayout from '../../layouts/BaseLayout.astro';

export async function getStaticPaths() {
  const entries = await getCollection('bookEntries');
  return entries.map((entry) => ({ params: { id: entry.data.slug }, props: { entry } }));
}

const { entry } = Astro.props;
const { Content } = await render(entry);
---

<BaseLayout title={entry.data.title} description={entry.data.summary}>
  <article class="book-entry page-shell">
    <header><p class="eyebrow">Книга · {entry.data.kind}</p><h1 class="display">{entry.data.title}</h1></header>
    <div class="book-prose"><Content /></div>
  </article>
</BaseLayout>
```

- [ ] **Step 5: Запустить routes**

Run: `npm test -- tests/routes.test.ts`

Expected: all static route tests PASS and all internal links use `/yu/`.

- [ ] **Step 6: Закоммитить routes**

```bash
git add src/pages/book src/components/book/BookChapterCard.astro tests/routes.test.ts
git commit -m "feat: add staged book routes"
```

### Task 7: Показать доказательства и паспорта предметов

**Files:**
- Create: `/Users/if/Documents/yu/src/components/book/ClaimDisclosure.astro`
- Create: `/Users/if/Documents/yu/src/components/book/ObjectPassport.astro`
- Modify: `/Users/if/Documents/yu/src/pages/book/[id].astro`
- Test: `/Users/if/Documents/yu/tests/book-components.test.ts`

- [ ] **Step 1: Написать падающий source contract**

Read both component files as text and assert that `ClaimDisclosure` uses native `<details>`, renders confidence and every `sourceId`; assert that `ObjectPassport` renders material, date, collection, inventory number and credit line.

- [ ] **Step 2: Создать `ClaimDisclosure.astro`**

The component receives one claim and a source map. Use `<details id={claim.id}>`, `<summary>Как мы это знаем?</summary>`, the statement, confidence label, notes and a list of exact source records. Do not hide the claim when JavaScript is unavailable.

- [ ] **Step 3: Создать `ObjectPassport.astro`**

Render a `<figure>` with the exported media, full alt text, material, culture, date, collection, inventory number, provenance note, credit line and source links. Construct the image URL only as `withBase(`/images/book-release/${media.path}`)`; `media.path` has already been reduced to a safe basename by the exporter.

- [ ] **Step 4: Подключить связанные записи к главе**

In `[id].astro`, load claims, sources, objects and media once, map only IDs declared by the entry, render object passports after the first narrative block and evidence disclosures in a section labelled `Как мы это знаем?`. The Markdown body links each substantive claim to `#claim-id`.

- [ ] **Step 5: Запустить tests and build**

Run:

```bash
npm test -- tests/book-components.test.ts
npm run build
```

Expected: tests PASS; build contains claim IDs and object captions.

- [ ] **Step 6: Закоммитить evidence UI**

```bash
git add src/components/book src/pages/book/[id].astro tests/book-components.test.ts
git commit -m "feat: expose book evidence and object provenance"
```

### Task 8: Дать веб-книге отдельный ритм и доступность

**Files:**
- Create: `/Users/if/Documents/yu/src/styles/book.css`
- Modify: `/Users/if/Documents/yu/src/pages/book/index.astro`
- Modify: `/Users/if/Documents/yu/src/pages/book/[id].astro`
- Modify: `/Users/if/Documents/yu/src/components/SiteHeader.astro`
- Modify: `/Users/if/Documents/yu/tests/accessibility-contract.test.ts`

- [ ] **Step 1: Добавить failing accessibility assertions**

Assert exactly one `<h1>` in built book routes, native `<details>/<summary>` for evidence, alt text on book images, a `/book/` navigation link and the presence of `prefers-reduced-motion` in book CSS.

- [ ] **Step 2: Добавить книгу в навигацию**

Insert `{ href: '/book/', label: 'Книга' }` before sources in `SiteHeader.astro`.

- [ ] **Step 3: Создать book CSS**

Define a readable prose measure of `68ch`, chapter openers, full-bleed visual pauses bounded by the site page width, object passport grids, evidence panels, visible focus, mobile one-column fallback and reduced-motion fallback. Do not add continuous scroll listeners or WebGL.

- [ ] **Step 4: Подключить CSS только к book routes**

Import `../../styles/book.css` from both book pages so the rest of the site remains unchanged.

- [ ] **Step 5: Запустить accessibility and route tests**

Run:

```bash
npm test -- tests/accessibility-contract.test.ts tests/routes.test.ts
npm run build
```

Expected: PASS; book pages remain readable in generated HTML without executing scripts.

- [ ] **Step 6: Закоммитить book visual system**

```bash
git add src/styles/book.css src/pages/book src/components/SiteHeader.astro tests/accessibility-contract.test.ts
git commit -m "feat: style accessible web book"
```

### Task 9: Собрать печатный PDF-пилот

**Files:**
- Create: `/Users/if/Documents/yu-book/src/content.config.ts`
- Create: `/Users/if/Documents/yu-book/src/layouts/PrintLayout.astro`
- Create: `/Users/if/Documents/yu-book/src/pages/print/pilot.astro`
- Create: `/Users/if/Documents/yu-book/src/styles/print.css`
- Create: `/Users/if/Documents/yu-book/vivliostyle.config.mjs`
- Test: `/Users/if/Documents/yu-book/tests/print-contract.test.ts`

- [ ] **Step 1: Написать failing print contract**

Assert that print CSS contains `@page`, `size: 210mm 260mm`, `bleed: 3mm`, running page numbers, `break-before`, `orphans`, `widows`; assert that the Vivliostyle config points at `/print/pilot/index.html` and outputs `artifacts/living-jade-pilot.pdf`.

- [ ] **Step 2: Определить private manuscript collection**

Use Astro `glob()` for `manuscript/entries/*.md` and reuse `manuscriptEntrySchema` as the frontmatter schema. Keep the final format open: `210×260 mm` is the pilot proof size, not the locked production trim.

- [ ] **Step 3: Создать print renderer**

`pilot.astro` loads `prologue`, `chapter-04` and `interlude-jade-immortality`, orders them, renders each with Astro `render()`, and surrounds them with print-only object/evidence sections sourced from the validated store.

- [ ] **Step 4: Создать paged CSS**

Use named pages for opener, narrative and interlude; define 3 mm bleed, crop marks, running chapter title, folios, figure breaks and a two-column notes section. Use bundled/local fonts only in the Docker-ready workspace; no remote Google Fonts in the print build.

- [ ] **Step 5: Добавить Vivliostyle config**

```js
import { defineConfig } from '@vivliostyle/cli';

export default defineConfig({
  title: 'Живой нефрит — пилот',
  author: 'agent-axiom',
  language: 'ru',
  static: { '/': 'dist' },
  entry: [{ path: '/print/pilot/index.html', title: 'Добродетель и бессмертие' }],
  workspaceDir: '.vivliostyle',
  output: 'artifacts/living-jade-pilot.pdf',
});
```

- [ ] **Step 6: Собрать PDF и проверить metadata**

Run:

```bash
npm test -- tests/print-contract.test.ts
npm run print:pilot
pdfinfo artifacts/living-jade-pilot.pdf
```

Expected: test PASS; PDF exists, title is present, pages are generated. The editorial plan later enforces the final 28–36-page range.

- [ ] **Step 7: Закоммитить print pipeline**

```bash
git add src/content.config.ts src/layouts src/pages/print src/styles/print.css vivliostyle.config.mjs tests/print-contract.test.ts
git commit -m "feat: render pilot as paged PDF"
```

### Task 10: Добавить CI без автопубликации рукописи

**Files:**
- Create: `/Users/if/Documents/yu-book/.github/workflows/verify.yml`
- Create: `/Users/if/Documents/yu/.github/workflows/ci.yml`
- Test: `/Users/if/Documents/yu-book/tests/workflow-contract.test.ts`
- Modify: `/Users/if/Documents/yu/tests/deploy-config.test.ts`

- [ ] **Step 1: Записать workflow contract tests**

Assert that private CI runs test/build/print and only uploads the PDF artifact; assert that it contains neither `git push` nor a cross-repository token. Assert that public CI runs `npm test` and `npm run build` for pull requests.

- [ ] **Step 2: Создать private verification workflow**

Use checkout, setup-node 24 with npm cache, `npm ci`, `npm test`, `npm run build`, `npm run print:pilot`, and upload `artifacts/living-jade-pilot.pdf`. Do not give write permissions.

- [ ] **Step 3: Создать public PR workflow**

Use checkout, setup-node 24, `npm ci`, `npm test`, `npm run build`. Keep the existing Pages workflow unchanged.

- [ ] **Step 4: Запустить workflow tests**

Run the relevant Vitest files in both repositories.

Expected: PASS; no workflow can publish the private manuscript.

- [ ] **Step 5: Закоммитить workflows**

Commit private and public workflow changes separately with messages `ci: verify private book artifacts` and `ci: test public book pull requests`.

### Task 11: Провести полную приёмку и опубликовать `/book/`

**Files:**
- Modify: `/Users/if/Documents/yu-book/release/public.json`
- Regenerate: `/Users/if/Documents/yu/src/content/book-release/`
- Regenerate: `/Users/if/Documents/yu/public/images/book-release/`
- Verify: `/Users/if/Documents/yu/dist/book/`

- [ ] **Step 1: Подтянуть готовые редакционные записи**

Require `approved`, `public`, and cleared web rights for prologue, chapter 4, interlude, claims, sources, objects and media. Run `npm test` in the private repo before export.

- [ ] **Step 2: Сгенерировать чистый public bundle**

Run:

```bash
cd /Users/if/Documents/yu-book
npm run export:public -- /Users/if/Documents/yu
```

Expected: exporter reports exact entry/source/object/media counts and no private IDs.

- [ ] **Step 3: Прогнать оба verification suites**

```bash
cd /Users/if/Documents/yu-book
npm run verify
cd /Users/if/Documents/yu
npm test
npm run build
```

Expected: all commands PASS.

- [ ] **Step 4: Провести ручную проверку**

Check desktop and mobile book routes, keyboard-only navigation, no-JavaScript reading, reduced motion, all source cards, all credits, and the 28–36-page printed proof. Record the result in `docs/qa/living-jade-pilot.md` with one row per acceptance criterion and `PASS`/`FAIL`.

- [ ] **Step 5: Закоммитить final private and public states**

Commit the reviewed manuscript/release in the private repo. Commit generated bundle, routes, styles, tests and QA report in `yu` with `feat: publish living jade pilot`.

- [ ] **Step 6: Запушить оба репозитория**

```bash
git -C /Users/if/Documents/yu-book push origin main
git -C /Users/if/Documents/yu push origin main
```

Expected: both pushes succeed; public Pages workflow starts.

- [ ] **Step 7: Проверить deployment**

Run:

```bash
gh run list --repo agent-axiom/yu --workflow deploy.yml --limit 1
curl -I https://agent-axiom.github.io/yu/book/
curl -I https://agent-axiom.github.io/yu/book/virtue-immortality/
```

Expected: workflow succeeds; both URLs return HTTP 200.

## Ссылки для реализатора

- Astro Content Loader API and `glob()`: https://docs.astro.build/en/reference/content-loader-reference/
- Astro content rendering and static routes: https://docs.astro.build/en/guides/content-collections/
- Vivliostyle CLI getting started: https://docs.vivliostyle.org/en/cli/getting-started/
- Vivliostyle frontend framework/static output integration: https://docs.vivliostyle.org/en/cli/frontend-framework-support/
- Vivliostyle print and EPUB output: https://docs.vivliostyle.org/en/cli/special-output-settings/
