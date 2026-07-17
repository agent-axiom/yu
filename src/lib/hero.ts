export function bindHeroPointer(root: HTMLElement, reduceMotion: boolean): () => void {
  if (reduceMotion) return () => undefined;

  const handlePointer = (event: PointerEvent | MouseEvent) => {
    const bounds = root.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const x = Math.min(100, Math.max(0, ((event.clientX - bounds.left) / bounds.width) * 100));
    const y = Math.min(100, Math.max(0, ((event.clientY - bounds.top) / bounds.height) * 100));
    root.style.setProperty('--pointer-x', `${Number(x.toFixed(2))}%`);
    root.style.setProperty('--pointer-y', `${Number(y.toFixed(2))}%`);
  };

  root.addEventListener('pointermove', handlePointer);
  return () => root.removeEventListener('pointermove', handlePointer);
}
