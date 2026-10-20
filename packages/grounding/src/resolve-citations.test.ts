import { describe, expect, it } from 'vitest';
import { answer, cite, slide } from './fake-gateway-fixture';
import { resolveCitations } from './resolve-citations';

const hive = slide('l1/1', 'Worker bees are male.\nThe queen is the colony’s only female.');
const comb = slide('l1/2', 'Bees build comb from square cells.');

const verdictOf = (unit: ReturnType<typeof answer>, retrieved = [hive, comb]) => {
  const { resolved, withheld } = resolveCitations([unit], retrieved);
  return resolved.length === 1 ? 'resolved' : withheld[0]?.reason;
};

describe('resolveCitations', () => {
  it('passes a unit whose quote is a verbatim span of a retrieved slide, with its quotes in citation order', () => {
    const unit = answer('Worker bees are male and comb cells are square.', [
      cite('l1/1', 'Worker bees are male.'),
      cite('l1/2', 'square cells'),
    ]);
    expect(resolveCitations([unit], [hive, comb])).toEqual({
      resolved: [{ unit, quotes: ['Worker bees are male.', 'square cells'] }],
      withheld: [],
    });
  });

  it('withholds a confident sentence that cites nothing', () => {
    expect(verdictOf(answer('Worker bees are female.', []))).toBe('dangling-citation');
  });

  it('withholds a citation to a slide that was not retrieved', () => {
    const unit = answer('Comb cells are square.', [cite('l1/2', 'square cells')]);
    expect(verdictOf(unit, [hive])).toBe('dangling-citation');
  });

  it('withholds a quote that paraphrases its slide', () => {
    const unit = answer('Worker bees are male.', [cite('l1/1', 'Worker bees are all male.')]);
    expect(verdictOf(unit)).toBe('dangling-citation');
  });

  it('withholds the whole unit when any one of its citations fails', () => {
    const unit = answer('Worker bees are male and comb cells are hexagonal.', [
      cite('l1/1', 'Worker bees are male.'),
      cite('l1/2', 'hexagonal cells'),
    ]);
    expect(verdictOf(unit)).toBe('dangling-citation');
  });

  it('matches a quote across a line break the slide has and the quote does not', () => {
    const unit = answer('The queen is female.', [cite('l1/1', 'male. The queen')]);
    expect(verdictOf(unit)).toBe('resolved');
  });

  it('matches a quote whose own whitespace differs from the slide’s, inside and at its ends', () => {
    const unit = answer('Comb cells are square.', [cite('l1/2', '  build\tcomb \n from ')]);
    expect(verdictOf(unit)).toBe('resolved');
  });

  it('matches a quote that ends where its slide’s text ends, after trailing whitespace', () => {
    const unit = answer('Comb cells are square.', [cite('l1/2', 'square cells.\n')]);
    expect(verdictOf(unit)).toBe('resolved');
  });

  it('normalises nothing but whitespace: case and apostrophes must match', () => {
    expect(verdictOf(answer('x', [cite('l1/1', 'worker bees are male.')]))).toBe(
      'dangling-citation',
    );
    expect(verdictOf(answer('x', [cite('l1/1', "colony's only female")]))).toBe(
      'dangling-citation',
    );
  });

  it('accepts a quote from any of the slide’s text fields', () => {
    const noted = slide('l1/3', 'Body.', {
      title: 'Drones',
      speakerNotes: 'Drones never leave the hive.',
      imageCaptions: ['A drone at rest'],
    });
    for (const quote of ['Drones', 'never leave the hive', 'A drone at rest']) {
      expect(verdictOf(answer('x', [cite('l1/3', quote)]), [noted])).toBe('resolved');
    }
  });

  it('keeps passing units in order and withholds the rest in order', () => {
    const units = [
      answer('a', [cite('l1/1', 'Worker bees')]),
      answer('b', []),
      answer('c', [cite('l1/2', 'square')]),
      answer('d', [cite('l9/9', 'square')]),
    ];
    const { resolved, withheld } = resolveCitations(units, [hive, comb]);
    expect(resolved.map((r) => r.unit.text)).toEqual(['a', 'c']);
    expect(withheld.map((w) => w.unit.text)).toEqual(['b', 'd']);
  });
});
