import {
  type LectureDigest,
  type LectureId,
  LectureSummary,
  type RetrievedSlide,
  SlideKind,
  type WithheldUnit,
} from '@cram/shared';
import { ground, type GroundingStage } from './ground';
import type { ModelFailure } from './model-failure';
import { estimateTokens, PROMPT_TOKEN_BUDGET } from './prompt-budget';
import { generationRequest, type SummaryTask } from './prompts/generation-prompt';
import { sourceBlock } from './prompts/source-block';
import { slideLines } from './slide-text';
import type { VerifyDeps } from './verify';

/** Units one summary call may return; set by #422's probe of the pinned generator on the eval deck. */
export const SUMMARY_MAX_UNITS = 12;

export interface SummaryLecture {
  readonly lectureId: LectureId;
  readonly lectureTitle: string;
}

export interface SummaryDeps extends VerifyDeps {
  readonly budget?: number;
}

export type UnsummarisedReason = 'nothing-to-summarise' | 'slide-over-budget' | 'no-unit-survived';

export type SummaryOutcome =
  | {
      readonly status: 'summarised';
      readonly summary: LectureSummary;
      readonly withheld: readonly WithheldUnit[];
      readonly drafted: number;
    }
  | {
      readonly status: 'unsummarised';
      readonly reason: UnsummarisedReason;
      readonly withheld: readonly WithheldUnit[];
      readonly drafted: number;
    }
  | {
      readonly status: 'model-failed';
      readonly stage: GroundingStage;
      readonly failure: ModelFailure;
      readonly drafted: number;
    };

const summarisable = ({ record }: RetrievedSlide): boolean =>
  record.kind !== SlideKind.enum.references && slideLines(record).length > 0;

const promptTokens = (task: SummaryTask, slides: readonly RetrievedSlide[]): number =>
  generationRequest(task, slides).messages.reduce(
    (total, { content }) => total + estimateTokens(content),
    0,
  );

/** Greedy parts whose summed estimates fit `budget`; `undefined` when one slide alone does not, since a backend truncates silently. */
export const summaryParts = (
  task: SummaryTask,
  slides: readonly RetrievedSlide[],
  budget: number,
): readonly (readonly RetrievedSlide[])[] | undefined => {
  const fixed = promptTokens(task, []);
  const parts: RetrievedSlide[][] = [];
  let part: RetrievedSlide[] = [];
  let used = fixed;
  for (const slide of slides) {
    const cost = estimateTokens(`${sourceBlock(slide)}\n\n`);
    if (fixed + cost > budget) return undefined;
    if (used + cost > budget) {
      parts.push(part);
      part = [];
      used = fixed;
    }
    part.push(slide);
    used += cost;
  }
  if (part.length > 0) parts.push(part);
  return parts;
};

/** One reported call per part, `partial` dropped (`docs/adr/0009-explanation-answers.md` § Decision (l)); any failure is no summary. */
export const summariseLecture = async (
  lecture: SummaryLecture,
  slides: readonly RetrievedSlide[],
  deps: SummaryDeps,
): Promise<SummaryOutcome> => {
  const task: SummaryTask = {
    kind: 'lecture-summary',
    lectureTitle: lecture.lectureTitle,
    maxUnits: SUMMARY_MAX_UNITS,
  };
  const source = slides.filter(summarisable);
  if (source.length === 0)
    return { status: 'unsummarised', reason: 'nothing-to-summarise', withheld: [], drafted: 0 };
  const parts = summaryParts(task, source, deps.budget ?? PROMPT_TOKEN_BUDGET);
  if (parts === undefined)
    return { status: 'unsummarised', reason: 'slide-over-budget', withheld: [], drafted: 0 };
  const units = [];
  const withheld: WithheldUnit[] = [];
  for (const part of parts) {
    const result = await ground(task, part, { ...deps, partialPolicy: 'drop' });
    if (result.status === 'model-failed')
      return { ...result, drafted: units.length + withheld.length };
    withheld.push(...result.withheld);
    if (result.status === 'grounded') units.push(...result.shown);
  }
  const drafted = units.length + withheld.length;
  if (units.length === 0)
    return { status: 'unsummarised', reason: 'no-unit-survived', withheld, drafted };
  return {
    status: 'summarised',
    summary: LectureSummary.parse({ lectureId: lecture.lectureId, units }),
    withheld,
    drafted,
  };
};

export const digestOf = (
  lectureId: LectureId,
  outcome: Exclude<SummaryOutcome, { status: 'model-failed' }>,
): LectureDigest => ({
  lectureId,
  units: outcome.status === 'summarised' ? outcome.summary.units : [],
  withheld: [...outcome.withheld],
});
