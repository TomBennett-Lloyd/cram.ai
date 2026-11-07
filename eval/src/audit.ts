import { type LectureId, quoteSpan, type SlideNo } from '@cram/shared';
import { slideText, type Deck } from './deck';
import type { FollowUpItem } from './follow-up';
import { firstForbiddenEntry, type GoldenQuestion, normaliseForMatch } from './golden-question';
import type { HandLabel } from './hand-label';
import type { SentenceKindLabel } from './sentence-kind-label';
import type { TopicLabel } from './topic-label';

export interface EvalCourse {
  readonly deck: Deck;
  readonly questions: readonly GoldenQuestion[];
  readonly followUps: readonly FollowUpItem[];
  readonly labels: readonly HandLabel[];
  readonly sentenceKinds: readonly SentenceKindLabel[];
  readonly topicLabels: readonly TopicLabel[];
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
  | { readonly kind: 'variant-of-uncovered'; readonly question: string; readonly variant: string }
  | { readonly kind: 'duplicate-variant'; readonly question: string; readonly variant: string }
  | { readonly kind: 'duplicate-follow-up'; readonly question: string; readonly standalone: string }
  | { readonly kind: 'unquotable'; readonly text: string; readonly quote: string }
  | {
      readonly kind: 'unknown-premise';
      readonly sentence: string;
      readonly lectureId: LectureId;
      readonly slideNo: SlideNo;
    }
  | {
      readonly kind: 'unknown-topic-slide' | 'duplicate-topic-slide';
      readonly lectureId: LectureId;
      readonly slideNo: SlideNo;
    };

const slideKey = (lectureId: LectureId, slideNo: SlideNo): string =>
  `${lectureId}#${String(slideNo)}`;

const slideKeys = (deck: Deck): ReadonlySet<string> =>
  new Set(
    deck.flatMap((lecture) => lecture.slides.map((s) => slideKey(lecture.lectureId, s.slideNo))),
  );

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
  const slides = slideKeys(deck);
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

const variantProblems = (questions: readonly GoldenQuestion[]): AuditProblem[] => {
  const taken = new Set(questions.map(({ question }) => normaliseForMatch(question)));
  return questions.flatMap(({ question, expectedCitations, misspelt }) =>
    misspelt.flatMap((variant): AuditProblem[] => {
      const key = normaliseForMatch(variant);
      const problems: AuditProblem[] = [];
      if (expectedCitations.length === 0)
        problems.push({ kind: 'variant-of-uncovered', question, variant });
      if (taken.has(key)) problems.push({ kind: 'duplicate-variant', question, variant });
      taken.add(key);
      return problems;
    }),
  );
};

const followUpProblems = (deck: Deck, followUps: readonly FollowUpItem[]): AuditProblem[] => {
  const slides = slideKeys(deck);
  const seen = new Set<string>();
  return followUps.flatMap(({ question, standalone, expectedCitations }): AuditProblem[] => {
    const key = JSON.stringify([normaliseForMatch(question), normaliseForMatch(standalone)]);
    const duplicate: AuditProblem[] = seen.has(key)
      ? [{ kind: 'duplicate-follow-up', question, standalone }]
      : [];
    seen.add(key);
    const unknown = expectedCitations
      .filter((ref) => !slides.has(slideKey(ref.lectureId, ref.slideNo)))
      .map((ref): AuditProblem => ({ kind: 'unknown-citation', question, ...ref }));
    return [...duplicate, ...unknown];
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

const premiseProblems = (deck: Deck, labels: readonly SentenceKindLabel[]): AuditProblem[] => {
  const slides = slideKeys(deck);
  return labels.flatMap(({ sentence, premises }) =>
    premises
      .filter((ref) => !slides.has(slideKey(ref.lectureId, ref.slideNo)))
      .map((ref): AuditProblem => ({ kind: 'unknown-premise', sentence, ...ref })),
  );
};

const topicProblems = (deck: Deck, labels: readonly TopicLabel[]): AuditProblem[] => {
  const slides = slideKeys(deck);
  const seen = new Set<string>();
  return labels.flatMap(({ lectureId, slideNo }): AuditProblem[] => {
    const key = slideKey(lectureId, slideNo);
    const problems: AuditProblem[] = [];
    if (!slides.has(key)) problems.push({ kind: 'unknown-topic-slide', lectureId, slideNo });
    if (seen.has(key)) problems.push({ kind: 'duplicate-topic-slide', lectureId, slideNo });
    seen.add(key);
    return problems;
  });
};

/**
 * Every disagreement among the deck, the golden questions, their misspelt variants
 * (`docs/adr/0010-misspelt-golden-variants.md` § Decision (c)), the follow-ups and the three label files. A
 * `mustNotContain` entry is checked against the whole deck because a unit faithfully
 * reporting any slide that contains it would fail its item.
 */
export const auditEvalCourse = (course: EvalCourse): readonly AuditProblem[] => [
  ...deckProblems(course.deck),
  ...questionProblems(course.deck, course.questions),
  ...variantProblems(course.questions),
  ...followUpProblems(course.deck, course.followUps),
  ...labelProblems(course.deck, course.labels),
  ...premiseProblems(course.deck, course.sentenceKinds),
  ...topicProblems(course.deck, course.topicLabels),
];
