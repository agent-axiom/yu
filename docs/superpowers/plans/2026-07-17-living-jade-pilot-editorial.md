# Living Jade Pilot Editorial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Подготовить доказательно связанные пролог, главу 4 «Добродетель и бессмертие», мифологическую интерлюдию, 10–15 проверенных изображений и пакет для независимой рецензии.

**Architecture:** Текст начинается не с черновика, а с карты исследовательских вопросов, источников, тезисов и предметов. Каждый нетривиальный тезис получает stable ID, locator и уровень уверенности до того, как попадает в рукопись. Миф сначала рассказывается, затем датируется и разбирается по конкурирующим интерпретациям. Публикация возможна только после академической, литературной и rights-проверок.

**Tech Stack:** Приватный Git-репозиторий `yu-book`, Markdown, JSON, stable IDs, Zod/Vitest-контракты из platform-плана, первичные и рецензируемые источники, реестр медиаправ.

---

## Зависимость

Начать после Tasks 1–4 из `2026-07-17-living-jade-pilot-platform.md`: приватный репозиторий, схемы, loader и fail-closed exporter уже существуют. Этот план не меняет схемы без отдельного коммита и повторного запуска platform-тестов.

## Карта файлов

- `editorial/book-bible.md` — тон, термины, транслитерация, цитирование, шкала уверенности.
- `editorial/pilot-questions.md` — вопросы, которые глава обязана решить.
- `editorial/pilot-outline.md` — секции, сцены, тезисы, объекты и визуальные паузы.
- `editorial/translation-ledger.md` — исходный текст, транслитерация, буквальный и публикуемый перевод.
- `editorial/review-log.md` — замечание, основание, исправление, статус.
- `research/sources/*.json` — проверенные библиографические записи.
- `research/claims/*.json` — атомарные тезисы и их локаторы.
- `research/objects/*.json` — паспорта предметов.
- `rights/media/*.json` — разрешения и подписи.
- `manuscript/entries/prologue.md` — пролог.
- `manuscript/entries/virtue-immortality.md` — глава 4.
- `manuscript/entries/jade-immortality.md` — интерлюдия.
- `tests/pilot-editorial-contract.test.ts` — формальная приёмка корпуса.

### Task 1: Создать библию книги и контракт пилота

**Files:**
- Create: `editorial/book-bible.md`
- Create: `editorial/pilot-questions.md`
- Test: `tests/pilot-editorial-contract.test.ts`

- [ ] **Step 1: Записать редакционные правила**

`book-bible.md` must fix:

- Russian as the narrative language;
- Pinyin with tone marks at first occurrence, then the selected Russian form;
- Chinese characters at first occurrence for terms central to an argument;
- `нефрит`, `жадеит`, `jade`, `玉 / yù` and `pounamu` as non-interchangeable terms;
- present tense only for living traditions, not for reconstructed ancient beliefs;
- direct quotations limited to the wording needed for analysis; long passages paraphrased;
- confidence labels: `high`, `medium`, `contested`;
- endnotes in print and stable `#claim-id` links in web;
- dates as `до н. э.` / `н. э.` and an explicit note when a reign or archaeological phase is approximate.

- [ ] **Step 2: Записать десять вопросов пилота**

`pilot-questions.md` must include:

1. Когда свойства yù стали языком добродетели?
2. Какие тексты связывают yù с моральными качествами, и когда они записаны?
3. Что показывает контекст погребений Хань, а чего он не доказывает?
4. Как строились нефритовые погребальные оболочки и кому они были доступны?
5. Какие телесные и космологические функции приписывались yù?
6. Как менялась идея бессмертия между периодом Хань и поздней религиозной традицией?
7. Какова ранняя текстуальная история Сиванму?
8. Когда формируется образ Нефритового императора и как он связан с материалом?
9. Где современные пересказы склеивают разные эпохи?
10. Какие факты остаются спорными после сопоставления азиатской и западной литературы?

- [ ] **Step 3: Написать failing editorial contract**

