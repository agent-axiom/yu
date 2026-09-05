export type EvidenceLevel =
  | 'traditional'
  | 'laboratory'
  | 'clinical'
  | 'none';

const evidenceLabels: Record<EvidenceLevel, string> = {
  traditional: 'Традиционное представление',
  laboratory: 'Лабораторное наблюдение',
  clinical: 'Клинические данные',
  none: 'Доказательств нет',
};

export function evidenceLabel(level: EvidenceLevel, locale: 'ru' | 'en' = 'ru'): string {
  const english: Record<EvidenceLevel, string> = {
    traditional: 'Traditional belief',
    laboratory: 'Laboratory observation',
    clinical: 'Clinical evidence',
    none: 'No supporting evidence',
  };
  return locale === 'en' ? english[level] : evidenceLabels[level];
}

export function missingSourceIds(
  citations: string[],
  available: Set<string>,
): string[] {
  return citations.filter((citation) => !available.has(citation));
}
