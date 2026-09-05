/** Enhance a static material comparison with a native range control. */
export function bindMaterialLens(root: HTMLElement): () => void {
  const input = root.querySelector<HTMLInputElement>('input[type="range"]');
  const controls = root.querySelector<HTMLElement>('[data-lens-controls]');
  const output = root.querySelector<HTMLOutputElement>('[data-lens-value]');
  if (!input || !controls || !output) return () => {};

  const update = () => {
    const value = Math.min(100, Math.max(0, Number(input.value)));
    input.value = String(value);
    root.style.setProperty('--lens', `${value}%`);
    input.setAttribute('aria-valuetext', `Область схемы: нефрит ${value}%, жадеит ${100 - value}%`);
    output.textContent = `Нефрит ${value}% · Жадеит ${100 - value}%`;
  };

  input.addEventListener('input', update);
  update();
  controls.hidden = false;
  root.setAttribute('data-enhanced', '');

  return () => {
    input.removeEventListener('input', update);
    controls.hidden = true;
    root.removeAttribute('data-enhanced');
  };
}
