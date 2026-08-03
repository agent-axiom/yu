import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import {
  readerEntrySchema,
  readerMediaSchema,
  readerNoteSchema,
  readerObjectSchema,
  readerReleaseManifestSchema,
  readerSourceSchema,
} from './lib/book-release/schemas';

const citations = z.array(z.string()).min(1);

const sources = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/sources' }),
  schema: z.object({
    title: z.string(),
    authors: z.array(z.string()).min(1),
    year: z.number(),
    publisher: z.string(),
    url: z.string().url(),
    region: z.enum(['asia', 'west', 'global']),
    kind: z.enum(['paper', 'museum', 'book', 'institution']),
    license: z.string().optional(),
    accessed: z.string(),
  }),
});

const eras = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/eras' }),
  schema: z.object({
    title: z.string(),
    date: z.string(),
    order: z.number(),
    summary: z.string(),
    detail: z.string(),
    place: z.string(),
    image: z.string().optional(),
    imageAlt: z.string().optional(),
    citations,
  }),
});

const myths = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/myths' }),
  schema: z.object({
    title: z.string(),
    culture: z.string(),
    legend: z.string(),
    context: z.string(),
    confirmed: z.string(),
    citations,
  }),
});

const materials = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/materials' }),
  schema: z.object({
    name: z.string(),
    family: z.string(),
    chemistry: z.string(),
    hardness: z.string(),
    structure: z.string(),
    toughness: z.string(),
    note: z.string(),
    citations,
  }),
});

const medicine = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/medicine' }),
  schema: z.object({
    title: z.string(),
    tradition: z.string(),
    assessment: z.string(),
    evidence: z.enum(['traditional', 'laboratory', 'clinical', 'none']),
    safety: z.string(),
    citations,
  }),
});

const bookManifest = defineCollection({
  loader: glob({ pattern: 'manifest.json', base: './src/content/book-release' }),
  schema: readerReleaseManifestSchema,
});

const bookEntries = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/book-release/entries' }),
  schema: readerEntrySchema,
});

const bookNotes = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/content/book-release/notes' }),
  schema: readerNoteSchema,
});

const bookSources = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/content/book-release/sources' }),
  schema: readerSourceSchema,
});

const bookObjects = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/content/book-release/objects' }),
  schema: readerObjectSchema,
});

const bookMedia = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/content/book-release/media' }),
  schema: readerMediaSchema,
});

export const collections = {
  sources,
  eras,
  myths,
  materials,
  medicine,
  bookManifest,
  bookEntries,
  bookNotes,
  bookSources,
  bookObjects,
  bookMedia,
};
