import { z } from 'zod';
import type { SlideRecord } from './slide-record';

/** A chunk's place in its slide, counted from 1 in reading order (`docs/adr/0008-slide-chunking.md` § Decision (a)). */
export const ChunkNo = z.number().int().positive().brand<'ChunkNo'>();
export type ChunkNo = z.infer<typeof ChunkNo>;

/** The fields of a slide a quote resolves against and an embedding is taken over. */
export type QuotableFields = Pick<SlideRecord, 'title' | 'body' | 'speakerNotes' | 'imageCaptions'>;

export interface SlideChunk extends QuotableFields {
  readonly chunkNo: ChunkNo;
}

/** The whole slide as one chunk's text: what is embedded first, and what a slide that cannot be split keeps. */
export const wholeSlideChunk = ({
  title,
  body,
  speakerNotes,
  imageCaptions,
}: QuotableFields): QuotableFields => ({ title, body, speakerNotes, imageCaptions });
