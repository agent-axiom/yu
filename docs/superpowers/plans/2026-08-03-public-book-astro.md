# Public Book Astro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use superpowers:test-driven-development for behavior changes and superpowers:systematic-debugging for any build/browser failure.

**Goal:** Опубликовать reviewed reader-v1 bundle как визуальный, доступный и интерактивный раздел `/book/` существующего Astro-сайта `yu`.

**Architecture:** Публичный репозиторий не редактирует рукопись. Он валидирует побайтово связанный generated bundle, загружает strict Astro content collections и строит пять статических маршрутов. Основной текст, notes, passports и navigation работают без JavaScript; лёгкие Web Component islands добавляют progress, image dialog и мягкую навигацию.

**Tech Stack:** Astro 7 static output, TypeScript 6, strict Zod schemas, Astro Content Layer/render API, Vitest/jsdom, Playwright Chromium, native Web Components, GitHub Pages.

**Approved design:** `docs/superpowers/specs/2026-08-01-full-manuscript-public-edition-design.md`

**Implementation worktree:** `/Users/if/Documents/玉 - yù - jade - нефрит/agent-axiom/yu`

**Implementation branch:** `codex/book-design`

---

## Baseline and generated boundary

Baseline on Node 24: `12` test files, `37` tests passed; production build produced 7 routes. The default system Node 12 is unsupported, so every task starts with:

```bash
cd "/Users/if/Documents/玉 - yù - jade - нефрит/agent-axiom/yu"
source /Users/if/.nvm/nvm.sh
nvm use 24
git status --short
```

The private exporter alone may replace:

```text
src/content/book-release/
  manifest.json
  entries/*.md
  notes/*.json
  sources/*.json
  objects/*.json
  media/*.json
public/images/book-release/*
```

Never hand-edit those generated roots.

### Task 1: Pin Node and add the browser-test harness

**Files:**

- Create: `.nvmrc`
- Create: `playwright.config.ts`
- Create: `tests/book-browser-config.test.ts`
- Create: `scripts/smoke-site-baseline.mjs`
- Create: `tests/site-baseline-smoke.test.ts`
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Write the RED tooling contract**

