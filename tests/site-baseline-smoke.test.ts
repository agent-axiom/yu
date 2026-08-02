import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

type FakeResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

const routeBodies = new Map([
  ['/yu/', '<title>Живой нефрит · YU</title>'],
  ['/yu/history/', '<title>История нефрита · YU</title>'],
  ['/yu/mythology/', '<title>Мифология нефрита · YU</title>'],
  ['/yu/material/', '<title>Нефрит и жадеит · YU</title>'],
  ['/yu/medicine/', '<title>Нефрит и медицина · YU</title>'],
  ['/yu/sources/', '<title>Источники и методология · YU</title>'],
]);

function response(status: number, body: string): FakeResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

async function loadSmokeModule() {
  const smokeUrl = pathToFileURL(join(process.cwd(), 'scripts/smoke-site-baseline.mjs')).href;
  return import(/* @vite-ignore */ smokeUrl) as Promise<{
    BASELINE_SMOKE_CONTRACT: string;
    BASELINE_ROUTES: ReadonlyArray<{ path: string; marker: string }>;
    smokeSiteBaseline: (options: {
      origin: string;
      fetchImpl: (url: URL) => Promise<FakeResponse>;
    }) => Promise<unknown>;
  }>;
}

describe('version-pinned site baseline smoke', () => {
  it('pins the existing non-book routes and returns stable JSON', async () => {
    const { BASELINE_ROUTES, BASELINE_SMOKE_CONTRACT, smokeSiteBaseline } = await loadSmokeModule();
    const requested: string[] = [];

    const result = await smokeSiteBaseline({
      origin: 'https://agent-axiom.github.io',
      fetchImpl: async (url) => {
        requested.push(url.pathname);
        const body = routeBodies.get(url.pathname);
        if (!body) return response(404, 'нет страницы');
        return response(200, body);
      },
    });

    expect(BASELINE_SMOKE_CONTRACT).toBe('yu-site-baseline-v1');
    expect(BASELINE_ROUTES).toEqual(
      [...routeBodies].map(([path, marker]) => ({ path, marker })),
    );
    expect(requested).toEqual([...routeBodies.keys()]);
    expect(result).toEqual({
      contract: 'yu-site-baseline-v1',
      origin: 'https://agent-axiom.github.io',
      routes: [...routeBodies].map(([path, marker]) => ({ path, status: 200, marker })),
    });
  });

  it('rejects non-2xx responses', async () => {
    const { smokeSiteBaseline } = await loadSmokeModule();
    await expect(
      smokeSiteBaseline({
        origin: 'https://agent-axiom.github.io',
        fetchImpl: async () => response(503, 'временно недоступно'),
      }),
    ).rejects.toThrow('expected a 2xx response');
  });

  it('rejects a soft-404 even when its response is 2xx', async () => {
    const { smokeSiteBaseline } = await loadSmokeModule();
    await expect(
      smokeSiteBaseline({
        origin: 'https://agent-axiom.github.io',
        fetchImpl: async () => response(200, '<h1>Этот след обрывается</h1>'),
      }),
    ).rejects.toThrow('soft-404 marker');
  });

  it('rejects a page that lost its stable route marker', async () => {
    const { smokeSiteBaseline } = await loadSmokeModule();
    await expect(
      smokeSiteBaseline({
        origin: 'https://agent-axiom.github.io',
        fetchImpl: async () => response(200, '<main>страница без маркера</main>'),
      }),
    ).rejects.toThrow('stable marker');
  });

  it('has no dependency on a future book release', () => {
    const smokePath = join(process.cwd(), 'scripts/smoke-site-baseline.mjs');
    expect(() => readFileSync(smokePath, 'utf8')).not.toThrow();
    if (!existsSync(smokePath)) return;
    const source = readFileSync(smokePath, 'utf8');
    expect(source).not.toContain('/book');
    expect(source).not.toContain('manifest.json');
  });
});
