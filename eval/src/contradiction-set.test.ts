import { EMPTY_CONTEXT, type ExplainResult } from '@cram/grounding';
import { sourceIdOf } from '@cram/index';
import { describe, expect, it } from 'vitest';
import { contradictionSet } from './contradiction-set';
import { question } from './eval-fixture';
import { asked, grounded, NOT_COVERED, record, sentence } from './run-fixture';

const expectedSlide = record({ slideNo: 1, body: 'Cells are square.' });
const otherSlide = record({ slideNo: 2, body: 'Bees are busy.' });
const slides = [expectedSlide, otherSlide];

const covered = question({
  question: 'What shape are cells?',
  expectedCitations: [{ lectureId: 'l1', slideNo: 1 }],
  mustNotContain: ['hexagon'],
});
const uncovered = question({
  question: 'Who won the cup?',
  expectedCitations: [],
  mustNotContain: [],
});
const outsideSet = question({ question: 'What do bees do?', mustNotContain: [] });

const fromExpected = sentence('Cells are square.', [expectedSlide]);
const fromOther = sentence('Bees are busy.', [otherSlide]);

describe('contradictionSet', () => {
  it('passes a covered item whose sources hold an expected slide', () => {
    expect(
      contradictionSet([asked(grounded([fromExpected], slides), slides, covered)]),
    ).toMatchObject({
      status: 'measured',
      ratio: { numerator: 1, denominator: 1 },
      failures: [],
    });
  });

  it('fails a covered item whose sources hold no expected slide', () => {
    expect(contradictionSet([asked(grounded([fromOther], slides), slides, covered)])).toMatchObject(
      {
        failures: [{ question: covered.question, problems: [{ kind: 'no-expected-citation' }] }],
      },
    );
  });

  it('fails a covered item answered from the same slide number in another lecture', () => {
    const elsewhere = record({ lectureId: 'l2', slideNo: 1, body: 'Cells are square.' });
    const all = [...slides, elsewhere];
    expect(
      contradictionSet([
        asked(grounded([sentence('Cells are square.', [elsewhere])], all), all, covered),
      ]),
    ).toMatchObject({ failures: [{ problems: [{ kind: 'no-expected-citation' }] }] });
  });

  it('lists a forbidden entry beside a coverage problem, not instead of it', () => {
    const caveat = sentence('Bees are busy with hexagons.', [otherSlide]);
    expect(contradictionSet([asked(grounded([caveat], slides), slides, covered)])).toMatchObject({
      failures: [
        {
          problems: [
            { kind: 'no-expected-citation' },
            { kind: 'forbidden-text', entry: 'hexagon' },
          ],
        },
      ],
    });
  });

  it('fails a covered item answered not-covered', () => {
    expect(contradictionSet([asked(NOT_COVERED, slides, covered)])).toMatchObject({
      failures: [{ problems: [{ kind: 'no-expected-citation' }] }],
    });
  });

  it('fails shown text that says a mustNotContain entry, case- and space-insensitively, across sentences', () => {
    const result = grounded(
      [fromExpected, sentence('Cells  are HEXAGONS really.', [expectedSlide])],
      slides,
    );
    expect(contradictionSet([asked(result, slides, covered)])).toMatchObject({
      failures: [
        {
          problems: [
            {
              kind: 'forbidden-text',
              entry: 'hexagon',
              text: 'Cells are square. Cells  are HEXAGONS really.',
            },
          ],
        },
      ],
    });
  });

  it('exempts the withheld panel from mustNotContain', () => {
    const shown = grounded([fromExpected], slides);
    if (shown.status !== 'grounded') throw new Error('a shown explanation');
    const result: ExplainResult = {
      ...shown,
      withheld: [
        {
          reason: 'contradicted',
          text: 'Cells are hexagons.',
          sourceId: sourceIdOf(expectedSlide),
        },
      ],
    };
    expect(contradictionSet([asked(result, slides, covered)])).toMatchObject({ failures: [] });
  });

  it('passes an uncovered item answered not-covered', () => {
    expect(contradictionSet([asked(NOT_COVERED, slides, uncovered)])).toMatchObject({
      ratio: { numerator: 1, denominator: 1 },
    });
  });

  it('fails an uncovered item with any shown explanation', () => {
    expect(
      contradictionSet([asked(grounded([fromOther], slides), slides, uncovered)]),
    ).toMatchObject({
      failures: [{ question: uncovered.question, problems: [{ kind: 'answered-uncovered' }] }],
    });
  });

  it('fails an item whose explanation failed in the model, naming the stage', () => {
    const failed: ExplainResult = {
      status: 'model-failed',
      stage: 'verify',
      failure: { status: 'backend-failed', reason: 'down' },
      context: EMPTY_CONTEXT,
    };
    expect(contradictionSet([asked(failed, slides, covered)])).toMatchObject({
      failures: [{ problems: [{ kind: 'model-failed', stage: 'verify' }] }],
    });
  });

  it('counts only the contradiction set’s items', () => {
    expect(
      contradictionSet([
        asked(grounded([fromOther], slides), slides, outsideSet),
        asked(grounded([fromExpected], slides), slides, covered),
      ]),
    ).toMatchObject({ ratio: { numerator: 1, denominator: 1 } });
  });

  it('is not-measurable when no question is in the set', () => {
    expect(
      contradictionSet([asked(grounded([fromOther], slides), slides, outsideSet)]),
    ).toMatchObject({
      status: 'not-measurable',
    });
  });
});
