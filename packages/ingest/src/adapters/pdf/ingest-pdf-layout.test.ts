import { resolveCitations, SlideLineNo, slideLines } from '@cram/grounding';
import { CourseId, LectureId, SourceId } from '@cram/shared';
import { getDocumentProxy } from 'unpdf';
import { describe, expect, it } from 'vitest';
import { buildDeck, CALL_OUT_SLIDE, type FixtureDeck, type FixturePage } from './deck-fixture';
import { ingestPdf } from './ingest-pdf';
import { layOutPages, pageTextOf, type PdfPageText } from './page-layout';

const TITLE = 48;
const BODY = 28;
const FOOTER = 14;

const ingested = async (deck: FixtureDeck) => {
  const result = await ingestPdf({
    bytes: await buildDeck(deck),
    fileName: 'Lecture_04-Kinetics.pdf',
    courseId: CourseId.parse('course-a'),
    lectureId: LectureId.parse('lecture-4'),
  });
  if (result.status !== 'ingested')
    throw new Error(`expected an ingested deck, got ${result.status}`);
  return result.slides;
};

describe('ingestPdf on a slide laid out by position (#567)', () => {
  it("reads the issue's call-out slide into its own lines, with no footer or page number, so its last bullet quotes (#567)", async () => {
    const [record] = await ingested({ pages: [{ lines: CALL_OUT_SLIDE }] });
    if (record === undefined) throw new Error('expected one slide');
    const lines = slideLines(record);
    expect(lines).toEqual([
      'Lecture title',
      'term = short definition',
      'Heading:',
      '• First bullet.',
      '• Second bullet, wrapped onto a second line.',
      'in a call-out box',
      'Key:',
      'label',
      "Pronounced 'x'",
      '• Example: a sentence the tutor should be able to quote.',
    ]);
    const sourceId = SourceId.parse('lecture-4/1');
    const { resolved, withheld } = resolveCitations(
      [
        {
          kind: 'lecture-summary',
          text: 'The tutor should be able to quote a sentence.',
          citations: [
            {
              sourceId,
              line: SlideLineNo.parse(
                lines.indexOf('• Example: a sentence the tutor should be able to quote.') + 1,
              ),
            },
          ],
        },
      ],
      [{ sourceId, record }],
    );
    expect(withheld).toEqual([]);
    expect(resolved.map(({ unit }) => unit.citations)).toEqual([
      [{ sourceId, quote: '• Example: a sentence the tutor should be able to quote.' }],
    ]);
  });

  it('leaves a footer repeated across the deck out of every slide, wherever it sits in the lower half (#567)', async () => {
    const slide = (title: string, pageNo: number): FixturePage => ({
      lines: [
        { text: title, size: TITLE },
        { text: `• ${title} has a body line`, size: BODY },
        { text: '© Example College: Course, Year.', size: FOOTER, at: [300, 80], form: true },
        { text: String(pageNo), size: FOOTER, at: [900, 20] },
      ],
    });
    const slides = await ingested({
      pages: [slide('Rates', 1), slide('Orders', 2), slide('Mechanisms', 3)],
    });
    expect(slides.map(({ title, body }) => [title, body])).toEqual([
      ['Rates', '• Rates has a body line'],
      ['Orders', '• Orders has a body line'],
      ['Mechanisms', '• Mechanisms has a body line'],
    ]);
  });

  it('keeps a page holding only the footer as content, its footer still counted as text layer (#567)', async () => {
    const footer: FixturePage['lines'][number] = {
      text: '© Example College: Course name, Year 2026.',
      size: FOOTER,
      at: [300, 80],
      form: true,
    };
    const slides = await ingested({
      pages: [
        {
          lines: [
            { text: 'Rates', size: TITLE },
            { text: '• Rates has a body line', size: BODY },
            footer,
          ],
        },
        {
          lines: [
            { text: 'Orders', size: TITLE },
            { text: '• Orders has a body line', size: BODY },
            footer,
          ],
        },
        { lines: [footer] },
      ],
    });
    expect(slides.map(({ kind, title, body }) => [kind, title, body])).toEqual([
      ['content', 'Rates', '• Rates has a body line'],
      ['content', 'Orders', '• Orders has a body line'],
      ['content', '', ''],
    ]);
  });

  it('reads a large title over a small-font body as two lines (#356)', async () => {
    const [slide] = await ingested({
      pages: [
        {
          lines: [
            { text: "The guild's honey calendar", size: 40, at: [40, 480] },
            { text: 'In the first month the keeper walks the hives', size: 11, at: [40, 465] },
            { text: 'and counts the frames in each', size: 11, at: [40, 452] },
          ],
        },
      ],
    });
    expect(slide).toEqual(
      expect.objectContaining({
        title: "The guild's honey calendar",
        body: 'In the first month the keeper walks the hives\nand counts the frames in each',
      }),
    );
  });
});

const pdfjsPages = async (bytes: Uint8Array): Promise<PdfPageText[]> => {
  const pdf = await getDocumentProxy(bytes, { verbosity: 0 });
  try {
    return await Promise.all(
      Array.from({ length: pdf.numPages }, (_, index) => pageTextOf(pdf, index + 1)),
    );
  } finally {
    await pdf.loadingTask.destroy();
  }
};

describe('layOutPages over what pdf.js reads', () => {
  it("partitions out the issue's footer, drops its page number and gives each call-out and label its own line (#567)", async () => {
    const [laid] = layOutPages(
      await pdfjsPages(await buildDeck({ pages: [{ lines: CALL_OUT_SLIDE }] })),
    );
    expect(laid?.footer.map((line) => line.text)).toEqual([
      '© Example College: Course, Year. AB / CD.',
    ]);
    expect(laid?.lines.map((line) => line.text.trim()).filter((text) => text !== '')).toEqual([
      'Lecture title',
      'term = short definition',
      'Heading:',
      '• First bullet.',
      '• Second bullet, wrapped',
      'onto a second line.',
      '• Example: a sentence the tutor should be able to quote.',
      'in a call-out box',
      'Key:',
      'label',
      "Pronounced 'x'",
    ]);
  });
});
