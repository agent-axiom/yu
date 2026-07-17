import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

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

export const collections = { sources, eras, myths, materials, medicine };
