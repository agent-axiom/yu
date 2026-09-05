import { afterEach, describe, expect, it } from 'vitest';
import { enhanceLegendHistory } from '../src/lib/legend-history';

function dossier() {
  const root = document.createElement('section');
  root.innerHTML = `
    <div data-witness-controls hidden aria-label="Текстовые свидетельства">
      <button id="han-tab" data-witness-tab aria-controls="han-panel">III век до н. э.</button>
      <button id="shi-tab" data-witness-tab aria-controls="shi-panel">Рубеж II–I веков до н. э.</button>
      <button id="now-tab" data-witness-tab aria-controls="now-panel">2015 год</button>
    </div>
    <article id="han-panel" data-witness-panel aria-labelledby="han-title"><h3 id="han-title">Нераспознанная ценность</h3><p>Сюжет: царство Чу. Текст: Хань Фэй-цзы.</p></article>
    <article id="shi-panel" data-witness-panel aria-labelledby="shi-title"><h3 id="shi-title">Дипломатический залог</h3><p>Сюжет: Чжао и Цинь. Текст: Ши цзи.</p></article>
    <article id="now-panel" data-witness-panel aria-labelledby="now-title"><h3 id="now-title">Память о честности</h3><p>Сюжет: древнее Чу. Текст: пересказ 2015 года.</p></article>`;
  document.body.append(root);
  return {
    root,
    tabs: [...root.querySelectorAll<HTMLButtonElement>('[data-witness-tab]')],
    panels: [...root.querySelectorAll<HTMLElement>('[data-witness-panel]')],
    controls: root.querySelector<HTMLElement>('[data-witness-controls]')!,
  };
}

describe('legend history dossier', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('keeps every witness readable and inactive controls hidden before enhancement', () => {
    const { controls, panels } = dossier();
    expect(controls.hidden).toBe(true);
    expect(panels.every((panel) => !panel.hidden)).toBe(true);
    expect(panels.map((panel) => panel.textContent).join(' ')).toContain('пересказ 2015 года');
  });

  it('reveals a tablist and selects the first dated witness with correct associations', () => {
    const { root, tabs, panels, controls } = dossier();
    enhanceLegendHistory(root);
    expect(controls.hidden).toBe(false);
    expect(controls.getAttribute('role')).toBe('tablist');
    expect(root.hasAttribute('data-enhanced')).toBe(true);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    expect(panels.map((panel) => panel.hidden)).toEqual([false, true, true]);
    expect(panels[0].getAttribute('aria-labelledby')).toBe(tabs[0].id);
    expect(panels[0].getAttribute('role')).toBe('tabpanel');
  });

  it('switches the visible source and selected control on click', () => {
    const { root, tabs, panels } = dossier();
    enhanceLegendHistory(root);
    tabs[2].click();
    expect(panels.map((panel) => panel.hidden)).toEqual([true, true, false]);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true']);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, -1, 0]);
  });

  it('moves selection and focus with arrows, wrapping at both ends', () => {
    const { root, tabs, panels } = dossier();
    enhanceLegendHistory(root);
    tabs[0].focus();
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(document.activeElement).toBe(tabs[2]);
    expect(panels[2].hidden).toBe(false);
    tabs[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(tabs[0]);
    expect(panels[0].hidden).toBe(false);
  });

  it('supports Home and End while leaving unrelated keys alone', () => {
    const { root, tabs } = dossier();
    enhanceLegendHistory(root);
    tabs[0].focus();
    const end = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true });
    tabs[0].dispatchEvent(end);
    expect(end.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(tabs[2]);
    tabs[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(tabs[0]);
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    tabs[0].dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('restores readable articles and removes listeners on cleanup', () => {
    const { root, tabs, panels, controls } = dossier();
    const cleanup = enhanceLegendHistory(root);
    tabs[1].click();
    cleanup();
    expect(controls.hidden).toBe(true);
    expect(controls.hasAttribute('role')).toBe(false);
    expect(root.hasAttribute('data-enhanced')).toBe(false);
    expect(panels.every((panel) => !panel.hidden && !panel.hasAttribute('role'))).toBe(true);
    expect(panels[0].getAttribute('aria-labelledby')).toBe('han-title');
    tabs[2].click();
    expect(panels.every((panel) => !panel.hidden)).toBe(true);
  });

  it('does not hide reading content when a tab points to a missing witness', () => {
    const { root, tabs, controls, panels } = dossier();
    tabs[1].setAttribute('aria-controls', 'missing-panel');
    const cleanup = enhanceLegendHistory(root);
    expect(controls.hidden).toBe(true);
    expect(panels.every((panel) => !panel.hidden)).toBe(true);
    expect(root.hasAttribute('data-enhanced')).toBe(false);
    expect(() => cleanup()).not.toThrow();
  });
});
