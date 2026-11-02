import type { EntailmentResult, Recording } from '@cram/gateway';
import type { RetrievedSlide } from '@cram/shared';
import { type ExplainDepth, explain } from './explain';
import {
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

export const MALE = 'Worker bees are male.';
export const SQUARE = 'Their comb is made of square cells.';
export const FIRST = `In this course, ${MALE}`;
export const TEXT = `${FIRST} ${SQUARE}`;

export const explained = (text: string, quotes: readonly LineCitation[] = [], slides = retrieved) =>
  generatorReplies(explanationRequest(QUESTION, slides), { answer: { text, quotes } });
export const uncovered = generatorReplies(explanationRequest(QUESTION, retrieved), {
  answer: null,
});
export const scored = (
  hypothesis: string,
  slides: readonly RetrievedSlide[],
  ...results: EntailmentResult[]
) => ({ pairs: pairsOf(hypothesis, slides), results });
export const verified = (...calls: ReturnType<typeof scored>[]): Recording =>
  verifierRecording(
    calls.flatMap(({ pairs }) => pairs),
    calls.flatMap(({ results }) => results),
  );

export const run = (recordings: readonly Recording[], depth: ExplainDepth, slides = retrieved) =>
  explain(QUESTION, slides, depth, {
    gateway: fakeGateway(recordings),
    thresholds: PROVISIONAL_NLI_THRESHOLDS,
  });
