import { z } from 'zod';
import { SourceId } from './citation';
import { ChunkNo } from './slide-chunk';
import { LectureId, SlideRecord } from './slide-record';
import { TopicOrigin, TopicTag } from './topic-tag';

export const ChunkTag = z.strictObject({ tag: TopicTag, origin: TopicOrigin });
export type ChunkTag = z.infer<typeof ChunkTag>;

/** The order a chunk's tags are listed in, by their text's code units, so it reads the same on every machine. */
export const tagOrder = (a: ChunkTag, b: ChunkTag): number =>
  a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0;

export const BrowsedChunk = z.strictObject({
  chunkNo: ChunkNo,
  lines: z.array(z.string()),
  tags: z.array(ChunkTag),
});
export type BrowsedChunk = z.infer<typeof BrowsedChunk>;

export const BrowsedSlide = z.strictObject({
  sourceId: SourceId,
  record: SlideRecord,
  chunks: z.array(BrowsedChunk).min(1),
});
export type BrowsedSlide = z.infer<typeof BrowsedSlide>;

export const LectureSlides = z.strictObject({
  lectureId: LectureId,
  slides: z.array(BrowsedSlide),
});
export type LectureSlides = z.infer<typeof LectureSlides>;

/** The whole tag list the student wants one chunk to hold. */
export const TagEdit = z.strictObject({
  sourceId: SourceId,
  chunkNo: ChunkNo,
  tags: z.array(TopicTag),
});
export type TagEdit = z.infer<typeof TagEdit>;

export const EditedTags = z.strictObject({
  sourceId: SourceId,
  chunkNo: ChunkNo,
  tags: z.array(ChunkTag),
});
export type EditedTags = z.infer<typeof EditedTags>;
