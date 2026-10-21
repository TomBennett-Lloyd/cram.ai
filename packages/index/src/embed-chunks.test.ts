import { chunkLines, embedText } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { slide, vector } from './course-fixture';
import { embedSlideChunks, type EmbedTextResult, type EmbedTexts } from './embed-chunks';

const words = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/** A vector that differs for any two texts this file embeds. */
const textVector = (text: string): Float32Array =>
  vector(
    words(text),
    Array.from({ length: text.length }, (_, at) => text.charCodeAt(at) * (at + 1)).reduce(
      (sum, term) => sum + term,
      0,
    ),
    0,
    0,
  );

/** An embedder that takes at most `maxWords` words, counting each as a token, and records every call. */
const wordLimited = (maxWords: number) => {
  const calls: string[][] = [];
  const embed: EmbedTexts = (texts) => {
    calls.push([...texts]);
    return Promise.resolve(
      texts.map((text): EmbedTextResult =>
        words(text) > maxWords
          ? { status: 'over-length', inputTokens: words(text), maxInputTokens: maxWords }
          : { status: 'embedded', vector: textVector(text) },
      ),
    );
  };
  return { calls, embed };
};

const LONG = slide({ title: 'Honey', body: 'one two three\nfour five six\nseven eight nine' });

describe('embedSlideChunks', () => {
  it('embeds every slide that fits whole as one chunk, in one call', async () => {
    const records = [slide({ body: 'short' }), slide({ slideNo: 2, body: 'also short' })];
    const { calls, embed } = wordLimited(10);
    const indexed = await embedSlideChunks(embed, records);
    expect(calls).toEqual([records.map(embedText)]);
    expect(indexed.map(({ record, chunks }) => [record, chunks.length])).toEqual([
      [records[0], 1],
      [records[1], 1],
    ]);
    expect(indexed[1]?.chunks[0]).toMatchObject({ chunk: { chunkNo: 1, body: 'also short' } });
  });

  it('splits a slide the embedder reports over-length into chunks numbered in text order, each with a vector', async () => {
    const { calls, embed } = wordLimited(6);
    const [indexed] = await embedSlideChunks(embed, [LONG]);
    const chunks = indexed?.chunks ?? [];
    expect(calls).toHaveLength(2);
    expect(chunks.map(({ chunk }) => chunk.chunkNo)).toEqual([1, 2, 3]);
    expect(chunks.flatMap(({ chunk }) => chunkLines(chunk))).toEqual(chunkLines(LONG));
    expect(chunks.every(({ chunk }) => chunk.title === 'Honey')).toBe(true);
    expect(chunks.map(({ embedding }) => embedding)).toEqual(
      chunks.map(({ chunk }) => textVector(embedText(chunk))),
    );
  });

  it('splits a piece that is still over-length again, in a later round', async () => {
    const dense = slide({
      title: 'Honey',
      body: 'a b c\nd e f\ng h i\nj k l\nm n o\np q r\ns t u\nv w x',
    });
    // A limit stricter after the first call than the one reported stands in for pieces denser than their slide.
    const calls: string[][] = [];
    const embed: EmbedTexts = (texts) => {
      calls.push([...texts]);
      return Promise.resolve(
        texts.map((text) =>
          words(text) > (calls.length === 1 ? 20 : 4)
            ? { status: 'over-length', inputTokens: words(text), maxInputTokens: 20 }
            : { status: 'embedded', vector: vector(1, 0, 0, 0) },
        ),
      );
    };
    const [indexed] = await embedSlideChunks(embed, [dense]);
    expect(calls.length).toBeGreaterThan(2);
    expect(indexed?.chunks.flatMap(({ chunk }) => chunkLines(chunk))).toEqual(chunkLines(dense));
    expect(indexed?.chunks.map(({ chunk }) => chunk.chunkNo)).toEqual(
      indexed?.chunks.map((_, index) => index + 1),
    );
  });

  it('embeds every pending piece of every slide in one call per round', async () => {
    const other = slide({ slideNo: 2, title: LONG.title, body: LONG.body });
    const { calls, embed } = wordLimited(6);
    await embedSlideChunks(embed, [LONG, other]);
    expect(calls.map((texts) => texts.length)).toEqual([2, 6]);
  });

  it('keeps a slide holding a line too long to embed alone as one whole chunk with no vector', async () => {
    const record = slide({ title: 'Honey', body: 'one two three four five six seven\nshort' });
    const [indexed] = await embedSlideChunks(wordLimited(6).embed, [record]);
    expect(indexed?.chunks).toEqual([
      {
        chunk: {
          chunkNo: 1,
          title: 'Honey',
          body: record.body,
          speakerNotes: '',
          imageCaptions: [],
        },
        embedding: undefined,
      },
    ]);
  });

  it('refuses an embedder that returns a different number of results than texts', async () => {
    const short: EmbedTexts = () => Promise.resolve([]);
    await expect(embedSlideChunks(short, [LONG])).rejects.toThrow(/0 results for 1 texts/);
  });
});
