import { describe, expect, it } from 'vitest';
import { auditEvalCourse } from './audit';
import {
  course,
  followUp,
  kindLabel,
  label,
  lecture,
  question,
  slide,
  topicLabel,
} from './eval-fixture';

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

  it.each(['What shape are cels?', 'What shape are cells'])(
    'accepts the misspelt variant %j',
    (variant) => {
      const questions = [question({ misspelt: [variant] })];
      expect(auditEvalCourse(course({ questions }))).toEqual([]);
    },
  );

  it('reports a misspelt variant of a question with no expected slide', () => {
    const questions = [question({ expectedCitations: [], misspelt: ['What shape are cels?'] })];
    expect(auditEvalCourse(course({ questions }))).toEqual([
      {
        kind: 'variant-of-uncovered',
        question: 'What shape are cells?',
        variant: 'What shape are cels?',
      },
    ]);
  });

  it.each([
    ['its own question, up to case and whitespace', [' what  SHAPE are\tcells? '], []],
    ['its own question, up to a no-break space', ['What\u00a0shape are cells?'], []],
    ['a later question', ['What colour are cells?'], ['What colour are cells?']],
    ['another variant of the same question', ['What shape are cels?', 'What shape are cels?'], []],
  ])('reports a misspelt variant equal to %s', (_, misspelt, later) => {
    const questions = [
      question({ misspelt }),
      ...later.map((text) => question({ question: text })),
    ];
    expect(auditEvalCourse(course({ questions }))).toEqual([
      { kind: 'duplicate-variant', question: 'What shape are cells?', variant: misspelt.at(-1) },
    ]);
  });

  it('reports a misspelt variant another question already carries', () => {
    const questions = [
      question({ misspelt: ['What shape are cels?'] }),
      question({ question: 'What size are cells?', misspelt: ['what shape are cels?'] }),
    ];
    expect(auditEvalCourse(course({ questions }))).toEqual([
      {
        kind: 'duplicate-variant',
        question: 'What size are cells?',
        variant: 'what shape are cels?',
      },
    ]);
  });

  it('reports a follow-up citing a slide the deck does not have, by the follow-up', () => {
    const followUps = [followUp({ expectedCitations: [{ lectureId: 'l1', slideNo: 2 }] })];
    expect(auditEvalCourse(course({ followUps }))).toEqual([
      { kind: 'unknown-citation', question: 'And how big are they?', lectureId: 'l1', slideNo: 2 },
    ]);
  });

  it('reports a follow-up whose question and standalone form an earlier one already holds', () => {
    const followUps = [
      followUp(),
      followUp({ question: 'and how big are   they?', turns: [{ question: 'Q?', answer: null }] }),
      followUp({ standalone: 'How wide are cells?' }),
    ];
    expect(auditEvalCourse(course({ followUps }))).toEqual([
      {
        kind: 'duplicate-follow-up',
        question: 'and how big are   they?',
        standalone: 'How big are cells?',
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

  it('reports a sentence-kind premise the deck does not have, by lecture and by slide', () => {
    const sentenceKinds = [
      kindLabel({
        premises: [
          { lectureId: 'l1', slideNo: 1 },
          { lectureId: 'l1', slideNo: 2 },
          { lectureId: 'l9', slideNo: 1 },
        ],
      }),
    ];
    const sentence = 'So a cell is one compartment of the comb.';
    expect(auditEvalCourse(course({ sentenceKinds }))).toEqual([
      { kind: 'unknown-premise', sentence, lectureId: 'l1', slideNo: 2 },
      { kind: 'unknown-premise', sentence, lectureId: 'l9', slideNo: 1 },
    ]);
  });

  it('reports a topic label on a slide the deck does not have, and a slide labelled twice', () => {
    const deck = [lecture('l1', [slide(), slide({ slideNo: 2 })])];
    const topics = [
      topicLabel({ lectureId: 'l1', slideNo: 2 }),
      topicLabel({ lectureId: 'l1', slideNo: 3 }),
      topicLabel({ lectureId: 'l9', slideNo: 1 }),
      topicLabel({ lectureId: 'l1', slideNo: 2, tags: ['cells'] }),
    ];
    expect(auditEvalCourse(course({ deck, topicLabels: topics }))).toEqual([
      { kind: 'unknown-topic-slide', lectureId: 'l1', slideNo: 3 },
      { kind: 'unknown-topic-slide', lectureId: 'l9', slideNo: 1 },
      { kind: 'duplicate-topic-slide', lectureId: 'l1', slideNo: 2 },
    ]);
  });

  it('reports a label quote that is not verbatim in any slide', () => {
    const labels = [label({ quotes: ['Cells are square.', 'cells are square.'] })];
    expect(auditEvalCourse(course({ labels }))).toEqual([
      { kind: 'unquotable', text: 'Cells are square.', quote: 'cells are square.' },
    ]);
  });
});
