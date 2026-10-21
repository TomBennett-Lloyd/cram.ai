import { SlideNo, SlideRecord, type CourseId, type LectureId, type SourceHash } from '@cram/shared';
import type { PageText } from './page-text';
import { slideText } from './slide-text';
import { storedPage, storedText } from './stored-text';

export interface DeckSource {
  readonly courseId: CourseId;
  readonly lectureId: LectureId;
  readonly fileName: string;
  readonly storedTitle?: string;
  readonly sourceHash: SourceHash;
}

export const UNTITLED_LECTURE = 'Untitled lecture';

const fileStem = (fileName: string): string =>
  (fileName.split(/[\\/]/).pop() ?? '')
    .replace(/\.[^.]*$/, '')
    .replace(/[_\s-]+/g, ' ')
    .trim();

/**
 * One record per page, in page order. The lecture title is the first page's, else the stored title
 * verbatim, else the file name's stem; never deck metadata, which goes stale (#9).
 */
export const slidesFromPages = (
  pages: readonly PageText[],
  source: DeckSource,
): readonly SlideRecord[] => {
  const read = pages.map((page, index) => {
    const slideNo = SlideNo.parse(index + 1);
    const stored = storedPage(page);
    return { page: stored, slideNo, text: slideText(stored, slideNo) };
  });
  const lectureTitle =
    [read[0]?.text.title, storedText(source.storedTitle ?? fileStem(source.fileName))].find(
      (title) => title !== undefined && title !== '',
    ) ?? UNTITLED_LECTURE;
  return read.map(({ page, slideNo, text }) =>
    SlideRecord.parse({
      courseId: source.courseId,
      lectureId: source.lectureId,
      lectureTitle,
      slideNo,
      kind: text.kind,
      title: text.title,
      body: text.body,
      speakerNotes: page.notes.trim(),
      imageCaptions: [],
      derived: false,
      sourceHash: source.sourceHash,
    }),
  );
};
