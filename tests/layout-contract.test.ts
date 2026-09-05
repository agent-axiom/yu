import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sections = ['', 'history/', 'mythology/', 'material/', 'medicine/', 'sources/', 'glossary/'];
const site = 'https://agent-axiom.github.io';

describe('localized production documents', () => {
  for (const locale of ['ru', 'en']) {
    for (const section of sections) {
      const route = `${locale === 'en' ? 'en/' : ''}${section}`;
      it(`${route || '/'} has working language, navigation and share metadata`, () => {
        const document = new DOMParser().parseFromString(readFileSync(join(process.cwd(), 'dist', route, 'index.html'), 'utf8'), 'text/html');
        expect(document.documentElement.lang).toBe(locale);
        expect(document.querySelectorAll('main')).toHaveLength(1);
        expect(document.querySelectorAll('h1')).toHaveLength(1);
        expect(document.querySelector('.skip-link')?.getAttribute('href')).toBe('#main-content');
        expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`${site}/yu/${route}`);
        for (const language of ['ru', 'en']) {
          const destination = `/yu/${language === 'en' ? 'en/' : ''}${section}`;
          expect(document.querySelector(`link[hreflang="${language}"]`)?.getAttribute('href')).toBe(`${site}${destination}`);
          expect(document.querySelector(`a[data-language-link][lang="${language}"]`)?.getAttribute('href')).toBe(destination);
        }
        const links = [...document.querySelectorAll('#primary-navigation a, .site-footer a, .brand')];
        expect(links.length).toBeGreaterThan(7);
        for (const link of links) {
          expect(link.getAttribute('href')).toMatch(locale === 'en' ? /^\/yu\/en\// : /^\/yu\/(?!en\/)/);
        }
        const social = document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
        expect(social).toBe(`${site}/yu/social/${locale}/${section.replace('/', '') || 'home'}.jpg`);
        expect(existsSync(join(process.cwd(), 'public', new URL(social).pathname.replace('/yu/', '')))).toBe(true);
        expect(document.querySelector('meta[property="og:locale"]')?.getAttribute('content')).toBe(locale === 'en' ? 'en_US' : 'ru_RU');
        expect(document.querySelectorAll('link[rel="preload"][as="font"]')).toHaveLength(2);
      });
    }
  }

  it('publishes a bilingual sitemap without indexing 404 pages', () => {
    const xml = readFileSync(join(process.cwd(), 'dist/sitemap.xml'), 'utf8');
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    expect(document.querySelectorAll('parsererror')).toHaveLength(0);
    expect(document.querySelectorAll('url')).toHaveLength(14);
    expect(document.querySelectorAll('loc')).toHaveLength(14);
    expect(xml).not.toContain('404');
    expect(xml).toContain('hreflang="en"');
  });
});
