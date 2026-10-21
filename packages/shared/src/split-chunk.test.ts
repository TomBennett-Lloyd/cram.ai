import { describe, expect, it } from 'vitest';
import { embedText } from './embed-text';
import type { QuotableFields } from './slide-chunk';
import { CHUNK_WINDOW_FILL, chunkLines, type ChunkSplit, splitChunk } from './split-chunk';

const fields = (over: Partial<QuotableFields> = {}): QuotableFields => ({
  title: 'Honey',
  body: '',
  speakerNotes: '',
  imageCaptions: [],
  ...over,
});

/** Ten body lines of ten characters each: `line 00 ab` … `line 09 ab`. */
const tenLines = fields({
  body: Array.from({ length: 10 }, (_, n) => `line 0${String(n)} ab`).join('\n'),
});

/** A measure at one token per character, so the budget is the window × the fill. */
const atOneTokenPerChar = (chunk: QuotableFields, maxInputTokens: number) => ({
  inputTokens: embedText(chunk).length,
  maxInputTokens,
});

const pieces = (split: ChunkSplit): readonly QuotableFields[] =>
  split.status === 'split' ? split.pieces : [];

const piecesOf = (chunk: QuotableFields, maxInputTokens: number): readonly QuotableFields[] =>
  pieces(splitChunk(chunk, atOneTokenPerChar(chunk, maxInputTokens)));

describe('chunkLines', () => {
  it('reads body lines, then speaker-note lines, then each caption, skipping blank ones', () => {
    const lines = chunkLines(
      fields({ body: 'a\n \nb', speakerNotes: 'n1\n\nn2', imageCaptions: ['c1', ' ', 'c2'] }),
    );
    expect(lines).toEqual([
      { field: 'body', text: 'a' },
      { field: 'body', text: 'b' },
      { field: 'speakerNotes', text: 'n1' },
      { field: 'speakerNotes', text: 'n2' },
      { field: 'imageCaption', text: 'c1' },
      { field: 'imageCaption', text: 'c2' },
    ]);
  });

  it('never takes the title as a line', () => {
    expect(chunkLines(fields({ title: 'Only a title' }))).toEqual([]);
  });
});

describe('splitChunk', () => {
  it('cuts only between lines, never inside one, keeping their order and the title on every piece', () => {
    const chunk = fields({
      body: tenLines.body,
      speakerNotes: 'note one\nnote two',
      imageCaptions: ['a comb'],
    });
    const split = piecesOf(chunk, 40);
    expect(split.length).toBeGreaterThan(1);
    expect(split.every(({ title }) => title === 'Honey')).toBe(true);
    expect(split.flatMap(chunkLines)).toEqual(chunkLines(chunk));
  });

  it('packs as many whole lines into each piece as the measured budget allows', () => {
    // A budget of 115 × 40 × fill / 115 = 30 characters: the title and two lines are 27.
    const split = piecesOf(tenLines, 40);
    expect(split.map((piece) => piece.body.split('\n').length)).toEqual([2, 2, 2, 2, 2]);
    expect(split.every((piece) => embedText(piece).length <= 40 * CHUNK_WINDOW_FILL)).toBe(true);
  });

  it('fills a piece up to exactly the budget, and no further', () => {
    // A budget of 36 × fill = 27 characters: the title and two lines are exactly 27.
    expect(piecesOf(tenLines, 36).map((piece) => piece.body.split('\n').length)).toEqual([
      2, 2, 2, 2, 2,
    ]);
  });

  it('sizes pieces from the density the embedder measured, not from characters alone', () => {
    // Twice the tokens per character halves the budget, so each piece holds one line.
    const denser = { inputTokens: embedText(tenLines).length * 2, maxInputTokens: 50 };
    expect(pieces(splitChunk(tenLines, denser)).length).toBe(10);
  });

  it('leaves room in every piece for text a third denser than its parent', () => {
    const measured = { inputTokens: 300, maxInputTokens: 120 };
    const density = measured.inputTokens / embedText(tenLines).length;
    const split = pieces(splitChunk(tenLines, measured));
    expect(split.length).toBeGreaterThan(1);
    for (const piece of split)
      expect(embedText(piece).length * density * (4 / 3)).toBeLessThanOrEqual(
        measured.maxInputTokens,
      );
  });

  it('cuts at the middle line when every line would fit one piece', () => {
    const split = piecesOf(fields({ body: 'one\ntwo\nthree' }), 1000);
    expect(split.map(({ body }) => body)).toEqual(['one\ntwo', 'three']);
  });

  it('keeps a line that fits no piece alone, and the lines around it in their own pieces', () => {
    const long = 'x'.repeat(60);
    const split = piecesOf(fields({ body: `aa\n${long}\nbb` }), 40);
    expect(split.map(({ body }) => body)).toEqual(['aa', long, 'bb']);
  });

  it('keeps each line in its own field in the piece it lands in', () => {
    const split = piecesOf(
      fields({ body: 'body line one', speakerNotes: 'a note line', imageCaptions: ['a caption'] }),
      30,
    );
    expect(split).toEqual([
      fields({ body: 'body line one' }),
      fields({ speakerNotes: 'a note line' }),
      fields({ imageCaptions: ['a caption'] }),
    ]);
  });

  it('is unsplittable when the chunk holds one line or none', () => {
    const measure = { inputTokens: 100, maxInputTokens: 10 };
    expect(splitChunk(fields({ body: 'one long line' }), measure)).toEqual({
      status: 'unsplittable',
    });
    expect(splitChunk(fields({ imageCaptions: ['a caption'] }), measure)).toEqual({
      status: 'unsplittable',
    });
    expect(splitChunk(fields(), measure)).toEqual({ status: 'unsplittable' });
  });

  it('puts every line in a piece of its own when no line fits under the title', () => {
    const split = pieces(
      splitChunk(fields({ body: 'a\nb\nc' }), { inputTokens: 1e9, maxInputTokens: 1 }),
    );
    expect(split.map(({ body }) => body)).toEqual(['a', 'b', 'c']);
  });
});