Assert `.nvmrc` is `24`, `package.json.engines.node` requires Node 24, scripts include `test:unit` and `test:browser`, and Playwright config has desktop Chromium plus touch/mobile Chromium against `/yu`. Add a version-pinned baseline smoke contract for the currently published non-book routes; it requires 2xx, rejects soft-404s and checks stable page markers without depending on any future book manifest or script.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/book-browser-config.test.ts tests/site-baseline-smoke.test.ts
```

- [ ] **Step 3: Install and configure**

```bash
npm install --save-exact zod
npm install --save-dev --save-exact @playwright/test
```

Use `webServer` with `astro preview --host 127.0.0.1 --port 4321`; use base URL `http://127.0.0.1:4321/yu/`. Keep current unit-test behavior in `npm test` until Task 8, so early TDD does not require a browser on every focused run.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npx vitest run tests/book-browser-config.test.ts tests/site-baseline-smoke.test.ts
git add .nvmrc package.json package-lock.json playwright.config.ts tests/book-browser-config.test.ts scripts/smoke-site-baseline.mjs tests/site-baseline-smoke.test.ts
git commit -m "test: add public book browser harness"
```

### Task 2: Define strict reader-release schemas and collections

**Files:**

- Create: `src/lib/book-release/schemas.ts`
- Create: `tests/helpers/book-release-fixture.ts`
- Create: `tests/book-release-schema.test.ts`
- Modify: `src/content.config.ts`

- [ ] **Step 1: Write RED strict-schema mutations**

Explicitly reject manifest v3 (and every version except v4), wrong projection/transformer/attestation, unknown keys, unsafe URLs, malformed generative/authored media, invalid reading sequence and an unsupported confidence value.

The manifest core must require:

```ts
{
  version: 4,
  projection: 'reader-v1',
  transformer: 'reader-markdown-v1',
  cycleId: string,
  targetCommit: FortyCharLowerHex,
  reviewEvidenceCommit: FortyCharLowerHex,
  releaseId: `living-jade-reader-v1-${FortyCharLowerHex}`,
  readerPayloadDigest: Sha256Hex,
  readingOrder: PublicEntryId[],
  counts: {
    entries: number,
    notes: number,
    sources: number,
    objects: number,
    media: number,
  },
  files: FileDescriptor[],
  reviewAttestation: AttestationV3,
}
```

The full 40-character SHA suffix of `releaseId` must equal `targetCommit`. A file descriptor is strict `{ path, kind: 'text' | 'binary', byteLength, sha256 }`. The only payload roots are `src/content/book-release/{entries,notes,sources,objects,media}/**` and `public/images/book-release/**`; `manifest.json` is excluded from its own `files` array. Paths are unique, normalized and code-unit sorted.

`AttestationV3` is strict and contains `schemaVersion: 3`, `reviewMode: 'ai-agent-panel'`, `panelType: 'five-agent'`, the same `C/T/E`, `publicationGate: 'agent-reviewed'`, and this exact disclosure:

```text
Материал проверен независимой коллегией AI-агентов по источникам, хронологии, объектам и сравнительному методу. Это не человеческая научная рецензия, не медицинская консультация и не подтверждение прав на изображения.
```

It also requires `reviewedPayload: { format: 'yu-reader-payload-v1', projection: 'reader-v1', transformer: 'reader-markdown-v1', digest }` and `contentBinding: { algorithm: 'sha256', format: 'yu-reader-release-v1', digest }`, with exact top-level/attestation identity equality.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/book-release-schema.test.ts
```

- [ ] **Step 3: Implement strict schemas and six collections**

Add `bookManifest`, `bookEntries`, `bookNotes`, `bookSources`, `bookObjects`, `bookMedia` using glob loaders rooted in `src/content/book-release`. Entry Markdown frontmatter includes ID/slug/kind/title/subtitle/order/part/readingMinutes and public note/object/media IDs plus optional reading sequence.

Do not invent a parallel public vocabulary: port the exact strict reader shapes exported by private `reader-release-model.ts` into a shared golden fixture. In addition to Entry/Manifest:

- Note requires only public `id`, `anchor`, `statement`, confidence, limitation and public `sourceIds`;
- Source requires only public `id`, authors, title, year/type, published bibliographic container fields, DOI/HTTPS URL and the locators actually used by this closure;
- Object requires only public `id`, title, culture/date, attributed material plus qualification, collection, an exclusive inventory-number-or-explicit-absence value, provenance boundary, credits, public `sourceIds` and `mediaIds`;
- Media requires only public `id`, safe output name, alt, caption, discriminated kind, credit, license and safe public URLs; authored diagrams additionally require public author/CC BY/change note, and generative media require the nondocumentary disclosure.

All objects are strict/unknown-key rejecting. Golden valid fixtures cover every discriminator; mutation tests delete/add each field. Loader validation also requires manifest `counts` to equal the actual five payload collection sizes and recomputes every Entry `readingMinutes` from projected text at 220 words/minute, ceiling, minimum 1.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npx vitest run tests/book-release-schema.test.ts tests/content-schema.test.ts
npx tsc --noEmit
git add src/lib/book-release/schemas.ts src/content.config.ts tests/helpers/book-release-fixture.ts tests/book-release-schema.test.ts
git commit -m "feat: define reader release collections"
```

### Task 3: Verify bundle bytes, safety and relationships

**Files:**

- Create: `src/lib/book-release/integrity.ts`
- Create: `src/lib/book-release/validate.ts`
- Create: `src/lib/book-release/load.ts`
- Create: `src/lib/book-release/routes.ts`
- Create: `tests/book-release-integrity.test.ts`
- Create: `tests/book-release-safety.test.ts`

- [ ] **Step 1: Write RED byte-mutation and graph tests**

Use synthetic fixture directories. Mutate one Markdown byte, one image byte, file order, C/T/E/digest, release-ID SHA, path normalization, file kind/length/SHA, extra/missing file, note/source edge, duplicate anchor and interlude return relation.

- [ ] **Step 2: Write RED privacy tests**

Reject symlinks/multi-link files, traversal, raw HTML, residual directives, dangerous URL schemes and private paths/sentinels. Reject private-prefixed `claim-*`, `object-*`, `media-*`, `source-*` or `interlude-*` tokens only in projected reader Markdown/prose fields; valid public JSON identifiers are checked against their declared neutral public-ID schemas and graph references rather than a blanket substring ban.

- [ ] **Step 3: Verify RED**

```bash
npx vitest run tests/book-release-integrity.test.ts tests/book-release-safety.test.ts
```

- [ ] **Step 4: Implement shared validation**

Recompute `yu-reader-payload-v1` and `yu-reader-release-v1` with eight-byte unsigned big-endian frames, code-unit path order and exact raw bytes. Release-binding preimage is exactly: UTF-8 domain separator `yu-reader-release-v1`; `frame(canonical manifest projection)`; then, for every payload file in manifest code-unit order, `frame(UTF-8 path)` and `frame(raw bytes)`. Canonical manifest JSON recursively code-unit-sorts object keys, preserves array order, uses two-space indentation plus one terminal LF, performs no Unicode normalization, and removes only `reviewAttestation.contentBinding`—no other field. Require sorted unique manifest paths and a manifest↔filesystem bijection. Validate all entry → note/object/media → source edges, manifest counts, computed reading minutes and the exact three-entry reading order.

Runtime validation is one layer only. Before release, the integration plan must additionally prove the exact staged path/mode allowlist, compare public tree blob origins against forbidden private-tree blobs, scan generated roots plus `dist/book` sentinels, recheck repository visibility and end with a clean index/tree. Those fail-closed gates are mandatory dependencies, not optional manual review.

Sentinel coverage includes runtime source (`src/layouts`, `src/pages/book`, `src/components/book`, `src/lib/book-release`, `src/styles/book.css`), generated roots and built `dist/book`; a mutation test plants one forbidden token in each layer and requires rejection.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npx vitest run tests/book-release-integrity.test.ts tests/book-release-safety.test.ts
npx tsc --noEmit
git add src/lib/book-release tests/book-release-integrity.test.ts tests/book-release-safety.test.ts
git commit -m "feat: validate reviewed reader bundles"
```

After Task 3 passes from a clean checkout, record its full feature-branch SHA as immutable pre-publication base `B`. Tasks 4–9 form the linear release range `B..P`; integration audits and, if necessary, reverts that whole range. The baseline smoke runner committed in Task 1 therefore remains available after rollback.

### Task 4: Accept the real exporter handoff

**Files:**

- Generated only: `src/content/book-release/**`
- Generated only: `public/images/book-release/**`
- Create: `tests/book-release-presence.test.ts`

- [ ] **Step 1: Write the RED presence contract before export**

Require exactly these slugs and no others:

```ts
expect(slugs).toEqual([
  'prologue',
  'virtue-immortality',
  'jade-immortality',
]);
```

Also require all three entries, 51 notes, 7 objects, 13 media and the manifest-declared source closure.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/book-release-presence.test.ts
```

Expected: generated bundle absent.

Commit the truthful RED contract before exporter handoff so the target worktree is clean and the private exporter never needs a dirty-tree exception:

```bash
git add tests/book-release-presence.test.ts
git commit -m "test: require reviewed reader bundle"
git status --short
```

Expected: clean tree. The focused presence test is intentionally RED only until the immediately following exporter handoff; no route/UI work starts in between.

- [ ] **Step 3: Export from the private clean F**

Run the private exporter with this worktree as its only target. Do not repair any generated file locally.

- [ ] **Step 4: Verify GREEN and deterministic handoff**

```bash
npx vitest run tests/book-release-presence.test.ts tests/book-release-integrity.test.ts tests/book-release-safety.test.ts
npm run build
git diff -- src/content/book-release public/images/book-release
```

Run the same private export again; expected second diff is zero.

- [ ] **Step 5: Commit the exact validated handoff before consumers**

Stage only the two generated roots after confirming no other path is dirty:

```bash
git add src/content/book-release public/images/book-release
git diff --cached --check
git commit -m "chore: import reviewed reader bundle"
```

Every later route/UI commit must therefore build from a clean checkout with the exact reviewed payload already present.

### Task 5: Render base-aware book routes and reading sequence

**Files:**

- Create: `src/lib/book-release/rehype-book-elements.mjs`
- Modify: `astro.config.mjs`
- Create: `src/layouts/BookLayout.astro`
- Create: `src/pages/book/index.astro`
- Create: `src/pages/book/[slug].astro`
- Create: `src/pages/book/sources.astro`
- Create: `tests/book-reading-sequence.test.ts`
- Create: `e2e/book-reader.spec.ts`
- Create: `e2e/book-reader-no-js.spec.ts`
- Modify: `tests/routes.test.ts`, `tests/accessibility-contract.test.ts`

- [ ] **Step 1: Write route/sequence RED tests**

Require `/book/`, the three entry routes and `/book/sources/`; exactly one `h1`; `/yu/`-prefixed internal URLs; a single portal to the interlude and an exact return anchor. Before route implementation, add browser cases for all five routes, portal/return and complete prose/navigation with JavaScript disabled.

- [ ] **Step 2: Verify RED**

```bash
npm run build
npx vitest run tests/book-reading-sequence.test.ts tests/routes.test.ts tests/accessibility-contract.test.ts
npx playwright install --with-deps chromium
npx playwright test e2e/book-reader.spec.ts e2e/book-reader-no-js.spec.ts
```

Expected: static route/unit and browser flows fail because `/book/` does not yet exist.

- [ ] **Step 3: Implement deterministic static paths**

Derive `getStaticPaths()` from validated manifest order only. Render Markdown with Astro `render(entry)`. Ownership is explicit: the rehype plugin converts only reviewed inline figure markers, the interlude portal/return marker and public note links, emitting semantic `<figure>`/anchors from safe reader Markdown plus validated media records. Astro page/layout components own the shell, release disclosure, note detail sections, object passports, navigation and progress. Missing/duplicate/misplaced markers fail the build.

- [ ] **Step 4: Verify GREEN and commit runtime files**

```bash
npm run build
npx vitest run tests/book-reading-sequence.test.ts tests/routes.test.ts tests/accessibility-contract.test.ts
npx playwright test e2e/book-reader.spec.ts e2e/book-reader-no-js.spec.ts
git add astro.config.mjs src/layouts/BookLayout.astro src/pages/book src/lib/book-release/rehype-book-elements.mjs tests/book-reading-sequence.test.ts tests/routes.test.ts tests/accessibility-contract.test.ts e2e/book-reader.spec.ts e2e/book-reader-no-js.spec.ts
git commit -m "feat: render public book routes"
```

### Task 6: Add semantic reader components and progressive-enhancement islands

**Files:**

- Create: `src/components/book/ReleaseDisclosure.astro`
- Create: `src/components/book/BookEntryHeader.astro`
- Create: `src/components/book/EvidenceNote.astro`
- Create: `src/components/book/ObjectPassport.astro`
- Create: `src/components/book/ReadingNavigation.astro`
- Create: `src/components/book/ReadingProgress.astro`
- Create: `src/components/book/ImageViewer.astro`
- Create: `src/lib/book-release/progress.ts`
- Create: `tests/book-components.test.ts`
- Create: `tests/book-progress.test.ts`
- Create: `e2e/book-reader-accessibility.spec.ts`
- Create: `e2e/book-reader-storage.spec.ts`
- Modify: `e2e/book-reader-no-js.spec.ts`
- Modify: book layout/pages from Task 5

- [ ] **Step 1: Write component and storage RED tests**

Require server-rendered prose/notes/passports/credits/navigation, native `details/summary`, ordinary no-JS image/portal links, static `<progress>`, visible AI/medical/generative disclosures, explicit inventory absence and provenance boundaries. Add keyboard/image-dialog/focus-restore, native notes with JavaScript disabled and denied-storage browser cases before components exist.

Test local storage as a pure adapter keyed by release ID; invalid/denied/throwing storage returns a safe default without hiding text.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/book-components.test.ts tests/book-progress.test.ts
npx playwright test e2e/book-reader-accessibility.spec.ts e2e/book-reader-storage.spec.ts e2e/book-reader-no-js.spec.ts
```

Expected: semantic component/storage and browser assertions fail for absent enhancements.

- [ ] **Step 3: Implement minimal Web Component enhancement**

Use native custom elements/dialog. Image viewer must restore focus to its trigger on close/Escape. Reading progress may observe headings and store progress, but all chapter links and text remain functional without JavaScript.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npx vitest run tests/book-components.test.ts tests/book-progress.test.ts
npm run build
npx playwright test e2e/book-reader-accessibility.spec.ts e2e/book-reader-storage.spec.ts e2e/book-reader-no-js.spec.ts
git add src/components/book src/lib/book-release/progress.ts src/layouts/BookLayout.astro src/pages/book tests/book-components.test.ts tests/book-progress.test.ts e2e/book-reader-accessibility.spec.ts e2e/book-reader-storage.spec.ts e2e/book-reader-no-js.spec.ts
git commit -m "feat: add accessible book interactions"
```

### Task 7: Extend the visual system and fix metadata

**Files:**

- Create: `src/styles/book.css`
- Modify: `src/layouts/BaseLayout.astro`
- Modify: `src/components/SiteHeader.astro`
- Optionally modify: `src/components/SiteFooter.astro`
- Create: `tests/book-build-output.test.ts`
- Modify: `tests/layout-contract.test.ts`, `tests/accessibility-contract.test.ts`
- Modify: `e2e/book-reader.spec.ts`, `e2e/book-reader-accessibility.spec.ts`

- [ ] **Step 1: Write RED output/metadata tests**

Require Book navigation, correct canonical/social URLs with exactly one slash before `/yu`, release ID/digest data attributes, no private sentinels in rendered prose and no script/style/iframe/event attributes inside the rendered reader subtree. Add desktop/touch viewport, reduced-motion, focus visibility and horizontal-overflow browser assertions before the book stylesheet exists.

- [ ] **Step 2: Verify RED**

```bash
npm run build
npx vitest run tests/book-build-output.test.ts tests/layout-contract.test.ts tests/accessibility-contract.test.ts
npx playwright test e2e/book-reader.spec.ts e2e/book-reader-accessibility.spec.ts
```

- [ ] **Step 3: Implement the book design layer**

Preserve the existing Prata/Manrope museum language. Add a narrow long-form measure, luminous jade/amber section markers, large responsive figures, paper-toned evidence/passport surfaces, chronology distinctions, visible target/focus states, mobile single-column layout and reduced-motion/no-overflow behavior.

Fix `BaseLayout.astro` social image construction through the existing base-aware URL helper instead of string concatenation.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npm run build
npx vitest run tests/book-build-output.test.ts tests/layout-contract.test.ts tests/accessibility-contract.test.ts
npx playwright test e2e/book-reader.spec.ts e2e/book-reader-accessibility.spec.ts
git add src/styles/book.css src/layouts/BaseLayout.astro src/components/SiteHeader.astro src/components/SiteFooter.astro tests/book-build-output.test.ts tests/layout-contract.test.ts tests/accessibility-contract.test.ts e2e/book-reader.spec.ts e2e/book-reader-accessibility.spec.ts
git commit -m "style: create the living jade reader"
```

### Task 8: Cover desktop, touch, no-JS and storage behavior

**Files:** modify only a runtime or test file when the already-RED-first suites from Tasks 5–7 expose a real integration defect.

- [ ] **Step 1: Run the complete browser matrix from a clean checkout**

Cover desktop/mobile portal → interlude → exact return, keyboard-only navigation, image dialog open/close/focus restore, native notes with JavaScript disabled, denied storage, reduced motion and no horizontal overflow. Do not relax assertions or add arbitrary waits.

- [ ] **Step 2: Run the complete public gate**

```bash
npm run build
npm run test:unit
npm run test:browser
git diff --check
git status --short
```

- [ ] **Step 3: Commit only genuine integration fixes**

If no fix is required, create no commit. If a fix is required, repeat the relevant focused RED → GREEN proof and stage only its exact paths; generated roots remain byte-identical to the Task 4 commit.

### Task 9: Gate GitHub Pages and add post-deploy smoke

**Files:**

- Modify: `.github/workflows/deploy.yml`
- Create: `scripts/smoke-book-release.mjs`
- Create: `scripts/audit-book-release.mjs`
- Create: `tests/postdeploy-smoke.test.ts`
- Create: `tests/book-release-audit.test.ts`
- Modify: `tests/deploy-config.test.ts`
- Create: `docs/book-release-runbook.md`

- [ ] **Step 1: Write deployment/smoke RED tests**

Require an explicit quality job running checkout → Node 24 → `npm ci` → `npx playwright install --with-deps chromium` → `npm run build` → `npm run test:unit` → `npm run test:browser`. Build precedes unit tests because existing route/accessibility contracts inspect `dist/` on a clean checkout. Pages build/deploy must depend on that exact job. A post-deploy smoke job must depend on the deploy job, read release ID/digest from the checked-in manifest and check all five production URLs; it rejects non-2xx, soft-404 text and wrong identity. Audit tests require exact `B..P` path/mode allowlisting, forbidden private-tree blob-origin comparison, runtime source/generated/`dist/book` sentinel scanning and clean index/tree behavior.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/deploy-config.test.ts tests/postdeploy-smoke.test.ts tests/book-release-audit.test.ts
```

- [ ] **Step 3: Implement quality dependency and smoke script**

Keep the official checkout → `withastro/action` → `deploy-pages` chain, but make build depend on quality and smoke depend on the exact deploy. Implement the release audit as checked-in automation with explicit base/tip/private-tip/dist arguments and no ambient path guesses. The runbook requires a normal revert of the complete public release range and successful redeploy if post-deploy smoke fails; never rewrite history.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run tests/deploy-config.test.ts tests/postdeploy-smoke.test.ts tests/book-release-audit.test.ts
npm run build
git add .github/workflows/deploy.yml scripts/smoke-book-release.mjs scripts/audit-book-release.mjs tests/deploy-config.test.ts tests/postdeploy-smoke.test.ts tests/book-release-audit.test.ts docs/book-release-runbook.md
git commit -m "ci: verify and smoke test book releases"
```

## Public acceptance gate

- [ ] Reader bundle validates exact C/T/E/digest and binary bytes.
- [ ] `/book/`, three entry routes and `/book/sources/` build under `/yu/`.
- [ ] Full text, notes, object passports, credits and navigation work without JavaScript.
- [ ] Desktop/mobile/keyboard/no-JS/storage/reduced-motion browser tests pass.
- [ ] Second export produces zero diff.
- [ ] Staged/tree privacy scans find no private repository files or sentinel content.
- [ ] Complete Node 24 unit, build and browser gates pass before push.
