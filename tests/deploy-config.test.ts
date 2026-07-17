import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('GitHub Pages deployment contract', () => {
  const workflow = readFileSync(join(process.cwd(), '.github/workflows/deploy.yml'), 'utf8');
  const astro = readFileSync(join(process.cwd(), 'astro.config.mjs'), 'utf8');

  it('deploys main with least-privilege Pages permissions', () => {
    expect(workflow).toMatch(/branches:\s*\[main\]/);
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('pages: write');
    expect(workflow).toContain('id-token: write');
  });

  it('uses the official current Astro Pages action chain', () => {
    expect(workflow).toContain('actions/checkout@v7');
    expect(workflow).toContain('withastro/action@v6');
    expect(workflow).toContain('actions/deploy-pages@v5');
  });

  it('matches the agent-axiom project URL', () => {
    expect(astro).toContain("site: 'https://agent-axiom.github.io'");
    expect(astro).toContain("base: '/yu'");
  });
});
