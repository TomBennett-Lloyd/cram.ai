import { describe, expect, it } from 'vitest';
import { citationValidity } from './citation-validity';
import { asked, citing, grounded, NOT_COVERED, record, unit } from './run-fixture';

const slide = record();
const valid = unit('Cells are square.', [citing(slide, 'Cells are square.')]);

describe('citationValidity', () => {
  it('counts every surviving unit whose citations resolve', () => {
    expect(citationValidity([asked(grounded(valid, valid))])).toMatchObject({
      status: 'measured',
      ratio: { numerator: 2, denominator: 2 },
      failures: [],
    });
  });

  it('fails a surviving unit whose quote is not on the cited slide', () => {
    const paraphrase = unit('Cells are square.', [citing(slide, 'Cells are four-sided.')]);
    expect(citationValidity([asked(grounded(valid, paraphrase))])).toMatchObject({
      ratio: { numerator: 1, denominator: 2 },
      failures: [{ question: 'What shape are cells?', unit: paraphrase }],
    });
  });

  it('fails a surviving unit citing a slide outside that call’s retrieved set', () => {
    const elsewhere = record({ slideNo: 2 });
    const stray = unit('Cells are square.', [citing(elsewhere, 'Cells are square.')]);
    expect(citationValidity([asked(grounded(stray))])).toMatchObject({
      failures: [{ unit: stray }],
    });
  });

  it('fails a unit if any one of its citations dangles', () => {
    const mixed = unit('Cells are square.', [
      citing(slide, 'Cells are square.'),
      citing(slide, 'Cells are round.'),
    ]);
    expect(citationValidity([asked(grounded(mixed))])).toMatchObject({
      ratio: { numerator: 0, denominator: 1 },
    });
  });

  it('is not-measurable when no unit survived anywhere', () => {
    expect(citationValidity([asked(NOT_COVERED)])).toMatchObject({ status: 'not-measurable' });
  });
});
