import { describe, expect, it } from 'vitest';
import {
  CourseUnavailableProblem,
  type DroppedPointer,
  SlideNo,
  SourceId,
  type Unit,
  WithheldSentence,
  WithheldUnit,
} from '@cram/shared';
import {
  APPEARS_TO_CONTRADICT,
  contradictionRefLabel,
  DERIVED_SOURCE,
  discardedMessage,
  DROPPED_QUOTES_NOTE,
  droppedQuotesHeading,
  sourceRefLabel,
  storedUnavailableMessage,
  withheldHeading,
  withheldMessage,
  withheldUnitMessage,
} from './copy';

const sourceId = SourceId.parse('s1');
const text = 'Drones forage.';

describe('withheldMessage', () => {
  it('gives each reason an explanation withholds a sentence for its own sentence', () => {
    const entries: Exclude<WithheldSentence, DroppedPointer>[] = [
      { reason: 'contradicted', text, sourceId },
      { reason: 'unsupported', text },
      { reason: 'ungrounded', text },
    ];
    expect([...entries.map(({ reason }) => reason), 'dangling-citation'].sort()).toEqual(
      WithheldSentence.options.map((arm) => arm.shape.reason.value).sort(),
    );
    const sentences = entries.map(withheldMessage);
    expect(new Set(sentences).size).toBe(sentences.length);
    expect(sentences[0]).toBe('A slide this answer was written from says otherwise.');
  });
});

describe('the withheld panels’ headings', () => {
  it('heads chat’s dropped quote pointers for what they are, and everything withheld as withheld', () => {
    expect(droppedQuotesHeading(9)).toBe('Quote marks removed (9)');
    expect(withheldHeading(3)).toBe('Withheld (3)');
    expect(DROPPED_QUOTES_NOTE).toMatch(/ Taking a mark off removed no words\.$/);
  });
});

describe('withheldUnitMessage', () => {
  it('gives each reason a summary line is withheld for its own sentence, and names what a partial one’s policy did', () => {
    const unit: Unit = { text, citations: [], kind: 'lecture-summary' };
    const entries: WithheldUnit[] = [
      { reason: 'dangling-citation', unit },
      { reason: 'unsupported', unit },
      { reason: 'partial', policy: 'drop', unit },
      { reason: 'partial', policy: 'rewrite-once', unit },
    ];
    expect([...new Set(entries.map(({ reason }) => reason))].sort()).toEqual(
      WithheldUnit.options.map((arm) => arm.shape.reason.value).sort(),
    );
    const sentences = entries.map(withheldUnitMessage);
    expect(new Set(sentences).size).toBe(sentences.length);
    expect(sentences[2]).toMatch(/so it was left out\.$/);
    expect(sentences[3]).toMatch(/a rewrite didn’t fix that\.$/);
  });
});

describe('discardedMessage', () => {
  const lost = (...discarded: { table: string; rows: number }[]) =>
    discardedMessage(discarded).split(': ')[1];

  it('names each table a student would know in its own words, and counts its rows', () => {
    expect(lost({ table: 'topics', rows: 12 }, { table: 'confirmations', rows: 3 })).toBe(
      '12 topic tags, 3 confirmations of text read from slide pictures.',
    );
    expect(lost({ table: 'topics', rows: 1 }, { table: 'confirmations', rows: 1 })).toBe(
      '1 topic tag, 1 confirmation of text read from a slide picture.',
    );
  });

  it('sums every other table into one count, never naming it', () => {
    expect(lost({ table: 'attempts', rows: 2 }, { table: 'notes', rows: 1 })).toBe(
      '3 other saved items.',
    );
    expect(lost({ table: 'topics', rows: 2 }, { table: 'constructor', rows: 1 })).toBe(
      '2 topic tags, 1 other saved item.',
    );
  });
});

describe('storedUnavailableMessage', () => {
  it('gives each reason a course file cannot be opened its own words, never its code', () => {
    const sentences = CourseUnavailableProblem.options.map(storedUnavailableMessage);
    expect(new Set(sentences).size).toBe(sentences.length);
    CourseUnavailableProblem.options.forEach((problem, index) => {
      expect(sentences[index]).not.toContain(problem);
    });
  });
});

describe('contradictionRefLabel', () => {
  it('names the slide after the label the button shows only on hover and focus', () => {
    const slide = { lectureTitle: 'Lecture 3: Wax', slideNo: SlideNo.parse(12), derived: false };
    expect(contradictionRefLabel(2, slide)).toBe(
      `Source 2: ${APPEARS_TO_CONTRADICT} Lecture 3: Wax, slide 12`,
    );
    expect(sourceRefLabel(2, slide)).toBe('Source 2: Lecture 3: Wax, slide 12');
  });

  it('ends the name of a slide read from its picture with the sources entry’s label', () => {
    const slide = { lectureTitle: 'Lecture 3: Wax', slideNo: SlideNo.parse(12), derived: true };
    expect(contradictionRefLabel(2, slide)).toBe(
      `Source 2: ${APPEARS_TO_CONTRADICT} Lecture 3: Wax, slide 12. ${DERIVED_SOURCE}`,
    );
    expect(sourceRefLabel(2, slide)).toBe(`Source 2: Lecture 3: Wax, slide 12. ${DERIVED_SOURCE}`);
  });
});
