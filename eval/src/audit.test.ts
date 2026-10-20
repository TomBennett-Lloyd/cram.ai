import { describe, expect, it } from 'vitest';
import { auditEvalCourse } from './audit';
import { course, label, lecture, question, slide } from './eval-fixture';

describe('auditEvalCourse', () => {
  it('finds nothing in a consistent course', () => {
    expect(auditEvalCourse(course())).toEqual([]);
  });

  it('reports a lecture id used twice', () => {
    const deck = [lecture('l1'), lecture('l1')];
    expect(auditEvalCourse(course({ deck }))).toEqual([
      { kind: 'duplicate-lecture', lectureId: 'l1' },
    ]);
  });

  it('reports a slide whose number is not its page in the lecture', () => {
    const deck = [lecture('l1', [slide(), slide({ slideNo: 3 })])];
    expect(auditEvalCourse(course({ deck }))).toEqual([
      { kind: 'slide-numbering', lectureId: 'l1', expected: 2, found: 3 },
    ]);
  });

  it('reports a question asked twice', () => {
    const questions = [question(), question()];
    expect(auditEvalCourse(course({ questions }))).toEqual([
      { kind: 'duplicate-question', question: 'What shape are cells?' },
    ]);
  });

  it('reports a citation to a slide the deck does not have', () => {
    const questions = [question({ expectedCitations: [{ lectureId: 'l1', slideNo: 2 }] })];
    expect(auditEvalCourse(course({ questions }))).toEqual([
      { kind: 'unknown-citation', question: 'What shape are cells?', lectureId: 'l1', slideNo: 2 },
    ]);
  });

  it('reports a citation to a lecture the deck does not have', () => {
    const questions = [question({ expectedCitations: [{ lectureId: 'l9', slideNo: 1 }] })];
    expect(auditEvalCourse(course({ questions }))).toMatchObject([
      { kind: 'unknown-citation', lectureId: 'l9' },
    ]);
  });

  it('reports a forbidden entry that any slide, uncited ones included, contains', () => {
    const deck = [
      lecture('l1', [
        slide(),
        slide({ slideNo: 2, title: 'Myths', body: [], speakerNotes: 'Not HEXAGONAL.' }),
      ]),
    ];
    const questions = [question({ mustNotContain: ['in reality', 'hexagonal'] })];
    expect(auditEvalCourse(course({ deck, questions }))).toEqual([
      {
        kind: 'forbidden-in-deck',
        question: 'What shape are cells?',
        entry: 'hexagonal',
        lectureId: 'l1',
        slideNo: 2,
      },
    ]);
  });

  it('accepts a label quote that spans bullets once whitespace is normalised', () => {
    const deck = [lecture('l1', [slide({ body: ['Cells are', 'square.'] })])];
    expect(auditEvalCourse(course({ deck, labels: [label()] }))).toEqual([]);
  });

  it('accepts a label quote whose own whitespace differs from the slide', () => {
    const labels = [label({ quotes: ['Cells  are\nsquare.'] })];
    expect(auditEvalCourse(course({ labels }))).toEqual([]);
  });

  it('reports a label quote that is not verbatim in any slide', () => {
    const labels = [label({ quotes: ['Cells are square.', 'cells are square.'] })];
    expect(auditEvalCourse(course({ labels }))).toEqual([
      { kind: 'unquotable', text: 'Cells are square.', quote: 'cells are square.' },
    ]);
  });
});
