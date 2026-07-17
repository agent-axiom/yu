# YU Jade Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish a Russian-language, source-driven, immersive Astro site about jade history, mythology, mineralogy, and medicine at `https://agent-axiom.github.io/yu/`.

**Architecture:** Astro generates six content-first routes and a custom 404 page from validated local content collections. Progressive-enhancement components provide pointer light, timelines, evidence tabs, and comparison controls while static HTML remains complete without JavaScript. GitHub Actions builds the project with the official Astro Pages action and deploys the result from `main`.

**Tech Stack:** Astro 7.1, TypeScript 6, Astro Content Collections with Zod schemas, Vitest 4, jsdom 29, CSS custom properties, vanilla custom elements, GitHub Actions, GitHub Pages.

---

## File map

- `package.json`, `package-lock.json` — scripts and pinned dependency graph.
- `astro.config.mjs`, `tsconfig.json`, `vitest.config.ts` — Astro, TypeScript, test, GitHub Pages base-path configuration.
- `src/content.config.ts` — schemas for `sources`, `eras`, `myths`, `materials`, and `medicine`.
- `src/content/**` — validated JSON content records.
- `src/lib/urls.ts` — base-aware internal URL construction.
- `src/lib/content.ts` — source resolution and evidence-label helpers.
- `src/layouts/BaseLayout.astro` — document shell, metadata, skip link, shared header and footer.
- `src/components/**` — hero, navigation, timeline, myth explorer, material comparison, evidence panel, and source marker.
- `src/pages/*.astro` — home, history, mythology, material, medicine, sources, and 404 routes.
- `src/styles/global.css` — design tokens, responsive layout, typography, focus, and reduced-motion rules.
- `public/images/**` — generated atmospheric artwork and locally hosted open-license artifact images.
- `tests/**` — unit, content integrity, interaction, accessibility-contract, and route-output checks.
- `.github/workflows/deploy.yml` — official GitHub Pages build and deploy workflow.
- `README.md`, `CREDITS.md` — local commands, editorial policy, sources, image licenses, and generative-image disclosure.

### Task 1: Scaffold Astro and the test harness

**Files:**
- Create: `package.json`
- Create: `astro.config.mjs`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Test: `tests/urls.test.ts`
- Create: `src/lib/urls.ts`

- [ ] **Step 1: Create the package manifest and configuration**

Use these scripts and dependencies in `package.json`:

```json
{
  "name": "yu-jade",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro check && astro build",
    "preview": "astro preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "astro": "^7.1.0"
  },
  "devDependencies": {
    "@astrojs/check": "^0.9.9",
    "jsdom": "^29.1.1",
    "typescript": "^6.0.3",
    "vitest": "^4.1.10"
  }
}
```

Configure `astro.config.mjs` with `site: 'https://agent-axiom.github.io'`, `base: '/yu'`, `output: 'static'`, and `trailingSlash: 'always'`. Extend `astro/tsconfigs/strict` in `tsconfig.json`. Configure Vitest for the `jsdom` environment and include `tests/**/*.test.ts`.

- [ ] **Step 2: Install dependencies**

Run: `npm install`

Expected: exit 0 and a new `package-lock.json`.

- [ ] **Step 3: Write the failing base-path test**

Create `tests/urls.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { withBase } from '../src/lib/urls';

describe('withBase', () => {
  it('prefixes project routes exactly once', () => {
    expect(withBase('/history/', '/yu/')).toBe('/yu/history/');
    expect(withBase('/yu/history/', '/yu/')).toBe('/yu/history/');
  });
});
```

- [ ] **Step 4: Run the test and verify RED**

Run: `npm test -- tests/urls.test.ts`

Expected: FAIL because `src/lib/urls.ts` does not exist.

- [ ] **Step 5: Implement the base helper**

Create `src/lib/urls.ts`:

```ts
export function withBase(path: string, base = import.meta.env.BASE_URL): string {
  const normalizedBase = `/${base.replace(/^\/+|\/+$/g, '')}`;
  const normalizedPath = `/${path.replace(/^\/+/, '')}`;
  if (normalizedPath === normalizedBase || normalizedPath.startsWith(`${normalizedBase}/`)) {
    return normalizedPath;
  }
  return `${normalizedBase === '/' ? '' : normalizedBase}${normalizedPath}`;
}
```

