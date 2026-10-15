import { describe, expect, it } from 'vitest';
import { StyleExemplar } from './style-exemplar';

const mcq = {
  type: 'mcq',
  stem: 'Which organelle makes ATP?',
  options: ['Nucleus', 'Mitochondrion'],
};

describe('StyleExemplar', () => {
  it('parses a multiple-choice question with options and marks', () => {
    expect(StyleExemplar.safeParse({ ...mcq, marks: 2 }).success).toBe(true);
  });

  it('parses an essay question with no marks stated', () => {
    expect(StyleExemplar.safeParse({ type: 'essay', stem: 'Discuss respiration.' }).success).toBe(
      true,
    );
  });

  it('refuses a multiple-choice question with fewer than two options', () => {
    expect(StyleExemplar.safeParse({ ...mcq, options: ['Nucleus'] }).success).toBe(false);
  });

  it('refuses options on a short-answer question', () => {
    expect(StyleExemplar.safeParse({ ...mcq, type: 'short' }).success).toBe(false);
  });

  it('refuses zero marks', () => {
    expect(StyleExemplar.safeParse({ ...mcq, marks: 0 }).success).toBe(false);
  });
});
