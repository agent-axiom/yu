import { afterEach, describe, expect, it } from 'vitest';
import { bindHeroPointer } from '../src/lib/hero';

describe('living jade hero', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('maps pointer position to light coordinates', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div class="hero__light"></div>';
    Object.defineProperty(root, 'getBoundingClientRect', {
      value: () => ({ left: 10, top: 20, width: 200, height: 100 }),
    });
    document.body.append(root);

    const cleanup = bindHeroPointer(root, false);
    root.dispatchEvent(new MouseEvent('pointermove', { clientX: 110, clientY: 45 }));

    expect(root.style.getPropertyValue('--pointer-x')).toBe('50%');
    expect(root.style.getPropertyValue('--pointer-y')).toBe('25%');
    cleanup();
  });

  it('does not bind motion when reduced motion is requested', () => {
    const root = document.createElement('div');
    Object.defineProperty(root, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    });

    bindHeroPointer(root, true);
    root.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 50 }));

    expect(root.style.getPropertyValue('--pointer-x')).toBe('');
  });
});
