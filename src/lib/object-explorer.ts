/** A bounded camera over a single museum photograph, enhanced only after binding. */
export function bindObjectExplorer(root: HTMLElement): () => void {
  const viewport = root.querySelector<HTMLElement>('[data-object-viewport]');
  const image = root.querySelector<HTMLImageElement>('[data-object-image]');
  const zoom = root.querySelector<HTMLInputElement>('[data-object-zoom]');
  const controls = root.querySelector<HTMLElement>('[data-object-controls]');
  const reset = root.querySelector<HTMLButtonElement>('[data-object-reset]');
  if (!viewport || !image || !zoom || !controls || !reset) return () => {};

  const output = root.querySelector<HTMLOutputElement>('[data-object-scale]');
  const details = [...root.querySelectorAll<HTMLButtonElement>('[data-object-detail]')];
  const abort = new AbortController();
  const options = { signal: abort.signal };
  let scale = 1;
  let x = 50;
  let y = 50;
  let drag: { id: number; x: number; y: number; cameraX: number; cameraY: number } | null = null;

  function render() {
    const edge = 50 / scale;
    x = Math.min(100 - edge, Math.max(edge, x));
    y = Math.min(100 - edge, Math.max(edge, y));
    image!.style.transform = `translate(${(50 - x) * scale}%, ${(50 - y) * scale}%) scale(${scale})`;
    zoom!.value = String(scale);
    const label = `${String(scale).replace('.', ',')}×`;
    zoom!.setAttribute('aria-valuetext', `Увеличение ${label}`);
    if (output) output.value = label;
    root.dataset.zoomed = String(scale > 1);
  }
  function clearSelection() {
    details.forEach((button) => button.setAttribute('aria-pressed', 'false'));
  }
  function resetView() {
    scale = 1; x = 50; y = 50; drag = null;
    clearSelection();
    render();
  }
  zoom.addEventListener('input', () => {
    const value = Number(zoom.value);
    scale = Number.isFinite(value) ? Math.min(2.5, Math.max(1, value)) : 1;
    clearSelection();
    render();
  }, options);
  reset.addEventListener('click', resetView, options);
  details.forEach((button) => button.addEventListener('click', () => {
    const detailX = Number(button.dataset.x);
    const detailY = Number(button.dataset.y);
    if (!Number.isFinite(detailX) || !Number.isFinite(detailY)) return;
    scale = 2.5; x = detailX; y = detailY;
    clearSelection();
    button.setAttribute('aria-pressed', 'true');
    render();
  }, options));
  viewport.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { resetView(); return; }
    if (scale === 1 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'ArrowLeft') x -= 5;
    if (event.key === 'ArrowRight') x += 5;
    if (event.key === 'ArrowUp') y -= 5;
    if (event.key === 'ArrowDown') y += 5;
    clearSelection();
    render();
  }, options);
  viewport.addEventListener('pointerdown', (event) => {
    if (scale === 1 || event.button !== 0 || drag) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, cameraX: x, cameraY: y };
    viewport.setPointerCapture?.(event.pointerId);
  }, options);
  viewport.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const rect = viewport.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    x = drag.cameraX - (event.clientX - drag.x) / rect.width * 100 / scale;
    y = drag.cameraY - (event.clientY - drag.y) / rect.height * 100 / scale;
    clearSelection();
    render();
  }, options);
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    viewport.addEventListener(event, () => { drag = null; }, options);
  }
  viewport.tabIndex = 0;
  controls.hidden = false;
  render();
  return () => { abort.abort(); };
}
