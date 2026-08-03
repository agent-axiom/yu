export const agentReviewDisclosure =
  'Материал проверен независимой коллегией AI-агентов по источникам, хронологии, объектам и сравнительному методу. Это не человеческая научная рецензия, не медицинская консультация и не подтверждение прав на изображения.';

export const targetCommit = 'a'.repeat(40);
export const reviewEvidenceCommit = 'b'.repeat(40);
export const payloadDigest = 'c'.repeat(64);
export const contentBindingDigest = 'd'.repeat(64);

export const validEntry = {
  id: 'chapter-04',
  slug: 'virtue-immortality',
  kind: 'chapter',
  title: 'Добродетель и бессмертие',
  subtitle: 'Как нефрит стал языком ритуала, памяти и надежды',
  order: 2,
  part: 1,
  readingMinutes: 2,
  noteIds: ['note-001'],
  objectIds: ['object-han-jade-suit'],
  mediaIds: ['media-han-jade-suit'],
  readingSequence: {
    interludeId: 'interlude-jade-immortality',
    portalAnchor: 'portal-jade-immortality',
    returnAnchor: 'after-jade-immortality',
  },
} as const;

export const validNote = {
  id: 'note-001',
  anchor: 'note-001',
  statement: 'В музейном каталоге материал предмета атрибутирован как нефрит.',
  confidence: 'medium',
  limitation: 'Эта атрибуция не заменяет минералогический анализ самого предмета.',
  sourceIds: ['source-henan-museum'],
} as const;

export const validSource = {
  id: 'source-henan-museum',
  authors: ['Henan Museum'],
  title: 'Gold-thread jade burial suit',
  year: 2020,
  type: 'museum-record',
  publisher: 'Henan Museum',
  url: 'https://www.chnmus.net/example/object.html',
  locators: ['Object description: material, date and excavation context'],
} as const;

const objectCore = {
  id: 'object-han-jade-suit',
  title: 'Погребальный костюм из пластин',
  culture: 'Западная Хань, Китай',
  date: '206 до н. э. — 9 н. э.',
  material: 'Пластины 青玉 и золотая проволока',
  materialQualification: 'Музейная каталожная атрибуция; опубликованный минералогический анализ не указан.',
  materialAttribution: 'Henan Museum',
  collection: 'Henan Museum',
  provenanceBoundary: 'Паспорт ограничен сведениями музейной выставочной страницы.',
  credits: ['Henan Museum', 'Фотография: Gary Todd, CC0 1.0'],
  sourceIds: ['source-henan-museum'],
  mediaIds: ['media-han-jade-suit'],
} as const;

export const validObject = {
  ...objectCore,
  inventory: {
    status: 'not-published',
    statement: 'Инвентарный номер отсутствует в использованной публичной карточке.',
  },
} as const;

export const validPublishedInventoryObject = {
  ...objectCore,
  inventory: { status: 'published', number: 'F1916.155' },
} as const;

const mediaCore = {
  alt: 'Погребальный костюм из прямоугольных пластин, соединённых золотой проволокой.',
  caption: 'Погребальный костюм Западной Хань в экспозиции Henan Museum.',
  credit: 'Gary Todd / Wikimedia Commons',
  license: 'CC0 1.0',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Western_Han_Jade_Burial_Suit.jpg',
} as const;

export const validDocumentaryMedia = {
  id: 'media-han-jade-suit',
  outputName: 'han-jade-suit.webp',
  ...mediaCore,
  kind: 'documentary',
} as const;

export const validAuthoredDiagramMedia = {
  id: 'media-site-context',
  outputName: 'site-context.svg',
  ...mediaCore,
  kind: 'authored-diagram',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  author: 'agent-axiom',
  changeNote: 'Схема составлена для книги; масштаб и положение элементов обобщены.',
} as const;

export const validGenerativeMedia = {
  id: 'media-nephrite-fibre',
  outputName: 'nephrite-fibre.webp',
  ...mediaCore,
  kind: 'generative',
  credit: 'Создано с помощью OpenAI для проекта agent-axiom',
  license: 'Project-owned output',
  licenseUrl: 'https://openai.com/policies/terms-of-use/',
  sourceUrl: 'https://github.com/agent-axiom/yu/blob/main/CREDITS.md',
  nondocumentaryDisclosure: 'Недокументальная визуализация: изображение не является историческим свидетельством.',
} as const;

export const validManifest = {
  version: 4,
  projection: 'reader-v1',
  transformer: 'reader-markdown-v1',
  cycleId: 'cycle-02',
  targetCommit,
  reviewEvidenceCommit,
  releaseId: `living-jade-reader-v1-${targetCommit}`,
  readerPayloadDigest: payloadDigest,
  readingOrder: ['chapter-04'],
  counts: { entries: 1, notes: 1, sources: 1, objects: 1, media: 3 },
  files: [
    ['src/content/book-release/entries/chapter-04.md', 'text'],
    ['src/content/book-release/media/media-han-jade-suit.json', 'text'],
    ['src/content/book-release/media/media-nephrite-fibre.json', 'text'],
    ['src/content/book-release/media/media-site-context.json', 'text'],
    ['src/content/book-release/notes/note-001.json', 'text'],
    ['src/content/book-release/objects/object-han-jade-suit.json', 'text'],
    ['src/content/book-release/sources/source-henan-museum.json', 'text'],
  ].map(([path, kind], index) => ({
    path,
    kind,
    byteLength: 100 + index,
    sha256: `${index}`.repeat(64),
  })),
  reviewAttestation: {
    schemaVersion: 3,
    reviewMode: 'ai-agent-panel',
    panelType: 'five-agent',
    cycleId: 'cycle-02',
    targetCommit,
    reviewEvidenceCommit,
    publicationGate: 'agent-reviewed',
    disclosure: agentReviewDisclosure,
    reviewedPayload: {
      format: 'yu-reader-payload-v1',
      projection: 'reader-v1',
      transformer: 'reader-markdown-v1',
      digest: payloadDigest,
    },
    contentBinding: {
      algorithm: 'sha256',
      format: 'yu-reader-release-v1',
      digest: contentBindingDigest,
    },
  },
} as const;

export const projectedText = Array.from({ length: 221 }, (_, index) => `слово${index + 1}`).join(' ');

export const validCollectionSnapshot = {
  manifest: validManifest,
  entries: [{ data: validEntry, projectedText }],
  notes: [validNote],
  sources: [validSource],
  objects: [validObject],
  media: [validDocumentaryMedia, validAuthoredDiagramMedia, validGenerativeMedia],
};
