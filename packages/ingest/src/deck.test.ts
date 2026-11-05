import { CourseId, LectureId, SourceHash } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { BOILERPLATE_MIN_PAGES, slidesFromPages, UNTITLED_LECTURE, type DeckSource } from './deck';
import type { PageText, TextLine } from './page-text';

const source = (fileName = 'Lecture_04-Kinetics.pdf'): DeckSource => ({
  courseId: CourseId.parse('course-a'),
  lectureId: LectureId.parse('lecture-4'),
  fileName,
  sourceHash: SourceHash.parse('hash-4'),
});

const titled = (title: string, notes = ''): PageText => ({
  lines: [
    { text: title, size: 48 },
    { text: 'Rate laws relate rate to concentration', size: 28 },
  ],
  notes,
});
const blank: PageText = { lines: [], notes: '' };

describe('slidesFromPages', () => {
  it('ingests an empty deck as no slides', () => {
    expect(slidesFromPages([], source())).toEqual([]);
  });

  it('numbers slides from one in page order and stamps the deck on each', () => {
    const slides = slidesFromPages([titled('Kinetics'), titled('Rate laws')], source());
    expect(slides.map((record) => [record.slideNo, record.title])).toEqual([
      [1, 'Kinetics'],
      [2, 'Rate laws'],
    ]);
    for (const record of slides) {
      expect(record).toMatchObject({
        courseId: 'course-a',
        lectureId: 'lecture-4',
        lectureTitle: 'Kinetics',
        imageCaptions: [],
        derived: false,
        sourceHash: 'hash-4',
      });
    }
  });

  it('carries the page kind on its record', () => {
    expect(slidesFromPages([titled('Kinetics'), blank], source()).map(({ kind }) => kind)).toEqual([
      'content',
      'image-only',
    ]);
  });

  it('carries speaker notes, trimmed', () => {
    const [slide] = slidesFromPages([titled('Kinetics', '  Say this.\n')], source());
    expect(slide?.speakerNotes).toBe('Say this.');
  });

  it('stores every text of every page as storedText gives it, whichever adapter read it (#194)', () => {
    const [marked, inferred] = slidesFromPages(
      [
        {
          markedTitle: 'Energy 𝐸',
          lines: [{ text: 'Rest energy is 𝐸=𝑚𝑐^2 for a body at rest', size: 28 }],
          notes: 'Derive 𝑎\u0302.',
        },
        {
          lines: [
            { text: 'Cafe\u0301 kinetics', size: 48 },
            { text: 'Rate laws relate rate to 𝑘', size: 28 },
          ],
          notes: '',
        },
      ],
      source(),
    );
    expect(marked).toMatchObject({
      title: 'Energy E',
      body: 'Rest energy is E=mc^2 for a body at rest',
      speakerNotes: 'Derive \u00E2.',
    });
    expect(inferred).toMatchObject({
      title: 'Caf\u00E9 kinetics',
      body: 'Rate laws relate rate to k',
    });
  });

  it('takes the lecture title from the filename when the first page has none', () => {
    const [slide] = slidesFromPages(
      [blank, titled('Rate laws')],
      source('decks/Lecture_04-Kinetics.pdf'),
    );
    expect(slide?.lectureTitle).toBe('Lecture 04 Kinetics');
  });

  it('stores the filename lecture title as storedText gives it (#254)', () => {
    const [slide] = slidesFromPages([blank], source('Cafe\u0301_𝑘_rates.pdf'));
    expect(slide?.lectureTitle).toBe('Caf\u00E9 k rates');
  });

  it('takes a stored title verbatim over the filename when the first page has none (#299)', () => {
    const stored = { ...source('decks/Lecture_04-Kinetics.pdf'), storedTitle: 'Cells/Tissues_1-2' };
    expect(slidesFromPages([blank], stored)[0]?.lectureTitle).toBe('Cells/Tissues_1-2');
    expect(slidesFromPages([titled('Kinetics')], stored)[0]?.lectureTitle).toBe('Kinetics');
    expect(slidesFromPages([blank], { ...stored, storedTitle: '' })[0]?.lectureTitle).toBe(
      UNTITLED_LECTURE,
    );
  });

  it('falls back to a fixed lecture title when neither page nor filename has one', () => {
    const [slide] = slidesFromPages([blank], source('.pdf'));
    expect(slide?.lectureTitle).toBe(UNTITLED_LECTURE);
  });
});

