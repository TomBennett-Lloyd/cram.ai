import { LectureSummary, type LoadedSummary } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import type { ExplainDepth } from './explain';
import { requestTokens } from './prompt-budget';
import { explanationRequest } from './prompts/explanation-prompt';
import {
  QUESTION,
  hive,
  retrieved,
  MALE,
  SQUARE,
  FIRST,
  TEXT,
  explained,
  scored,
  verified,
  run,
  contextOf,
  drones,
  DRONES_UNIT,
  hiveSummary,
} from './explain-fixture';
import {
  bySlide,
  CONTRADICTED,
  ENTAILED,
  kindsRecording,
  line,
  NEUTRAL,
  pairsOf,
  slide,
  verifierRecording,
} from './fake-gateway-fixture';

describe('explain at the deep depth', () => {
  const deep = (secondOpinion = false): ExplainDepth => ({ depth: 'deep', secondOpinion });

  it('cuts a contradicted sentence, names its slide, and shows the rest with its entailing slides', async () => {
    const result = await run(
      [
        explained(TEXT, [line('l1/1', 1)]),
        verified(
          scored(FIRST, retrieved, CONTRADICTED, NEUTRAL),
          scored(SQUARE, retrieved, NEUTRAL, ENTAILED),
        ),
      ],
      deep(),
    );
    expect(result).toEqual({
      status: 'grounded',
      explanation: {
        text: SQUARE,
        quotes: [],
        sentences: [{ text: SQUARE, slides: ['l1/2'], contradicts: [], standing: 'entailed' }],
        sources: ['l1/2'],
      },
      withheld: [{ reason: 'contradicted', text: FIRST, sourceId: 'l1/1' }],
      slides: retrieved,
      context: contextOf(),
    });
  });

  it('keeps a quote in a kept sentence and names its slide among the sources', async () => {
    const result = await run(
      [
        explained(TEXT, [line('l1/1', 1)]),
        verified(
          scored(FIRST, retrieved, ENTAILED, NEUTRAL),
          scored(SQUARE, retrieved, NEUTRAL, NEUTRAL),
        ),
        kindsRecording([SQUARE], retrieved, ['course-claim']),
      ],
      deep(),
    );
    expect(result).toMatchObject({
      explanation: { text: FIRST, quotes: [{ sourceId: 'l1/1', quote: MALE }], sources: ['l1/1'] },
      withheld: [{ reason: 'unsupported', text: SQUARE }],
    });
  });

  it('names a quoted slide among the sources when another slide entails its sentence', async () => {
    const result = await run(
      [explained(FIRST, [line('l1/1', 1)]), verified(scored(FIRST, retrieved, NEUTRAL, ENTAILED))],
      deep(),
    );
    expect(result).toMatchObject({
      explanation: {
        sentences: [{ slides: ['l1/2'] }],
        quotes: [{ sourceId: 'l1/1' }],
        sources: ['l1/2', 'l1/1'],
      },
    });
  });

  it('withholds a neutral course claim as unsupported', async () => {
    const result = await run(
      [
        explained(TEXT),
        verified(
          scored(FIRST, retrieved, ENTAILED, NEUTRAL),
          scored(SQUARE, retrieved, NEUTRAL, NEUTRAL),
        ),
        kindsRecording([SQUARE], retrieved, ['course-claim']),
      ],
      deep(),
    );
    expect(result).toMatchObject({
      status: 'grounded',
      withheld: [{ reason: 'unsupported', text: SQUARE }],
    });
  });

  it('shows a neutral interpretation in place, naming no slide for it', async () => {
    const result = await run(
      [
        explained(TEXT),
        verified(
          scored(FIRST, retrieved, ENTAILED, NEUTRAL),
          scored(SQUARE, retrieved, NEUTRAL, NEUTRAL),
        ),
        kindsRecording([SQUARE], retrieved, ['interpretation']),
      ],
      deep(),
    );
    expect(result).toEqual({
      status: 'grounded',
      explanation: {
        text: TEXT,
        quotes: [],
        sentences: [
          { text: FIRST, slides: ['l1/1'], contradicts: [], standing: 'entailed' },
          { text: SQUARE, slides: [], contradicts: [], standing: 'interpretation' },
        ],
        sources: ['l1/1'],
      },
      withheld: [],
      slides: retrieved,
      context: contextOf(),
    });
  });

  it('is not-covered with every sentence withheld when none is entailed, a contradicted one naming its slide', async () => {
    const result = await run(
      [
        explained(TEXT),
        verified(
          scored(FIRST, retrieved, NEUTRAL, CONTRADICTED),
          scored(SQUARE, retrieved, NEUTRAL, NEUTRAL),
        ),
        kindsRecording([SQUARE], retrieved, ['course-claim']),
      ],
      deep(),
    );
    expect(result).toEqual({
      status: 'not-covered',
      withheld: [
        { reason: 'contradicted', text: FIRST, sourceId: 'l1/2' },
        { reason: 'ungrounded', text: SQUARE },
      ],
      context: contextOf(),
    });
  });

  it('puts a dropped pointer before the sentences it withholds', async () => {
    const result = await run(
      [
        explained(SQUARE, [line('l1/2', 9)]),
        verified(scored(SQUARE, retrieved, NEUTRAL, NEUTRAL)),
        kindsRecording([SQUARE], retrieved, ['course-claim']),
      ],
      deep(),
    );
    expect(result).toEqual({
      status: 'not-covered',
      withheld: [
        { reason: 'dangling-citation', text: '[9]', sourceId: 'l1/2' },
        { reason: 'ungrounded', text: SQUARE },
      ],
      context: contextOf(),
    });
  });

  it('still names a retrieved slide the budget dropped among the reply’s slides', async () => {
    const budget = requestTokens(explanationRequest(QUESTION, contextOf(), [])) - 1;
    const result = await run(
      [explained(MALE, [], [hive]), verified(scored(MALE, [hive], ENTAILED))],
      deep(),
      retrieved,
      [],
      budget,
    );
    expect(result).toMatchObject({
      status: 'grounded',
      slides: retrieved,
      context: { raw: [hive] },
    });
  });

  describe('with a loaded summary', () => {
    const DRONES = 'Drones are the males.';
    const againstAll = (sentence: string, ...results: Parameters<typeof verifierRecording>[1]) =>
      verifierRecording(
        [...pairsOf(sentence, retrieved), { premise: DRONES_UNIT, hypothesis: sentence }],
        [...bySlide(retrieved, results.slice(0, -1)), ...results.slice(-1)],
      );

    it('keeps a sentence only a summary unit entails, crediting the slide that unit cites', async () => {
      const result = await run(
        [
          explained(DRONES, [], retrieved, [hiveSummary]),
          againstAll(DRONES, NEUTRAL, NEUTRAL, ENTAILED),
        ],
        deep(),
        retrieved,
        [hiveSummary],
      );
      expect(result).toEqual({
        status: 'grounded',
        explanation: {
          text: DRONES,
          quotes: [],
          sentences: [{ text: DRONES, slides: ['l1/3'], contradicts: [], standing: 'entailed' }],
          sources: ['l1/3'],
        },
        withheld: [],
        slides: [...retrieved, drones],
        context: contextOf(retrieved, [hiveSummary]),
      });
    });

    it('names no slide a loaded unit cites unless a sentence credits it', async () => {
      const queen = slide('l1/4', 'The queen lays the eggs.');
      const QUEEN_UNIT = 'Only the queen lays.';
      const twoUnits: LoadedSummary = {
        summary: LectureSummary.parse({
          lectureId: 'l1',
          units: [
            ...hiveSummary.summary.units,
            {
              text: QUEEN_UNIT,
              citations: [{ sourceId: queen.sourceId, quote: queen.record.body }],
              kind: 'lecture-summary',
            },
          ],
        }),
        slides: [drones, queen],
      };
      const result = await run(
        [
          explained(DRONES, [], retrieved, [twoUnits]),
          verifierRecording(
            [
              ...pairsOf(DRONES, retrieved),
              { premise: DRONES_UNIT, hypothesis: DRONES },
              { premise: QUEEN_UNIT, hypothesis: DRONES },
            ],
            [...bySlide(retrieved, [NEUTRAL, NEUTRAL]), ENTAILED, NEUTRAL],
          ),
        ],
        deep(),
        retrieved,
        [twoUnits],
      );
      expect(result).toMatchObject({ slides: [...retrieved, drones] });
    });

    it('withholds a sentence only a summary unit contradicts, naming the slide it cites', async () => {
      const result = await run(
        [
          explained(TEXT, [], retrieved, [hiveSummary]),
          verifierRecording(
            [
              ...pairsOf(FIRST, retrieved),
              { premise: DRONES_UNIT, hypothesis: FIRST },
              ...pairsOf(SQUARE, retrieved),
              { premise: DRONES_UNIT, hypothesis: SQUARE },
            ],
            [
              ...bySlide(retrieved, [NEUTRAL, NEUTRAL]),
              CONTRADICTED,
              ...bySlide(retrieved, [NEUTRAL, ENTAILED]),
              NEUTRAL,
            ],
          ),
        ],
        deep(),
        retrieved,
        [hiveSummary],
      );
      expect(result).toMatchObject({
        status: 'grounded',
        withheld: [{ reason: 'contradicted', text: FIRST, sourceId: 'l1/3' }],
        slides: [...retrieved, drones],
      });
    });
  });
});
