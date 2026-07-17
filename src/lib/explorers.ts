export type MythLayer = 'legend' | 'context' | 'confirmed';

const mythLabels: Record<MythLayer, string> = {
  legend: 'Легенда',
  context: 'Культурный контекст',
  confirmed: 'Что подтверждено',
};

export function mythLayerLabel(layer: MythLayer): string {
  return mythLabels[layer];
}

export function clampLens(value: number): number {
  return Math.min(100, Math.max(0, value));
}
