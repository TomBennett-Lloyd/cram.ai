import type { LectureId, LoadedSummary, RetrievedSlide, SourceId } from '@cram/shared';
import { estimateTokens } from './prompt-budget';
import { sourceBlock, summaryBlock } from './prompts/source-block';

export interface AssembledContext {
  readonly raw: readonly RetrievedSlide[];
  readonly summaries: readonly LoadedSummary[];
  readonly leftOut: readonly SourceId[];
}

export const EMPTY_CONTEXT: AssembledContext = { raw: [], summaries: [], leftOut: [] };

const blockTokens = (block: string): number => estimateTokens(`${block}\n\n`);

const sum = (costs: readonly number[]): number => costs.reduce((total, cost) => total + cost, 0);

/** What fits `available` tokens, dropped in `docs/adr/0009-explanation-answers.md` § Decision (k)'s order. */
export const assembleContext = (
  ranked: readonly RetrievedSlide[],
  summaries: readonly LoadedSummary[],
  available: number,
): AssembledContext => {
  const lectures = [...new Set<LectureId>(ranked.map(({ record }) => record.lectureId))];
  const loaded = lectures.flatMap((lectureId) => {
    const found = summaries.find(({ summary }) => summary.lectureId === lectureId);
    return found === undefined ? [] : [found];
  });
  const raw = [...ranked];
  let used =
    sum(raw.map((slide) => blockTokens(sourceBlock(slide)))) +
    sum(loaded.map((summary) => blockTokens(summaryBlock(summary))));
  const unsummarised = new Set<LectureId>();
  while (used > available) {
    const last = loaded.pop();
    if (last === undefined) break;
    unsummarised.add(last.summary.lectureId);
    used -= blockTokens(summaryBlock(last));
  }
  while (used > available && raw.length > 1) {
    const last = raw.pop();
    if (last === undefined) break;
    used -= blockTokens(sourceBlock(last));
  }
  const kept = new Set(raw.map(({ sourceId }) => sourceId));
  const leftOut = ranked.flatMap(({ sourceId, record }) =>
    kept.has(sourceId) && !unsummarised.has(record.lectureId) ? [] : [sourceId],
  );
  return { raw, summaries: loaded, leftOut: [...new Set(leftOut)] };
};
