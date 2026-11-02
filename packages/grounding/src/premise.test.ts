import { LectureSummary } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { comb, drones, hive, hiveSummary } from './explain-fixture';
import { contextPremises, summaryPremises } from './premise';
import { slideText } from './slide-text';

const cited = (sourceId: string) => ({ sourceId, quote: 'q' });

describe('the deep premises', () => {
  it('are every raw slide, then every loaded unit, each unit crediting the slides it cites', () => {
    expect(contextPremises({ raw: [hive, comb], summaries: [hiveSummary] })).toEqual([
      { text: slideText(hive.record), sources: ['l1/1'] },
      { text: slideText(comb.record), sources: ['l1/2'] },
      { text: hiveSummary.summary.units[0]?.text, sources: [drones.sourceId] },
    ]);
  });

  it('credit a slide a unit cites twice once, and take no unit citing none', () => {
    const summary = LectureSummary.parse({
      lectureId: 'l1',
      units: [
        {
          text: 'Twice.',
          citations: [cited('l1/3'), cited('l1/1'), cited('l1/3')],
          kind: 'lecture-summary',
        },
        { text: 'Never.', citations: [], kind: 'lecture-summary' },
      ],
    });
    expect(summaryPremises([{ summary, slides: [] }])).toEqual([
      { text: 'Twice.', sources: ['l1/3', 'l1/1'] },
    ]);
  });
});
