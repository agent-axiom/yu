import { describe, expect, it } from 'vitest';
import { clampLens, mythLayerLabel } from '../src/lib/explorers';

describe('content explorers', () => {
  it('uses clear labels for myth evidence layers', () => {
    expect(mythLayerLabel('legend')).toBe('Легенда');
    expect(mythLayerLabel('context')).toBe('Культурный контекст');
    expect(mythLayerLabel('confirmed')).toBe('Что подтверждено');
  });

  it('clamps material lens values', () => {
    expect(clampLens(-5)).toBe(0);
    expect(clampLens(45)).toBe(45);
    expect(clampLens(120)).toBe(100);
  });

  it('labels every English myth layer without changing the Russian default', () => {
    expect(mythLayerLabel('legend', 'en')).toBe('Legend');
    expect(mythLayerLabel('context', 'en')).toBe('Cultural context');
    expect(mythLayerLabel('confirmed', 'en')).toBe('What is supported');
    expect(mythLayerLabel('legend', 'ru')).toBe('Легенда');
  });
});
