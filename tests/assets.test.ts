import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const requiredAssets = [
  'hero-jade.webp',
  'jade-macro.webp',
  'mythic-jade.webp',
  'artifacts/liangzhu-bi.webp',
  'artifacts/maya-jade-ornament.webp',
];

describe('visual asset provenance', () => {
  const credits = readFileSync(join(process.cwd(), 'CREDITS.md'), 'utf8');

  for (const filename of requiredAssets) {
    it(`${filename} exists, is non-empty, and is credited`, () => {
      const path = join(process.cwd(), 'public/images', filename);
      expect(existsSync(path)).toBe(true);
      expect(existsSync(path) && statSync(path).size).toBeGreaterThan(1_000);
      expect(credits).toContain(filename);

      const creditBlock = credits.slice(credits.indexOf(filename), credits.indexOf(filename) + 700);
      expect(creditBlock).toMatch(/Public Domain|CC BY|генеративная иллюстрация/i);
    });
  }
});
