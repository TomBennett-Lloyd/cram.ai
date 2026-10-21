import { CourseId, LectureId, type SlideRecord } from '@cram/shared';
import type { DeckFile, IngestResult } from './adapters/deck-file';
import { buildDeck as buildPdf, type FixtureLine } from './adapters/pdf/deck-fixture';
import { ingestPdf } from './adapters/pdf/ingest-pdf';
import {
  alternateContent,
  bareShape,
  buildDeck as buildPptx,
  group,
  lineBreak,
  paragraphOf,
  picture,
  run,
  shape,
  slideNumberField,
  table,
} from './adapters/pptx/deck-fixture';
import { ingestPptx } from './adapters/pptx/ingest-pptx';
import { EVERY_CONSTRUCT, MASS_ENERGY } from './stored-output-equations';
import { BULLET_MARKERS } from './slide-text';

/** Characters from pdf.js's `normalizeUnicode` set, as a deck writes them: micro sign, ligatures, ohm sign (#256). */
const PDFJS_FOLDED_LINE = 'Cells are 5 \u00B5m across, \uFB01ne \uFB02ow, \uFB05 and 10 k\u2126';

/** Pointed Hebrew in presentation forms, drawn left to right in visual order as a PDF stores it (#283). */
const POINTED_HEBREW_VISUAL = '\u05D4\uFB2A\u05DC\u05D5\u05DD \u05E8\u05E7\uFB4B\uFB31';

/** Each slide and page reaches one edge of how ingest reads a deck (#257's PR names them). */
const PPTX = buildPptx({
  reversePartNames: true,
  slides: [
    {
      shapes: [
        shape(['Week four of the chemistry course'], 'subTitle'),
        shape(['Reaction  Kinetics'], 'ctrTitle'),
        shape([paragraphOf(slideNumberField('Slide 1'))], 'sldNum'),
        shape(['Chemistry 101'], 'ftr'),
        shape(['October'], 'dt'),
      ],
      notes: ['  Welcome to the café, says 𝑚  ', 'Second line of notes'],
    },
    {
      shapes: [
        shape(['Rate', 'laws'], 'title'),
        shape(
          [
            paragraphOf(run('Rate depends on', '2800'), lineBreak, run('concentration')),
            'Units are mol per litre per second',
            '',
            '  A padded line  ',
          ],
          'body',
        ),
        table([
          ['Order', 'Units'],
          ['First order', 'per second'],
        ]),
        group(shape(['A grouped caption under the table'])),
      ],
      notes: ['Read from an absolute target', PDFJS_FOLDED_LINE],
      absoluteNotesTarget: true,
    },
    {
      shapes: [
        alternateContent(
          shape([paragraphOf(run('Energy and mass 𝑚'))], 'title'),
          shape(['Fallback title'], 'title'),
        ),
        alternateContent(
          shape([paragraphOf(run('Rest energy is '), MASS_ENERGY, run(' for a body at rest'))]),
          picture,
        ),
        shape(['Café au lait and the word ℎ for Planck', PDFJS_FOLDED_LINE]),
      ],
    },
    { shapes: [shape(['Every construct'], 'title'), shape([paragraphOf(EVERY_CONSTRUCT)])] },
    { shapes: [picture, bareShape('title')] },
    {
      shapes: [
        bareShape('title'),
        shape(['A body line that would otherwise be read as its title']),
      ],
    },
    {
      shapes: [
        shape(['Further reading'], 'title'),
        shape(['Atkins, Physical Chemistry, chapter seventeen'], 'body'),
      ],
    },
    { shapes: [shape(['Hidden backup slide with enough words to read'])], hidden: true },
    {
      shapes: [
        shape([paragraphOf(run('A run whose size is not a number', 'big'))]),
        shape([paragraphOf(run('Inferred title', '4400'))]),
        shape([paragraphOf(run('Body text at the modal size here', '2400'))]),
        shape([paragraphOf(run('More body text at the modal size', '2400'))]),
      ],
    },
    {
      shapes: [
        shape(['A run with no size, the longest line on its slide']),
        shape([paragraphOf(run('A one point run', '100'))]),
      ],
    },
    {
      shapes: [
        alternateContent(
          shape(['A choice body with no title of its own']),
          shape(['Fallback title'], 'title'),
        ),
      ],
    },
    {
      shapes: [
        shape(['Every bullet marker'], 'title'),
        shape(['Lead line', ...BULLET_MARKERS.map((marker) => `${marker} item after ${marker}`)]),
      ],
    },
  ],
});

