import { SlideNo, SlideRecord, type CourseId, type LectureId, type SourceHash } from '@cram/shared';
import type { PageText, TextLine } from './page-text';
import { pageLines, slideText } from './slide-text';
import { storedPage, storedText } from './stored-text';

export interface DeckSource {
  readonly courseId: CourseId;
  readonly lectureId: LectureId;
  readonly fileName: string;
  readonly storedTitle?: string;
  readonly sourceHash: SourceHash;
}

export const UNTITLED_LECTURE = 'Untitled lecture';

export const BOILERPLATE_MIN_PAGES = 3;

interface ReadPage {
  readonly lines: readonly TextLine[];
  readonly title: string;
}

const boilerplateOf = (pages: readonly ReadPage[]): ReadonlySet<string> => {
  const texted = pages.filter(({ lines }) => lines.length > 0);
  if (texted.length < BOILERPLATE_MIN_PAGES || new Set(texted.map(({ title }) => title)).size < 2)
    return new Set();
  const [first, ...rest] = texted.map(({ lines }) => new Set(lines.map(({ text }) => text)));
  return new Set([...(first ?? [])].filter((text) => rest.every((texts) => texts.has(text))));
};

const fileStem = (fileName: string): string =>
  (fileName.split(/[\\/]/).pop() ?? '')
    .replace(/\.[^.]*$/, '')
    .replace(/[_\s-]+/g, ' ')
    .trim();

/** The lecture title is never deck metadata, which goes stale (#9). */
export const slidesFromPages = (
  pages: readonly PageText[],
  source: DeckSource,
): readonly SlideRecord[] => {
  const stored = pages.map((raw, index) => {
    const slideNo = SlideNo.parse(index + 1);
    const page = storedPage(raw);
    return {
      page,
      slideNo,
      lines: pageLines(page, slideNo),
      title: slideText(page, slideNo).title,
    };
  });
  const boilerplate = boilerplateOf(stored);
  const read = stored.map(({ page, slideNo }) => ({
    page,
    slideNo,
    text: slideText(page, slideNo, boilerplate),
  }));
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