- [ ] **Step 6: Verify GREEN and commit**

Run: `npm test -- tests/urls.test.ts`

Expected: 2 assertions pass.

Commit: `git add package.json package-lock.json astro.config.mjs tsconfig.json vitest.config.ts .gitignore src/lib/urls.ts tests/urls.test.ts && git commit -m "chore: scaffold Astro project"`

### Task 2: Define and validate the editorial content model

**Files:**
- Create: `src/content.config.ts`
- Create: `src/lib/content.ts`
- Create: `tests/content-schema.test.ts`
- Create: `src/content/sources/seed.json`
- Create: `src/content/eras/seed.json`
- Create: `src/content/myths/seed.json`
- Create: `src/content/materials/seed.json`
- Create: `src/content/medicine/seed.json`

- [ ] **Step 1: Write failing tests for evidence labels and source references**

Create `tests/content-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { evidenceLabel, missingSourceIds } from '../src/lib/content';

describe('content contracts', () => {
  it('uses explicit Russian evidence labels', () => {
    expect(evidenceLabel('traditional')).toBe('Традиционное представление');
    expect(evidenceLabel('none')).toBe('Доказательств нет');
  });

  it('reports unresolved citations', () => {
    expect(missingSourceIds(['museum-a', 'paper-b'], new Set(['museum-a']))).toEqual(['paper-b']);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/content-schema.test.ts`

Expected: FAIL because `src/lib/content.ts` does not exist.

- [ ] **Step 3: Implement content helpers**

Create `src/lib/content.ts` with a closed `EvidenceLevel` union, a `Record<EvidenceLevel, string>` label map, `evidenceLabel(level)`, and `missingSourceIds(citations, available)` implemented with `Array.filter`.

- [ ] **Step 4: Define collection schemas and seed records**

Use `defineCollection`, `glob`, and `z` in `src/content.config.ts`. Require these fields:

```ts
const citation = z.array(z.string()).min(1);
const sourceSchema = z.object({ title: z.string(), authors: z.array(z.string()), year: z.number(), publisher: z.string(), url: z.string().url(), region: z.enum(['asia', 'west', 'global']), kind: z.enum(['paper', 'museum', 'book', 'institution']), license: z.string().optional(), accessed: z.string() });
const eraSchema = z.object({ title: z.string(), date: z.string(), order: z.number(), summary: z.string(), detail: z.string(), place: z.string(), image: z.string().optional(), imageAlt: z.string().optional(), citations: citation });
const mythSchema = z.object({ title: z.string(), culture: z.string(), legend: z.string(), context: z.string(), confirmed: z.string(), citations: citation });
const materialSchema = z.object({ name: z.string(), family: z.string(), chemistry: z.string(), hardness: z.string(), structure: z.string(), toughness: z.string(), note: z.string(), citations: citation });
const medicineSchema = z.object({ title: z.string(), tradition: z.string(), assessment: z.string(), evidence: z.enum(['traditional', 'laboratory', 'clinical', 'none']), safety: z.string(), citations: citation });
```

Seed each collection with one schema-valid JSON record referencing `seed-source`. Export all five collections.

- [ ] **Step 5: Verify GREEN and Astro schema generation**

Run: `npm test -- tests/content-schema.test.ts && npx astro sync`

Expected: tests pass and Astro sync exits 0 with generated collection types.

- [ ] **Step 6: Commit**

Commit: `git add src/content.config.ts src/content src/lib/content.ts tests/content-schema.test.ts && git commit -m "feat: define sourced content model"`

### Task 3: Research and author verified content

**Files:**
- Replace: `src/content/sources/seed.json`
- Replace: `src/content/eras/seed.json`
- Replace: `src/content/myths/seed.json`
- Replace: `src/content/materials/seed.json`
- Replace: `src/content/medicine/seed.json`
- Create: `tests/content-integrity.test.ts`
- Create: `CREDITS.md`

