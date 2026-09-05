import { describe, expect, it } from 'vitest';
import { localeFromPath, localizePath, translator } from '../src/lib/i18n';

describe('static language routes', () => {
  it('recognizes the language only at the route prefix', () => {
    expect(localeFromPath('/yu/en/history/', '/yu/')).toBe('en');
    expect(localeFromPath('/yu/english/', '/yu/')).toBe('ru');
    expect(localeFromPath('/yu/history/en/', '/yu/')).toBe('ru');
    expect(localeFromPath('/en/', '/')).toBe('en');
  });
  it('changes locale exactly once while retaining query and fragment', () => {
    expect(localizePath('/yu/history/?view=detail#object-biography', 'en', '/yu/')).toBe('/yu/en/history/?view=detail#object-biography');
    expect(localizePath('/yu/en/history/#object-biography', 'ru', '/yu/')).toBe('/yu/history/#object-biography');
    expect(localizePath('/yu/en/material/', 'en', '/yu/')).toBe('/yu/en/material/');
    expect(localizePath('/', 'en', '/yu/')).toBe('/yu/en/');
    expect(localizePath('/en/', 'ru', '/yu/')).toBe('/yu/');
    expect(localizePath('/history/', 'en', '/')).toBe('/en/history/');
    expect(localizePath('/yu/404.html', 'en', '/yu/')).toBe('/yu/en/404/');
    expect(localizePath('/yu/en/404/', 'ru', '/yu/')).toBe('/yu/404.html');
  });
  it('renders the chosen language without browser-side text replacement', () => {
    expect(translator('en')('Нефрит', 'Nephrite')).toBe('Nephrite');
    expect(translator('ru')('Нефрит', 'Nephrite')).toBe('Нефрит');
  });
});
