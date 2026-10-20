import { SlideNo } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import type { PageText, TextLine } from './page-text';
import { slideText as readSlide, THIN_TEXT_LAYER_WORDS, type SlideText } from './slide-text';

const TITLE = 48;
const BODY = 28;
const FOOTER = 14;

const line = (text: string, size = BODY): TextLine => ({ text, size });
const page = (...lines: TextLine[]): PageText => ({ lines, notes: '' });

const slideText = (page: PageText, slideNo: number): SlideText =>
  readSlide(page, SlideNo.parse(slideNo));

const ENOUGH = 'Rate laws relate rate to concentration';

describe('slideText title', () => {
  it('takes the largest line when it is larger than the body text', () => {
    const text = slideText(page(line(ENOUGH), line('Reaction Kinetics', TITLE)), 3);
    expect(text.title).toBe('Reaction Kinetics');
    expect(text.body).toBe(ENOUGH);
  });

  it('joins a title that wraps onto consecutive lines at the same size', () => {
    const text = slideText(page(line('Reaction', TITLE), line('Kinetics', TITLE), line(ENOUGH)), 3);
    expect(text.title).toBe('Reaction Kinetics');
    expect(text.body).toBe(ENOUGH);
  });

  it('keeps a later line at the title size in the body', () => {
    const text = slideText(page(line('Reaction', TITLE), line(ENOUGH), line('Aside', TITLE)), 3);
    expect(text.title).toBe('Reaction');
    expect(text.body).toBe(`${ENOUGH}\nAside`);
  });

  it('takes the first line when no line is larger than the body text', () => {
    const text = slideText(page(line('Worked examples:'), line(ENOUGH)), 3);
    expect(text.title).toBe('Worked examples:');
    expect(text.body).toBe(ENOUGH);
  });

  it('gives the largest line the title when sizes tie on characters', () => {
    const text = slideText(
      page(line('Unit CH204', 20), line('Rate laws today', TITLE), line('Four words here')),
      3,
    );
    expect(text.title).toBe('Rate laws today');
  });

  it('never takes a digit-only line as the title', () => {
    expect(slideText(page(line('2024', TITLE), line(ENOUGH)), 3).title).toBe('');
    expect(slideText(page(line('2024'), line(ENOUGH)), 3).title).toBe('');
  });

  it('never takes a bullet as the title', () => {
    expect(slideText(page(line(`• ${ENOUGH}`)), 3).title).toBe('');
  });
});

describe('slideText marked title', () => {
  const marked = (markedTitle: string, ...lines: TextLine[]): PageText => ({
    markedTitle,
    lines,
    notes: '',
  });

  it('takes the marked title and keeps every line in the body, whatever its size', () => {
    const text = slideText(marked('Rate laws', line(ENOUGH), line('Aside', TITLE)), 3);
    expect(text).toEqual({ kind: 'content', title: 'Rate laws', body: `${ENOUGH}\nAside` });
  });

  it('keeps an empty marked title empty rather than promoting the first line', () => {
    expect(slideText(marked('', line(ENOUGH)), 3)).toMatchObject({ title: '', body: ENOUGH });
  });

  it('collapses whitespace inside the marked title', () => {
    expect(slideText(marked('  Rate \n laws ', line(ENOUGH)), 3).title).toBe('Rate laws');
  });

  it("counts the marked title's words toward the text layer", () => {
    const title = Array.from({ length: THIN_TEXT_LAYER_WORDS - 1 }, () => 'label').join(' ');
    expect(slideText(marked(title, line('one')), 3).kind).toBe('content');
    expect(slideText(marked(title), 3)).toEqual({ kind: 'image-only', title, body: '' });
  });

  it('classifies a references page by its marked title', () => {
    expect(slideText(marked('References', line(ENOUGH)), 40).kind).toBe('references');
  });
});

describe('slideText page numbers', () => {
  it('drops a digit-only line equal to the slide number', () => {
    const text = slideText(page(line('7', FOOTER), line('Kinetics', TITLE), line(ENOUGH)), 7);
    expect(text.title).toBe('Kinetics');
    expect(text.body).toBe(ENOUGH);
  });

  it('keeps a digit-only line that is not the slide number', () => {
    expect(
      slideText(page(line('Kinetics', TITLE), line(ENOUGH), line('42'), line('7.0')), 7).body,
    ).toBe(`${ENOUGH}\n42\n7.0`);
  });
});

