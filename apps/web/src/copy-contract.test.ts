// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = new URL('.', import.meta.url).pathname;

const components = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return components(path);
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [path] : [];
  });

/** Phrases that belong to `copy.ts` (`docs/standards/react.md` § Async surface convention). */
const ASYNC_PHRASE = /loading|…|went wrong|try again|couldn.t|can.t reach|failed to|don.t cover/i;

describe('async-state copy', () => {
  it('lives in copy.ts and in no component', () => {
    const inline = components(SRC).flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => ASYNC_PHRASE.test(line))
        .map((line) => `${path.slice(SRC.length)}: ${line.trim()}`),
    );
    expect(inline).toEqual([]);
  });

  it('finds the phrases it is looking for', () => {
    expect(ASYNC_PHRASE.test('Loading decks…')).toBe(true);
    expect(components(SRC).length).toBeGreaterThan(5);
  });
});
