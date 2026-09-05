# Multilingual Museum Release

**Goal:** Publish the approved RU/EN release, contextual glossary, self-hosted fonts and localized social cards.

**Architecture:** Keep Russian URLs unchanged and add English static routes under `/yu/en/`. Both versions render shared Astro templates, localized collection data and small locale-aware controllers. Language links preserve page and hash. Shared source identifiers and museum facts remain stable. No backend or new runtime dependency is required.

## Ownership and sequence

- [x] Root: create locale/path helpers, shared header/footer/layout and source/evidence labels; configure language metadata, sitemap and social images. Own `src/lib/i18n.ts`, `src/lib/content.ts`, `src/layouts/BaseLayout.astro`, `SiteHeader`, `SiteFooter`, `SourceRef`, `EvidencePanel`, `RouteCard`, global CSS, public fonts/social assets and scripts.
- [x] Agent A: translate all existing page templates and collection content, add English wrapper routes. Own existing `src/pages/*.astro` except glossary, `src/pages/en/*` except glossary, and `src/i18n/content.*`. Use `localeFromPath`, `translator`, `localizePath` from the root helper. Preserve Russian copy and stable collection IDs/citations.
- [x] Agent B: localize hero, timeline, myth explorer, mineral lens, object biography and legend history, including dynamic accessibility labels. Own those components plus their controllers/tests. Detect locale from the rendered URL and serialize only where client behavior needs it.
- [x] Agent C: build six sourced bilingual glossary entries (jade, nephrite, jadeite, yù, bì, pounamu), glossary route and contextual dialog. Own glossary data/controller/components and two glossary routes. A term link must remain a normal glossary-anchor link without JavaScript. Keyboard dialog closes with Escape and restores focus. Pronunciation is written or links to a reliable language source; no invented audio.
- [x] Root: integrate contextual term links in selected page passages after Agent A finishes; mount glossary dialog once in the shared layout.
- [x] Root: self-host licensed Manrope and Prata with local Latin/Cyrillic coverage, preserve license notices, remove external font requests.
- [x] Root: create 1200×630 localized social cards by rendering authored HTML card layouts with existing credited assets and local fonts; add correct absolute metadata URLs, image dimensions, language links and sitemap.
- [x] Verify: locale helper edge cases; translation completeness by stable IDs; browser RU/EN navigation, hash preservation, all interactive states, glossary keyboard/no-JS fallback, mobile widths, local-font loading, social-card existence and metadata. Existing tests run once after integration; repeat only for changes/failures.
- Publication handoff: review the final release, commit, push, open PR, merge main under the user's standing publication authorization, wait for Pages and inspect public results.

## Interfaces

`src/lib/i18n.ts` exports `Locale = 'ru' | 'en'`, `localeFromPath(pathname, base?)`, `localizePath(path, locale, base?)`, and `translator(locale)` returning `(ru, en) => string`. Components infer language from `Astro.url.pathname`; English wrapper pages render the same templates. Dynamic controls use `data-locale` or `document.documentElement.lang`.

The glossary exports `Term.astro` with `id`, optional `locale` and a text slot; its fallback goes to the matching localized glossary anchor. `GlossaryDialog.astro` is mounted once by BaseLayout and enhances `[data-term]` links. The root integrates these after page ownership ends.

## Content boundaries

English is a full editorial translation of the existing site, including medical limitations and accessible labels. Original bibliographic titles, object identifiers, Chinese characters and Māori macrons are preserved. Atlas, Chinese localization and lighting simulations remain later releases.

## Verification record

2026-09-05: production build completed (16 pages); 856/856 unit tests and 24/24 desktop/touch browser scenarios passed. Cross-reviews covered translations, shared routing/metadata and glossary accessibility. Narrow-screen source cards and medical headings were corrected; the existing release validator was preserved. Social cards were rendered and visually checked. Publication uses the existing GitHub Pages workflow on main.
