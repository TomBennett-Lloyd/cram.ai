import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  alternateContent,
  bareShape,
  BODY_TEXT as ENOUGH,
  buildDeck,
  deckFile,
  group,
  lineBreak,
  paragraphOf,
  picture,
  run,
  shape,
  slideNumberField,
  table,
  titledSlide as titled,
  ingestedSlides as ingested,
} from './deck-fixture';
import { ingestPptx } from './ingest-pptx';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ingestPptx', () => {
  it('reads each slide into a record with its title placeholder, body paragraphs and notes', () => {
    const slides = ingested({
      slides: [
        {
          shapes: [
            shape(['Rates and orders of reaction'], 'subTitle'),
            shape(['Reaction Kinetics'], 'ctrTitle'),
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
    expect(slides).toEqual([
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
    const read = ingested({ ...deck, reversePartNames: true });
    expect(read.map(({ slideNo, title }) => [slideNo, title])).toEqual([
      [1, 'First'],
      [2, 'Second'],
      [3, 'Third'],
    ]);
  });

  it('keeps a hidden slide, so later slides keep their PowerPoint numbers', () => {
    const read = ingested({ slides: [titled('Shown'), { ...titled('Hidden'), hidden: true }] });
    expect(read.map(({ slideNo, title }) => [slideNo, title])).toEqual([
      [1, 'Shown'],
      [2, 'Hidden'],
    ]);
  });

  it.each(['sldNum', 'ftr', 'dt'] as const)('drops the %s placeholder', (placeholder) => {
    const [record] = ingested({
      slides: [{ shapes: [...titled('Rate laws').shapes, shape(['CH204 week 4'], placeholder)] }],
    });
    expect(record?.body).toBe(ENOUGH);
  });

  it('reads text in groups and table cells in document order', () => {
    const [record] = ingested({
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
    const [record] = ingested({
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

  it('skips only the markup-compatibility fallback, not an element of that name elsewhere', () => {
    const [record] = ingested({
      slides: [
        {
          shapes: [
            shape(['Rate laws'], 'title'),
            `<x:Fallback xmlns:x="urn:example:other">${shape([ENOUGH])}</x:Fallback>`,
          ],
        },
      ],
    });
    expect(record?.body).toBe(ENOUGH);
  });

  it('takes no title from a title placeholder that only fallback content holds', () => {
    const [record] = ingested({
      slides: [
        {
          shapes: [
            shape(['Worked examples']),
            alternateContent(shape([ENOUGH]), shape(['Fallback title'], 'title')),
          ],
        },
      ],
    });
    expect(record).toMatchObject({ title: 'Worked examples', body: ENOUGH });
  });

  it('joins runs and fields within a paragraph and reads a line break as a space', () => {
    const [record] = ingested({
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
    const [record] = ingested({
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

  it('takes the first line as the title when every size is inherited', () => {
    const [record] = ingested({
      slides: [{ shapes: [shape(['Worked examples']), shape([ENOUGH])] }],
    });
    expect(record).toMatchObject({ title: 'Worked examples', body: ENOUGH });
  });

  it('reads a run with no properties and one with properties but no size as the same size', () => {
    const sizeless = paragraphOf(
      '<a:r><a:rPr lang="en-GB" b="1"/><a:t>Second line here</a:t></a:r>',
    );
    const [record] = ingested({
      slides: [{ shapes: [shape(['Worked examples', sizeless, ENOUGH])] }],
    });
    expect(record?.title).toBe('Worked examples');
  });

  it('reads an unreadable run size as inherited', () => {
    const [record] = ingested({
      slides: [
        {
          shapes: [
            shape([paragraphOf(run(ENOUGH, 'x'))]),
            shape([paragraphOf(run('Kinetics', '4400'))]),
          ],
        },
      ],
    });
    expect(record).toMatchObject({ title: 'Kinetics', body: ENOUGH });
  });

  it('keeps an empty title placeholder empty rather than promoting a body line', () => {
    const read = ingested({
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
      title: 'Mechanism',
      body: '',
      imageCaptions: [],
    });
  });

  it("reads notes from the notes slide's body placeholder alone", () => {
    const [record] = ingested({ slides: [{ ...titled('Rate laws'), notes: ['Say this.'] }] });
    expect(record?.speakerNotes).toBe('Say this.');
  });

  it('follows a notes relationship written as an absolute part name', () => {
    const [record] = ingested({
      slides: [{ ...titled('Rate laws'), notes: ['Say this.'], absoluteNotesTarget: true }],
    });
    expect(record?.speakerNotes).toBe('Say this.');
  });

  it('reads a slide with no relationships part as having no notes', () => {
    const [record] = ingested({
      slides: [titled('Rate laws')],
      parts: { 'ppt/slides/_rels/slide1.xml.rels': null },
    });
    expect(record).toMatchObject({ title: 'Rate laws', speakerNotes: '' });
  });

  it.each(['ppt/media/image1.png', 'ppt/media/image1.xml.jpeg'])(
    'reads the text of a deck whose %s cannot be inflated',
    (uninflatable) => {
      expect(ingested({ slides: [titled('Rate laws')], uninflatable })).toHaveLength(1);
    },
  );

  it('stamps every slide with the sha256 of the deck bytes and leaves the caller buffer intact', () => {
    const bytes = buildDeck({ slides: [titled('Kinetics'), titled('Rate laws')] });
    const digest = createHash('sha256').update(bytes).digest('hex');
    const result = ingestPptx(deckFile(bytes));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);
    if (result.status !== 'ingested') throw new Error(result.status);
    expect(result.slides.map(({ sourceHash }) => sourceHash)).toEqual([digest, digest]);
  });

  it('makes no network request while reading a deck', () => {
    const refuse = vi.fn(() => {
      throw new Error('network request during ingest');
    });
    vi.stubGlobal('fetch', refuse);
    vi.stubGlobal('XMLHttpRequest', refuse);
    ingested({ slides: [{ ...titled('Kinetics'), notes: ['Note.'] }] });
    expect(refuse).not.toHaveBeenCalled();
  });
});