```ts
import { describe, expect, it } from 'vitest';
import { loadStore, validateStore } from '../src/lib/store';

describe('pilot editorial corpus', () => {
  const store = loadStore(process.cwd());
  it('resolves every pilot relation', () => expect(validateStore(store)).toEqual([]));
  it('contains prologue, chapter and interlude', () => {
    expect([...store.entries.values()].map((entry) => entry.kind).sort())
      .toEqual(['chapter', 'interlude', 'prologue']);
  });
});
```

- [ ] **Step 4: Запустить контракт и увидеть FAIL**

Run: `npm test -- tests/pilot-editorial-contract.test.ts`

Expected: FAIL because the three manuscript entries do not exist.

- [ ] **Step 5: Закоммитить editorial foundation**

```bash
git add editorial/book-bible.md editorial/pilot-questions.md tests/pilot-editorial-contract.test.ts
git commit -m "docs: define pilot editorial protocol"
```

### Task 2: Собрать и отбрать корпус источников

**Files:**
- Create: `editorial/source-prospectus.md`
- Create: `research/sources/*.json`
- Modify: `tests/pilot-editorial-contract.test.ts`

- [ ] **Step 1: Записать source quotas**

The pilot needs at least 16 key records:

- 3 primary Chinese texts in a critical edition or academic translation;
- 4 works by Chinese or other Asian researchers, including at least 2 archaeological/excavation publications;
- 2 Chinese museum or archaeological-institution catalog records;
- 3 peer-reviewed Western studies or academic monographs;
- 1 study of the semantics/translation history of yù;
- 1 study explicitly discussing uncertainty or competing interpretation;
- 2 object-specific collection or excavation records.

For each quota, `source-prospectus.md` records search language, repository/catalog searched, selection reason, rejection reason and the question IDs it can answer.

- [ ] **Step 2: Добавить source-count assertions**

Extend the test:

```ts
it('uses regional and methodological balance', () => {
  const sources = [...store.sources.values()];
  expect(sources.length).toBeGreaterThanOrEqual(16);
  expect(sources.filter((source) => source.region === 'asia').length).toBeGreaterThanOrEqual(6);
  expect(sources.filter((source) => source.kind === 'primary-text').length).toBeGreaterThanOrEqual(3);
  expect(sources.filter((source) => ['paper', 'book'].includes(source.kind)).length).toBeGreaterThanOrEqual(4);
});
```

- [ ] **Step 3: Завести одну JSON-запись на каждый принятый источник**

Every record includes real authors, title, `publicationYear` of the edition actually consulted, optional `originalDate` for an ancient text/object record, publisher, region, kind, language, stable URL when available and page/catalog locator. Set `reviewStatus: fact-checked`; keep `releaseStatus: private` until the exact claim and publication rights are reviewed. Do not create a source record from a search-result snippet.

- [ ] **Step 4: Сверить библиографию**

Open every source at its publisher, journal, library, museum or institution page. Compare author order, title, edition publication year, original-date label and locator against the document itself. Record inaccessible sources as rejected; do not cite them from a secondary bibliography.

- [ ] **Step 5: Запустить model and balance tests**

Run: `npm test -- tests/model.test.ts tests/store.test.ts tests/pilot-editorial-contract.test.ts`

Expected: schema and source quotas PASS; manuscript-entry assertions still FAIL.

- [ ] **Step 6: Закоммитить source corpus**

```bash
git add editorial/source-prospectus.md research/sources tests/pilot-editorial-contract.test.ts
git commit -m "research: establish pilot source corpus"
```

### Task 3: Создать матрицу тезисов и переводов

**Files:**
- Create: `research/claims/*.json`
- Create: `editorial/translation-ledger.md`
- Modify: `tests/pilot-editorial-contract.test.ts`

- [ ] **Step 1: Разбить ответы на атомарные тезисы**

Create one claim record per independently verifiable statement. A claim must not join a date, object identification and interpretation in one sentence. Mark interpretive disagreements `confidence: contested` and list sources representing each position in `notes`.