- [ ] **Step 1: Collect primary and institutional sources**

Use museum, university, geological, medical, and peer-reviewed sources. The final source collection must include at least four Asian institutions or Asia-based scholars, four Western institutions or scholars, two mineralogical references, and two medical or toxicological references. Record exact URLs, access date `2026-07-17`, author or institution, publication year, regional perspective, and image license where applicable.

- [ ] **Step 2: Write the failing content-integrity test**

Create a test that imports the JSON source and content records and asserts:

```ts
expect(sourceRegions).toContain('asia');
expect(sourceRegions).toContain('west');
expect(new Set(allSourceIds).size).toBe(allSourceIds.length);
expect(missingSourceIds(allCitations, new Set(allSourceIds))).toEqual([]);
expect(medicineRecords.every((item) => item.safety.length >= 40)).toBe(true);
expect(eraRecords[0].order).toBeLessThan(eraRecords.at(-1)!.order);
```

- [ ] **Step 3: Run the test and verify RED**

Run: `npm test -- tests/content-integrity.test.ts`

Expected: FAIL because seed content lacks required regional breadth and chronology.

- [ ] **Step 4: Replace seed data with researched records**

Author at least eight chronological eras, four cross-cultural myths, two material records (`Нефрит`, `Жадеит`), four medical claims, and the complete source list. Every central claim must cite one or more exact records; contested interpretations must say so explicitly. `CREDITS.md` must distinguish documentary photographs from generated illustrations.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- tests/content-integrity.test.ts && npx astro sync`

Expected: all assertions pass and content sync exits 0.

Commit: `git add src/content CREDITS.md tests/content-integrity.test.ts && git commit -m "content: add sourced jade research"`

### Task 4: Build the document shell and design system

**Files:**
- Create: `src/styles/global.css`
- Create: `src/layouts/BaseLayout.astro`
- Create: `src/components/SiteHeader.astro`
- Create: `src/components/SiteFooter.astro`
- Create: `src/components/SourceRef.astro`
- Create: `tests/layout-contract.test.ts`

- [ ] **Step 1: Write the failing layout contract test**

Read the component source files and assert that the layout contains `<html lang="ru">`, a skip link to `#main-content`, one `main` landmark, a canonical link, and that the header uses base-aware route helpers.

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/layout-contract.test.ts`

Expected: FAIL because layout files do not exist.

- [ ] **Step 3: Implement the shell**

`BaseLayout.astro` accepts `{ title, description, image?, eyebrow? }`, builds canonical metadata from `Astro.site` and `Astro.url`, renders the skip link, header, `<main id="main-content">`, and footer. `SourceRef.astro` renders a keyboard-operable `<details>` citation card with title, author, publisher, year, and external link.

- [ ] **Step 4: Implement the visual tokens**

Define CSS variables for ink `#07110f`, deep jade `#123a30`, living jade `#8fcba5`, mist `#dce8df`, warm paper `#eee8d9`, and amber warning `#d5a866`. Add fluid type, editorial grids, focus rings, `.reveal` progressive enhancement, responsive breakpoints at 900px and 640px, and a `prefers-reduced-motion` block that removes transforms and transitions.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- tests/layout-contract.test.ts`

Expected: all layout contract assertions pass.

Commit: `git add src/layouts src/components/SiteHeader.astro src/components/SiteFooter.astro src/components/SourceRef.astro src/styles tests/layout-contract.test.ts && git commit -m "feat: add living jade design system"`

### Task 5: Create and integrate original visual assets

**Files:**
- Create: `public/images/hero-jade.webp`
- Create: `public/images/jade-macro.webp`
- Create: `public/images/mythic-jade.webp`
- Create: `public/images/artifacts/*`
- Modify: `CREDITS.md`
- Create: `tests/assets.test.ts`

- [ ] **Step 1: Search open-access museum imagery**

Select artifact images only when the source provides public-domain or explicit reusable licensing. Save local copies with descriptive filenames and record object title, culture, approximate date, institution, object URL, image URL, creator, and license in `CREDITS.md`.

