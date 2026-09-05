import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const playwrightConfigPath = join(root, 'playwright.config.ts');

describe('public book browser harness', () => {
  it('pins the supported Node runtime and focused test scripts', () => {
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      engines?: { node?: string };
      scripts?: Record<string, string>;
    };

    expect(existsSync(join(root, '.nvmrc'))).toBe(true);
    expect(readFileSync(join(root, '.nvmrc'), 'utf8')).toBe('24\n');
    expect(packageJson.engines?.node).toBe('24.x');
    expect(packageJson.scripts?.['test:unit']).toBe('vitest run');
    expect(packageJson.scripts?.['test:browser']).toBe('playwright test');
  });

  it('configures desktop and touch Chromium against the GitHub Pages base', async () => {
    expect(existsSync(playwrightConfigPath)).toBe(true);
    if (!existsSync(playwrightConfigPath)) return;

    const configUrl = pathToFileURL(playwrightConfigPath).href;
    const { default: config } = await import(/* @vite-ignore */ configUrl);
    expect(config.testDir).toBe('./e2e');
    expect(config.use?.baseURL).toBe('http://127.0.0.1:4321/yu/');
    expect(config.webServer).toMatchObject({
      command: 'npm run preview -- --host 127.0.0.1 --port 4321',
      url: 'http://127.0.0.1:4321/yu/',
    });

    expect(config.projects).toEqual([
      expect.objectContaining({
        name: 'desktop-chromium',
        use: expect.objectContaining({ browserName: 'chromium', isMobile: false, hasTouch: false }),
      }),
      expect.objectContaining({
        name: 'touch-chromium',
        use: expect.objectContaining({ browserName: 'chromium', isMobile: true, hasTouch: true }),
      }),
    ]);
  });
});
