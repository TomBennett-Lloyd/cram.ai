import type { Embedder } from '@cram/gateway';
import { embedText, SlideRecord } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { WordEmbedder } from './server-fixture';
import { embedSlides } from './slide-embedding';

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

describe('embedSlides', () => {
  it('embeds each slide as its embedText, the text the eval retriever embeds it as', async () => {
    const records = [
      slide({ speakerNotes: 'Drones are male.', imageCaptions: ['A comb', 'A queen'] }),
      slide({ slideNo: 2, title: ' ', body: 'Foragers see red best.' }),
    ];
    const inner = new WordEmbedder();
    const sent: string[][] = [];
    const spy: Embedder = {
      pin: inner.pin,
      embed: (request) => {
        sent.push([...request.texts]);
        return inner.embed(request);
      },
    };
    await expect(embedSlides(spy, records)).resolves.toMatchObject({ status: 'embedded' });
    expect(sent).toEqual([records.map(embedText)]);
  });
});
