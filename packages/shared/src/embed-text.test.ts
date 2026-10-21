import { describe, expect, it } from 'vitest';
import { embedText } from './embed-text';
import type { SlideRecord } from './slide-record';
import { slide } from './slide-record-fixture';

const captioned = (fields: Partial<SlideRecord> = {}): SlideRecord =>
  slide({ speakerNotes: 'Ask about drones.', imageCaptions: ['A comb', 'A queen'], ...fields });

describe('embedText', () => {
  it('is every quotable field in reading order, one per line', () => {
    expect(embedText(captioned())).toBe(
      'The Hive\nWorker bees are female.\nAsk about drones.\nA comb\nA queen',
    );
  });

  it('leaves blank fields out rather than embedding an empty line', () => {
    expect(embedText(captioned({ title: ' ', speakerNotes: '', imageCaptions: [] }))).toBe(
      'Worker bees are female.',
    );
  });
});
