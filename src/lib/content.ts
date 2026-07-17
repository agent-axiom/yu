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

export function evidenceLabel(level: EvidenceLevel): string {
  return evidenceLabels[level];
}

export function missingSourceIds(
  citations: string[],
  available: Set<string>,
): string[] {
  return citations.filter((citation) => !available.has(citation));
}
