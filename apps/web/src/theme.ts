/** Follows the reader's colour scheme; `@cram/ui`'s dark block keys on `data-theme`. */
export const syncTheme = (root: HTMLElement, scheme: MediaQueryList): (() => void) => {
  const apply = (): void => {
    root.dataset.theme = scheme.matches ? 'dark' : 'light';
  };
  apply();
  scheme.addEventListener('change', apply);
  return () => {
    scheme.removeEventListener('change', apply);
  };
};
