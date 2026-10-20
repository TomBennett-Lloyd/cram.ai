import type { GroundingResult } from '@cram/grounding';
import { describe, expect, it } from 'vitest';
import { contradictionSet } from './contradiction-set';
import { question } from './eval-fixture';
import { asked, citing, grounded, NOT_COVERED, record, unit } from './run-fixture';

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

const fromExpected = unit('Cells are square.', [citing(expectedSlide, 'Cells are square.')]);
const fromOther = unit('Bees are busy.', [citing(otherSlide, 'Bees are busy.')]);

describe('contradictionSet', () => {
  it('passes a covered item answered from an expected slide', () => {
    expect(contradictionSet([asked(grounded(fromExpected), slides, covered)])).toMatchObject({
      status: 'measured',
      ratio: { numerator: 1, denominator: 1 },
      failures: [],
    });
  });

  it('fails a covered item no surviving unit answers from an expected slide', () => {
    expect(contradictionSet([asked(grounded(fromOther), slides, covered)])).toMatchObject({
      failures: [{ question: covered.question, problems: [{ kind: 'no-expected-citation' }] }],
    });
  });

  it('fails a covered item answered from the same slide number in another lecture', () => {
    const elsewhere = record({ lectureId: 'l2', slideNo: 1, body: 'Cells are square.' });
    const fromElsewhere = unit('Cells are square.', [citing(elsewhere, 'Cells are square.')]);
    expect(
      contradictionSet([asked(grounded(fromElsewhere), [...slides, elsewhere], covered)]),
    ).toMatchObject({ failures: [{ problems: [{ kind: 'no-expected-citation' }] }] });
  });

  it('lists a forbidden entry beside a coverage problem, not instead of it', () => {
    const caveat = unit('Bees are busy with hexagons.', [citing(otherSlide, 'Bees are busy.')]);
    expect(contradictionSet([asked(grounded(caveat), slides, covered)])).toMatchObject({
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

  it('fails a surviving unit that says a mustNotContain entry, case- and space-insensitively', () => {
    const caveat = unit('Cells  are HEXAGONS really.', [
      citing(expectedSlide, 'Cells are square.'),
    ]);
    expect(
      contradictionSet([asked(grounded(fromExpected, caveat), slides, covered)]),
    ).toMatchObject({
      failures: [{ problems: [{ kind: 'forbidden-text', entry: 'hexagon', text: caveat.text }] }],
    });
  });

  it('exempts the withheld panel from mustNotContain', () => {
    const withheldCaveat = unit('Cells are hexagons.', [
      citing(expectedSlide, 'Cells are square.'),
    ]);
    const result: GroundingResult = {
      status: 'grounded',
      shown: [fromExpected],
      withheld: [{ reason: 'unsupported', unit: withheldCaveat }],
    };
    expect(contradictionSet([asked(result, slides, covered)])).toMatchObject({ failures: [] });
  });

  it('passes an uncovered item answered not-covered', () => {
    expect(contradictionSet([asked(NOT_COVERED, slides, uncovered)])).toMatchObject({
      ratio: { numerator: 1, denominator: 1 },
    });
  });

  it('fails an uncovered item with any surviving unit', () => {
    expect(contradictionSet([asked(grounded(fromOther), slides, uncovered)])).toMatchObject({
      failures: [{ question: uncovered.question, problems: [{ kind: 'answered-uncovered' }] }],
    });
  });

  it('fails an item whose Ask failed in the model, naming the stage', () => {
    const failed: GroundingResult = {
      status: 'model-failed',
      stage: 'verify',
      failure: { status: 'backend-failed', reason: 'down' },
    };
    expect(contradictionSet([asked(failed, slides, covered)])).toMatchObject({
      failures: [{ problems: [{ kind: 'model-failed', stage: 'verify' }] }],
    });
  });

  it('counts only the contradiction set’s items', () => {
    expect(
      contradictionSet([
        asked(grounded(fromOther), slides, outsideSet),
        asked(grounded(fromExpected), slides, covered),
      ]),
    ).toMatchObject({ ratio: { numerator: 1, denominator: 1 } });
  });

  it('is not-measurable when no question is in the set', () => {
    expect(contradictionSet([asked(grounded(fromOther), slides, outsideSet)])).toMatchObject({
      status: 'not-measurable',
    });
  });
});