- [ ] **Step 2: Generate three atmospheric illustrations**

Use the built-in image generation tool for a wide hero jade boulder, a macro mineral texture, and a historically non-documentary mythic still. Prompts must exclude text, logos, watermarks, counterfeit museum labels, and identifiable real artifacts. Copy final images into `public/images/` and label them as generated illustrations in `CREDITS.md`.

- [ ] **Step 3: Write the failing asset test**

Assert each required local image exists, is non-empty, and that every filename appears in `CREDITS.md` with either a reusable license or the phrase `генеративная иллюстрация`.

- [ ] **Step 4: Optimize and verify assets**

Use the bundled image runtime or `sips` to constrain hero width to 2400px, supporting images to 1800px, and output WebP at high quality. Run: `npm test -- tests/assets.test.ts`.

Expected: all required files and credits pass.

- [ ] **Step 5: Commit**

Commit: `git add public/images CREDITS.md tests/assets.test.ts && git commit -m "feat: add credited jade imagery"`

### Task 6: Build the immersive home page

**Files:**
- Create: `src/components/JadeHero.astro`
- Create: `src/components/RouteCard.astro`
- Create: `src/pages/index.astro`
- Create: `tests/hero-interaction.test.ts`

- [ ] **Step 1: Write the failing hero interaction test**

In jsdom, create a `<jade-hero>` element with a `.hero__light` child, import the component interaction module, dispatch `pointermove`, and expect CSS properties `--pointer-x` and `--pointer-y` to change. Set `matchMedia('(prefers-reduced-motion: reduce)')` to true in a second case and expect no pointer listener update.

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/hero-interaction.test.ts`

Expected: FAIL because the interaction module is absent.

- [ ] **Step 3: Implement progressive hero behavior**

Create a small exported `bindHeroPointer(root, reduceMotion)` function next to `JadeHero.astro`; calculate pointer percentages from `getBoundingClientRect`, write the two CSS variables, and return a cleanup function. The Astro component renders the hero image, decorative light, title, introduction, and a base-aware jump link.

- [ ] **Step 4: Compose the home page**

Render the approved sequence: hero, concise definition, four `RouteCard` links, history preview, myth quotation, material lens preview, medical evidence warning, and source-methodology callout. Use the generated hero and macro images with intrinsic dimensions and Russian alt text.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- tests/hero-interaction.test.ts && npm run build`

Expected: hero tests pass and `/yu/index.html` is generated.

Commit: `git add src/components/JadeHero.astro src/components/RouteCard.astro src/pages/index.astro tests/hero-interaction.test.ts && git commit -m "feat: build immersive jade homepage"`

### Task 7: Implement the historical timeline and history route

**Files:**
- Create: `src/components/HistoryTimeline.astro`
- Create: `src/lib/timeline.ts`
- Create: `src/pages/history.astro`
- Create: `tests/timeline.test.ts`

- [ ] **Step 1: Write failing timeline state tests**

Test `nextEra(current, direction, length)` for forward, backward, and clamped boundaries, and `eraPanelId(id)` for stable `era-panel-${id}` output.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/timeline.test.ts`

Expected: FAIL because timeline helpers do not exist.

- [ ] **Step 3: Implement helpers and semantic timeline**

Render eras as buttons in an ordered list with `aria-controls` and `aria-selected`. Render every era panel in the HTML, hide only inactive panels after enhancement, and support ArrowLeft/ArrowRight/Home/End. Use `nextEra` and stable panel IDs in the custom element.

- [ ] **Step 4: Compose the history route**

Add an introduction explaining archaeological evidence, the interactive timeline, artifact panels with credits, a section on changing meanings of jade, and contextual citations. Avoid presenting disputed symbolic meanings as settled facts.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- tests/timeline.test.ts && npm run build`

Expected: timeline tests pass and `dist/history/index.html` exists beneath the configured base output.

Commit: `git add src/components/HistoryTimeline.astro src/lib/timeline.ts src/pages/history.astro tests/timeline.test.ts && git commit -m "feat: add sourced jade history timeline"`

### Task 8: Implement mythology and material exploration

