import { describe, expect, it } from 'vitest';
import { claimSpans, spansOf, splitClaims } from './claims';

describe('splitClaims', () => {
  it('keeps one sentence as one claim', () => {
    expect(splitClaims('The queen is fed royal jelly and never leaves the hive.')).toEqual([
      'The queen is fed royal jelly and never leaves the hive.',
    ]);
  });

  it.each([
    ['.', 'Workers are male. Drones are female.'],
    ['!', 'Workers are male! Drones are female.'],
    ['?', 'Workers are male? Drones are female.'],
  ])('splits after %s before a capital', (_, text) => {
    expect(splitClaims(text)).toHaveLength(2);
  });

  it('splits after a full stop before a numeral', () => {
    expect(splitClaims('Cells are square. 4 sides each.')).toEqual([
      'Cells are square.',
      '4 sides each.',
    ]);
  });

  it('splits before a capital outside ASCII', () => {
    expect(splitClaims('Cells are square. Écrit by the guild.')).toHaveLength(2);
  });

  it('splits after a semicolon whatever follows', () => {
    expect(splitClaims('Workers are male; drones are female.')).toEqual([
      'Workers are male;',
      'drones are female.',
    ]);
  });

  it('does not split an abbreviation before a lowercase word', () => {
    expect(splitClaims('Some castes, e.g. drones, never forage.')).toHaveLength(1);
  });

  it('does not split a decimal or a full stop with no space after it', () => {
    expect(splitClaims('A cell is 5.4 mm across.Drones too.')).toHaveLength(1);
  });

  it('trims whitespace around the text and around each claim', () => {
    expect(splitClaims('  Workers are male.  Drones are female. ')).toEqual([
      'Workers are male.',
      'Drones are female.',
    ]);
  });

  it('drops the empty tail a trailing boundary leaves', () => {
    expect(splitClaims('Workers are male; ')).toEqual(['Workers are male;']);
  });
});

describe('claimSpans', () => {
  it('places each claim where it sits, past a repeat of an earlier one', () => {
    const text = '  Bees sleep.  Bees sleep; then wake.';
    expect(claimSpans(text)).toEqual([
      { text: 'Bees sleep.', start: 2, end: 13 },
      { text: 'Bees sleep;', start: 15, end: 26 },
      { text: 'then wake.', start: 27, end: 37 },
    ]);
  });
});

describe('spansOf', () => {
  it('refuses a claim the text does not hold past the one before it', () => {
    expect(() => spansOf('Bees sleep. Bees wake.', ['Bees wake.', 'Bees sleep.'])).toThrow(
      'spansOf: "Bees sleep." is not in the text past 22',
    );
  });
});