- [ ] **Step 2: Заполнить translation ledger**

For each quoted Chinese passage record:

- source ID and locator;
- original characters;
- pinyin;
- literal gloss;
- published translation and translator;
- the book's Russian rendering;
- whether it is a quote or paraphrase;
- ambiguity relevant to the argument.

- [ ] **Step 3: Добавить claim assertions**

```ts
it('gives every claim a locator and a review note', () => {
  const claims = [...store.claims.values()];
  expect(claims.length).toBeGreaterThanOrEqual(24);
  expect(claims.every((claim) => claim.sourceIds.length > 0 && claim.notes.length >= 20)).toBe(true);
  expect(claims.some((claim) => claim.confidence === 'contested')).toBe(true);
});
```

- [ ] **Step 4: Проверить relation integrity**

Run: `npm test -- tests/store.test.ts tests/pilot-editorial-contract.test.ts`

Expected: every claim→source link resolves; claim quota PASS.

- [ ] **Step 5: Закоммитить claim matrix**

```bash
git add research/claims editorial/translation-ledger.md tests/pilot-editorial-contract.test.ts
git commit -m "research: map pilot claims to evidence"
```

### Task 4: Отобрать предметы и очистить права на визуальный ряд

**Files:**
- Create: `research/objects/*.json`
- Create: `rights/media/*.json`
- Create: `assets/pilot/*`
- Create: `editorial/visual-sequence.md`
- Modify: `tests/pilot-editorial-contract.test.ts`

- [ ] **Step 1: Составить визуальную последовательность**

Select 10–15 items across these functions: chapter opener, fibre/macro texture, one complete Han burial suit, construction detail, jade plugs or burial pieces, a datable ritual object, tomb/site plan, route/map, manuscript or inscription witness, Sivanmu image with date, later Jade Emperor image with date, visual pause. Each item must support a specific section; decorative duplicates are rejected.

- [ ] **Step 2: Создать object passports**

Record exact material, culture/period, date, dimensions when available, collection, inventory number, excavation/provenance, supporting source IDs and media IDs. Use `material: unidentified greenstone` when the institution does not provide a defensible mineral identification.

- [ ] **Step 3: Очистить канальные права**

For every media record verify web and print separately. Keep `rightsStatus: pending` until the institution's page or a written permission supports the exact channel. Store the required credit line verbatim. A museum's ownership of an object does not by itself establish copyright in the photograph.

- [ ] **Step 4: Добавить rights assertions**

```ts
it('has a reviewable visual package', () => {
  const media = [...store.media.values()];
  expect(media.length).toBeGreaterThanOrEqual(10);
  expect(media.length).toBeLessThanOrEqual(15);
  expect(media.every((item) => item.rightsStatus === 'cleared')).toBe(true);
  expect(media.every((item) => item.channels.includes('web') && item.channels.includes('print'))).toBe(true);
});
```

- [ ] **Step 5: Проверить files, rights and references**

Run: `npm test -- tests/store.test.ts tests/pilot-editorial-contract.test.ts`

Expected: every asset exists, every object relation resolves, all 10–15 records are cleared for both channels.

- [ ] **Step 6: Закоммитить visual package**

```bash
git add research/objects rights/media assets/pilot editorial/visual-sequence.md tests/pilot-editorial-contract.test.ts
git commit -m "research: clear pilot visual sequence"
```

### Task 5: Создать драматургию и первый черновик

**Files:**
- Create: `editorial/pilot-outline.md`
- Create: `editorial/openings.md`
- Create: `manuscript/entries/prologue.md`
- Create: `manuscript/entries/virtue-immortality.md`
- Create: `manuscript/entries/jade-immortality.md`

- [ ] **Step 1: Написать три пробных открытия по 250–350 слов**

Use three sourceable scenes: discovery/conservation of a Han burial suit; tactile/sound qualities of worked nephrite; a close reading of the earliest selected virtues passage. Under each opening list the exact claim IDs and object IDs it uses.

