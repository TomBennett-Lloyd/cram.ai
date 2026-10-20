import { describe, expect, it } from 'vitest';
import { question } from './eval-fixture';
import { firstForbiddenEntry, GoldenQuestion, inContradictionSet } from './golden-question';

describe('GoldenQuestion', () => {
  it('refuses a field ADR 0005 (c) does not fix', () => {
    const result = GoldenQuestion.safeParse({
      question: 'q',
      expectedCitations: [],
      mustNotContain: [],
      expectedAnswerUnits: [],
    });
    expect(result.success).toBe(false);
  });

  it('refuses a blank mustNotContain entry, which every text would contain', () => {
    const result = GoldenQuestion.safeParse({
      question: 'q',
      expectedCitations: [],
      mustNotContain: ['  '],
    });
    expect(result.success).toBe(false);
  });

  it('refuses a citation naming a slide by anything but lecture and page', () => {
    const result = GoldenQuestion.safeParse({
      question: 'q',
      expectedCitations: [{ lectureId: 'l1', slideNo: 1, sourceId: 's' }],
      mustNotContain: [],
    });
    expect(result.success).toBe(false);
  });

  it('refuses a citation by slide index rather than page number', () => {
    const result = GoldenQuestion.safeParse({
      question: 'q',
      expectedCitations: [{ lectureId: 'l1', slideNo: 0 }],
      mustNotContain: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('inContradictionSet', () => {
  it('holds an item with mustNotContain entries', () => {
    expect(inContradictionSet(question({ mustNotContain: ['hexagon'] }))).toBe(true);
  });

  it('holds an uncovered item', () => {
    expect(inContradictionSet(question({ expectedCitations: [] }))).toBe(true);
  });

  it('leaves out a covered item with nothing forbidden', () => {
    expect(inContradictionSet(question())).toBe(false);
  });
});

describe('firstForbiddenEntry', () => {
  it('matches case-insensitively across normalised whitespace', () => {
    expect(firstForbiddenEntry('Cells are\n  HEXAGONAL in reality', ['hexagonal in reality'])).toBe(
      'hexagonal in reality',
    );
  });

  it('normalises the entry as well as the text', () => {
    expect(firstForbiddenEntry('in reality cells', [' In\tReality '])).toBe(' In\tReality ');
  });

  it('matches an entry as a substring, never as a pattern', () => {
    expect(firstForbiddenEntry('abc', ['a.c'])).toBeUndefined();
    expect(firstForbiddenEntry('a.c', ['a.c'])).toBe('a.c');
  });

  it('returns nothing when no entry occurs', () => {
    expect(firstForbiddenEntry('Cells are square.', ['hexagon', 'in reality'])).toBeUndefined();
  });
});
