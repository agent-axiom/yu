import type { APIRoute } from 'astro';
import { localizePath } from '../lib/i18n';

export const GET: APIRoute = ({ site }) => {
  const routes = ['/', '/history/', '/mythology/', '/material/', '/medicine/', '/sources/', '/glossary/'];
  const absolute = (route: string, locale: 'ru' | 'en') => new URL(localizePath(route, locale), site).href;
  const urls = routes.flatMap((route) => (['ru', 'en'] as const).map((locale) =>
    `<url><loc>${absolute(route, locale)}</loc>${(['ru', 'en'] as const).map((language) => `<xhtml:link rel="alternate" hreflang="${language}" href="${absolute(route, language)}"/>`).join('')}<xhtml:link rel="alternate" hreflang="x-default" href="${absolute(route, 'ru')}"/></url>`,
  ));
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join('')}</urlset>`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