const TITLE = 48;
const BODY = 28;
const line = (text: string, size = BODY): FixtureLine => ({ text, size });
const titled = (title: string): { lines: readonly FixtureLine[] } => ({
  lines: [line(title, TITLE), line('Atkins, Physical Chemistry, chapter seventeen')],
});

const PDF = await buildPdf({
  metadataTitle: 'A stale metadata title',
  pages: [
    { lines: [] },
    {
      lines: [
        line('Reaction Kinetics', TITLE),
        line('•'),
        line('Rate depends on concentration'),
        line('• Second order reactions'),
        line('wrap onto a second line'),
        { text: 'Scaled line of body text', size: BODY, scaled: true },
        line('42'),
        line('2.0'),
        line('2', 14),
      ],
      annotations: [
        { subtype: 'Text', contents: 'A note for the speaker' },
        { subtype: 'Text', contents: 'A second note' },
        { subtype: 'Link', contents: 'not a note' },
        { contents: 'no subtype either' },
      ],
    },
    {
      lines: [
        line('Mass and energy', TITLE),
        { text: 'Emc', size: BODY, mathItalic: true },
        line('is the rest energy of a body'),
        { text: PDFJS_FOLDED_LINE, size: BODY, toUnicode: true },
        { text: POINTED_HEBREW_VISUAL, size: BODY, toUnicode: true },
      ],
      annotations: [{ subtype: 'Text', contents: PDFJS_FOLDED_LINE }],
    },
    titled('References'),
    titled('Reference list'),
    titled('Bibliography'),
    titled('Further readings'),
    titled('Reading lists'),
    titled('Works cited'),
    titled('Bibliographic methods'),
    titled('Bibliographyish slide'),
    titled('3 laws of motion'),
    titled('Chapter 3'),
    titled('Our references today'),
    { lines: [line('Four words only here')] },
    { lines: [line('Exactly five words are here')] },
    { lines: [line('Lab 3 opens at noon')] },
    {
      lines: [
        line('Cell potential'),
        line('–0.76 V at the zinc'),
        line('measured against hydrogen'),
      ],
    },
    { lines: [line('No title is larger'), line('Body at one size'), line('•')] },
    { lines: [line('• Only bullets here'), line('• and more bullets after')] },
    { lines: [line('2024', TITLE), line('Year in review for the course')] },
    {
      lines: [
        line('Part one of', TITLE),
        line('the title', TITLE),
        line('then the body text, which runs longer'),
      ],
    },
    { lines: [line('Wxyz one two', 30), line('Abcd three f', 40)] },
    {
      lines: [
        line('A plain line, the longer of the two'),
        { text: 'Then scaled', size: BODY, scaled: true },
      ],
    },
    {
      lines: [
        { text: 'A scaled line, the longer of the two', size: BODY, scaled: true },
        line('Then plain'),
      ],
    },
  ],
});

const deckFile = (bytes: Uint8Array, fileName: string): DeckFile => ({
  bytes,
  fileName,
  courseId: CourseId.parse('course-a'),
  lectureId: LectureId.parse('lecture-4'),
});

const slidesOf = (result: IngestResult<string>): readonly SlideRecord[] => {
  if (result.status !== 'ingested')
    throw new Error(`a corpus deck must ingest, got ${result.reason}: ${result.detail}`);
  return result.slides;
};

/** Each deck's bytes and records; the PDF is read under three file names so its untitled first page reaches the stem fallback, `storedText` on a stem, and `UNTITLED_LECTURE`. */
export const storedOutputCorpus = async (): Promise<
  readonly (readonly [Uint8Array, readonly SlideRecord[]])[]
> => [
  [PPTX, slidesOf(ingestPptx(deckFile(PPTX, 'Lecture_04-Kinetics.pptx')))],
  [PDF, slidesOf(await ingestPdf(deckFile(PDF, 'week4\\-Lecture__04 -  Kinetics.v2.pdf')))],
  [PDF, slidesOf(await ingestPdf(deckFile(PDF, 'week4/.pdf')))],
  [PDF, slidesOf(await ingestPdf(deckFile(PDF, 'Cafe\u0301_𝑘_rates.pdf')))],
];
