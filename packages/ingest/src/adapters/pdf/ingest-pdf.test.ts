import { createHash } from 'node:crypto';
import { CourseId, LectureId } from '@cram/shared';
import { getDocumentProxy } from 'unpdf';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDeck, type FixtureDeck, type FixtureLine } from './deck-fixture';
import { ingestPdf, type PdfIngestResult } from './ingest-pdf';

const TITLE = 48;
const BODY = 28;
const FOOTER = 14;

const line = (text: string, size = BODY): FixtureLine => ({ text, size });

const ingest = async (bytes: Uint8Array): Promise<PdfIngestResult> =>
  ingestPdf({
    bytes,
    fileName: 'Lecture_04-Kinetics.pdf',
    courseId: CourseId.parse('course-a'),
    lectureId: LectureId.parse('lecture-4'),
  });

const ingested = async (deck: FixtureDeck) => {
  const result = await ingest(await buildDeck(deck));
  if (result.status !== 'ingested')
    throw new Error(`expected an ingested deck, got ${result.status}`);
  return result.slides;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ingestPdf', () => {
  it('reads each page into a slide with its title, bullets and notes, dropping the page number', async () => {
    const slides = await ingested({
      metadataTitle: 'A different lecture',
      pages: [
        {
          lines: [
            line('Reaction Kinetics', TITLE),
            line('Rates and orders of reaction'),
            line('1', FOOTER),
          ],
        },
        {
          lines: [
            line('Rate laws', TITLE),
            line('•'),
            line('Rate depends on concentration'),
            line('• Orders are found by experiment'),
            line('2', FOOTER),
          ],
          annotations: [
            { subtype: 'Text', contents: 'Pause for questions.' },
            { subtype: 'Link', contents: 'Course page' },
            { subtype: 'Text', contents: 'Then the demo.' },
          ],
        },
      ],
    });
    expect(slides).toEqual([
      expect.objectContaining({
        kind: 'content',
        slideNo: 1,
        lectureTitle: 'Reaction Kinetics',
        title: 'Reaction Kinetics',
        body: 'Rates and orders of reaction',
        speakerNotes: '',
      }),
      expect.objectContaining({
        kind: 'content',
        slideNo: 2,
        lectureTitle: 'Reaction Kinetics',
        title: 'Rate laws',
        body: '• Rate depends on concentration\n• Orders are found by experiment',
        speakerNotes: 'Pause for questions.\nThen the demo.',
      }),
    ]);
  });

  it('stores a text layer in math italic as the plain letters a PPTX equation stores (#194)', async () => {
    const deck: FixtureDeck = {
      pages: [
        {
          lines: [
            line('Rest energy', TITLE),
            line('The rest energy of a body is'),
            { text: 'E=mc', size: BODY, mathItalic: true },
          ],
        },
      ],
    };
    const bytes = await buildDeck(deck);
    const pdf = await getDocumentProxy(bytes.slice(), { verbosity: 0 });
    const { items } = await (await pdf.getPage(1)).getTextContent();
    await pdf.loadingTask.destroy();
    expect(items.map((item) => ('str' in item ? item.str : ''))).toContain('𝐸=𝑚𝑐');
    const [slide] = await ingested(deck);
    expect(slide?.body).toBe('The rest energy of a body is\nE=mc');
  });

  it('stores pointed Hebrew drawn in presentation forms in logical order, each pdf.js item on its own (#283)', async () => {
    const [slide] = await ingested({
      pages: [
        {
          lines: [
            line('Pointed Hebrew', TITLE),
            { text: '\u05e8\u05e7\ufb4b\ufb31', size: BODY, toUnicode: true },
            { text: '\u05d4\ufb2a\u05dc\u05d5\u05dd', size: BODY, toUnicode: true },
            { text: 'abc\t\u05e8\u05e7\ufb4b\ufb31', size: BODY, toUnicode: true },
          ],
        },
      ],
    });
    expect(slide?.body).toBe(
      '\u05d1\u05bc\u05d5\u05b9\u05e7\u05e8\n\u05dd\u05d5\u05dc\u05e9\u05c1\u05d4\nabc \u05d1\u05bc\u05d5\u05b9\u05e7\u05e8',
    );
  });

  it('flags a page with no text layer as image-only', async () => {
    const slides = await ingested({
      pages: [
        { lines: [line('Kinetics', TITLE), line(`Rates and orders of reaction`)] },
        { lines: [] },
      ],
    });
    expect(slides[1]).toMatchObject({
      kind: 'image-only',
      title: '',
      body: '',
      derived: false,
    });
  });

  it("sizes a line by its own glyphs, not the next line's", async () => {
    const [slide] = await ingested({
      pages: [{ lines: [line('Rates and orders of reaction'), line('Kinetics', TITLE)] }],
    });
    expect(slide).toMatchObject({
      title: 'Kinetics',
      body: 'Rates and orders of reaction',
    });
  });

  it('reads a line drawn through a scaled matrix at body size as body size', async () => {
    const [slide] = await ingested({
      pages: [
        {
          lines: [
            line('Worked examples:'),
            { text: 'First order decays', size: BODY, scaled: true },
            line('Second order needs both reactants'),
          ],
        },
      ],
    });
    expect(slide?.title).toBe('Worked examples:');
  });

  it('stamps every slide with the sha256 of the deck bytes and leaves the caller buffer intact', async () => {
    const bytes = await buildDeck({ pages: [{ lines: [line('Kinetics', TITLE)] }, { lines: [] }] });
    const digest = createHash('sha256').update(bytes).digest('hex');
    const result = await ingest(bytes);
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);
    if (result.status !== 'ingested') throw new Error(result.status);
    expect(result.slides.map(({ sourceHash }) => sourceHash)).toEqual([digest, digest]);
  });

  it('reports bytes that are not a PDF as unreadable', async () => {
    const result = await ingest(new TextEncoder().encode('not a pdf'));
    expect(result).toMatchObject({
      status: 'unreadable',
      fileName: 'Lecture_04-Kinetics.pdf',
      reason: 'not-a-pdf',
    });
    expect(result.status === 'unreadable' && result.detail.trim() !== '').toBe(true);
  });

  it('reports a password-protected PDF as unreadable', async () => {
    const result = await ingest(await buildDeck({ pages: [{ lines: [] }], encrypted: 'password' }));
    expect(result).toMatchObject({ status: 'unreadable', reason: 'encrypted' });
  });

  it.each([
    ['kid-not-a-reference', 'Page dictionary kid reference points to wrong type of object.'],
    ['kids-not-an-array', 'Page dictionary kids object is not an array.'],
    ['circular', 'Pages tree contains circular reference.'],
  ] as const)('reports a page tree broken as %s as damaged', async (brokenPageTree, detail) => {
    const pages = [{ lines: [line('Kinetics', TITLE)] }, { lines: [line('Rate laws', TITLE)] }];
    const result = await ingest(await buildDeck({ pages, brokenPageTree }));
    expect(result).toEqual({
      status: 'unreadable',
      fileName: 'Lecture_04-Kinetics.pdf',
      reason: 'damaged',
      detail,
    });
  });

  it.each([
    ['algorithm-3', 'unsupported encryption algorithm'],
    ['custom-handler', 'unknown encryption method'],
  ] as const)(
    'reports an encryption pdf.js cannot open (%s) as a limit of this reader, not of the deck',
    async (encrypted, detail) => {
      const result = await ingest(await buildDeck({ pages: [{ lines: [] }], encrypted }));
      expect(result).toMatchObject({ status: 'unreadable', reason: 'reader-limit', detail });
    },
  );

  it.each([
    ['a Buffer', (bytes: Uint8Array): Uint8Array => Buffer.from(bytes)],
    [
      'a Buffer view between two other decks',
      (bytes: Uint8Array, decoy: Uint8Array): Uint8Array =>
        Buffer.concat([decoy, bytes, decoy]).subarray(decoy.length, decoy.length + bytes.length),
    ],
  ])('reads a deck handed over as %s like its plain bytes', async (_, view) => {
    const bytes = await buildDeck({ pages: [{ lines: [line('Kinetics', TITLE)] }] });
    const decoy = await buildDeck({
      pages: [{ lines: [line('Decoy', TITLE)] }, { lines: [line('Decoy', TITLE)] }],
    });
    expect(await ingest(view(bytes, decoy))).toEqual(await ingest(bytes));
  });

  it('reads an annotation with no subtype as no speaker note', async () => {
    const [slide] = await ingested({
      pages: [
        {
          lines: [line('Kinetics', TITLE), line('Rates and orders of reaction')],
          annotations: [{ contents: 'Not a note' }, { subtype: 'Text', contents: 'A note' }],
        },
      ],
    });
    expect(slide?.speakerNotes).toBe('A note');
  });

  it('makes no network request while reading a deck', async () => {
    const refuse = vi.fn(() => {
      throw new Error('network request during ingest');
    });
    vi.stubGlobal('fetch', refuse);
    vi.stubGlobal('XMLHttpRequest', refuse);
    await ingested({
      pages: [
        {
          lines: [line('Kinetics', TITLE), line('Rates and orders of reaction')],
          annotations: [{ subtype: 'Text', contents: 'Note.' }],
        },
      ],
    });
    expect(refuse).not.toHaveBeenCalled();
  });
});
