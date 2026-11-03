import { describe, expect, it } from 'vitest';
import { citationValidity } from './citation-validity';
import { asked, citing, grounded, NOT_COVERED, record, retrieved, sentence } from './run-fixture';

const slide = record();
const said = sentence('Cells are square.', [slide]);

describe('citationValidity', () => {
  it('counts every shown quote that resolves', () => {
    const quotes = [citing(slide, 'Cells are square.'), citing(slide, 'Cells are square.')];
    expect(citationValidity([asked(grounded([said], [slide], quotes))])).toMatchObject({
      status: 'measured',
      ratio: { numerator: 2, denominator: 2 },
      failures: [],
    });
  });

  it('fails a quote that is not on its slide', () => {
    const paraphrase = citing(slide, 'Cells are four-sided.');
    const quotes = [citing(slide, 'Cells are square.'), paraphrase];
    expect(citationValidity([asked(grounded([said], [slide], quotes))])).toMatchObject({
      ratio: { numerator: 1, denominator: 2 },
      failures: [{ question: 'What shape are cells?', quote: paraphrase }],
    });
  });

  it('fails a quote of a slide outside that call’s prompt, though retrieval returned it', () => {
    const elsewhere = record({ slideNo: 2 });
    const stray = citing(elsewhere, 'Cells are square.');
    expect(citationValidity([asked(grounded([said], [slide], [stray]))])).toMatchObject({
      failures: [{ quote: stray }],
    });
    const result = grounded([said], [slide, elsewhere], [stray]);
    const dropped = { ...result, context: { ...result.context, raw: [retrieved(slide)] } };
    expect(citationValidity([asked(dropped, [slide, elsewhere])])).toMatchObject({
      failures: [{ quote: stray }],
    });
  });

  it('is not-measurable when no quote was shown anywhere', () => {
    expect(citationValidity([asked(NOT_COVERED), asked(grounded([said]))])).toMatchObject({
      status: 'not-measurable',
    });
  });
});
