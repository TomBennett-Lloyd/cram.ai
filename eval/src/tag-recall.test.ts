import type { FactTagging } from '@cram/grounding';
import { ChunkNo, SourceId, TopicTag } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { topicLabel } from './eval-fixture';
import { tagRecall } from './tag-recall';

const tagged = (id: string, chunkNo: number, ...tags: string[]): FactTagging => ({
  sourceId: SourceId.parse(id),
  chunkNo: ChunkNo.parse(chunkNo),
  status: 'tagged',
  tags: tags.map((tag) => TopicTag.parse(tag)),
});

const ratio = (numerator: number, denominator: number) => ({
  status: 'measured',
  bar: 'baseline',
  ratio: { numerator, denominator },
});

describe('tagRecall', () => {
  it('counts a labelled topic when a tag on any of the slide’s chunks is named by it', () => {
    const labels = [
      topicLabel({ lectureId: 'l1', slideNo: 1, tags: ['swarming', 'the bloom count'] }),
    ];
    expect(
      tagRecall(labels, [tagged('l1/1', 1, 'swarming'), tagged('l1/1', 2, 'Bloom Count')]),
    ).toEqual(ratio(2, 2));
  });

  it('does not count a tag on another slide, a tag the topic does not name, or an untagged fact', () => {
    const labels = [
      topicLabel({ lectureId: 'l1', slideNo: 1, tags: ['swarming'] }),
      topicLabel({ lectureId: 'l1', slideNo: 2, tags: ['bloom count'] }),
      topicLabel({ lectureId: 'l2', slideNo: 1, tags: ['the stilling'] }),
    ];
    const facts: FactTagging[] = [
      tagged('l1/2', 1, 'swarming'),
      tagged('l1/1', 1, 'swarm', 'swarming season'),
      tagged('l1/2', 2, 'the bloom count'),
      {
        sourceId: SourceId.parse('l2/1'),
        chunkNo: ChunkNo.parse(1),
        status: 'untagged',
        reason: 'invalid-output',
      },
    ];
    expect(tagRecall(labels, facts)).toEqual(ratio(0, 3));
  });

  it('counts a shorter tag a longer topic contains, as a query naming the topic would find it', () => {
    const labels = [topicLabel({ lectureId: 'l1', slideNo: 1, tags: ['the stilling'] })];
    expect(tagRecall(labels, [tagged('l1/1', 1, 'stilling')])).toEqual(ratio(1, 1));
  });

  it('is not measurable with no labelled topic', () => {
    expect(tagRecall([], [tagged('l1/1', 1, 'swarming')])).toEqual({
      status: 'not-measurable',
      reason: 'no slide carries a golden topic',
    });
  });
});
