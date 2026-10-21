import { embedText } from './embed-text';
import type { QuotableFields } from './slide-chunk';

/**
 * The share of the embedder's window a piece is cut to, measured at its parent's density, so a
 * piece up to a third denser than its parent still fits in one round. Tuned against
 * `split-chunk.test.ts`; carriers: `.claude/ledgers/slide-chunking.ledger`.
 */
export const CHUNK_WINDOW_FILL = 0.75;

/** What the embedder reported for text it would not embed whole (`packages/gateway/src/encoder-requests.ts`, #66). */
export interface OverLengthMeasure {
  readonly inputTokens: number;
  readonly maxInputTokens: number;
}

export type ChunkLineField = 'body' | 'speakerNotes' | 'imageCaption';

/** A unit the cut never falls inside: one non-blank line of the body or notes, or one caption. */
export interface ChunkLine {
  readonly field: ChunkLineField;
  readonly text: string;
}

export type ChunkSplit =
  | {
      readonly status: 'split';
      readonly pieces: readonly [QuotableFields, QuotableFields, ...QuotableFields[]];
    }
  | { readonly status: 'unsplittable' };

const nonBlank = (text: string): boolean => /\S/.test(text);

const linesOf = (field: ChunkLineField, text: string): readonly ChunkLine[] =>
  text
    .split('\n')
    .filter(nonBlank)
    .map((line) => ({ field, text: line }));

/** A chunk's lines in `slideFields` order; the title is never a line, since every piece repeats it. */
export const chunkLines = (chunk: QuotableFields): readonly ChunkLine[] => [
  ...linesOf('body', chunk.body),
  ...linesOf('speakerNotes', chunk.speakerNotes),
  ...chunk.imageCaptions.filter(nonBlank).map((text) => ({ field: 'imageCaption' as const, text })),
];

const joined = (lines: readonly ChunkLine[], field: ChunkLineField): string =>
  lines
    .filter((line) => line.field === field)
    .map(({ text }) => text)
    .join('\n');

const piece = (title: string, lines: readonly ChunkLine[]): QuotableFields => ({
  title,
  body: joined(lines, 'body'),
  speakerNotes: joined(lines, 'speakerNotes'),
  imageCaptions: lines.filter((line) => line.field === 'imageCaption').map(({ text }) => text),
});

const packed = (
  title: string,
  lines: readonly ChunkLine[],
  budget: number,
): readonly (readonly ChunkLine[])[] => {
  const groups: ChunkLine[][] = [];
  let current: ChunkLine[] = [];
  for (const line of lines) {
    const grown = [...current, line];
    if (current.length > 0 && embedText(piece(title, grown)).length > budget) {
      groups.push(current);
      current = [line];
    } else current = grown;
  }
  groups.push(current);
  return groups;
};

/**
 * Cuts text the embedder reported over-length between its lines, into pieces sized from the density
 * it measured (`docs/adr/0008-slide-chunking.md` § Decision (d) and (e)). A piece may itself still
 * be over-length; the caller measures it again.
 */
export const splitChunk = (chunk: QuotableFields, measured: OverLengthMeasure): ChunkSplit => {
  const lines = chunkLines(chunk);
  const middle = Math.ceil(lines.length / 2);
  const budget =
    (embedText(chunk).length * measured.maxInputTokens * CHUNK_WINDOW_FILL) / measured.inputTokens;
  const groups = packed(chunk.title, lines, budget);
  const [first, second, ...rest] =
    groups.length > 1 ? groups : [lines.slice(0, middle), lines.slice(middle)];
  if (first === undefined || second === undefined || second.length === 0)
    return { status: 'unsplittable' };
  return {
    status: 'split',
    pieces: [
      piece(chunk.title, first),
      piece(chunk.title, second),
      ...rest.map((group) => piece(chunk.title, group)),
    ],
  };
};
