import { type Explanation, type QuoteSpan, quoteSpan, type SourceId } from '@cram/shared';

export interface Run {
  readonly text: string;
  readonly quote?: { readonly sourceId: SourceId; readonly ends: boolean };
}

export interface MarkedSentence {
  readonly text: string;
  readonly runs: readonly Run[];
  readonly contradicts: readonly SourceId[];
  readonly mayBeRelevant: readonly SourceId[];
}

interface Located extends QuoteSpan {
  readonly sourceId: SourceId;
}

const sentenceSpans = (text: string, sentences: readonly string[]): (QuoteSpan | undefined)[] => {
  let cursor = 0;
  return sentences.map((sentence) => {
    const span = quoteSpan(text.slice(cursor), sentence);
    if (span === undefined) return undefined;
    const located = { start: cursor + span.start, end: cursor + span.end };
    cursor = located.end;
    return located;
  });
};

const quoteSpans = ({ text, quotes }: Explanation): Located[] => {
  const located = quotes
    .flatMap(({ sourceId, quote }) => {
      const span = quoteSpan(text, quote);
      return span === undefined ? [] : [{ ...span, sourceId }];
    })
    .sort((a, b) => a.start - b.start);
  const kept: Located[] = [];
  for (const span of located) {
    const last = kept.at(-1);
    if (last === undefined || span.start >= last.end) kept.push(span);
  }
  return kept;
};

interface Piece {
  readonly text: string;
  readonly quote?: Located;
}

const piecesOf = (text: string, { start, end }: QuoteSpan, quotes: readonly Located[]): Piece[] => {
  const pieces: Piece[] = [];
  let cursor = start;
  for (const quote of quotes) {
    const from = Math.max(quote.start, cursor);
    const to = Math.min(quote.end, end);
    if (to <= from) continue;
    if (from > cursor) pieces.push({ text: text.slice(cursor, from) });
    pieces.push({ text: text.slice(from, to), quote });
    cursor = to;
  }
  if (cursor < end) pieces.push({ text: text.slice(cursor, end) });
  return pieces;
};

/**
 * Sentences split into runs at quotes (`docs/adr/0009-explanation-answers.md` § Decision (i)); a quote
 * crossing a boundary marks a run in each, its number after the last.
 */
export const markExplanation = (explanation: Explanation): readonly MarkedSentence[] => {
  const { text, sentences } = explanation;
  const quotes = quoteSpans(explanation);
  const spans = sentenceSpans(
    text,
    sentences.map((sentence) => sentence.text),
  );
  const split = sentences.map((sentence, index) => {
    const span = spans[index];
    return {
      sentence,
      pieces: span === undefined ? [{ text: sentence.text }] : piecesOf(text, span, quotes),
    };
  });
  const last = new Map<Located, Piece>();
  for (const piece of split.flatMap(({ pieces }) => pieces))
    if (piece.quote !== undefined) last.set(piece.quote, piece);
  return split.map(({ sentence, pieces }) => {
    const contradicts = new Set(sentence.contradicts);
    return {
      text: sentence.text,
      runs: pieces.map((piece) =>
        piece.quote === undefined
          ? { text: piece.text }
          : {
              text: piece.text,
              quote: { sourceId: piece.quote.sourceId, ends: last.get(piece.quote) === piece },
            },
      ),
      contradicts: sentence.contradicts,
      mayBeRelevant: sentence.slides.filter((slide) => !contradicts.has(slide)),
    };
  });
};

/** `sources` is in first-use order (§ Decision (a)). */
export const sourceNumbers = (sources: readonly SourceId[]): ReadonlyMap<SourceId, number> =>
  new Map(sources.map((sourceId, index) => [sourceId, index + 1]));
