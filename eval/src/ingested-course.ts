import { readFile } from 'node:fs/promises';
import { ingestPdf } from '@cram/ingest';
import { type CourseId, Deck as StoredDeck } from '@cram/shared';
import type { Deck } from './deck';
import type { IndexedLecture } from './index-retriever';
import { renderDeckPdfs } from './render-deck';

/**
 * The course as ingest makes it: each lecture rendered into `dir`, which `renderDeckPdfs` requires
 * to lie outside the checkout, and read back through `ingestPdf`.
 */
export const ingestedCourse = async (
  deck: Deck,
  courseId: CourseId,
  dir: string,
): Promise<readonly IndexedLecture[]> => {
  const rendered = await renderDeckPdfs(deck, dir);
  const lectures: IndexedLecture[] = [];
  for (const [index, source] of deck.entries()) {
    const path = rendered[index]?.path;
    if (path === undefined) throw new Error(`ingestedCourse: ${source.lectureId} was not rendered`);
    const bytes = new Uint8Array(await readFile(path));
    const result = await ingestPdf({
      bytes,
      fileName: path,
      courseId,
      lectureId: source.lectureId,
    });
    if (result.status !== 'ingested')
      throw new Error(`ingestedCourse: ${path} did not ingest: ${result.reason}: ${result.detail}`);
    lectures.push({
      deck: StoredDeck.parse({
        lectureId: source.lectureId,
        lectureTitle: source.lectureTitle,
        mediaType: 'application/pdf',
        content: bytes,
      }),
      slides: result.slides,
    });
  }
  return lectures;
};
