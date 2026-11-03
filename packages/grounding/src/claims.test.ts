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

  it.each([
    ['straight double quote', 'The slides say "Worker bees are male." Their comb is square.'],
    ['straight single quote', "The slides say 'Worker bees are male.' Their comb is square."],
    ['typographic double quote', 'The slides say “Worker bees are male.” Their comb is square.'],
    ['typographic single quote', 'The slides say ‘Worker bees are male.’ Their comb is square.'],
    [
      'nested pair of quotes',
      'They read "the slide says \'Workers are male!\'" Their comb is square.',
    ],
  ])('splits after a closing %s before a capital', (_, text) => {
    expect(splitClaims(text)).toHaveLength(2);
  });

  it('keeps the closing quote with the sentence it ends', () => {
    expect(
      splitClaims('The slides put it plainly: “Worker bees are male?”  4 sides each.'),
    ).toEqual(['The slides put it plainly: “Worker bees are male?”', '4 sides each.']);
  });

  it.each([
    ['straight double quote', 'Workers are male. "Drones are female."'],
    ['straight single quote', "Workers are male. 'Drones are female.'"],
    ['typographic double quote', 'Workers are male. “Drones are female.”'],
    ['typographic single quote', 'Workers are male. ‘Drones are female.’'],
    ['pair of quotes', 'Workers are male. “‘Drones’ are female.”'],
  ])('splits before an opening %s before a capital', (_, text) => {
    expect(splitClaims(text)).toHaveLength(2);
  });

  it.each([
    ['an opening double quote after the terminal', 'Workers are male.“ Drones are female.'],
    ['an opening single quote after the terminal', 'Workers are male.‘ Drones are female.'],
    ['a closing double quote before the capital', 'Workers are male. ”Drones are female.”'],
    ['a closing single quote before the capital', 'Workers are male. ’Drones’ are female.'],
  ])('splits at %s, a quote mark set the wrong way round', (_, text) => {
    expect(splitClaims(text)).toHaveLength(2);
  });

  it.each([
    ['a newline', '“Workers are male.”\nDrones are female.'],
    ['a tab', '“Workers are male.”\tDrones are female.'],
  ])('splits after a closing quote at %s', (_, text) => {
    expect(splitClaims(text)).toEqual(['“Workers are male.”', 'Drones are female.']);
  });

  it('splits between two quoted sentences', () => {
    expect(splitClaims('“Workers are male.” “Drones are female.”')).toEqual([
      '“Workers are male.”',
      '“Drones are female.”',
    ]);
  });

  it.each([
    ['parenthesis', 'Workers are male.) Drones are female.'],
    ['square bracket', 'Workers are male.] Drones are female.'],
    ['guillemet', 'Workers are male.» Drones are female.'],
    ['single guillemet', 'Workers are male.› Drones are female.'],
    ['parenthesis then a quote', 'Workers are male.)” Drones are female.'],
  ])('splits after a closing %s before a capital', (_, text) => {
    expect(splitClaims(text)).toHaveLength(2);
  });

  it.each([
    ['parenthesis', 'Workers are male. (Drones are female.)'],
    ['guillemet', 'Workers are male. «Drones are female.»'],
    ['single guillemet', 'Workers are male. ‹Drones are female.›'],
    ['low double quote', 'Workers are male. „Drones are female.“'],
    ['quote then a parenthesis', 'Workers are male. “(Drones are female.)”'],
  ])('splits before an opening %s before a capital', (_, text) => {
    expect(splitClaims(text)).toHaveLength(2);
  });

  it.each([
    ['an opening parenthesis after the terminal', 'Workers are male.( Drones are female.'],
    ['a closing parenthesis before the capital', 'Workers are male. )Drones are female.'],
    ['a closing guillemet before the capital', 'Workers are male. »Drones are female.«'],
  ])('splits at %s, a bracket set the wrong way round', (_, text) => {
    expect(splitClaims(text)).toHaveLength(2);
  });

  it('splits a parenthesised sentence from the sentences either side of it', () => {
    expect(splitClaims('Workers are male. (See the hive diagram.) Drones are female.')).toEqual([
      'Workers are male.',
      '(See the hive diagram.)',
      'Drones are female.',
    ]);
  });

  it('splits before a line pointer and keeps it with the sentence it opens', () => {
    expect(splitClaims('Workers are male. [1] Drones are female.')).toEqual([
      'Workers are male.',
      '[1] Drones are female.',
    ]);
  });

  it.each([
    [
      'a currency sign',
      'The hive costs £5. £20 Buys a nucleus.',
      ['The hive costs £5.', '£20 Buys a nucleus.'],
    ],
    [
      'a hash',
      'Workers are male. #1 Drones are female.',
      ['Workers are male.', '#1 Drones are female.'],
    ],
    [
      'an asterisk',
      'Workers are male. *Drones are female.',
      ['Workers are male.', '*Drones are female.'],
    ],
    [
      'an underscore',
      'Workers are male. _Drones_ are female.',
      ['Workers are male.', '_Drones_ are female.'],
    ],
    [
      'a backtick',
      'Workers are male. `Drones` are female.',
      ['Workers are male.', '`Drones` are female.'],
    ],
    [
      'an arrow',
      'Workers are male. →Drones are female.',
      ['Workers are male.', '→Drones are female.'],
    ],
    [
      'an ornament quote',
      'Workers are male. ❝Drones are female.❞',
      ['Workers are male.', '❝Drones are female.❞'],
    ],
    [
      'a substitution mark',
      'Workers are male. ⸀Drones are female.',
      ['Workers are male.', '⸀Drones are female.'],
    ],
  ])(
    'splits before %s before a capital and keeps it with the sentence it opens',
    (_, text, claims) => {
      expect(splitClaims(text)).toEqual(claims);
    },
  );

  it('splits before a currency sign before a numeral, as before the bare numeral', () => {
    expect(splitClaims('The hive costs £5. £20 buys a nucleus.')).toEqual([
      'The hive costs £5.',
      '£20 buys a nucleus.',
    ]);
  });

  it.each([
    ['a trademark sign', 'Workers are male.™ Drones are female.', 'Workers are male.™'],
    ['a footnote asterisk', 'Workers are male.* Drones are female.', 'Workers are male.*'],
    ['a dagger', 'Workers are male.† Drones are female.', 'Workers are male.†'],
    ['closing emphasis', '_Workers are male._ Drones are female.', '_Workers are male._'],
    ['an ornament quote', '❝Workers are male.❞ Drones are female.', '❝Workers are male.❞'],
    ['a substitution mark', 'Workers are male.⸀ Drones are female.', 'Workers are male.⸀'],
  ])('keeps %s after the terminal with the sentence it ends', (_, text, first) => {
    expect(splitClaims(text)).toEqual([first, 'Drones are female.']);
  });

  it.each(['055D', '060D', '066B', '066C', 'FE10', 'FE11', 'FE13', 'FE14'])(
    'does not split at U+%s after the terminal, a mark UAX #29 continues through',
    (hex) => {
      const mark = String.fromCodePoint(Number.parseInt(hex, 16));
      expect(splitClaims(`Workers are male.${mark} Drones are female.`)).toHaveLength(1);
    },
  );

  it.each([
    ['after a closing quote', '"Is it?" she asked.'],
    ['after an opening quote', 'Workers are male. "drones" are not.'],
    ['after an opening parenthesis', 'Workers are male. (see the diagram) and drones are not.'],
    ['after a closing parenthesis', '(Workers are male.) drones are female.'],
    ['in a parenthesised enumerator', 'Workers are male. (i) Drones are female.'],
    ['after an asterisk', 'Workers are male. *drones* are not.'],
    ['after a mark between the terminal and the space', 'Workers are male.* drones are not.'],
  ])('does not split before a lowercase word %s', (_, text) => {
    expect(splitClaims(text)).toHaveLength(1);
  });

  it.each([
    ['a quote mark with no terminal before it', 'They call them "workers" Drones differ.'],
    ['a full stop inside a word', 'Cells are 5.4mm Drones are not.'],
    ['a dash before the capital', 'Workers are male. —Drones are female.'],
    ['a comma after the terminal', 'Some castes, e.g., Drones, never forage.'],
    ['a circled capital after the terminal', 'Workers are male.Ⓐ Drones are female.'],
    ['a circled lowercase letter before the capital', 'Workers are male. ⓐDrones are female.'],
  ])('does not split at %s', (_, text) => {
    expect(splitClaims(text)).toHaveLength(1);
  });

  it.each([
    ['a blank line', 'Castes\n\nDrones are male.'],
    ['a blank line holding a space and a tab', 'Castes\n \t\nDrones are male.'],
    ['three line endings', 'Castes\n\n\nDrones are male.'],
    ['two CRLF line endings', 'Castes\r\n\r\nDrones are male.'],
    ['two carriage returns', 'Castes\r\rDrones are male.'],
    ['a line feed then a carriage return', 'Castes\n\rDrones are male.'],
  ])('splits a heading from the sentence after it at %s', (_, text) => {
    expect(splitClaims(text)).toEqual(['Castes', 'Drones are male.']);
  });

  it.each([
    ['before a lowercase word', 'Workers are\n\nmale.', ['Workers are', 'male.']],
    [
      'after a colon',
      'The castes:\n\nqueen, worker, drone.',
      ['The castes:', 'queen, worker, drone.'],
    ],
    [
      'after a full stop before a lowercase word',
      'Bees fly.\n\nthen rest.',
      ['Bees fly.', 'then rest.'],
    ],
    ['inside a quotation', '“Castes\n\nDrones are male.”', ['“Castes', 'Drones are male.”']],
    [
      'mid-text',
      'Bees fly. Castes\n\nDrones are male.',
      ['Bees fly.', 'Castes', 'Drones are male.'],
    ],
  ])('splits at a blank line %s', (_, text, claims) => {
    expect(splitClaims(text)).toEqual(claims);
  });

  it.each([
    ['a line feed', 'Castes\nDrones are male.'],
    ['a CRLF', 'Castes\r\nDrones are male.'],
    ['a carriage return', 'Castes\rDrones are male.'],
    ['two line feeds around a no-break space', 'Castes\n\u00a0\nDrones are male.'],
    ['two line feeds around a form feed', 'Castes\n\f\nDrones are male.'],
    ['two paragraph separators', 'Castes\u2029\u2029Drones are male.'],
    ['a line feed then a paragraph separator', 'Castes\n\u2029Drones are male.'],
    ['a paragraph separator then a line feed', 'Castes\u2029\nDrones are male.'],
  ])('does not split a heading from the sentence after it at %s', (_, text) => {
    expect(splitClaims(text)).toHaveLength(1);
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
