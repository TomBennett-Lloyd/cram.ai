import type { ExplainResult } from '@cram/grounding';
import { describe, expect, it } from 'vitest';
import { question } from './eval-fixture';
import {
  attributionRecall,
  attributionSet,
  contradictionSetLight,
  lightFlagRate,
} from './light-rows';
import { asked, citing, grounded, NOT_COVERED, record, sentence } from './run-fixture';

const expectedSlide = record({ slideNo: 1, body: 'Cells are square.' });
const otherSlide = record({ slideNo: 2, body: 'Bees are busy.' });
const elsewhere = record({ lectureId: 'l2', slideNo: 1, body: 'Cells are square.' });
const slides = [expectedSlide, otherSlide, elsewhere];

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

const forbidden = (contradicts = [expectedSlide]) =>
  sentence('Cells are hexagons.', [otherSlide, expectedSlide], contradicts);
const light = (result: ExplainResult, golden = covered) => asked(result, slides, golden);

describe('attributionSet', () => {
  it('names each sentence’s slides and every quoted slide', () => {
    const result = grounded([sentence('Bees are busy.', [otherSlide])], slides, [
      citing(elsewhere, 'Cells are square.'),
    ]);
    expect(attributionSet(light(result))).toHaveLength(2);
  });
});

describe('attributionRecall', () => {
  it('pools expected slides over every question with any, found in that answer’s attribution set', () => {
    const two = question({
      expectedCitations: [
        { lectureId: 'l1', slideNo: 1 },
        { lectureId: 'l1', slideNo: 2 },
      ],
    });
    expect(
      attributionRecall([
        light(grounded([sentence('Cells are square.', [expectedSlide])], slides), two),
        light(NOT_COVERED),
        light(NOT_COVERED, uncovered),
      ]),
    ).toMatchObject({ ratio: { numerator: 1, denominator: 3 } });
  });

  it('does not find an expected slide by its number in another lecture', () => {
    expect(
      attributionRecall([light(grounded([sentence('Cells are square.', [elsewhere])], slides))]),
    ).toMatchObject({ ratio: { numerator: 0, denominator: 1 } });
  });

  it('is not-measurable when no question names an expected slide', () => {
    expect(attributionRecall([light(NOT_COVERED, uncovered)])).toMatchObject({
      status: 'not-measurable',
    });
  });
});

describe('contradictionSetLight', () => {
  it('passes a forbidden sentence marked against an expected slide, shown whole', () => {
    expect(contradictionSetLight([light(grounded([forbidden()], slides))])).toMatchObject({
      bar: 'baseline',
      ratio: { numerator: 1, denominator: 1 },
      failures: [],
    });
  });

  it('fails a forbidden sentence left unmarked, or marked against another slide only', () => {
    for (const contradicts of [[], [otherSlide]])
      expect(
        contradictionSetLight([light(grounded([forbidden(contradicts)], slides))]),
      ).toMatchObject({
        failures: [
          {
            problems: [
              { kind: 'unflagged-forbidden-text', entry: 'hexagon', text: 'Cells are hexagons.' },
            ],
          },
        ],
      });
  });

  it('fails a covered item whose attribution set misses every expected slide', () => {
    const result = grounded([sentence('Bees are busy.', [otherSlide])], slides);
    expect(contradictionSetLight([light(result)])).toMatchObject({
      failures: [{ problems: [{ kind: 'no-expected-citation' }] }],
    });
  });

  it('passes an uncovered item only as not-covered, and counts the set’s items only', () => {
    expect(
      contradictionSetLight([
        light(NOT_COVERED, uncovered),
        light(grounded([sentence('Bees are busy.', [otherSlide])], slides), uncovered),
        light(NOT_COVERED, outsideSet),
      ]),
    ).toMatchObject({
      ratio: { numerator: 1, denominator: 2 },
      failures: [{ problems: [{ kind: 'answered-uncovered' }] }],
    });
  });

  it('fails a model failure with its stage, and is not-measurable with no set item', () => {
    const failed: ExplainResult = {
      status: 'model-failed',
      stage: 'generate',
      failure: { status: 'backend-failed', reason: 'down' },
    };
    expect(contradictionSetLight([light(failed)])).toMatchObject({
      failures: [{ problems: [{ kind: 'model-failed', stage: 'generate' }] }],
    });
    expect(contradictionSetLight([light(NOT_COVERED, outsideSet)])).toMatchObject({
      status: 'not-measurable',
    });
  });
});

describe('lightFlagRate', () => {
  it('counts the set’s answers that show a forbidden sentence, and those whose every such sentence is marked', () => {
    const square = sentence('Cells are square.', [expectedSlide]);
    expect(
      lightFlagRate([
        light(grounded([forbidden(), forbidden([])], slides)),
        light(grounded([forbidden()], slides)),
        light(grounded([square], slides)),
        light(grounded([forbidden([])], slides), outsideSet),
      ]),
    ).toMatchObject({ ratio: { numerator: 1, denominator: 2 } });
  });

  it('is not-measurable when no answer in the set shows a forbidden sentence', () => {
    expect(lightFlagRate([light(NOT_COVERED)])).toMatchObject({ status: 'not-measurable' });
  });
});
