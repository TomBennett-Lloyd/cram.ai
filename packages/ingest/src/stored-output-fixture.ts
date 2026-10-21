import { CourseId, LectureId, type SlideRecord } from '@cram/shared';
import type { DeckFile, IngestResult } from './adapters/deck-file';
import { buildDeck as buildPdf, type FixtureLine } from './adapters/pdf/deck-fixture';
import { ingestPdf } from './adapters/pdf/ingest-pdf';
import {
  alternateContent,
  bareShape,
  buildDeck as buildPptx,
  equation,
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
import { BULLET_MARKERS } from './slide-text';

const r = (text: string): string => `<m:r><m:t>${text}</m:t></m:r>`;
const m = (name: string, ...content: readonly string[]): string =>
  `<m:${name}>${content.join('')}</m:${name}>`;
const e = (...content: readonly string[]): string => m('e', ...content);
/** A construct with its `m:<name>Pr` properties, each `[property, val]`. */
const construct = (
  name: string,
  properties: readonly (readonly [string, string])[],
  ...args: readonly string[]
): string =>
  `<m:${name}><m:${name}Pr>${properties.map(([property, val]) => `<m:${property} m:val="${val}"/>`).join('')}</m:${name}Pr>${args.join('')}</m:${name}>`;

/** `E=mc^2+â` as PowerPoint writes it: math italic letters, and the accent as a combining character. */
const MASS_ENERGY = equation(
  m(
    'oMath',
    ...['𝐸', '=', '𝑚'].map(r),
    construct('sSup', [], e(r('𝑐')), m('sup', r('2'))),
    r('+'),
    construct('acc', [['chr', '̂']], e(r('𝑎'))),
  ),
);

/** Every construct `linearOmml` reads, each with its default properties and, where it has one, another. */
const EVERY_CONSTRUCT = equation(
  m(
    'oMathPara',
    m(
      'oMath',
      construct('f', [], m('num', r('a')), m('den', r('b+c'))),
      construct('f', [['type', 'noBar']], m('num', r('n')), m('den', r('k'))),
      construct('f', [['type', 'skw']], m('num', r('p')), m('den', r('q'))),
      construct('f', [['type', 'lin']], m('num', r('s')), m('den', r('t'))),
      construct('sSub', [], e(r('x')), m('sub', r('i'))),
      construct('sSubSup', [], e(r('x')), m('sub', r('i')), m('sup', r('2'))),
      construct('sPre', [], m('sub', r('a')), m('sup', r('b')), e(r('C'))),
      construct('sSup', [], e(r('y')), m('sup')),
      construct('sSup', [], e(r('x')), m('sup', r('*'))),
    ),
    m(
      'oMath',
      construct('rad', [], m('deg'), e(r('x'))),
      construct('rad', [], m('deg', r('3')), e(r('x'))),
      construct('nary', [], m('sub', r('0')), m('sup', r('1')), e(r('f'))),
      construct('nary', [['chr', '∑']], m('sub', r('k')), m('sup'), e(r('k'))),
      construct('d', [], e(r('a')), e(r('b'))),
      construct(
        'd',
        [
          ['begChr', '{'],
          ['endChr', ''],
        ],
        e(r('one-sided')),
      ),
      construct(
        'd',
        [
          ['begChr', '['],
          ['sepChr', ','],
          ['endChr', ']'],
        ],
        e(r('p')),
        e(r('q')),
      ),
      construct('sSup', [], e(construct('d', [], e(r('u+v')))), m('sup', r('2'))),
      construct('sSup', [], e(r('u+v')), m('sup', r('ab'))),
    ),
    m(
      'oMath',
      construct('func', [], m('fName', r('sin')), e(r('θ'))),
      construct('limLow', [], e(r('lim')), m('lim', r('n→∞'))),
      construct('limUpp', [], e(r('X')), m('lim', r('T'))),
      construct('acc', [], e(r('o'))),
      construct('acc', [['chr', '\u0303']], e(r('n'))),
      construct('bar', [], e(r('z'))),
      construct('bar', [['pos', 'top']], e(r('w'))),
      construct('groupChr', [], e(r('g'))),
      construct('groupChr', [['chr', '\u23DE']], e(r('h'))),
      construct('m', [], m('mr', e(r('1')), e(r('2'))), m('mr', e(r('3')), e(r('4')))),
      construct('eqArr', [], e(r('s=1')), e(r('t=2'))),
      construct('phant', [['show', 'off']], e(r('hidden'))),
      construct('phant', [['show', 'false']], e(r('hidden'))),
      construct('phant', [['show', '0']], e(r('hidden'))),
      construct('phant', [], e(r('shown'))),
      m('box', r('B')),
      m('borderBox', r('D')),
    ),
  ),
);

/** Characters from pdf.js's `normalizeUnicode` set, as a deck writes them: micro sign, ligatures, ohm sign (#256). */
const PDFJS_FOLDED_LINE = 'Cells are 5 \u00B5m across, \uFB01ne \uFB02ow, \uFB05 and 10 k\u2126';

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
