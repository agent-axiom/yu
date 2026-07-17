import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const outputs = [
  'index.html',
  'history/index.html',
  'mythology/index.html',
  'material/index.html',
  'medicine/index.html',
  'sources/index.html',
  '404.html',
];

describe('static route output', () => {
  for (const output of outputs) {
    it(`builds ${output}`, () => {
      expect(existsSync(join(process.cwd(), 'dist', output))).toBe(true);
    });
  }

  it('prefixes all internal anchor links with the Pages base', () => {
    for (const output of outputs.filter((file) => existsSync(join(process.cwd(), 'dist', file)))) {
      const html = readFileSync(join(process.cwd(), 'dist', output), 'utf8');
      const hrefs = [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((match) => match[1]);
      const invalid = hrefs.filter((href) => !/^(?:\/yu\/|#|mailto:|https?:\/\/)/.test(href));
      expect(invalid, `${output}: ${invalid.join(', ')}`).toEqual([]);
    }
  });
});
