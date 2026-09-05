import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bindMaterialLens } from '../src/lib/material-lens';

function fixture(value = '50') {
  const root = document.createElement('material-lens');
  root.innerHTML = `
    <div data-lens-controls hidden>
      <label for="test-lens">Доля схемы нефрита</label>
      <input id="test-lens" type="range" min="0" max="100" step="1" value="${value}" />
      <output data-lens-value for="test-lens"></output>
    </div>`;
  document.body.append(root);
  return {
    root,
    input: root.querySelector('input')!,
    controls: root.querySelector<HTMLElement>('[data-lens-controls]')!,
    output: root.querySelector('output')!,
  };
}

describe('material lens', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('initializes the reveal from the native range and then exposes its control', () => {
    const { root, input, controls, output } = fixture('35');
    bindMaterialLens(root);

    expect(root.style.getPropertyValue('--lens')).toBe('35%');
    expect(input.getAttribute('aria-valuetext')).toBe('Область схемы: нефрит 35%, жадеит 65%');
    expect(output.textContent).toBe('Нефрит 35% · Жадеит 65%');
    expect(controls.hidden).toBe(false);
    expect(root.hasAttribute('data-enhanced')).toBe(true);
  });

  it('synchronizes CSS, the visible readout and accessible value on native input events', () => {
    const { root, input, output } = fixture();
    bindMaterialLens(root);
    input.value = '72';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(root.style.getPropertyValue('--lens')).toBe('72%');
    expect(input.getAttribute('aria-valuetext')).toBe('Область схемы: нефрит 72%, жадеит 28%');
    expect(output.textContent).toBe('Нефрит 72% · Жадеит 28%');
    // Keyboard and touch use the native range; no custom key handling is needed.
    expect(input.type).toBe('range');
    expect(input.step).toBe('1');
  });

  it('keeps English readouts and accessible values localized through interaction', () => {
    const { root, input, output } = fixture('35');
    root.dataset.locale = 'en';
    bindMaterialLens(root);
    expect(input.getAttribute('aria-valuetext')).toBe('Diagram area: nephrite 35%, jadeite 65%');
    expect(output.textContent).toBe('Nephrite 35% · Jadeite 65%');
    input.value = '100';
    input.dispatchEvent(new Event('input'));
    expect(root.style.getPropertyValue('--lens')).toBe('100%');
    expect(input.getAttribute('aria-valuetext')).toBe('Diagram area: nephrite 100%, jadeite 0%');
    expect(output.textContent).toBe('Nephrite 100% · Jadeite 0%');
  });

  it.each([['0', '100'], ['100', '0']])('supports the %s%% endpoint', (value, other) => {
    const { root, input } = fixture();
    bindMaterialLens(root);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    expect(root.style.getPropertyValue('--lens')).toBe(`${value}%`);
    expect(input.getAttribute('aria-valuetext')).toBe(`Область схемы: нефрит ${value}%, жадеит ${other}%`);
  });

  it.each([[-30, '0%'], [140, '100%']])('bounds unexpected input %s to a valid reveal', (value, expected) => {
    const { root, input } = fixture();
    input.min = '-100';
    input.max = '200';
    bindMaterialLens(root);
    input.value = String(value);
    input.dispatchEvent(new Event('input'));
    expect(root.style.getPropertyValue('--lens')).toBe(expected);
    expect(input.value).toBe(expected.slice(0, -1));
  });

  it('leaves incomplete static markup unenhanced', () => {
    const root = document.createElement('material-lens');
    root.innerHTML = '<div data-lens-controls hidden></div><p>Описание структуры</p>';
    expect(() => bindMaterialLens(root)).not.toThrow();
    expect(root.hasAttribute('data-enhanced')).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-lens-controls]')!.hidden).toBe(true);
    expect(root.textContent).toContain('Описание структуры');
  });

  it('cleans up listeners and hides the inactive control when disconnected', () => {
    const { root, input, controls } = fixture();
    const cleanup = bindMaterialLens(root);
    cleanup();
    input.value = '80';
    input.dispatchEvent(new Event('input'));
    expect(root.style.getPropertyValue('--lens')).toBe('50%');
    expect(controls.hidden).toBe(true);
    expect(root.hasAttribute('data-enhanced')).toBe(false);
  });

  it('ships two distinct diagrams, persistent scientific limits and a useful no-JS view', () => {
    const component = readFileSync(join(process.cwd(), 'src/components/MaterialLens.astro'), 'utf8');
    expect(component).toContain('data-structure="fibres"');
    expect(component).toContain('data-structure="grains"');
    expect(component).toContain('Объяснительные схемы');
    expect(component).toContain('не микрофотографии');
    expect(component).toContain('не диагностика');
    expect(component).toContain('data-lens-controls hidden');
    expect(component).not.toContain('jade-macro.webp');
    expect(component).toContain('<table>');
  });
});
