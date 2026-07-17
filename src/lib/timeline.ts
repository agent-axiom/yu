export function nextEra(current: number, direction: -1 | 1, length: number): number {
  return Math.max(0, Math.min(Math.max(0, length - 1), current + direction));
}

export function eraPanelId(id: string): string {
  return `era-panel-${id}`;
}
