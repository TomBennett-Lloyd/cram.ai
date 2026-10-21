import type { EmbedRequest, EmbeddingResult } from '@cram/gateway';
import { embedText, SlideRecord } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ShortEmbedder, WordEmbedder } from './server-fixture';
import { embedSlides } from './slide-embedding';

/** A `ShortEmbedder` that keeps every text it was sent, call by call. */
class RecordingEmbedder extends ShortEmbedder {
  readonly sent: string[][] = [];

  override embed(request: EmbedRequest): Promise<readonly EmbeddingResult[]> {
    this.sent.push([...request.texts]);
    return super.embed(request);
  }
}

const slide = (fields: Partial<z.input<typeof SlideRecord>>): SlideRecord =>
  SlideRecord.parse({
    courseId: 'bio',
    lectureId: 'l1',
    lectureTitle: 'Lecture 1',
    slideNo: 1,
    kind: 'content',
    title: 'The Hive',
    body: 'Worker bees are female.',
    speakerNotes: '',
    imageCaptions: [],
    derived: false,
    sourceHash: 'h',
    ...fields,
  });

const LONG = 'one two three four five six seven eight nine ten eleven twelve thirteen';

describe('embedSlides', () => {
  it('embeds each slide as its embedText, the text the eval retriever embeds it as', async () => {
    const records = [
      slide({ speakerNotes: 'Drones are male.', imageCaptions: ['A comb', 'A queen'] }),
      slide({ slideNo: 2, title: ' ', body: 'Foragers see red best.' }),
    ];
    const embedder = new RecordingEmbedder(100);
    const slides = await embedSlides(embedder, records);
    expect(slides.every(({ chunks: [{ embedding }] }) => embedding !== undefined)).toBe(true);
    expect(embedder.sent).toEqual([records.map(embedText)]);
  });

  it('returns every record in order, with a vector only for what the embedder took whole', async () => {
    const records = [
      slide({ slideNo: 1 }),
      slide({ slideNo: 2, kind: 'references', title: 'References', body: 'short list' }),
      slide({ slideNo: 3, body: LONG }),
      slide({ slideNo: 4, kind: 'image-only', title: '', body: LONG }),
    ];
    const slides = await embedSlides(new RecordingEmbedder(12), records);
    expect(slides.map(({ record: { slideNo } }) => slideNo)).toEqual([1, 2, 3, 4]);
    expect(slides.map(({ chunks: [{ embedding }] }) => embedding !== undefined)).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it('sends no references slide to the embedder, and pairs each vector with its own slide', async () => {
    const wasps = slide({ slideNo: 2, title: 'Wasps', body: 'Wasps sting more than once.' });
    const records = [
      slide({ slideNo: 1, kind: 'references', title: 'Further reading', body: 'short list' }),
      wasps,
    ];
    const embedder = new RecordingEmbedder(100);
    const [first, second] = await embedSlides(embedder, records);
    expect(embedder.sent).toEqual([[embedText(wasps)]]);
    expect(first?.chunks[0].embedding).toBeUndefined();
    const [own] = await new WordEmbedder().embed({ texts: [embedText(wasps)] });
    expect(second?.chunks[0].embedding).toEqual(
      own?.status === 'embedded' ? own.vector : 'not embedded',
    );
  });

  it('splits a slide over the window into chunks that each fit, and sends each chunk as its embedText', async () => {
    const record = slide({
      title: 'Honey',
      body: 'one two three\nfour five six\nseven eight nine',
    });
    const embedder = new RecordingEmbedder(6);
    const [indexed] = await embedSlides(embedder, [record]);
    const chunks = indexed?.chunks ?? [];
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(({ embedding }) => embedding !== undefined)).toBe(true);
    expect(embedder.sent[0]).toEqual([embedText(record)]);
    expect(embedder.sent.slice(1).flat()).toEqual(chunks.map(({ chunk }) => embedText(chunk)));
  });
});
