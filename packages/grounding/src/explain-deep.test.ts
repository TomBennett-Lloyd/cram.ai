import { describe, expect, it } from 'vitest';
import type { ExplainDepth } from './explain';
import {
  retrieved,
  MALE,
  SQUARE,
  FIRST,
  TEXT,
  explained,
  scored,
  verified,
  run,
} from './explain-fixture';
import { CONTRADICTED, ENTAILED, kindsRecording, line, NEUTRAL } from './fake-gateway-fixture';

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
        sentences: [{ text: SQUARE, slides: ['l1/2'], contradicts: [] }],
        sources: ['l1/2'],
      },
      withheld: [{ reason: 'contradicted', text: FIRST, sourceId: 'l1/1' }],
      slides: retrieved,
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
          { text: FIRST, slides: ['l1/1'], contradicts: [] },
          { text: SQUARE, slides: [], contradicts: [] },
        ],
        sources: ['l1/1'],
      },
      withheld: [],
      slides: retrieved,
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
    });
  });
});
