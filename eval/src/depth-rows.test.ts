import type { ExplainResult } from '@cram/grounding';
import { sourceIdOf } from '@cram/index';
import type { WithheldSentence } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import {
  attributionCounts,
  deepPairCounts,
  explanationEntailed,
  explanationWithheld,
  quotedShare,
} from './depth-rows';
import { asked, citing, grounded, NOT_COVERED, record, sentence } from './run-fixture';

const slide = record({ body: 'Cells are square.\nBees are busy.' });
const square = sentence('Cells are square.', [slide]);
const busy = sentence('Bees are busy.', [slide]);
const unattributed = sentence('Bees hum.', []);

const withWithheld = (
  result: ExplainResult,
  withheld: readonly WithheldSentence[],
): ExplainResult => (result.status === 'model-failed' ? result : { ...result, withheld });

describe('explanationWithheld', () => {
  it('counts withheld sentences over sentences written, leaving dropped pointers out', () => {
    const id = sourceIdOf(slide);
    const shown = withWithheld(grounded([square], [slide]), [
      { reason: 'unsupported', text: 'Bees hum.' },
      { reason: 'dangling-citation', text: '[9]', sourceId: id },
    ]);
    const none = withWithheld(NOT_COVERED, [
      { reason: 'contradicted', text: 'Cells are round.', sourceId: id },
    ]);
    expect(explanationWithheld([asked(shown), asked(none)])).toMatchObject({
      ratio: { numerator: 2, denominator: 3 },
    });
  });

  it('is not-measurable when no explanation was written', () => {
    expect(explanationWithheld([asked(NOT_COVERED)])).toMatchObject({ status: 'not-measurable' });
  });
});

describe('explanationEntailed', () => {
  it('counts the shown sentences some slide entailed', () => {
    const entailed = sentence('Cells are square.', [slide], [], 'entailed');
    const kept = sentence('Bees hum.', [], [], 'interpretation');
    expect(explanationEntailed([asked(grounded([entailed, kept], [slide]))])).toMatchObject({
      ratio: { numerator: 1, denominator: 2 },
    });
  });

  it('does not count a sentence with candidate slides that none entailed', () => {
    expect(explanationEntailed([asked(grounded([square, busy], [slide]))])).toMatchObject({
      ratio: { numerator: 0, denominator: 2 },
    });
  });
});

describe('quotedShare', () => {
  it('counts the shown sentences holding any part of a quote', () => {
    const result = grounded([square, busy], [slide], [citing(slide, 'Cells are square.')]);
    expect(quotedShare([asked(result)])).toMatchObject({ ratio: { numerator: 1, denominator: 2 } });
  });

  it('counts a quote crossing a boundary in both sentences', () => {
    const result = grounded([square, busy], [slide], [citing(slide, 'square. Bees')]);
    expect(quotedShare([asked(result)])).toMatchObject({ ratio: { numerator: 2, denominator: 2 } });
  });
});

describe('attributionCounts', () => {
  it('counts answers and sentences from the explanations, and takes the pairs the verifier was sent', () => {
    expect(
      attributionCounts(
        [asked(grounded([square, busy, unattributed], [slide])), asked(NOT_COVERED)],
        { pairs: 7, overLength: 4 },
      ),
    ).toEqual({ answers: 1, sentences: 3, pairs: 7, overLengthPairs: 4 });
  });
});

describe('deepPairCounts', () => {
  it('counts each answer that sent any pair, the pairs, the most one answer sent, and the over-length ones', () => {
    expect(
      deepPairCounts([
        { pairs: 12, overLength: 1 },
        { pairs: 0, overLength: 0 },
        { pairs: 30, overLength: 2 },
      ]),
    ).toEqual({ answers: 2, pairs: 42, maxPairs: 30, overLengthPairs: 3 });
  });

  it('is zero throughout when no answer sent a pair', () => {
    expect(deepPairCounts([{ pairs: 0, overLength: 0 }])).toEqual({
      answers: 0,
      pairs: 0,
      maxPairs: 0,
      overLengthPairs: 0,
    });
  });
});
