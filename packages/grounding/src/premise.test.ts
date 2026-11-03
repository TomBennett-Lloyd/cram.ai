import { LectureSummary, SourceId } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { comb, drones, hive, hiveSummary } from './explain-fixture';
import { slide } from './fake-gateway-fixture';
import { contextPremises, type Premise, scoredPremises, summaryPremises } from './premise';
import { slideLines, slideText } from './slide-text';

const cited = (sourceId: string) => ({ sourceId, quote: 'q' });

describe('the deep premises', () => {
  it('are every raw slide, then every loaded unit, each unit crediting the slides it cites', () => {
    expect(contextPremises({ raw: [hive, comb], summaries: [hiveSummary] })).toEqual([
      { text: slideText(hive.record), lines: slideLines(hive.record), sources: ['l1/1'] },
      { text: slideText(comb.record), lines: slideLines(comb.record), sources: ['l1/2'] },
      {
        text: hiveSummary.summary.units[0]?.text,
        lines: [hiveSummary.summary.units[0]?.text],
        sources: [drones.sourceId],
      },
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
      { text: 'Twice.', lines: ['Twice.'], sources: ['l1/3', 'l1/1'] },
    ]);
  });
});

describe('the scored premises', () => {
  const [workers] = contextPremises({
    raw: [
      slide('l1/3', 'Worker bees are male.\n\n  Workers forage.  \nWorker bees are male.', {
        title: 'The workers',
      }),
    ],
    summaries: [],
  });

  it('are a slide whole, then each distinct line of it, each crediting the slide', () => {
    expect(scoredPremises(workers === undefined ? [] : [workers])).toEqual([
      workers,
      { text: 'The workers', lines: ['The workers'], sources: ['l1/3'] },
      { text: 'Worker bees are male.', lines: ['Worker bees are male.'], sources: ['l1/3'] },
      { text: 'Workers forage.', lines: ['Workers forage.'], sources: ['l1/3'] },
    ]);
  });

  it('are a premise of one line, or of one line repeated, alone', () => {
    const once: Premise = {
      text: 'Drones are male.',
      lines: ['Drones are male.'],
      sources: [SourceId.parse('l1/2')],
    };
    const twice: Premise = {
      ...once,
      text: 'Drones are male.\nDrones are male.',
      lines: ['Drones are male.', 'Drones are male.'],
    };
    expect(scoredPremises([once, twice])).toEqual([once, twice]);
  });
});