describe('slidesFromPages boilerplate (#641)', () => {
  const COURSE = 'CHEM 101 Physical Chemistry, Example College';
  const slide = (title: string, ...body: (string | TextLine)[]): PageText => ({
    lines: [
      { text: title, size: 48 },
      ...body.map((line) => (typeof line === 'string' ? { text: line, size: 28 } : line)),
    ],
    notes: '',
  });
  const bodies = (pages: readonly PageText[]): string[] =>
    slidesFromPages(pages, source()).map(({ body }) => body);

  it('drops a line on every page with text from every body, at any position and size', () => {
    expect(
      bodies([
        slide('Rates', COURSE, '• Rate laws relate rate to concentration'),
        slide('Orders', '• An order is an exponent of a concentration', COURSE),
        slide('Mechanisms', '• A mechanism is a sequence of steps', { text: COURSE, size: 14 }),
      ]),
    ).toEqual([
      '• Rate laws relate rate to concentration',
      '• An order is an exponent of a concentration',
      '• A mechanism is a sequence of steps',
    ]);
  });

  it(`needs ${String(BOILERPLATE_MIN_PAGES)} pages with text; a blank page neither counts nor switches it off`, () => {
    const RATES = '• Rate laws relate rate to concentration';
    const ORDERS = '• An order is an exponent of a concentration';
    const rates = slide('Rates', COURSE, RATES);
    const orders = slide('Orders', COURSE, ORDERS);
    const steps = slide('Steps', COURSE, '• A step is one collision');
    expect(bodies([rates, orders, blank])).toEqual([
      `${COURSE}\n${RATES}`,
      `${COURSE}\n${ORDERS}`,
      '',
    ]);
    expect(bodies([rates, blank, orders, steps])).toEqual([
      RATES,
      '',
      ORDERS,
      '• A step is one collision',
    ]);
  });

  it("keeps every step of one slide's builds, whose title is on every page", () => {
    const steps = ['• Step one forms the intermediate', '• Step two consumes it', '• Step three'];
    const builds = [1, 2, 3].map((n) => slide('Mechanisms', ...steps.slice(0, n)));
    expect(bodies(builds)).toEqual([steps[0], steps.slice(0, 2).join('\n'), steps.join('\n')]);
    expect(bodies([...builds, slide('Rates', '• Rate laws relate rate to concentration')])[0]).toBe(
      steps[0],
    );
  });

  it('drops a line under two titles, written with other spacing or split from its bullet marker', () => {
    const line = '• Exam: Friday, Example Hall';
    expect(
      bodies([
        slide('Rates', line, '• Rate laws relate rate to concentration'),
        slide('Rates', `  ${line.replace(' ', '   ')} `, '• Rate constants rise with temperature'),
        slide('Orders', '•', line.slice(2), '• An order is an exponent of a concentration'),
      ]),
    ).toEqual([
      '• Rate laws relate rate to concentration',
      '• Rate constants rise with temperature',
      '• An order is an exponent of a concentration',
    ]);
  });

  it("keeps the steps of one slide's builds beside a blank page, which has no title to count", () => {
    const steps = ['• Step one forms the intermediate', '• Step two consumes it', '• Step three'];
    const builds = [1, 2, 3].map((n) => slide('Mechanisms', ...steps.slice(0, n)));
    expect(bodies([...builds, blank])[0]).toBe(steps[0]);
  });

  it('keeps a line that one page with text lacks, or carries in another case', () => {
    const deck = (last: string): PageText[] => [
      slide('Rates', COURSE, '• Rate laws relate rate to concentration'),
      slide('Orders', COURSE, '• An order is an exponent of a concentration'),
      slide('Steps', last, '• A step is one collision'),
    ];
    const kept = `${COURSE}\n• Rate laws relate rate to concentration`;
    expect(bodies(deck('A second line'))[0]).toBe(kept);
    expect(bodies(deck(COURSE.toLowerCase()))[0]).toBe(kept);
  });

  it("keeps a line where it is the page's title, and drops it from the others", () => {
    const slides = slidesFromPages(
      [
        slide('Kinetics', '• Lecture 4 of the course'),
        slide('Rates', 'Kinetics', '• Rate laws relate rate to concentration'),
        slide('Orders', 'Kinetics', '• An order is an exponent of a concentration'),
      ],
      source(),
    );
    expect(slides.map(({ title, body }) => [title, body])).toEqual([
      ['Kinetics', '• Lecture 4 of the course'],
      ['Rates', '• Rate laws relate rate to concentration'],
      ['Orders', '• An order is an exponent of a concentration'],
    ]);
  });

  it('drops a line on every page under a marked title too', () => {
    const marked = (title: string, line: string): PageText => ({
      markedTitle: title,
      lines: [
        { text: line, size: 28 },
        { text: COURSE, size: 14 },
      ],
      notes: '',
    });
    expect(
      bodies([
        marked('Rates', '• Rate laws relate rate to concentration'),
        marked('Orders', '• An order is an exponent of a concentration'),
        marked('Steps', '• A step is one collision'),
      ]),
    ).toEqual([
      '• Rate laws relate rate to concentration',
      '• An order is an exponent of a concentration',
      '• A step is one collision',
    ]);
  });

  it('reads a page left with its title and boilerplate as image-only', () => {
    const slides = slidesFromPages(
      [
        slide('Rates', '• Rate laws relate rate to concentration', COURSE),
        slide('Orders', '• An order is an exponent of a concentration', COURSE),
        slide('Diagram', COURSE),
      ],
      source(),
    );
    expect(slides.map(({ kind, body }) => [kind, body])).toEqual([
      ['content', '• Rate laws relate rate to concentration'],
      ['content', '• An order is an exponent of a concentration'],
      ['image-only', ''],
    ]);
  });
});
