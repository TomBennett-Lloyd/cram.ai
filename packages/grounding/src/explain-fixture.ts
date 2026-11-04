import type { EntailmentResult, Recording } from '@cram/gateway';
import {
  LectureSummary,
  type LoadedSummary,
  type RetrievedSlide,
  type SourceId,
} from '@cram/shared';
import type { AssembledContext } from './assemble-context';
import { type ExplainDepth, explain } from './explain';
import {
  bySlide,
  fakeGateway,
  generatorReplies,
  pairsOf,
  slide,
  verifierRecording,
} from './fake-gateway-fixture';
import { PROVISIONAL_NLI_THRESHOLDS } from './nli-verdict';
import { explanationRequest } from './prompts/explanation-prompt';
import type { LineCitation } from './prompts/generation-prompt';

export const QUESTION = 'Who are the workers?';
export const hive = slide('l1/1', 'Worker bees are male.\nThe queen is the colony’s only female.');
export const comb = slide('l1/2', 'Bees build comb from square cells.');
export const winter = slide('l5/6', 'Bees sleep through the winter.');
export const retrieved = [hive, comb];
export const drones = slide('l1/3', 'Drones are the colony’s males.');

export const DRONES_UNIT = 'The colony’s males are its drones.';
export const hiveSummary: LoadedSummary = {
  summary: LectureSummary.parse({
    lectureId: 'l1',
    units: [
      {
        text: DRONES_UNIT,
        citations: [{ sourceId: drones.sourceId, quote: drones.record.body }],
        kind: 'lecture-summary',
      },
    ],
  }),
  slides: [drones],
};

export const MALE = 'Worker bees are male.';
export const SQUARE = 'Their comb is made of square cells.';
export const FIRST = `In this course, ${MALE}`;
export const TEXT = `${FIRST} ${SQUARE}`;

export const contextOf = (
  raw: readonly RetrievedSlide[] = retrieved,
  summaries: readonly LoadedSummary[] = [],
  leftOut: readonly SourceId[] = [],
): AssembledContext => ({ raw, summaries, leftOut });

export const explained = (
  text: string,
  quotes: readonly LineCitation[] = [],
  slides = retrieved,
  summaries: readonly LoadedSummary[] = [],
) =>
  generatorReplies(explanationRequest(QUESTION, { raw: slides, summaries }), {
    answer: { text, quotes },
  });
export const uncovered = generatorReplies(explanationRequest(QUESTION, contextOf()), {
  answer: null,
});
export const scored = (
  hypothesis: string,
  slides: readonly RetrievedSlide[],
  ...results: EntailmentResult[]
) => ({ pairs: pairsOf(hypothesis, slides), results: bySlide(slides, results) });
export const verified = (...calls: ReturnType<typeof scored>[]): Recording =>
  verifierRecording(
    calls.flatMap(({ pairs }) => pairs),
    calls.flatMap(({ results }) => results),
  );

export const run = (
  recordings: readonly Recording[],
  depth: ExplainDepth,
  slides = retrieved,
  summaries: readonly LoadedSummary[] = [],
  budget?: number,
) =>
  explain(QUESTION, { retrieved: slides, summaries }, depth, {
    gateway: fakeGateway(recordings),
    thresholds: PROVISIONAL_NLI_THRESHOLDS,
    ...(budget === undefined ? {} : { budget }),
  });
