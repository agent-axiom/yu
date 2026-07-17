import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

describe('accessibility contracts', () => {
  it('uses alt attributes and native interactive controls', () => {
    const astroSources = filesBelow(join(process.cwd(), 'src'))
      .filter((file) => file.endsWith('.astro'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    const images = [...astroSources.matchAll(/<img\b[\s\S]*?>/g)].map((match) => match[0]);
    expect(images.length).toBeGreaterThan(0);
    expect(images.every((tag) => /\balt=(?:"[^"]*"|\{[^}]*\})/.test(tag))).toBe(true);
    expect(astroSources).not.toMatch(/<(?:div|span)\b[^>]*role="(?:button|tab)"/);
    expect(astroSources).toContain('<button');
    expect(astroSources).toContain('type="range"');
  });

  it('renders exactly one top-level heading per route', () => {
    for (const file of ['index.html', 'history/index.html', 'mythology/index.html', 'material/index.html', 'medicine/index.html', 'sources/index.html']) {
      const html = readFileSync(join(process.cwd(), 'dist', file), 'utf8');
      expect(html.match(/<h1\b/g), file).toHaveLength(1);
    }
  });

  it('provides focus, skip-link, and reduced-motion styles', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/global.css'), 'utf8');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('.skip-link:focus');
    expect(css).toContain('prefers-reduced-motion: reduce');
  });
});