**Files:**
- Create: `src/components/MythExplorer.astro`
- Create: `src/components/MaterialLens.astro`
- Create: `src/lib/explorers.ts`
- Create: `src/pages/mythology.astro`
- Create: `src/pages/material.astro`
- Create: `tests/explorers.test.ts`

- [ ] **Step 1: Write failing explorer tests**

Test that `mythLayerLabel('legend')`, `mythLayerLabel('context')`, and `mythLayerLabel('confirmed')` return the three approved Russian labels. Test `clampLens(-5) === 0`, `clampLens(45) === 45`, and `clampLens(120) === 100`.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/explorers.test.ts`

Expected: FAIL because `src/lib/explorers.ts` does not exist.

- [ ] **Step 3: Implement mythology explorer**

Render each myth with three native buttons and three corresponding content panels. Before enhancement, show all layers with headings. After enhancement, use `aria-selected`, `aria-controls`, and hidden states. Keep the legend wording in attributed or carefully paraphrased form within source limits.

- [ ] **Step 4: Implement material lens**

Use a labeled native range input from 0 to 100 to move a CSS clip boundary between nephrite and jadeite textures. Show both material records simultaneously in a responsive comparison table so the interaction never hides essential facts.

- [ ] **Step 5: Compose both routes and verify GREEN**

Run: `npm test -- tests/explorers.test.ts && npm run build`

Expected: tests pass and both route directories are generated.

- [ ] **Step 6: Commit**

Commit: `git add src/components/MythExplorer.astro src/components/MaterialLens.astro src/lib/explorers.ts src/pages/mythology.astro src/pages/material.astro tests/explorers.test.ts && git commit -m "feat: add myth and material explorers"`

### Task 9: Implement evidence-first medicine and sources routes

**Files:**
- Create: `src/components/EvidencePanel.astro`
- Create: `src/pages/medicine.astro`
- Create: `src/pages/sources.astro`
- Create: `tests/medicine-contract.test.ts`

- [ ] **Step 1: Write the failing medical safety contract**

Read the generated medicine page source and assert it contains the exact phrases `не заменяет диагностику`, `не заменяет назначенное лечение`, and all four evidence labels. Assert every medical record renders a source marker and a visible safety paragraph.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/medicine-contract.test.ts`

Expected: FAIL because the medicine page and evidence component do not exist.

- [ ] **Step 3: Implement evidence cards and medicine route**

`EvidencePanel.astro` renders the title, tradition summary, evidence badge, assessment, safety note, and resolved `SourceRef` entries. The page begins with the safety notice, explains the evidence categories, lists every medical record, and ends with guidance to seek qualified medical care rather than product recommendations.

- [ ] **Step 4: Implement sources and methodology route**

Group all sources by `paper`, `museum`, `book`, and `institution`. Show authors, year, publisher, title, link, access date, and regional perspective. Add the editorial hierarchy, disagreement policy, medical threshold, and image-license disclosure.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- tests/medicine-contract.test.ts && npm run build`

Expected: safety contract passes and both routes build.

Commit: `git add src/components/EvidencePanel.astro src/pages/medicine.astro src/pages/sources.astro tests/medicine-contract.test.ts && git commit -m "feat: add evidence-led medical summary"`

### Task 10: Add route, accessibility, and resilience verification

**Files:**
- Create: `src/pages/404.astro`
- Create: `tests/routes.test.ts`
- Create: `tests/accessibility-contract.test.ts`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Write failing route-output tests**

After building, assert that `dist/index.html`, `dist/history/index.html`, `dist/mythology/index.html`, `dist/material/index.html`, `dist/medicine/index.html`, `dist/sources/index.html`, and `dist/404.html` exist. Parse internal `href` values and assert each starts with `/yu/`, `#`, `mailto:`, or `http`.

- [ ] **Step 2: Write failing accessibility contract tests**

Read component sources and assert interactive controls are native `button` or `input`, all images have non-empty `alt` or explicit decorative empty alt, every page uses one `<h1>`, and the stylesheet contains `prefers-reduced-motion`, `:focus-visible`, and a skip-link focus rule.

