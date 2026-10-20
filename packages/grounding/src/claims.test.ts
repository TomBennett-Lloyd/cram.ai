import { describe, expect, it } from 'vitest';
import { splitClaims } from './claims';

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

  it('drops the empty tail a trailing boundary leaves', () => {
    expect(splitClaims('Workers are male; ')).toEqual(['Workers are male;']);
  });
});
