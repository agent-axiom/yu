import { afterEach, describe, expect, it } from 'vitest';
import { bindObjectExplorer } from '../src/lib/object-explorer';

function fixture() {
  document.body.innerHTML = `<div data-object-explorer>
    <div data-object-viewport><img data-object-image alt="Диск bi"></div>
    <div data-object-controls hidden>
      <input data-object-zoom type="range" min="1" max="2.5" step=".25" value="1">
      <output data-object-scale></output><button data-object-reset>Сбросить</button>
      <button data-object-detail data-x="40" data-y="30" aria-pressed="false">Поверхность</button>
      <button data-object-detail data-x="75" data-y="50" aria-pressed="false">Край</button>
    </div></div>`;
  const root = document.querySelector<HTMLElement>('[data-object-explorer]')!;
  const viewport = root.querySelector<HTMLElement>('[data-object-viewport]')!;
  Object.defineProperty(viewport, 'getBoundingClientRect', { value: () => ({ width: 600, height: 450 }) });
  return { root, viewport, zoom: root.querySelector<HTMLInputElement>('input')!, img: root.querySelector<HTMLImageElement>('img')! };
}

describe('object explorer', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('enhances a readable image with zoom controls and accessible value', () => {
    const { root, zoom } = fixture();
    expect(root.querySelector<HTMLElement>('[data-object-controls]')!.hidden).toBe(true);
    bindObjectExplorer(root);
    expect(root.querySelector<HTMLElement>('[data-object-controls]')!.hidden).toBe(false);
    expect(zoom.getAttribute('aria-valuetext')).toBe('Увеличение 1×');
    zoom.value = '2.5';
    zoom.dispatchEvent(new Event('input'));
    expect(root.dataset.zoomed).toBe('true');
    expect(zoom.getAttribute('aria-valuetext')).toBe('Увеличение 2,5×');
  });

  it('focuses a detail and resets scale, position and button state', () => {
    const { root, zoom, img } = fixture();
    bindObjectExplorer(root);
    const detail = root.querySelector<HTMLButtonElement>('[data-object-detail]')!;
    detail.click();
    expect(zoom.value).toBe('2.5');
    expect(detail.getAttribute('aria-pressed')).toBe('true');
    expect(img.style.transform).toBe('translate(25%, 50%) scale(2.5)');
    root.querySelector<HTMLButtonElement>('[data-object-reset]')!.click();
    expect(zoom.value).toBe('1');
    expect(img.style.transform).toBe('translate(0%, 0%) scale(1)');
    expect(detail.getAttribute('aria-pressed')).toBe('false');
  });

  it('bounds keyboard panning and allows Escape to reset', () => {
    const { root, viewport, zoom, img } = fixture();
    bindObjectExplorer(root);
    zoom.value = '2.5'; zoom.dispatchEvent(new Event('input'));
    for (let i = 0; i < 30; i++) viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }));
    expect(img.style.transform).toBe('translate(-75%, 0%) scale(2.5)');
    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(zoom.value).toBe('1');
  });

  it('does not intercept page scrolling when the full object is visible', () => {
    const { root, viewport } = fixture();
    bindObjectExplorer(root);
    const key = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
    viewport.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(false);
  });

  it('supports drag panning while zoomed and removes listeners on cleanup', () => {
    const { root, viewport, zoom, img } = fixture();
    const cleanup = bindObjectExplorer(root);
    zoom.value = '2'; zoom.dispatchEvent(new Event('input'));
    viewport.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 100, button: 0 }));
    viewport.dispatchEvent(new MouseEvent('pointermove', { clientX: 160, clientY: 100 }));
    expect(img.style.transform).toBe('translate(10%, 0%) scale(2)');
    viewport.dispatchEvent(new MouseEvent('pointerup'));
    cleanup();
    zoom.value = '1'; zoom.dispatchEvent(new Event('input'));
    expect(img.style.transform).toBe('translate(10%, 0%) scale(2)');
  });
});
