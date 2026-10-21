import { type LectureId, quoteSpan, type SlideNo } from '@cram/shared';
import { slideText, type Deck } from './deck';
import { firstForbiddenEntry, type GoldenQuestion } from './golden-question';
import type { HandLabel } from './hand-label';

export interface EvalCourse {
  readonly deck: Deck;
  readonly questions: readonly GoldenQuestion[];
  readonly labels: readonly HandLabel[];
}

/** A way the committed eval files can disagree with each other or with themselves. */
export type AuditProblem =
  | { readonly kind: 'duplicate-lecture'; readonly lectureId: LectureId }
  | {
      readonly kind: 'slide-numbering';
      readonly lectureId: LectureId;
      readonly expected: number;
      readonly found: SlideNo;
    }
  | { readonly kind: 'duplicate-question'; readonly question: string }
  | {
      readonly kind: 'unknown-citation';
      readonly question: string;
      readonly lectureId: LectureId;
      readonly slideNo: SlideNo;
    }
  | {
      readonly kind: 'forbidden-in-deck';
      readonly question: string;
      readonly entry: string;
      readonly lectureId: LectureId;
      readonly slideNo: SlideNo;
    }
  | { readonly kind: 'unquotable'; readonly text: string; readonly quote: string };

const slideKey = (lectureId: LectureId, slideNo: SlideNo): string =>
  `${lectureId}#${String(slideNo)}`;

const deckProblems = (deck: Deck): AuditProblem[] => {
  const seen = new Set<LectureId>();
  return deck.flatMap((lecture): AuditProblem[] => {
    const duplicate: AuditProblem[] = seen.has(lecture.lectureId)
      ? [{ kind: 'duplicate-lecture', lectureId: lecture.lectureId }]
      : [];
    seen.add(lecture.lectureId);
    const numbering = lecture.slides.flatMap((slide, index): AuditProblem[] =>
      slide.slideNo === index + 1
        ? []
        : [
            {
              kind: 'slide-numbering',
              lectureId: lecture.lectureId,
              expected: index + 1,
              found: slide.slideNo,
            },
          ],
    );
    return [...duplicate, ...numbering];
  });
};

const questionProblems = (deck: Deck, questions: readonly GoldenQuestion[]): AuditProblem[] => {
  const slides = new Set(
    deck.flatMap((lecture) => lecture.slides.map((s) => slideKey(lecture.lectureId, s.slideNo))),
  );
  const seen = new Set<string>();
  return questions.flatMap((item): AuditProblem[] => {
    const duplicate: AuditProblem[] = seen.has(item.question)
      ? [{ kind: 'duplicate-question', question: item.question }]
      : [];
    seen.add(item.question);
    const unknown = item.expectedCitations
      .filter((ref) => !slides.has(slideKey(ref.lectureId, ref.slideNo)))
      .map((ref): AuditProblem => ({ kind: 'unknown-citation', question: item.question, ...ref }));
    const forbidden = deck.flatMap((lecture) =>
      lecture.slides.flatMap((slide): AuditProblem[] => {
        const entry = firstForbiddenEntry(slideText(slide), item.mustNotContain);
        return entry === undefined
          ? []
          : [
              {
                kind: 'forbidden-in-deck',
                question: item.question,
                entry,
                lectureId: lecture.lectureId,
                slideNo: slide.slideNo,
              },
            ];
      }),
    );
    return [...duplicate, ...unknown, ...forbidden];
  });
};

const labelProblems = (deck: Deck, labels: readonly HandLabel[]): AuditProblem[] => {
  const texts = deck.flatMap((lecture) => lecture.slides.map(slideText));
  return labels.flatMap((label) =>
    label.quotes
      .filter((quote) => !texts.some((text) => quoteSpan(text, quote) !== undefined))
      .map((quote): AuditProblem => ({ kind: 'unquotable', text: label.text, quote })),
  );
};

/**
 * Every disagreement among the deck, the golden questions and the hand labels. A
 * `mustNotContain` entry is checked against the whole deck because a unit faithfully
 * reporting any slide that contains it would fail its item.
 */
export const auditEvalCourse = (course: EvalCourse): readonly AuditProblem[] => [
  ...deckProblems(course.deck),
  ...questionProblems(course.deck, course.questions),
  ...labelProblems(course.deck, course.labels),
];
