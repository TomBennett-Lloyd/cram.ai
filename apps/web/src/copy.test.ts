import { describe, expect, it } from 'vitest';
import { CourseUnavailableProblem, SlideNo, SourceId, WithheldSentence } from '@cram/shared';
import {
  APPEARS_TO_CONTRADICT,
  contradictionRefLabel,
  discardedMessage,
  sourceRefLabel,
  storedUnavailableMessage,
  withheldMessage,
} from './copy';

const sourceId = SourceId.parse('s1');
const text = 'Drones forage.';

describe('withheldMessage', () => {
  it('gives each reason an explanation withholds for its own sentence', () => {
    const entries: WithheldSentence[] = [
      { reason: 'dangling-citation', text, sourceId },
      { reason: 'contradicted', text, sourceId },
      { reason: 'unsupported', text },
      { reason: 'ungrounded', text },
    ];
    expect(entries.map(({ reason }) => reason).sort()).toEqual(
      WithheldSentence.options.map((arm) => arm.shape.reason.value).sort(),
    );
    const sentences = entries.map(withheldMessage);
    expect(new Set(sentences).size).toBe(sentences.length);
    expect(sentences[0]).toMatch(/^The answer marked this line as a quote/);
    expect(sentences[1]).toBe('A slide this answer was written from says otherwise.');
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
    const slide = { lectureTitle: 'Lecture 3: Wax', slideNo: SlideNo.parse(12) };
    expect(contradictionRefLabel(2, slide)).toBe(
      `Source 2: ${APPEARS_TO_CONTRADICT} Lecture 3: Wax, slide 12`,
    );
    expect(sourceRefLabel(2, slide)).toBe('Source 2: Lecture 3: Wax, slide 12');
  });
});
