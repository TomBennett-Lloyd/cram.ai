import type { TagRow } from '@cram/index';
import { ChunkNo, type TopicOrigin, TopicTag } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { chunkTags } from './slide-topics';

const row = (chunkNo: number, origin: TopicOrigin, tag: string): TagRow => ({
  chunkNo: ChunkNo.parse(chunkNo),
  origin,
  tag: TopicTag.parse(tag),
});

describe('chunkTags', () => {
  it('lists one chunk’s tags by their text, whatever order the rows come in', () => {
    const rows = [row(1, 'student', 'zebra'), row(2, 'tagger', 'other'), row(1, 'tagger', 'apple')];
    expect(chunkTags(rows, ChunkNo.parse(1))).toEqual([
      { tag: 'apple', origin: 'tagger' },
      { tag: 'zebra', origin: 'student' },
    ]);
    expect(chunkTags(rows, ChunkNo.parse(3))).toEqual([]);
  });

  it('shows a tag both origins hold once, as the student’s, in either row order', () => {
    for (const rows of [
      [row(1, 'tagger', 'cells'), row(1, 'student', 'cells')],
      [row(1, 'student', 'cells'), row(1, 'tagger', 'cells')],
    ])
      expect(chunkTags(rows, ChunkNo.parse(1))).toEqual([{ tag: 'cells', origin: 'student' }]);
  });
});
