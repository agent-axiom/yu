import { withBase } from './urls';

export type Locale = 'ru' | 'en';

function withoutBase(path: string, base: string): string {
  const prefix = `/${base.replace(/^\/+|\/+$/g, '')}`;
  if (prefix !== '/' && (path === prefix || path.startsWith(`${prefix}/`))) return path.slice(prefix.length) || '/';
  return path.startsWith('/') ? path : `/${path}`;
}

export function localeFromPath(pathname: string, base = import.meta.env.BASE_URL): Locale {
  return /^\/en(?:\/|$)/.test(withoutBase(pathname, base)) ? 'en' : 'ru';
}

/** Preserve the current page, query and fragment while changing language. */
export function localizePath(path: string, locale: Locale, base = import.meta.env.BASE_URL): string {
  const match = path.match(/^([^?#]*)(.*)$/)!;
  let route = withoutBase(match[1] || '/', base).replace(/^\/en(?=\/|$)/, '') || '/';
  // Astro emits the root error route as 404.html, but its EN wrapper as a directory.
  if (/^\/404(?:\.html|\/)?$/.test(route)) route = locale === 'en' ? '/404/' : '/404.html';
  return withBase(`${locale === 'en' ? '/en' : ''}${route}`, base) + match[2];
}

export function translator(locale: Locale) {
  return (ru: string, en: string): string => locale === 'en' ? en : ru;
}
