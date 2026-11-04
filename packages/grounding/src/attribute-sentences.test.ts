import { describe, expect, it } from 'vitest';
import { attributeSentences, quotesIn, sourcesOf } from './attribute-sentences';
import { claimSpans } from './claims';
import { cite, slide } from './fake-gateway-fixture';

const hive = slide('l1/1', 'Worker bees are male.');
const comb = slide('l1/2', 'Bees build comb from square cells.');
const winter = slide('l5/6', 'Bees sleep through the winter.');
const retrieved = [hive, comb];
const ids = (slides: readonly { sourceId: string }[]) => slides.map(({ sourceId }) => sourceId);

describe('attributeSentences', () => {
  it('gives each sentence its own candidates, best first, then its quoted slide', () => {
    const text = 'Workers are male, as "Bees build comb from square cells." says. Bees sleep.';
    const spans = claimSpans(text);
    const attributed = attributeSentences(
      text,
      spans,
      [[hive], [winter, comb]],
      [cite('l1/2', 'Bees build comb from square cells.')],
      retrieved,
    );
    expect(attributed.map(({ text: sentence, slides }) => [sentence, ids(slides)])).toEqual([
      ['Workers are male, as "Bees build comb from square cells." says.', ['l1/1', 'l1/2']],
      ['Bees sleep.', ['l5/6', 'l1/2']],
    ]);
  });

  it('attributes the sentence after a quoted line on its own', () => {
    const text = 'The slides put it plainly: "Worker bees are male." That surprises people.';
    const attributed = attributeSentences(
      text,
      claimSpans(text),
      [[comb], [winter]],
      [cite('l1/1', 'Worker bees are male.')],
      retrieved,
    );
    expect(attributed.map(({ text: sentence, slides }) => [sentence, ids(slides)])).toEqual([
      ['The slides put it plainly: "Worker bees are male."', ['l1/2', 'l1/1']],
      ['That surprises people.', ['l5/6']],
    ]);
  });

  it('names a quoted slide once when the search found it too', () => {
    const text = 'Bees build comb from square cells.';
    const [attributed] = attributeSentences(
      text,
      claimSpans(text),
      [[comb, hive]],
      [cite('l1/2', text)],
      retrieved,
    );
    expect(ids(attributed?.slides ?? [])).toEqual(['l1/2', 'l1/1']);
  });

  it('carries a candidate the question’s retrieval never fetched', () => {
    const text = 'Bees sleep.';
    const [attributed] = attributeSentences(text, claimSpans(text), [[winter]], [], retrieved);
    expect(attributed?.slides).toEqual([winter]);
  });

  it('leaves a sentence with no candidate and no quote with no slide', () => {
    const text = 'Bees sleep.';
    expect(attributeSentences(text, claimSpans(text), [[]], [], retrieved)).toEqual([
      { text, slides: [] },
    ]);
  });
});

describe('quotesIn', () => {
  const quote = cite('l1/1', 'male. Drones');
  const text = 'Workers are male. Drones are female.';
  const [first, second] = claimSpans(text);

  it('puts a quote crossing a sentence boundary in both sentences', () => {
    if (first === undefined || second === undefined) throw new Error('two sentences');
    expect(quotesIn(text, first, [quote])).toEqual([quote]);
    expect(quotesIn(text, second, [quote])).toEqual([quote]);
  });

  it('leaves out a quote the text does not hold', () => {
    if (first === undefined) throw new Error('two sentences');
    expect(quotesIn(text, first, [cite('l1/1', 'Workers are female.')])).toEqual([]);
  });

  it('leaves a quote out of a sentence it only touches', () => {
    const at = cite('l1/1', 'Drones are female.');
    if (first === undefined || second === undefined) throw new Error('two sentences');
    expect(quotesIn(text, first, [at])).toEqual([]);
    expect(quotesIn(text, second, [at])).toEqual([at]);
  });
});

describe('sourcesOf', () => {
  it('numbers every slide by its first use, sentence by sentence', () => {
    expect(
      sourcesOf([[hive.sourceId, comb.sourceId], [winter.sourceId, hive.sourceId], []]),
    ).toEqual(['l1/1', 'l1/2', 'l5/6']);
  });
});
