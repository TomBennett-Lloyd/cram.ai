import { describe, expect, it } from 'vitest';
import { embedText } from './embed-text';
import { SlideRecord } from './slide-record';

const slide = (fields: Partial<SlideRecord> = {}): SlideRecord =>
  SlideRecord.parse({
    courseId: 'bio',
    lectureId: 'l1',
    lectureTitle: 'Lecture 1',
    slideNo: 1,
    kind: 'content',
    title: 'The Hive',
    body: 'Worker bees are female.',
    speakerNotes: 'Ask about drones.',
    imageCaptions: ['A comb', 'A queen'],
    derived: false,
    sourceHash: 'h',
    ...fields,
  });

describe('embedText', () => {
  it('is every quotable field in reading order, one per line', () => {
    expect(embedText(slide())).toBe(
      'The Hive\nWorker bees are female.\nAsk about drones.\nA comb\nA queen',
    );
  });

  it('leaves blank fields out rather than embedding an empty line', () => {
    expect(embedText(slide({ title: ' ', speakerNotes: '', imageCaptions: [] }))).toBe(
      'Worker bees are female.',
    );
  });
});