- [ ] **Step 3: Run RED**

Run: `npm run build && npm test -- tests/routes.test.ts tests/accessibility-contract.test.ts`

Expected: FAIL until the 404 page and any uncovered contracts are implemented.

- [ ] **Step 4: Implement the 404 route and close contract gaps**

Use `BaseLayout`, a concise Russian explanation, and base-aware links to the home page and four primary sections. Fix only specific issues identified by the tests.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm run build && npm test`

Expected: Astro check/build exit 0 and the full Vitest suite reports zero failures.

Commit: `git add src/pages/404.astro src/styles/global.css tests/routes.test.ts tests/accessibility-contract.test.ts && git commit -m "test: verify routes and accessibility contracts"`

### Task 11: Document and configure GitHub Pages deployment

**Files:**
- Create: `.github/workflows/deploy.yml`
- Create: `README.md`
- Create: `tests/deploy-config.test.ts`

- [ ] **Step 1: Write the failing workflow contract test**

Read the YAML and Astro config as text. Assert the workflow triggers on `main`, grants `contents: read`, `pages: write`, and `id-token: write`, uses `actions/checkout@v7`, `withastro/action@v6`, and `actions/deploy-pages@v5`, and the Astro config includes `site: 'https://agent-axiom.github.io'` plus `base: '/yu'`.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/deploy-config.test.ts`

Expected: FAIL because the workflow is absent.

- [ ] **Step 3: Add the official deployment workflow**

Create `.github/workflows/deploy.yml` with separate `build` and `deploy` jobs, `workflow_dispatch`, the official actions above, the `github-pages` environment, and `url: ${{ steps.deployment.outputs.page_url }}`.

- [ ] **Step 4: Write the README**

Document the site purpose, `npm install`, `npm run dev`, `npm test`, `npm run build`, project structure, source methodology, image credits link, accessibility behavior, and expected Pages URL.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- tests/deploy-config.test.ts && npm run build`

Expected: workflow contract passes and production build exits 0.

Commit: `git add .github/workflows/deploy.yml README.md tests/deploy-config.test.ts && git commit -m "ci: deploy Astro site to GitHub Pages"`

### Task 12: Final local audit, remote publication, and live verification

**Files:**
- Modify only files required by failures found below.

- [ ] **Step 1: Run the complete local gate**

Run: `npm test && npm run build && git diff --check && git status --short`

Expected: all tests pass, Astro check/build exit 0, no whitespace errors, and only intentional changes are listed.

- [ ] **Step 2: Inspect the production site locally**

Run `npm run preview -- --host 127.0.0.1` and inspect home, history, mythology, material, medicine, sources, and 404 at desktop and mobile widths. Verify keyboard controls, reduced motion, image loading, base-prefixed navigation, and citation links. Stop the preview server after inspection.

- [ ] **Step 3: Create the remote repository**

Verify authentication and organization access:

```bash
gh auth status
gh api orgs/agent-axiom --jq .login
```

Create a public repository without adding remote files, then add `origin`:

```bash
gh repo create agent-axiom/yu --public --source=. --remote=origin
```

Expected: repository URL `https://github.com/agent-axiom/yu` and an `origin` remote.

- [ ] **Step 4: Push and enable GitHub Pages Actions**

Run:

```bash
git push -u origin main
gh api --method POST repos/agent-axiom/yu/pages -f build_type=workflow
```

If Pages already exists, use `gh api --method PUT repos/agent-axiom/yu/pages -f build_type=workflow`.

- [ ] **Step 5: Verify workflow and live URL**

Run:

```bash
gh run list --repo agent-axiom/yu --workflow deploy.yml --limit 1
gh run watch --repo agent-axiom/yu --exit-status
curl -I https://agent-axiom.github.io/yu/
```

Expected: workflow conclusion `success` and live URL returns HTTP 200.

- [ ] **Step 6: Verify final repository state**

Run: `git status --short --branch && git log --oneline -8 && git remote -v`

Expected: clean `main` tracking `origin/main`, visible implementation commits, and the `agent-axiom/yu` remote.
