/** A readable set of articles becomes a tab interface only after validation. */
export function enhanceLegendHistory(root: HTMLElement): () => void {
  const controls = root.querySelector<HTMLElement>('[data-witness-controls]');
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[data-witness-tab]')];
  const articles = [...root.querySelectorAll<HTMLElement>('[data-witness-panel]')];
  const panels = tabs.map((tab) => articles.find((panel) => panel.id === tab.getAttribute('aria-controls')));

  if (!controls || tabs.length < 2 || tabs.length !== articles.length ||
      panels.some((panel) => !panel) || new Set(panels).size !== panels.length) {
    return () => {};
  }

  const witnesses = panels as HTMLElement[];
  const originalLabels = witnesses.map((panel) => panel.getAttribute('aria-labelledby'));
  const select = (selectedIndex: number) => {
    tabs.forEach((tab, index) => {
      const selected = selectedIndex === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      witnesses[index].hidden = !selected;
    });
  };

  const listeners = tabs.map((tab, index) => {
    tab.setAttribute('role', 'tab');
    witnesses[index].setAttribute('role', 'tabpanel');
    witnesses[index].setAttribute('aria-labelledby', tab.id);
    witnesses[index].tabIndex = 0;
    const click = () => select(index);
    const keydown = (event: KeyboardEvent) => {
      let next: number;
      switch (event.key) {
        case 'ArrowRight': next = (index + 1) % tabs.length; break;
        case 'ArrowLeft': next = (index + tabs.length - 1) % tabs.length; break;
        case 'Home': next = 0; break;
        case 'End': next = tabs.length - 1; break;
        default: return;
      }
      event.preventDefault();
      select(next);
      tabs[next].focus();
    };
    tab.addEventListener('click', click);
    tab.addEventListener('keydown', keydown);
    return { click, keydown };
  });

  select(0);
  controls.setAttribute('role', 'tablist');
  controls.hidden = false;
  root.setAttribute('data-enhanced', '');

  return () => {
    controls.hidden = true;
    controls.removeAttribute('role');
    root.removeAttribute('data-enhanced');
    tabs.forEach((tab, index) => {
      tab.removeEventListener('click', listeners[index].click);
      tab.removeEventListener('keydown', listeners[index].keydown);
      tab.removeAttribute('role');
      tab.removeAttribute('aria-selected');
      tab.removeAttribute('tabindex');
      witnesses[index].hidden = false;
      witnesses[index].removeAttribute('role');
      witnesses[index].removeAttribute('tabindex');
      const label = originalLabels[index];
      if (label) witnesses[index].setAttribute('aria-labelledby', label);
      else witnesses[index].removeAttribute('aria-labelledby');
    });
  };
}
