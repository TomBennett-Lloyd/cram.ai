import { describe, expect, it } from 'vitest';
import { answer, cite, draft, line, slide } from './fake-gateway-fixture';
import { quotesResolve, resolveCitations } from './resolve-citations';

const hive = slide('l1/1', 'Worker bees are male.\nThe queen is the colony’s only female.', {
  title: 'Castes',
});
const comb = slide('l1/2', 'Bees build comb from square cells.');

const verdictOf = (unit: ReturnType<typeof draft>, retrieved = [hive, comb]) => {
  const { resolved, withheld } = resolveCitations([unit], retrieved);
  return resolved.length === 1 ? 'resolved' : withheld[0]?.reason;
};

describe('resolveCitations', () => {
  it('quotes each cited line from the stored slide, in citation order', () => {
    const unit = draft('Worker bees are male and comb cells are square.', [
      line('l1/1', 2),
      line('l1/2', 1),
    ]);
    const quoted = answer(unit.text, [
      cite('l1/1', 'Worker bees are male.'),
      cite('l1/2', 'Bees build comb from square cells.'),
    ]);
    expect(resolveCitations([unit], [hive, comb])).toEqual({
      resolved: [
        { unit: quoted, quotes: ['Worker bees are male.', 'Bees build comb from square cells.'] },
      ],
      withheld: [],
    });
  });

  it('quotes the whole of a two-sentence bullet when a unit reports one of its sentences', () => {
    const smoke = slide(
      'l2/1',
      'Smoke calms the guards. It masks their alarm scent.\nWear a veil.',
    );
    const { resolved } = resolveCitations(
      [draft('Smoke calms the guards.', [line('l2/1', 1)])],
      [smoke],
    );
    expect(resolved[0]?.quotes).toEqual(['Smoke calms the guards. It masks their alarm scent.']);
  });

  it('withholds a confident sentence that cites nothing', () => {
    expect(verdictOf(draft('Worker bees are female.', []))).toBe('dangling-citation');
  });

  it('withholds a citation to a slide that was not retrieved', () => {
    expect(verdictOf(draft('Comb cells are square.', [line('l1/2', 1)]), [hive])).toBe(
      'dangling-citation',
    );
  });

  it('withholds a line number the slide does not have, at either end', () => {
    for (const n of [0, -1, 4]) {
      expect(verdictOf(draft('Worker bees are male.', [line('l1/1', n)]))).toBe(
        'dangling-citation',
      );
    }
    expect(verdictOf(draft('Worker bees are male.', [line('l1/1', 3)]))).toBe('resolved');
  });

  it('withholds the whole unit when one citation fails, keeping the ones that resolved', () => {
    const unit = draft('Worker bees are male and comb cells are hexagonal.', [
      line('l1/1', 2),
      line('l1/2', 2),
    ]);
    expect(resolveCitations([unit], [hive, comb]).withheld).toEqual([
      {
        reason: 'dangling-citation',
        unit: answer(unit.text, [cite('l1/1', 'Worker bees are male.')]),
      },
    ]);
  });

  it('looks a line up in, and checks it against, the same record when a source id repeats', () => {
    const { resolved } = resolveCitations(
      [draft('x', [line('l1/1', 1)])],
      [slide('l1/1', 'foo'), slide('l1/1', 'bar')],
    );
    expect(resolved.map(({ quotes }) => quotes)).toEqual([['bar']]);
  });

  it('keeps passing units in order and withholds the rest in order', () => {
    const units = [
      draft('a', [line('l1/1', 1)]),
      draft('b', []),
      draft('c', [line('l1/2', 1)]),
      draft('d', [line('l9/9', 1)]),
    ];
    const { resolved, withheld } = resolveCitations(units, [hive, comb]);
    expect(resolved.map((r) => r.unit.text)).toEqual(['a', 'c']);
    expect(withheld.map((w) => w.unit.text)).toEqual(['b', 'd']);
  });
});

describe('quotesResolve', () => {
  const holds = (quote: string, retrieved = [hive, comb]) =>
    quotesResolve(answer('x', [cite('l1/1', quote)]), retrieved);

  it('holds a quote that is a span of a retrieved slide', () => {
    expect(holds('Worker bees are male.')).toBe(true);
  });

  it('refuses a unit with no citations, and a quote from a slide not retrieved', () => {
    expect(quotesResolve(answer('x', []), [hive])).toBe(false);
    expect(holds('Worker bees are male.', [comb])).toBe(false);
  });

  it('refuses a quote that paraphrases its slide', () => {
    expect(holds('Worker bees are all male.')).toBe(false);
  });

  it('refuses the unit when any one of its quotes fails', () => {
    const unit = answer('x', [cite('l1/1', 'Worker bees'), cite('l1/2', 'hexagonal cells')]);
    expect(quotesResolve(unit, [hive, comb])).toBe(false);
  });

  it('reads whitespace runs as one space, across a line break and at the quote’s ends', () => {
    expect(holds('male. The queen')).toBe(true);
    expect(holds('  Worker\tbees \n are ')).toBe(true);
  });

  it('normalises nothing but whitespace: case and apostrophes must match', () => {
    expect(holds('worker bees are male.')).toBe(false);
    expect(holds("colony's only female")).toBe(false);
  });

  it('accepts a quote from any of the slide’s text fields', () => {
    const noted = slide('l1/1', 'Body.', {
      title: 'Castes',
      speakerNotes: 'Drones never leave the hive.',
      imageCaptions: ['A drone at rest'],
    });
    for (const quote of ['Castes', 'never leave the hive', 'A drone at rest'])
      expect(holds(quote, [noted])).toBe(true);
  });
});
