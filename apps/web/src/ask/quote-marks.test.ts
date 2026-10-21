import { CourseId, LectureId, type SlideRecord, SlideNo, SourceHash } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { markedFields, markedLines } from './quote-marks';

const slide = (fields: Partial<SlideRecord> = {}): SlideRecord => ({
  courseId: CourseId.parse('bio'),
  lectureId: LectureId.parse('l1'),
  lectureTitle: 'Lecture 1',
  slideNo: SlideNo.parse(1),
  kind: 'content',
  title: 'The Hive',
  body: 'Worker bees are female.\nDrones   are male.',
  speakerNotes: '',
  imageCaptions: [],
  derived: false,
  sourceHash: SourceHash.parse('h'),
  ...fields,
});

/** Each field as text with its marked runs bracketed, so one string states the whole result. */
const bracketed = (record: SlideRecord, quotes: readonly string[]) =>
  markedFields(record, quotes).map(({ field, segments }) => [
    field,
    segments.map(({ text, marked }) => (marked ? `[${text}]` : text)).join(''),
  ]);

describe('markedFields', () => {
  it('marks a verbatim quote where it sits', () => {
    expect(bracketed(slide(), ['bees are female'])).toEqual([
      ['title', 'The Hive'],
      ['body', 'Worker [bees are female].\nDrones   are male.'],
    ]);
  });

  it('matches whitespace runs as one space, in the slide and in the quote', () => {
    expect(bracketed(slide(), ['female. Drones are\n male.'])[1]).toEqual([
      'body',
      'Worker bees are [female.\nDrones   are male.]',
    ]);
  });

  it('ignores whitespace around a quote', () => {
    expect(bracketed(slide(), ['  Drones are male.\n'])[1]).toEqual([
      'body',
      'Worker bees are female.\n[Drones   are male.]',
    ]);
  });

  it('marks a quote that runs from one field into the next in both', () => {
    expect(bracketed(slide(), ['Hive Worker'])).toEqual([
      ['title', 'The [Hive]'],
      ['body', '[Worker] bees are female.\nDrones   are male.'],
    ]);
  });

  it('marks several quotes, overlapping ones without marking any span twice', () => {
    expect(bracketed(slide(), ['are male', 'Worker bees', 'bees are female'])[1]).toEqual([
      'body',
      '[Worker bees][ are female].\nDrones   [are male].',
    ]);
  });

  it('marks nothing for a quote the slide does not hold, or a blank one', () => {
    expect(bracketed(slide(), ['queens are male', '  '])).toEqual([
      ['title', 'The Hive'],
      ['body', 'Worker bees are female.\nDrones   are male.'],
    ]);
  });

  it('leaves blank fields out and reads notes and captions in slideFields order', () => {
    const record = slide({
      title: ' ',
      speakerNotes: 'Say: queens lay.',
      imageCaptions: ['', 'A comb'],
    });
    expect(bracketed(record, ['male. Say: queens', 'A comb'])).toEqual([
      ['body', 'Worker bees are female.\nDrones   are [male.]'],
      ['speakerNotes', '[Say: queens] lay.'],
      ['imageCaption', '[A comb]'],
    ]);
  });

  it('marks a quote at the very start and very end of the slide', () => {
    expect(bracketed(slide({ body: 'x' }), ['The', 'x'])).toEqual([
      ['title', '[The] Hive'],
      ['body', '[x]'],
    ]);
  });
});

/** The body's lines with their marked runs bracketed. */
const bracketedLines = (body: string, quotes: readonly string[]) =>
  markedLines(
    markedFields(slide({ title: '', body }), quotes).find(({ field }) => field === 'body')
      ?.segments ?? [],
  ).map((line) => line.map(({ text, marked }) => (marked ? `[${text}]` : text)).join(''));

describe('markedLines', () => {
  it('gives one entry per line ingest separated (`bodyOf` in packages/ingest/src/slide-text.ts), a quote marked at a line’s start, middle or end', () => {
    expect(bracketedLines('ab cd ef\ngh ij kl', ['ab', 'ij', 'ef'])).toEqual([
      '[ab] cd [ef]',
      'gh [ij] kl',
    ]);
  });

  it('marks both parts of a quote that runs across a line break, and not the break', () => {
    expect(bracketedLines('ab cd\nef gh\nij', ['cd ef gh ij'])).toEqual([
      'ab [cd]',
      '[ef gh]',
      '[ij]',
    ]);
  });

  it('leaves out blank and whitespace-only lines, wherever they sit', () => {
    expect(bracketedLines('\nab\n\n \t\ncd\n', ['cd'])).toEqual(['ab', '[cd]']);
  });

  it('keeps a line that is only a marked run', () => {
    expect(bracketedLines('ab\ncd', ['cd'])).toEqual(['ab', '[cd]']);
  });

  /** The oracle is `String.prototype.split`, never the code under test. */
  const BODIES = [
    'one',
    'one\ntwo',
    '\none',
    'one\n',
    'one\n\ntwo',
    'one\n \ntwo',
    'one\n\t\ntwo',
    '  one  \n  two',
    'one\r\ntwo',
    '• one\n• two wraps on',
    '\n\n\n',
  ];

  it('separates every body exactly as a split on line breaks does', () => {
    for (const body of BODIES) {
      expect(bracketedLines(body, []), JSON.stringify(body)).toEqual(
        body.split('\n').filter((line) => /\S/.test(line)),
      );
    }
  });
});
