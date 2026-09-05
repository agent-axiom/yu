# Museum Interactives Implementation Plan

> **For agentic workers:** Use subagent-driven development with non-overlapping component ownership and a final integrated review.

**Goal:** Deliver the approved first trio: an object biography with detail exploration, a dated history of a legend, and an honest mineral-structure comparison.

**Architecture:** Retain Astro's static pages and enhance isolated components with small TypeScript controllers. Content remains readable without JavaScript; native controls support touch and keyboard. Use existing licensed museum media, primary-source references, and explicitly labelled schematic SVGs. No new runtime dependency is needed for bounded image zoom or the two educational diagrams.

**Tech Stack:** Astro, TypeScript, SVG/CSS, Vitest/jsdom, Playwright.

## Approved experience

- History: a warm-paper museum spread around Met object 17.118.43. A sticky object viewer accompanies five short chapters: material, making, possible use, unknown provenance, museum record. The viewer offers zoom, reset, detail buttons and a source link. It does not invent a findspot, owner, tool mark or ritual for this particular object.
- Mythology: a focused dossier on Heshibi separates narrative time from dates of textual witnesses. Controls select a witness and its interpretive layer; all witnesses remain readable without JavaScript. Quotations are avoided unless independently checked.
- Material: replace the reused tinted photo with two visibly different vector models of interlocking fibres and grains. Explain hardness versus toughness without numerical simulation or claims of diagnostic fidelity.
- Home: add a compact editorial gateway to the three sections using anchored links. Keep the current visual language, introduce warm-paper reading surfaces and restrained motion.

## Task 1 — Object biography and integration (root)

Files: `src/components/ObjectBiography.astro`, `src/lib/object-explorer.ts`, `tests/object-explorer.test.ts`, `src/pages/history.astro`, `src/pages/index.astro`.

- [x] Verify Met object date, material, acquisition credit and image rights from the official collection record.
- [x] Add behavior tests for zoom bounds, detail selection, reset and keyboard movement; confirm they fail before implementing the controller.
- [x] Build the object spread and five evidence-conscious chapters. Retained the credited 1200px image with bounded 2.5× inspection.
- [x] Integrate the section at `history/#object-biography` and add homepage gateways to all three new sections.

## Task 2 — Material lens (agent A)

Files: `src/components/MaterialLens.astro`, optional `src/lib/material-lens.ts`, `tests/material-lens.test.ts`, narrowly `src/pages/material.astro`.

- [x] Add meaningful DOM tests for the comparison control and readable fallback.
- [x] Render distinct authored SVG fibre/grain structures with accessible captions and a permanent schematic label.
- [x] Make the native comparison slider update the two visible regions and its accessible value; preserve the materials table.
- [x] Add a compact explanatory hardness/toughness comparison, avoid pseudo-physical animation.

## Task 3 — Legend history (agent B)

Files: `src/components/LegendHistory.astro`, `src/lib/legend-history.ts`, `tests/legend-history.test.ts`, `src/pages/mythology.astro`.

- [x] Verify textual witnesses and dates using primary editions or institutional research, recording links alongside the dossier.
- [x] Add behavior tests for witness selection and keyboard navigation; observe the missing-feature failure.
- [x] Build a dated witness navigator with a distinct narrative-time label and readable static sections. Switching is immediate, with no compulsory animation.
- [x] Insert at `mythology/#legend-history`; retain the existing cross-cultural myth cards and correct the conflicting three-offers paraphrase.

## Task 4 — Verification and review (root)

Files: `e2e/museum-interactives.spec.ts`, existing source/credits documentation if media are added.

- [x] Run targeted DOM tests, Astro check and build under Node 24.
- [x] Run the existing unit suite: 818 tests pass across 21 files.
- [x] Verify desktop and mobile controls, keyboard navigation, no-JS reading, reduced motion and horizontal overflow: 12 browser tests pass.
- [x] Inspect screenshots of all three sections and the homepage; fix 320px internal heading overflow and add a measured regression assertion.
- [x] Review factual boundaries, sources, accessibility and final diff. Local preview runs at http://127.0.0.1:4321/yu/; no deployment or commit.

Verification notes: external Google Fonts requests stalled in this environment. Browser tests explicitly abort those requests and exercise declared fallback fonts. Native no-JS disclosure is verified with keyboard activation. Astro check reports zero errors and existing content-schema deprecation hints; the pre-existing absent book-release directory warnings remain outside this change.

## Evidence boundaries

Met reference: https://www.metmuseum.org/art/collection/search/49371 — object 17.118.43, mid-third millennium BCE, Liangzhu culture, nephrite, Rogers Fund 1917; image marked Public Domain. The record's general ritual/status interpretation is labelled as interpretation, not a documented biography of this individual object.

GIA reference: https://www.gia.edu/jade-description — jade materials comprise interlocking crystals; diagrams are explanatory models, not microscope photographs. Existing GIA/Dorling material references remain available in the page's source system.

All content decisions follow the user's approved museum/story/atlas direction. The separate private release-platform work remains outside this change.
