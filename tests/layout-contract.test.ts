import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function source(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

describe('document shell contract', () => {
  it('declares Russian, canonical metadata, and accessible landmarks', () => {
    const layout = source('src/layouts/BaseLayout.astro');

    expect(layout).toContain('<html lang="ru">');
    expect(layout).toMatch(/href=["{]#main-content/);
    expect(layout.match(/<main\b/g)).toHaveLength(1);
    expect(layout).toContain('rel="canonical"');
  });

  it('keeps navigation safe for a GitHub Pages base path', () => {
    const header = source('src/components/SiteHeader.astro');

    expect(header).toContain("import { withBase } from '../lib/urls'");
    expect(header).toContain('withBase(item.href)');
  });
});
