import { createHash } from 'node:crypto';
import { CourseId, LectureId } from '@cram/shared';
import { strToU8 } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  alternateContent,
  bareShape,
  buildDeck,
  group,
  lineBreak,
  paragraphOf,
  picture,
  run,
  shape,
  slideNumberField,
  table,
  type FixtureDeck,
  type FixtureSlide,
} from './deck-fixture';
import { ingestPptx, type PptxIngestResult } from './ingest-pptx';

const ENOUGH = 'Rate laws relate rate to concentration';
const SLIDE_1 = 'ppt/slides/slide1.xml';

const ingest = (bytes: Uint8Array): PptxIngestResult =>
  ingestPptx({
    bytes,
    fileName: 'Lecture_04-Kinetics.pptx',
    courseId: CourseId.parse('course-a'),
    lectureId: LectureId.parse('lecture-4'),
  });

const ingested = (deck: FixtureDeck) => {
  const result = ingest(buildDeck(deck));
  if (result.status !== 'ingested')
    throw new Error(`expected an ingested deck, got ${result.status}: ${result.detail}`);
  return result.slides;
};

const records = (deck: FixtureDeck) => ingested(deck).map(({ record }) => record);

const titled = (title: string, ...body: string[]): FixtureSlide => ({
  shapes: [shape([title], 'title'), shape(body.length > 0 ? body : [ENOUGH], 'body')],
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ingestPptx', () => {
  it('reads each slide into a record with its title placeholder, body paragraphs and notes', () => {
    const slides = ingested({
      slides: [
        {
          shapes: [
            shape(['Reaction Kinetics'], 'ctrTitle'),
            shape(['Rates and orders of reaction'], 'subTitle'),
          ],
        },
        {
          shapes: [
            shape(['Rate laws'], 'title'),
            shape(['Rate depends on concentration', 'Orders are found by experiment'], 'body'),
          ],
          notes: ['Pause for questions.', 'Then the demo.'],
        },
      ],
    });
    expect(slides.map(({ kind, record }) => ({ kind, ...record }))).toEqual([
      expect.objectContaining({
        kind: 'content',
        slideNo: 1,
        lectureTitle: 'Reaction Kinetics',
        title: 'Reaction Kinetics',
        body: 'Rates and orders of reaction',
        speakerNotes: '',
        derived: false,
      }),
      expect.objectContaining({
        kind: 'content',
        slideNo: 2,
        lectureTitle: 'Reaction Kinetics',
        title: 'Rate laws',
        body: 'Rate depends on concentration\nOrders are found by experiment',
        speakerNotes: 'Pause for questions.\nThen the demo.',
      }),
    ]);
  });

  it("numbers slides in the presentation's order, not by part name", () => {
    const deck = { slides: [titled('First'), titled('Second'), titled('Third')] };
    const read = records({ ...deck, reversePartNames: true });
    expect(read.map(({ slideNo, title }) => [slideNo, title])).toEqual([
      [1, 'First'],
      [2, 'Second'],
      [3, 'Third'],
    ]);
  });

  it('keeps a hidden slide, so later slides keep their PowerPoint numbers', () => {
    const read = records({ slides: [titled('Shown'), { ...titled('Hidden'), hidden: true }] });
    expect(read.map(({ slideNo, title }) => [slideNo, title])).toEqual([
      [1, 'Shown'],
      [2, 'Hidden'],
    ]);
  });

  it.each(['sldNum', 'ftr', 'dt'] as const)('drops the %s placeholder', (placeholder) => {
    const [record] = records({
      slides: [{ shapes: [...titled('Rate laws').shapes, shape(['CH204 week 4'], placeholder)] }],
    });
    expect(record?.body).toBe(ENOUGH);
  });

  it('reads text in groups and table cells in document order', () => {
    const [record] = records({
      slides: [
        {
          shapes: [
            shape(['Rate laws'], 'title'),
            group(shape(['Grouped label one']), group(shape(['Nested label two']))),
            table([
              ['Order', 'Units of k'],
              ['first', 'per second'],
            ]),
          ],
        },
      ],
    });
    expect(record?.body).toBe(
      'Grouped label one\nNested label two\nOrder\nUnits of k\nfirst\nper second',
    );
  });

  it('reads alternate content once, from its choice', () => {
    const [record] = records({
      slides: [
        {
          shapes: [
            shape(['Rate laws'], 'title'),
            alternateContent(shape([ENOUGH]), shape(['Fallback copy of the same equation'])),
            alternateContent(shape(['Choice title'], 'title'), shape(['Fallback title'], 'title')),
          ],
        },
      ],
    });
    expect(record).toMatchObject({ title: 'Rate laws Choice title', body: ENOUGH });
  });

  it('joins runs and fields within a paragraph and reads a line break as a space', () => {
    const [record] = records({
      slides: [
        {
          shapes: [
            shape([paragraphOf(run('Rate'), lineBreak, run('laws'))], 'title'),
            shape([
              paragraphOf(run('See slide '), slideNumberField('7'), run(' for the derivation')),
            ]),
          ],
        },
      ],
    });
    expect(record).toMatchObject({ title: 'Rate laws', body: 'See slide 7 for the derivation' });
  });

  it('infers the title from explicit run sizes when the slide has no title placeholder', () => {
    const [record] = records({
      slides: [
        {
          shapes: [
            shape([paragraphOf(run(ENOUGH, '2400'))]),
            shape([paragraphOf(run('Kinetics', '4400'))]),
          ],
        },
      ],
    });
    expect(record).toMatchObject({ title: 'Kinetics', body: ENOUGH });
  });

  it('takes the first line as the title when every size is inherited or unreadable', () => {
    const [record] = records({
      slides: [{ shapes: [shape(['Worked examples']), shape([paragraphOf(run(ENOUGH, 'x'))])] }],
    });
    expect(record).toMatchObject({ title: 'Worked examples', body: ENOUGH });
  });

  it('keeps an empty title placeholder empty rather than promoting a body line', () => {
    const read = records({
      slides: [
        { shapes: [shape([''], 'title'), shape([ENOUGH], 'body')] },
        { shapes: [bareShape('title'), shape([ENOUGH], 'body')] },
      ],
    });
    expect(read.map(({ title, body }) => ({ title, body }))).toEqual([
      { title: '', body: ENOUGH },
      { title: '', body: ENOUGH },
    ]);
  });

  it('flags a picture-only slide as image-only, keeping its title', () => {
    const slides = ingested({
      slides: [titled('Kinetics'), { shapes: [shape(['Mechanism'], 'title'), picture] }],
    });
    expect(slides[1]).toMatchObject({
      kind: 'image-only',
      record: { title: 'Mechanism', body: '', imageCaptions: [] },
    });
  });

  it("reads notes from the notes slide's body placeholder alone", () => {
    const [record] = records({ slides: [{ ...titled('Rate laws'), notes: ['Say this.'] }] });
    expect(record?.speakerNotes).toBe('Say this.');
  });

  it('follows a notes relationship written as an absolute part name', () => {
    const [record] = records({
      slides: [{ ...titled('Rate laws'), notes: ['Say this.'], absoluteNotesTarget: true }],
    });
    expect(record?.speakerNotes).toBe('Say this.');
  });

  it('reads a slide with no relationships part as having no notes', () => {
    const [record] = records({
      slides: [titled('Rate laws')],
      parts: { 'ppt/slides/_rels/slide1.xml.rels': null },
    });
    expect(record).toMatchObject({ title: 'Rate laws', speakerNotes: '' });
  });

  it('reads the text of a deck whose media cannot be inflated', () => {
    expect(records({ slides: [titled('Rate laws')], unreadableMedia: true })).toHaveLength(1);
  });

  it('stamps every slide with the sha256 of the deck bytes and leaves the caller buffer intact', () => {
    const bytes = buildDeck({ slides: [titled('Kinetics'), titled('Rate laws')] });
    const digest = createHash('sha256').update(bytes).digest('hex');
    const result = ingest(bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);
    if (result.status !== 'ingested') throw new Error(result.status);
    expect(result.slides.map(({ record }) => record.sourceHash)).toEqual([digest, digest]);
  });

  it('makes no network request while reading a deck', () => {
    const refuse = vi.fn(() => {
      throw new Error('network request during ingest');
    });
    vi.stubGlobal('fetch', refuse);
    vi.stubGlobal('XMLHttpRequest', refuse);
    records({ slides: [{ ...titled('Kinetics'), notes: ['Note.'] }] });
    expect(refuse).not.toHaveBeenCalled();
  });
});

