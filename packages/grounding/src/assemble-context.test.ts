import { LectureId, LectureSummary, type LoadedSummary, type RetrievedSlide } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { assembleContext } from './assemble-context';
import { slide } from './fake-gateway-fixture';
import { estimateTokens } from './prompt-budget';
import { sourceBlock, summaryBlock } from './prompts/source-block';

const inLecture = (lecture: string, id: string, body: string): RetrievedSlide =>
  slide(id, body, { lectureId: LectureId.parse(lecture) });

const a1 = inLecture('la', 'la/1', 'Workers forage for nectar.');
const a2 = inLecture('la', 'la/2', 'Foragers dance to share a find.');
const b1 = inLecture('lb', 'lb/1', 'Drones leave the hive in autumn.');
const c1 = inLecture('lc', 'lc/1', 'The queen lays every egg.');

const summaryOf = (lecture: string, ...cited: readonly RetrievedSlide[]): LoadedSummary => ({
  summary: LectureSummary.parse({
    lectureId: lecture,
    units: cited.map(({ sourceId, record }) => ({
      text: `In short: ${record.body}`,
      citations: [{ sourceId, quote: record.body }],
      kind: 'lecture-summary',
    })),
  }),
  slides: cited,
});

const sa = summaryOf('la', a1, a2);
const sb = summaryOf('lb', b1);
const sc = summaryOf('lc', c1);

const rawCost = (slides: readonly RetrievedSlide[]) =>
  slides.reduce((sum, each) => sum + estimateTokens(`${sourceBlock(each)}\n\n`), 0);
const summaryCost = (summaries: readonly LoadedSummary[]) =>
  summaries.reduce((sum, each) => sum + estimateTokens(`${summaryBlock(each)}\n\n`), 0);

const ranked = [b1, a1, c1, a2];
const all = rawCost(ranked) + summaryCost([sb, sa, sc]);

describe('assembleContext', () => {
  it('loads every ranked slide and its lectures’ summaries, by each lecture’s best slide, when they fit', () => {
    expect(assembleContext(ranked, [sa, sc, sb], all)).toEqual({
      raw: ranked,
      summaries: [sb, sa, sc],
      leftOut: [],
    });
  });

  it('loads no summary of a lecture no ranked slide is from, and one summary per lecture', () => {
    const again = summaryOf('la', a2);
    expect(assembleContext([a1], [sb, sa, again], all).summaries).toEqual([sa]);
  });

  it('drops the lowest-ranked lecture’s summary first, whole, and leaves out that lecture’s ranked slides', () => {
    const tight = all - 1;
    expect(assembleContext(ranked, [sa, sb, sc], tight)).toEqual({
      raw: ranked,
      summaries: [sb, sa],
      leftOut: [c1.sourceId],
    });
    const fewer = rawCost(ranked) + summaryCost([sb]);
    expect(assembleContext(ranked, [sa, sb, sc], fewer)).toEqual({
      raw: ranked,
      summaries: [sb],
      leftOut: [a1.sourceId, c1.sourceId, a2.sourceId],
    });
  });

  it('drops every summary before a slide, then slides from the bottom, never the last', () => {
    expect(assembleContext(ranked, [sa, sb, sc], rawCost(ranked) - 1)).toEqual({
      raw: [b1, a1, c1],
      summaries: [],
      leftOut: [b1, a1, c1, a2].map(({ sourceId }) => sourceId),
    });
    expect(assembleContext(ranked, [sa, sb, sc], 0)).toEqual({
      raw: [b1],
      summaries: [],
      leftOut: ranked.map(({ sourceId }) => sourceId),
    });
    expect(assembleContext([b1], [], 0)).toEqual({ raw: [b1], summaries: [], leftOut: [] });
  });

  it('leaves out a dropped slide of a lecture that has no summary', () => {
    expect(assembleContext([b1, c1], [], rawCost([b1]))).toEqual({
      raw: [b1],
      summaries: [],
      leftOut: [c1.sourceId],
    });
  });

  it('leaves out no slide of a lecture with no summary when another lecture’s summary drops', () => {
    expect(assembleContext([b1, a1], [sa], rawCost([b1, a1]))).toEqual({
      raw: [b1, a1],
      summaries: [],
      leftOut: [a1.sourceId],
    });
  });

  it('never exceeds what is available unless one slide alone does', () => {
    const summaries = [sa, sb, sc];
    for (let available = 0; available <= all + 1; available += 1) {
      const { raw, summaries: loaded } = assembleContext(ranked, summaries, available);
      const used = rawCost(raw) + summaryCost(loaded);
      if (raw.length > 1 || loaded.length > 0) expect(used).toBeLessThanOrEqual(available);
      expect(raw.length).toBeGreaterThan(0);
    }
  });

  it('names a left-out slide once though ranked twice, and holds nothing for nothing ranked', () => {
    expect(assembleContext([b1, a1, a1], [sa], 0).leftOut).toEqual([a1.sourceId]);
    expect(assembleContext([], [sa], all)).toEqual({ raw: [], summaries: [], leftOut: [] });
  });
});
