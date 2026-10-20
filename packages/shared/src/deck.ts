import { z } from 'zod';
import { NonBlankText } from './non-blank-text';
import { LectureId, SlideNo } from './slide-record';

const FileContent = z.instanceof(Uint8Array).refine((bytes) => bytes.length > 0, 'empty file');

export const DeckMediaType = z.enum([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);
export type DeckMediaType = z.infer<typeof DeckMediaType>;

/** One lecture's uploaded deck, as stored in its course file (`docs/adr/0004-storage.md` § Decision (b)). */
export const Deck = z.strictObject({
  lectureId: LectureId,
  lectureTitle: NonBlankText,
  mediaType: DeckMediaType,
  content: FileContent,
});
export type Deck = z.infer<typeof Deck>;

export const SlideImageMediaType = z.enum(['image/png', 'image/jpeg']);
export type SlideImageMediaType = z.infer<typeof SlideImageMediaType>;

/** A slide rendered from its deck, shown beside a citation to derived text (ADR 0006, #6). */
export const SlideImage = z.strictObject({
  slideNo: SlideNo,
  mediaType: SlideImageMediaType,
  content: FileContent,
});
export type SlideImage = z.infer<typeof SlideImage>;
