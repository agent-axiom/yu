import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BASELINE_SMOKE_CONTRACT = 'yu-site-baseline-v1';
export const BASELINE_REQUEST_TIMEOUT_MS = 10_000;

export const BASELINE_ROUTES = Object.freeze([
  { path: '/yu/', marker: '<title>Живой нефрит · YU</title>' },
  { path: '/yu/history/', marker: '<title>История нефрита · YU</title>' },
  { path: '/yu/mythology/', marker: '<title>Мифология нефрита · YU</title>' },
  { path: '/yu/material/', marker: '<title>Нефрит и жадеит · YU</title>' },
  { path: '/yu/medicine/', marker: '<title>Нефрит и медицина · YU</title>' },
  { path: '/yu/sources/', marker: '<title>Источники и методология · YU</title>' },
].map(Object.freeze));

const SOFT_404_MARKERS = Object.freeze([
  'Этот след обрывается',
  '<title>Страница не найдена · YU</title>',
]);

function normalizeOrigin(origin) {
  const parsed = new URL(origin);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported site origin protocol: ${parsed.protocol}`);
  }
  return parsed.origin;
}

export async function smokeSiteBaseline({
  origin = 'https://agent-axiom.github.io',
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');

  const normalizedOrigin = normalizeOrigin(origin);
  const routes = [];

  for (const route of BASELINE_ROUTES) {
    const url = new URL(route.path, `${normalizedOrigin}/`);
    const signal = AbortSignal.timeout(BASELINE_REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetchImpl(url, { signal });
    } catch (error) {
      if (signal.aborted) {
        throw new Error(
          `${route.path}: request timed out after ${BASELINE_REQUEST_TIMEOUT_MS}ms`,
          { cause: error },
        );
      }
      throw error;
    }
    if (!response.ok || response.status < 200 || response.status >= 300) {
      throw new Error(`${route.path}: expected a 2xx response, received ${response.status}`);
    }

    let body;
    try {
      body = await response.text();
    } catch (error) {
      if (signal.aborted) {
        throw new Error(
          `${route.path}: request timed out after ${BASELINE_REQUEST_TIMEOUT_MS}ms`,
          { cause: error },
        );
      }
      throw error;
    }
    const soft404 = SOFT_404_MARKERS.find((marker) => body.includes(marker));
    if (soft404) throw new Error(`${route.path}: response contains soft-404 marker "${soft404}"`);
    if (!body.includes(route.marker)) {
      throw new Error(`${route.path}: response is missing its stable marker`);
    }

    routes.push({ path: route.path, status: response.status, marker: route.marker });
  }

  return {
    contract: BASELINE_SMOKE_CONTRACT,
    origin: normalizedOrigin,
    routes,
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  smokeSiteBaseline({ origin: process.argv[2] })
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
