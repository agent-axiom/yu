/** Keep term links navigable; intercept only after a native modal really opens. */
export function bindGlossary(dialog: HTMLDialogElement): () => void {
  const close = dialog.querySelector<HTMLButtonElement>('[data-glossary-close]');
  const entries = [...dialog.querySelectorAll<HTMLElement>('[data-glossary-entry]')];
  const document = dialog.ownerDocument;
  const byId = new Map(entries.map((entry) => [entry.dataset.glossaryEntry, entry]));
  if (typeof dialog.showModal !== 'function' || typeof dialog.close !== 'function' ||
      !close || !entries.length || byId.size !== entries.length ||
      entries.some((entry) => !entry.dataset.glossaryEntry ||
        !entry.getAttribute('aria-labelledby') ||
        !entry.contains(document.getElementById(entry.getAttribute('aria-labelledby')!)))) {
    return () => {};
  }

  let opener: HTMLAnchorElement | null = null;
  const initialLabel = dialog.getAttribute('aria-labelledby');
  const restoreFocus = () => {
    const target = opener;
    opener = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  };
  const closeDialog = () => { if (dialog.open) dialog.close(); };
  const cancel = (event: Event) => { event.preventDefault(); closeDialog(); };
  const backdrop = (event: MouseEvent) => {
    if (event.target !== dialog || !dialog.open) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right ||
        event.clientY < box.top || event.clientY > box.bottom) closeDialog();
  };
  const openTerm = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey ||
        event.metaKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>('a[data-term]');
    if (!link || link.hasAttribute('download') ||
        (link.target && link.target !== '_self')) return;
    const entry = byId.get(link.dataset.term);
    if (!entry) return;

    entries.forEach((item) => { item.hidden = item !== entry; });
    dialog.setAttribute('aria-labelledby', entry.getAttribute('aria-labelledby')!);
    try {
      if (!dialog.open) dialog.showModal();
      if (!dialog.open) return;
    } catch {
      return; // The original href remains the fallback, including when opening fails.
    }
    opener = link;
    event.preventDefault();
    dialog.scrollTop = 0;
    close.focus({ preventScroll: true });
  };

  document.addEventListener('click', openTerm);
  close.addEventListener('click', closeDialog);
  dialog.addEventListener('cancel', cancel);
  dialog.addEventListener('close', restoreFocus);
  dialog.addEventListener('click', backdrop);
  return () => {
    closeDialog();
    restoreFocus();
    document.removeEventListener('click', openTerm);
    close.removeEventListener('click', closeDialog);
    dialog.removeEventListener('cancel', cancel);
    dialog.removeEventListener('close', restoreFocus);
    dialog.removeEventListener('click', backdrop);
    entries.forEach((entry) => { entry.hidden = true; });
    if (initialLabel) dialog.setAttribute('aria-labelledby', initialLabel);
    else dialog.removeAttribute('aria-labelledby');
  };
}
