import { afterEach, describe, expect, it, vi } from 'vitest';
import { glossaryEntries } from '../src/i18n/glossary';
import { bindGlossary } from '../src/lib/glossary';

function fixture() {
  document.body.innerHTML = `<main>
    <a data-term="jade" href="/en/glossary/#jade">jade</a>
    <a data-term="yu" href="/en/glossary/#yu"><em>yù</em></a>
    <a data-term="unknown" href="/en/glossary/#unknown">unknown</a>
    <dialog data-glossary-dialog aria-labelledby="glossary-label">
      <p id="glossary-label">Living glossary</p>
      <button type="button" data-glossary-close>Close glossary</button>
      <article data-glossary-entry="jade" aria-labelledby="dialog-jade-title" hidden><h2 id="dialog-jade-title">Jade</h2><p>A material name.</p><a href="/en/glossary/#jade">Full glossary</a></article>
      <article data-glossary-entry="yu" aria-labelledby="dialog-yu-title" hidden><h2 id="dialog-yu-title">Yù</h2><p>A Chinese word, not an exact mineral synonym.</p><a href="/en/glossary/#yu">Full glossary</a></article>
    </dialog></main>`;
  const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
  // jsdom has no top-layer rendering. Only the two native dialog methods are shimmed.
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new Event('close')); };
  dialog.getBoundingClientRect = () => ({ left: 100, right: 600, top: 100, bottom: 500 } as DOMRect);
  const links = [...document.querySelectorAll<HTMLAnchorElement>('a[data-term]')];
  const close = dialog.querySelector<HTMLButtonElement>('[data-glossary-close]')!;
  const entries = [...dialog.querySelectorAll<HTMLElement>('[data-glossary-entry]')];
  return { dialog, links, close, entries };
}

function click(target: Element, init: MouseEventInit = {}) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  // Prevent jsdom navigation after recording the controller's own decision.
  let intercepted = false;
  const record = (observed: Event) => {
    intercepted = observed.defaultPrevented;
    observed.preventDefault();
  };
  document.addEventListener('click', record, { once: true });
  target.dispatchEvent(event);
  return intercepted;
}

const cleanups: Array<() => void> = [];
function bind(dialog: HTMLDialogElement) { cleanups.push(bindGlossary(dialog)); }

describe('living glossary', () => {
  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps real, localized anchor navigation without JavaScript', () => {
    const { links, dialog } = fixture();
    expect(links[1].getAttribute('href')).toBe('/en/glossary/#yu');
    expect(links[1].getAttribute('role')).toBeNull();
    expect(dialog.open).toBe(false);
    expect(click(links[1])).toBe(false);
  });

  it('opens exactly the requested entry from nested link content and labels the dialog with it', () => {
    const { dialog, links, close, entries } = fixture();
    bind(dialog);
    expect(click(links[1].querySelector('em')!)).toBe(true);
    expect(dialog.open).toBe(true);
    expect(entries.map((entry) => entry.hidden)).toEqual([true, false]);
    expect(dialog.getAttribute('aria-labelledby')).toBe('dialog-yu-title');
    expect(document.activeElement).toBe(close);
    expect(links[1].getAttribute('href')).toBe('/en/glossary/#yu');
  });

  it('closes with the labelled button and restores focus to the initiating term', () => {
    const { dialog, links, close } = fixture();
    bind(dialog);
    links[0].focus();
    click(links[0]);
    close.click();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(links[0]);
    click(links[1]);
    close.click();
    expect(document.activeElement).toBe(links[1]);
  });

  it('handles native Escape cancellation and returns focus', () => {
    const { dialog, links } = fixture();
    bind(dialog);
    click(links[1]);
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(links[1]);
  });

  it('starts each newly opened entry at the top, not at the previous scroll position', () => {
    const { dialog, links, close } = fixture();
    bind(dialog);
    click(links[0]);
    dialog.scrollTop = 240;
    close.click();
    click(links[1]);
    expect(dialog.scrollTop).toBe(0);
  });

  it('closes on the backdrop but not on empty space inside the dialog', () => {
    const { dialog, links } = fixture();
    bind(dialog);
    click(links[0]);
    click(dialog, { clientX: 200, clientY: 200 });
    expect(dialog.open).toBe(true);
    click(dialog, { clientX: 20, clientY: 20 });
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(links[0]);
  });

  it('preserves unknown terms, modified clicks, new tabs and explicit downloads', () => {
    const { dialog, links } = fixture();
    bind(dialog);
    expect(click(links[2])).toBe(false);
    for (const key of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
      expect(click(links[0], { [key]: true })).toBe(false);
    }
    links[0].target = '_blank';
    expect(click(links[0])).toBe(false);
    links[0].removeAttribute('target');
    links[0].download = 'definition';
    expect(click(links[0])).toBe(false);
    expect(dialog.open).toBe(false);
  });

  it('does not enhance navigation when native dialog support is missing', () => {
    const { dialog, links } = fixture();
    Object.defineProperty(dialog, 'showModal', { value: undefined });
    bind(dialog);
    expect(click(links[0])).toBe(false);
    expect(dialog.open).toBe(false);
  });

  it('does not swallow the anchor if opening the native dialog fails', () => {
    const { dialog, links } = fixture();
    dialog.showModal = () => { throw new DOMException('Cannot enter top layer'); };
    bind(dialog);
    expect(click(links[0])).toBe(false);
    expect(dialog.open).toBe(false);
  });

  it('keeps links unenhanced if an entry cannot label the dialog accessibly', () => {
    const { dialog, links, entries } = fixture();
    entries[1].removeAttribute('aria-labelledby');
    bind(dialog);
    expect(click(links[0])).toBe(false);
  });

  it('restores ordinary links after cleanup and tolerates a removed opener', () => {
    const { dialog, links } = fixture();
    const cleanup = bindGlossary(dialog);
    click(links[0]);
    links[0].remove();
    expect(() => cleanup()).not.toThrow();
    expect(dialog.open).toBe(false);
    expect(click(links[1])).toBe(false);
  });

  it('contains six unique, sourced bilingual entries with pronunciation and related routes', () => {
    expect(glossaryEntries.map((entry) => entry.id)).toEqual(['jade', 'nephrite', 'jadeite', 'yu', 'bi', 'pounamu']);
    for (const entry of glossaryEntries) {
      expect(entry.original).toBeTruthy();
      expect(entry.language).toMatch(/^(en|zh|mi)$/);
      expect(entry.related.path).toMatch(/^\/(material|history|mythology)\//);
      expect(entry.sources.length).toBeGreaterThan(0);
      expect(entry.pronunciation.source.url).toMatch(/^https:\/\//);
      for (const locale of ['ru', 'en'] as const) {
        expect(entry.title[locale]).toBeTruthy();
        expect(entry.summary[locale].length).toBeGreaterThan(40);
        expect(entry.context[locale].length).toBeGreaterThan(40);
        expect(entry.pronunciation.text[locale]).toBeTruthy();
        expect(entry.related.label[locale]).toBeTruthy();
        expect(entry.sources.every((source) => source.label[locale] && source.url.startsWith('https://'))).toBe(true);
      }
    }
  });
});
