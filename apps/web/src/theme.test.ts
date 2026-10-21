import { describe, expect, it } from 'vitest';
import { syncTheme } from './theme';

/** A colour-scheme query whose answer the test sets, firing `change` as a browser does. */
class FakeScheme extends EventTarget {
  matches: boolean;

  constructor(matches: boolean) {
    super();
    this.matches = matches;
  }

  flip(): void {
    this.matches = !this.matches;
    this.dispatchEvent(new Event('change'));
  }
}

const asQuery = (scheme: FakeScheme): MediaQueryList =>
  Object.assign(scheme, {
    media: '',
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
  });

describe('syncTheme', () => {
  it('follows the reader’s scheme until stopped', () => {
    const root = document.createElement('div');
    const scheme = new FakeScheme(true);
    const stop = syncTheme(root, asQuery(scheme));
    expect(root.dataset.theme).toBe('dark');
    scheme.flip();
    expect(root.dataset.theme).toBe('light');
    stop();
    scheme.flip();
    expect(root.dataset.theme).toBe('light');
  });
});
