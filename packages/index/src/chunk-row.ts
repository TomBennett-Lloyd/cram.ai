import { ChunkNo, type SlideChunk } from '@cram/shared';
import { z } from 'zod';

/** A slide's chunks: the rows `slides_fts` and `slide_vec` index (`docs/adr/0008-slide-chunking.md` § Decision (b)). */
export const CHUNK_TABLE_NAME = 'chunks';

export const CHUNK_TABLE = `
  create table ${CHUNK_TABLE_NAME} (
    id integer primary key,
    slide_id integer not null references slides (id),
    chunk_no integer not null check (chunk_no >= 1),
    title text not null,
    body text not null,
    speaker_notes text not null,
    image_captions text not null,
    unique (slide_id, chunk_no)
  ) strict;
`;

export const CHUNK_COLUMNS = 'slide_id, chunk_no, title, body, speaker_notes, image_captions';

const ChunkRow = z.object({
  chunk_no: z.number(),
  title: z.string(),
  body: z.string(),
  speaker_notes: z.string(),
  image_captions: z.string(),
});

export const chunkFromRow = (row: unknown): SlideChunk => {
  const parsed = ChunkRow.parse(row);
  return {
    chunkNo: ChunkNo.parse(parsed.chunk_no),
    title: parsed.title,
    body: parsed.body,
    speakerNotes: parsed.speaker_notes,
    imageCaptions: z.array(z.string()).parse(JSON.parse(parsed.image_captions)),
  };
};

/** Bind values in `CHUNK_COLUMNS` order. */
export const chunkRowValues = (
  slideId: number,
  chunk: SlideChunk,
): readonly (string | number)[] => [
  slideId,
  chunk.chunkNo,
  chunk.title,
  chunk.body,
  chunk.speakerNotes,
  JSON.stringify(chunk.imageCaptions),
];

/** The FTS5 columns of `slides_fts`, in order: the lecture's title, then the chunk's fields. */
export const ftsValues = (lectureTitle: string, chunk: SlideChunk): readonly string[] => [
  lectureTitle,
  chunk.title,
  chunk.body,
  chunk.speakerNotes,
  chunk.imageCaptions.join('\n'),
];