describe('slideText bullets', () => {
  it('joins a lone bullet marker to the line after it', () => {
    const text = slideText(page(line('Kinetics', TITLE), line('•'), line(ENOUGH)), 3);
    expect(text.body).toBe(`• ${ENOUGH}`);
  });

  it('reads a marker with no space after it as text, so a negative number stays one', () => {
    const text = slideText(
      page(line('Cell potentials', TITLE), line('–0.76 V for zinc'), line('+0.34 V for copper')),
      3,
    );
    expect(text.body).toBe('–0.76 V for zinc\n+0.34 V for copper');
  });

  it('drops a lone bullet marker with no line after it', () => {
    expect(slideText(page(line('Kinetics', TITLE), line(ENOUGH), line('•')), 3).body).toBe(ENOUGH);
  });

  it('keeps a wrapped bullet on one line, one bullet per line', () => {
    const text = slideText(
      page(
        line('Kinetics', TITLE),
        line('•  First order'),
        line('decays exponentially'),
        line('– Second order'),
      ),
      3,
    );
    expect(text.body).toBe('• First order decays exponentially\n– Second order');
  });

  it('keeps plain lines before the first bullet on their own lines', () => {
    const text = slideText(
      page(line('Kinetics', TITLE), line('Two cases.'), line('Both matter.'), line(`• ${ENOUGH}`)),
      3,
    );
    expect(text.body).toBe(`Two cases.\nBoth matter.\n• ${ENOUGH}`);
  });

  it('collapses whitespace inside a line and drops blank lines', () => {
    const text = slideText(
      page(
        line('  Kinetics ', TITLE),
        line('   '),
        line(`Rate   laws\trelate rate to concentration`),
      ),
      3,
    );
    expect(text).toEqual({ kind: 'content', title: 'Kinetics', body: ENOUGH });
  });
});

describe('slideText kind', () => {
  it('flags a page with no text as image-only', () => {
    expect(slideText(page(), 1)).toEqual({ kind: 'image-only', title: '', body: '' });
  });

  it('flags a thin text layer as image-only, keeping its title and emptying its body', () => {
    const words = Array.from({ length: THIN_TEXT_LAYER_WORDS - 2 }, () => 'label');
    const text = slideText(page(line('Cycle', TITLE), line(words.join(' '))), 4);
    expect(text).toEqual({ kind: 'image-only', title: 'Cycle', body: '' });
  });

  it('reads a page at the word threshold as content', () => {
    const words = Array.from({ length: THIN_TEXT_LAYER_WORDS - 1 }, () => 'label');
    expect(slideText(page(line('Cycle', TITLE), line(words.join(' '))), 4).kind).toBe('content');
  });

  it('does not count the page number or a bullet marker as a word', () => {
    const words = Array.from({ length: THIN_TEXT_LAYER_WORDS - 1 }, () => 'label');
    expect(slideText(page(line(words.join(' ')), line('•'), line('9', FOOTER)), 9).kind).toBe(
      'image-only',
    );
  });

  it('counts words, not bullet markers', () => {
    expect(slideText(page(line('• one'), line('• two'), line('• six')), 1).kind).toBe('image-only');
  });

  it('classifies a references page by its title', () => {
    const text = slideText(
      page(line('References', TITLE), line(`Smith, J. (2020). ${ENOUGH}.`)),
      40,
    );
    expect(text.kind).toBe('references');
  });

  it.each(['Reference list', 'Reading lists', 'Further readings', 'Bibliography'])(
    'classifies a %s page as references',
    (title) => {
      expect(slideText(page(line(title, TITLE), line(ENOUGH)), 40).kind).toBe('references');
    },
  );

  it('reads a content title that starts with "reference" as content', () => {
    expect(slideText(page(line('Reference electrodes', TITLE), line(ENOUGH)), 3).kind).toBe(
      'content',
    );
  });

  it('reads a title that only mentions references as content', () => {
    expect(slideText(page(line('Using references well', TITLE), line(ENOUGH)), 3).kind).toBe(
      'content',
    );
  });
});
