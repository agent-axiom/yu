import type { Locale } from './i18n';

export type MythLayer = 'legend' | 'context' | 'confirmed';

const mythLabels: Record<Locale, Record<MythLayer, string>> = {
  ru: { legend: 'Легенда', context: 'Культурный контекст', confirmed: 'Что подтверждено' },
  en: { legend: 'Legend', context: 'Cultural context', confirmed: 'What is supported' },
};

export function mythLayerLabel(layer: MythLayer, locale: Locale = 'ru'): string {
  return mythLabels[locale][layer];
}

export function clampLens(value: number): number {
  return Math.min(100, Math.max(0, value));
}
