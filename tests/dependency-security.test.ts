import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

type PackageLock = {
  packages: Record<
    string,
    {
      version?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    }
  >;
};

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageJson;
const packageLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as PackageLock;

function expectSafeTransitiveResolution(packageName: string, expectedVersion: string) {
  expect(packageLock.packages[`node_modules/${packageName}`]?.version).toBe(expectedVersion);
  expect(packageJson.dependencies?.[packageName]).toBeUndefined();
  expect(packageJson.devDependencies?.[packageName]).toBeUndefined();
  expect(packageJson.optionalDependencies?.[packageName]).toBeUndefined();
  expect(packageLock.packages['']?.dependencies?.[packageName]).toBeUndefined();
  expect(packageLock.packages['']?.devDependencies?.[packageName]).toBeUndefined();
  expect(packageLock.packages['']?.optionalDependencies?.[packageName]).toBeUndefined();
}

describe('build dependency security pins', () => {
  it('pins the verified Astro release and excludes affected 7.1.0', () => {
    expect(packageJson.dependencies?.astro).toBe('7.1.6');
    expect(packageLock.packages['node_modules/astro']?.version).toBe('7.1.6');
    expect(packageLock.packages['node_modules/astro']?.version).not.toBe('7.1.0');
  });

  it('resolves fixed fast-uri transitively without making it a direct dependency', () => {
    expect(packageLock.packages['node_modules/fast-uri']?.version).toBe('3.1.5');
    expect(packageJson.dependencies?.['fast-uri']).toBeUndefined();
    expect(packageJson.devDependencies?.['fast-uri']).toBeUndefined();
    expect(packageJson.optionalDependencies?.['fast-uri']).toBeUndefined();
    expect(packageLock.packages['']?.dependencies?.['fast-uri']).toBeUndefined();
  });

  it('resolves fixed nanoid transitively without making it a direct dependency', () => {
    expectSafeTransitiveResolution('nanoid', '3.3.18');
  });

  it('resolves fixed postcss transitively without making it a direct dependency', () => {
    expectSafeTransitiveResolution('postcss', '8.5.26');
  });

  it('resolves fixed undici transitively without making it a direct dependency', () => {
    expectSafeTransitiveResolution('undici', '7.29.0');
  });
});