- [ ] **Step 2: Выбрать opening по критериям**

Score each opening from 1–5 for factual support, sensory force, relevance to both virtue and immortality, visual potential and absence of invented inner states. Record the scores in `openings.md`; use the highest total.

- [ ] **Step 3: Создать outline**

Use these chapter movements:

1. sourced opening scene;
2. material qualities become moral language;
3. ritual, rank and courtly use;
4. the Han body, tomb and jade suit;
5. what burial context proves and leaves uncertain;
6. interlude on immortality, Sivanmu and later Jade Emperor traditions;
7. return to the object and transition to Khotan/court workshops.

For every movement list target word count, claim IDs, object/media IDs, visual pause and transition sentence purpose.

- [ ] **Step 4: Написать пролог**

Target 1,500–2,000 Russian words. Introduce the book's central question and the difference between nephrite, jadeite and cultural jade without front-loading the full glossary.

- [ ] **Step 5: Написать главу 4**

Target 7,000–9,000 Russian words. Every paragraph containing a nontrivial historical assertion links to `#claim-id`; do not leave citation markers for claims absent from the registry.

- [ ] **Step 6: Написать интерлюдию**

Target 1,500–2,500 Russian words in five labelled movements: story, earliest witness, transformations, competing interpretations, living/later meaning. Explicitly state that the Jade Emperor's title and chronology do not prove a direct ancient material cult.

- [ ] **Step 7: Установить private/draft frontmatter**

All three entries use `releaseStatus: private`, `reviewStatus: draft` and list their complete claim/object/media dependency IDs.

- [ ] **Step 8: Запустить corpus tests**

Run: `npm test -- tests/store.test.ts tests/pilot-editorial-contract.test.ts`

Expected: all three entries load and every declared relation resolves.

- [ ] **Step 9: Закоммитить first draft**

```bash
git add editorial/openings.md editorial/pilot-outline.md manuscript/entries
git commit -m "feat: draft living jade pilot narrative"
```

### Task 6: Провести фактчек и независимую рецензию

**Files:**
- Create: `editorial/review-log.md`
- Modify: `research/claims/*.json`
- Modify: `manuscript/entries/*.md`

- [ ] **Step 1: Проверить каждый claim marker**

For every `#claim-id` in the manuscript, read the cited locator and record `supported`, `overstated`, `misquoted`, `translation issue` or `scope issue` in `review-log.md`. Any missing locator is an automatic failure.

- [ ] **Step 2: Проверить chronology and material names**

Create separate review rows for every dynasty/date, every use of `nephrite/jadeite/yù/jade`, every object identification and every link between a text and an archaeological context.

- [ ] **Step 3: Провести азиатскую академическую рецензию**

Provide the chapter, translation ledger, claim matrix and source list to a qualified reader of Chinese historical/archaeological material. Record every comment verbatim enough to act on, the accepted correction and the commit that resolves it. Publication remains blocked until this review exists.

- [ ] **Step 4: Провести западную/сравнительную рецензию**

Ask a second qualified reviewer to focus on method, contested interpretations, translation transparency and whether evidence supports scope. Resolve comments independently; disagreement is documented rather than silently averaged.

- [ ] **Step 5: Исправить manuscript and claims**

Each correction updates the manuscript and, when necessary, the atomic claim. Set a claim to `fact-checked` only after its review row is resolved.

- [ ] **Step 6: Запустить integrity tests**

Run: `npm test`

Expected: PASS; no claim is marked `approved` yet.

- [ ] **Step 7: Закоммитить reviewed draft**

```bash
git add editorial/review-log.md research/claims manuscript/entries
git commit -m "edit: resolve pilot fact review"
```

### Task 7: Провести литературную редактуру и макетную пробу

**Files:**
- Modify: `manuscript/entries/*.md`
- Create: `editorial/pilot-style-report.md`
- Create: `editorial/proof-review.md`
- Modify: `tests/pilot-editorial-contract.test.ts`

- [ ] **Step 1: Вычитать сквозную драматургию**

