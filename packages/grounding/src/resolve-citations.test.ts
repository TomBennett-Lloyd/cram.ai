import { describe, expect, it } from 'vitest';
import { answer, cite, draft, emittedCitation, line, slide } from './fake-gateway-fixture';
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
      line('l1/1', 'Worker bees are male.'),
      line('l1/2', 'Bees build comb from square cells.'),
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
      [
        draft('Smoke calms the guards.', [
          line('l2/1', 'Smoke calms the guards. It masks their alarm scent.'),
        ]),
      ],
      [smoke],
    );
    expect(resolved[0]?.quotes).toEqual(['Smoke calms the guards. It masks their alarm scent.']);
  });

  it('withholds a confident sentence that cites nothing', () => {
    expect(verdictOf(draft('Worker bees are female.', []))).toBe('dangling-citation');
  });

  it('withholds a citation to a slide that was not retrieved', () => {
    expect(
      verdictOf(
        draft('Comb cells are square.', [line('l1/2', 'Bees build comb from square cells.')]),
        [hive],
      ),
    ).toBe('dangling-citation');
  });

  it.each([
    ['altered at its start', 'Xorker bees are male.'],
    ['altered in its middle', 'Worker bees are mole.'],
    ['altered at its end', 'Worker bees are male!'],
    ['in another case', 'worker bees are male.'],
    ['that is part of a line', 'Worker bees'],
    ['that spans two lines', 'Worker bees are male. The queen is the colony’s only female.'],
  ])('withholds a copy %s, since it equals no line of its slide', (_, copy) => {
    expect(verdictOf(draft('Worker bees are male.', [line('l1/1', copy)]))).toBe(
      'dangling-citation',
    );
  });

  it('withholds a copy of a line its slide holds twice, since it names neither', () => {
    const repeated = slide('l1/3', 'Drones\nDrones never forage.', { title: 'Drones' });
    expect(verdictOf(draft('Drones never forage.', [line('l1/3', 'Drones')]), [repeated])).toBe(
      'dangling-citation',
    );
  });

  it('reads whitespace runs in a copy as one space, and quotes the line as the slide holds it', () => {
    const { resolved } = resolveCitations(
      [draft('Worker bees are male.', [line('l1/1', '  Worker  bees\tare male. ')])],
      [hive, comb],
    );
    expect(resolved[0]?.quotes).toEqual(['Worker bees are male.']);
  });

  it('withholds the whole unit when one citation fails, keeping the ones that resolved', () => {
    const unit = draft('Worker bees are male and comb cells are hexagonal.', [
      line('l1/1', 'Worker bees are male.'),
      line('l1/2', 'Bees build comb from hexagonal cells.'),
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
      [draft('x', [line('l1/1', 'bar')]), draft('y', [line('l1/1', 'foo')])],
      [slide('l1/1', 'foo'), slide('l1/1', 'bar')],
    );
    expect(resolved.map(({ quotes }) => quotes)).toEqual([['bar']]);
  });

  it('keeps passing units in order and withholds the rest in order', () => {
    const units = [
      draft('a', [line('l1/1', 'Castes')]),
      draft('b', []),
      draft('c', [line('l1/2', 'Bees build comb from square cells.')]),
      draft('d', [line('l9/9', 'Castes')]),
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

describe('emittedCitation', () => {
  const noted = slide('l1/1', 'Worker bees are male.\nThe queen is the colony’s only female.', {
    title: 'Castes',
    speakerNotes: 'Drones never leave the hive.',
    imageCaptions: ['A drone at rest'],
  });
  const retrieved = [comb, noted];
  const lookedUp = (quote: string) =>
    resolveCitations([draft('x', [emittedCitation(cite('l1/1', quote), retrieved)])], retrieved)
      .resolved[0]?.quotes;

  it('emits the citation resolveCitations looks up as the quote, for every line of every field', () => {
    for (const quote of [
      'Castes',
      'Worker bees are male.',
      'The queen is the colony’s only female.',
      'Drones never leave the hive.',
      'A drone at rest',
    ])
      expect(lookedUp(quote)).toEqual([quote]);
  });

  it('refuses a quote that is no line of its slide: part of a line, a span across two, another slide’s', () => {
    for (const quote of ['Worker bees', 'male. The queen', 'Bees build comb from square cells.'])
      expect(() => lookedUp(quote)).toThrow(`"${quote}" is no line of l1/1`);
    expect(() => emittedCitation(cite('l9/9', 'Castes'), retrieved)).toThrow('no line of l9/9');
  });
});
