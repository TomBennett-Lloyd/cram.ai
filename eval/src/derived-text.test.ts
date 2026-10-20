import { describe, expect, it } from 'vitest';
import { derivedTextAccuracy, derivedTextCoverage, derivedTextTokens } from './derived-text';
import { SlideRef } from './golden-question';

const ref = (slideNo: number): SlideRef => SlideRef.parse({ lectureId: 'l1', slideNo });

describe('derivedTextTokens', () => {
  it('lower-cases, strips punctuation and splits on any whitespace', () => {
    expect(derivedTextTokens(' Queens’ cells,\n  are SQUARE!\tWell-known. ')).toEqual([
      'queens',
      'cells',
      'are',
      'square',
      'wellknown',
    ]);
  });

  it('gives no token for punctuation alone', () => {
    expect(derivedTextTokens('— … !')).toEqual([]);
  });
});

describe('derivedTextCoverage', () => {
  it('lists each imageOnly slide whose record is not derived', () => {
    expect(
      derivedTextCoverage([
        { ref: ref(1), derived: true },
        { ref: ref(2), derived: false },
      ]),
    ).toEqual({
      status: 'measured',
      bar: 'absolute',
      ratio: { numerator: 1, denominator: 2 },
      failures: [ref(2)],
    });
  });

  it('is not-measurable with no imageOnly slide', () => {
    expect(derivedTextCoverage([])).toMatchObject({ status: 'not-measurable' });
  });
});

describe('derivedTextAccuracy', () => {
  it('pools tokens over slides', () => {
    expect(
      derivedTextAccuracy([
        { trueText: 'cells are square', derivedText: 'cells are' },
        { trueText: 'bees', derivedText: 'bees buzz' },
      ]),
    ).toEqual({
      recall: { status: 'measured', bar: 'baseline', ratio: { numerator: 3, denominator: 4 } },
      precision: { status: 'measured', bar: 'baseline', ratio: { numerator: 3, denominator: 4 } },
    });
  });

  it('counts a repeated token only as often as the scarcer side holds it', () => {
    const { recall, precision } = derivedTextAccuracy([
      { trueText: 'the the the cells', derivedText: 'the cells cells' },
    ]);
    expect(recall).toMatchObject({ ratio: { numerator: 2, denominator: 4 } });
    expect(precision).toMatchObject({ ratio: { numerator: 2, denominator: 3 } });
  });

  it('matches a token only within its own slide', () => {
    const { recall } = derivedTextAccuracy([
      { trueText: 'cells', derivedText: '' },
      { trueText: 'bees', derivedText: 'cells' },
    ]);
    expect(recall).toMatchObject({ ratio: { numerator: 0, denominator: 2 } });
  });

  it('is not-measurable on the side with no tokens', () => {
    expect(derivedTextAccuracy([{ trueText: 'cells', derivedText: '' }])).toMatchObject({
      precision: { status: 'not-measurable' },
    });
  });
});
