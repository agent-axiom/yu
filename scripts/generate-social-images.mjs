import { chromium } from '@playwright/test';
import { parse } from 'parse5';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Run after a build; commit the rendered cards so deployment does not need a browser.
const root = resolve(import.meta.dirname, '..');
const sections = ['home', 'history', 'mythology', 'material', 'medicine', 'sources', 'glossary'];
const escape = (text) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const data = async (path, mime) => `data:${mime};base64,${(await readFile(resolve(root, path))).toString('base64')}`;
const [manrope, prata, artwork] = await Promise.all([
  data('public/fonts/manrope-variable.ttf', 'font/ttf'),
  data('public/fonts/prata-regular.ttf', 'font/ttf'),
  data('public/images/hero-jade.webp', 'image/webp'),
]);
function metadata(html) {
  const result = {};
  const visit = (node) => {
    if (node.tagName === 'meta') {
      const attrs = Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
      if (attrs.property === 'og:title') result.title = attrs.content;
      if (attrs.name === 'description') result.description = attrs.content;
    }
    node.childNodes?.forEach(visit);
  };
  visit(parse(html));
  if (!result.title || !result.description) throw new Error('Build output is missing page metadata');
  return result;
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  for (const locale of ['ru', 'en']) {
    await mkdir(resolve(root, 'public/social', locale), { recursive: true });
    for (const [index, section] of sections.entries()) {
      const route = `${locale === 'en' ? 'en/' : ''}${section === 'home' ? '' : `${section}/`}`;
      const { title, description } = metadata(await readFile(resolve(root, 'dist', route, 'index.html'), 'utf8'));
      await page.setContent(`<!doctype html><html lang="${locale}"><head><meta charset="UTF-8"><style>
        @font-face{font-family:Manrope;src:url('${manrope}');font-weight:200 800}
        @font-face{font-family:Prata;src:url('${prata}')}
        *{box-sizing:border-box}body{margin:0;background:#07110f;color:#eee8d9;font-family:Manrope,sans-serif}
        .card{position:relative;width:1200px;height:630px;overflow:hidden;padding:54px 62px}
        .art{position:absolute;inset:0 0 0 460px;background:linear-gradient(90deg,#07110f 0%,transparent 80%),url('${artwork}') 57% center/cover;opacity:.8}
        .veil{position:absolute;inset:0;background:linear-gradient(0deg,#07110f,transparent 38%)}
        header,main,footer{position:relative}header{display:flex;justify-content:space-between;align-items:center;color:#8fcba5;font-size:18px;letter-spacing:.15em;text-transform:uppercase}
        .brand{font-size:32px;font-weight:800;letter-spacing:.23em}main{margin-top:74px;max-width:850px}
        h1{font:400 ${title.length > 30 ? 58 : 70}px/1.12 Prata,serif;letter-spacing:-.035em;margin:0 0 25px;text-wrap:balance}
        p{font-size:21px;line-height:1.6;max-width:760px;margin:0;color:#c1d1c5}
        footer{position:absolute;bottom:42px;left:62px;right:62px;display:flex;justify-content:space-between;border-top:1px solid #365348;padding-top:19px;font-size:14px;color:#a8c4b2;letter-spacing:.05em}
      </style></head><body><article class="card"><div class="art"></div><div class="veil"></div>
        <header><span class="brand">YU</span><span>${locale === 'ru' ? 'КАМЕНЬ · КУЛЬТУРА · ДОКАЗАТЕЛЬСТВА' : 'STONE · CULTURE · EVIDENCE'}</span></header>
        <main><h1>${escape(title)}</h1><p>${escape(description)}</p></main>
        <footer><span>${String(index + 1).padStart(2, '0')} / ${locale.toUpperCase()} — agent-axiom.github.io/yu</span><span>${locale === 'ru' ? 'Атмосферная иллюстрация · YU' : 'Atmospheric illustration · YU'}</span></footer>
      </article></body></html>`);
      await page.evaluate(() => document.fonts.ready);
      const fits = await page.locator('main').evaluate((main) => main.getBoundingClientRect().bottom < 535);
      if (!fits) throw new Error(`Social card text exceeds its safe area: ${locale}/${section}`);
      await page.screenshot({ path: resolve(root, 'public/social', locale, `${section}.jpg`), type: 'jpeg', quality: 88 });
      console.log(`Rendered ${locale}/${section}.jpg`);
    }
  }
} finally {
  await browser.close();
}