Check that each section starts with a concrete question or scene, ends by changing the reader's understanding, and transitions into the next movement. Remove repeated explanations of jade/nephrite and repeated caveats; keep the first full explanation and link back from later occurrences.

- [ ] **Step 2: Вычитать язык и термины**

Record word count, average paragraph length, quotations over 25 words, undefined specialist terms and inconsistent transliterations in `pilot-style-report.md`. Resolve every listed item or mark a documented exception.

- [ ] **Step 3: Собрать print proof**

Run: `npm run print:pilot`

Expected: `artifacts/living-jade-pilot.pdf` exists.

- [ ] **Step 4: Проверить объём и визуальный ритм**

Add a test that reads `pdfinfo` output when available and requires 28–36 pages. In `proof-review.md`, inspect every spread for image purpose, caption completeness, widows/orphans, minimum text size, contrast, bleed and repeated visual rhythm.

- [ ] **Step 5: Напечатать цветопробу**

Print the proof at 100% scale. Record paper, printer/profile, observed dark-green reproduction, shadow detail, small type readability, image sharpness and required corrections. Do not approve only from the screen PDF.

- [ ] **Step 6: Исправить proof issues and rebuild**

Run `npm run print:pilot` again and attach the resulting commit hash to every resolved proof issue.

- [ ] **Step 7: Закоммитить edited pilot**

```bash
git add manuscript/entries editorial/pilot-style-report.md editorial/proof-review.md tests/pilot-editorial-contract.test.ts
git commit -m "edit: finalize pilot reading rhythm"
```

### Task 8: Утвердить публичную версию

**Files:**
- Modify: `manuscript/entries/*.md`
- Modify: `research/{claims,sources,objects}/*.json`
- Modify: `rights/media/*.json`
- Modify: `release/public.json`
- Create: `editorial/release-signoff.md`

- [ ] **Step 1: Создать release checklist**

`release-signoff.md` has one signed row for academic review, Asian-source review, literary edit, translation ledger, rights/web, rights/print, object provenance, print proof, accessibility/no-JS web proof and author approval.

- [ ] **Step 2: Поднять review statuses**

Set entries and their complete dependency closure to `reviewStatus: approved` only when all corresponding signoff rows pass. Set `releaseStatus: public` only for prologue, chapter 4, the selected interlude and records needed by them.

- [ ] **Step 3: Записать explicit allowlist**

`release/public.json` contains:

```json
{
  "version": 1,
  "generatedLabel": "living-jade-pilot-v1",
  "entries": ["prologue", "chapter-04", "interlude-jade-immortality"]
}
```

- [ ] **Step 4: Запустить private release gate**

Run:

```bash
npm test
npm run build
npm run print:pilot
npm run export:public -- /Users/if/Documents/yu
```

Expected: every command PASS; exporter reports only three entries and their dependency closure.

- [ ] **Step 5: Просмотреть exported text for leakage**

Search the public bundle for the private sentinel string used in exporter tests and for IDs absent from `release/public.json`. Expected: no matches.

- [ ] **Step 6: Закоммитить signed release**

```bash
git add manuscript research rights release/public.json editorial/release-signoff.md
git commit -m "release: approve living jade pilot corpus"
```

## Приёмочный чек-лист

- Три запланированные manuscript entries существуют и проходят схему.
- Корпус содержит не менее 16 ключевых источников и 24 атомарных тезисов.
- Азиатские авторы и первичные тексты не заменены западными пересказами.
- Все цитаты и переводы имеют locator и запись в translation ledger.
- Все 10–15 медиафайлов имеют очищенные web- и print-права.
- Поздние традиции Сиванму/Нефритового императора не проецируются в неолит или Хань без свидетельства.
- Академическая и сравнительная рецензии записаны, а замечания закрыты или явно отклонены с обоснованием.
- Печатный пилот имеет 28–36 страниц и прошёл физическую цветопробу.
- Public export содержит только три allowlisted entries и их замкнутые зависимости.