describe('ingestPptx unreadable decks', () => {
  const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const ole = (stream: string): Uint8Array =>
    new Uint8Array([...OLE, ...new Uint8Array(504), ...Buffer.from(stream, 'utf16le')]);

  const reasonOf = (bytes: Uint8Array) => {
    const result = ingest(bytes);
    if (result.status !== 'unreadable') throw new Error('expected an unreadable deck');
    expect(result.fileName).toBe('Lecture_04-Kinetics.pptx');
    expect(result.detail.trim()).not.toBe('');
    return result.reason;
  };

  it('reports bytes that are not a zip as not a pptx', () => {
    expect(reasonOf(new TextEncoder().encode('not a pptx'))).toBe('not-a-pptx');
  });

  it('reports a password-protected package as encrypted', () => {
    expect(reasonOf(ole('EncryptedPackage'))).toBe('encrypted');
  });

  it('reports an OLE file with no encrypted package as not a pptx', () => {
    expect(reasonOf(ole('PowerPoint Document'))).toBe('not-a-pptx');
  });

  it('reports a zip with no presentation part as not a pptx', () => {
    const deck = { slides: [titled('Rate laws')], parts: { 'ppt/presentation.xml': null } };
    expect(reasonOf(buildDeck(deck))).toBe('not-a-pptx');
  });

  it('reports a presentation outside the transitional namespace as not a pptx', () => {
    const strict = 'http://purl.oclc.org/ooxml/presentationml/main';
    const deck = { slides: [titled('Rate laws')], presentationNamespace: strict };
    expect(reasonOf(buildDeck(deck))).toBe('not-a-pptx');
  });

  it('reports a truncated zip as damaged', () => {
    const bytes = buildDeck({ slides: [titled('Rate laws')] });
    expect(reasonOf(bytes.slice(0, bytes.length / 2))).toBe('damaged');
  });

  it('reports a missing slide part as damaged', () => {
    expect(reasonOf(buildDeck({ slides: [titled('Rate laws')], parts: { [SLIDE_1]: null } }))).toBe(
      'damaged',
    );
  });

  it('reports a slide id with no relationship as damaged', () => {
    expect(reasonOf(buildDeck({ slides: [titled('Rate laws')], danglingSlideId: true }))).toBe(
      'damaged',
    );
  });

  it('reports a part that is not well-formed XML as damaged', () => {
    const deck = { slides: [titled('Rate laws')], parts: { [SLIDE_1]: '<p:sld><unclosed>' } };
    expect(reasonOf(buildDeck(deck))).toBe('damaged');
  });

  it('reports a part that is not UTF-8 as damaged', () => {
    const bytes = new Uint8Array([...strToU8('<?xml version="1.0"?><p:sld>'), 0xff]);
    expect(
      reasonOf(buildDeck({ slides: [titled('Rate laws')], parts: { [SLIDE_1]: bytes } })),
    ).toBe('damaged');
  });

  it('reports a relationship with no target as damaged', () => {
    const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="t"/></Relationships>`;
    const deck = {
      slides: [titled('Rate laws')],
      parts: { 'ppt/_rels/presentation.xml.rels': rels },
    };
    expect(reasonOf(buildDeck(deck))).toBe('damaged');
  });
});
