import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

type PackageLock = {
  packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
};

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageJson;
const packageLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as PackageLock;

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
});
