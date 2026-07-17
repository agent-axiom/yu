import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(join(process.cwd(), 'src/pages/medicine.astro'), 'utf8');
const panel = readFileSync(join(process.cwd(), 'src/components/EvidencePanel.astro'), 'utf8');

describe('medical editorial safety contract', () => {
  it('states the diagnostic and treatment boundary exactly', () => {
    expect(page).toContain('не заменяет диагностику');
    expect(page).toContain('не заменяет назначенное лечение');
  });

  it('explains every evidence category', () => {
    for (const label of [
      'Традиционное представление',
      'Лабораторное наблюдение',
      'Клинические данные',
      'Доказательств нет',
    ]) expect(page).toContain(label);
  });

  it('renders visible safety and source markers for every record', () => {
    expect(page).toContain('medicine.map');
    expect(panel).toContain('evidence-panel__safety');
    expect(panel).toContain('record.data.citations.map');
    expect(panel).toContain('<SourceRef');
  });
});
