import { describe, expect, it } from 'vitest';
import { BrowsedSlide, TagEdit } from './lecture-slides';
import { slide as record } from './slide-record-fixture';

const chunk = {
  chunkNo: 1,
  lines: ['Cells divide.'],
  tags: [{ tag: 'mitosis', origin: 'tagger' }],
};

describe('BrowsedSlide', () => {
  it('accepts a slide with a chunk whose tags name their origin', () => {
    const slide = { sourceId: 'l1/1', record: record(), chunks: [chunk] };
    expect(BrowsedSlide.safeParse(slide).success).toBe(true);
  });

  it('refuses a slide with no chunk, an origin outside the two, and a blank tag', () => {
    const base = { sourceId: 'l1/1', record: record() };
    for (const chunks of [
      [],
      [{ ...chunk, tags: [{ tag: 'mitosis', origin: 'model' }] }],
      [{ ...chunk, tags: [{ tag: ' ', origin: 'student' }] }],
    ])
      expect(BrowsedSlide.safeParse({ ...base, chunks }).success, JSON.stringify(chunks)).toBe(
        false,
      );
  });
});

describe('TagEdit', () => {
  it('accepts empty lists and refuses an untrimmed tag, a chunk number of 0, an extra key, or a missing or malformed base', () => {
    const baseless = { sourceId: 'l1/1', chunkNo: 1, tags: [] };
    const edit = { ...baseless, base: [] };
    expect(TagEdit.safeParse(edit).success).toBe(true);
    expect(TagEdit.safeParse({ ...edit, base: [{ tag: 'cells', origin: 'tagger' }] }).success).toBe(
      true,
    );
    for (const refused of [
      { ...edit, tags: ['cells '] },
      { ...edit, chunkNo: 0 },
      { ...edit, origin: 'tagger' },
      baseless,
      { ...edit, base: ['cells'] },
      { ...edit, base: [{ tag: 'cells' }] },
      { ...edit, base: [{ tag: 'cells ', origin: 'student' }] },
      { ...edit, base: [{ tag: 'cells', origin: 'teacher' }] },
    ])
      expect(TagEdit.safeParse(refused).success, JSON.stringify(refused)).toBe(false);
  });
});
