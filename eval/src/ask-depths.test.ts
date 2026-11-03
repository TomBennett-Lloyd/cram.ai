import type { EntailRequest, EntailmentResult, ModelGateway } from '@cram/gateway';
import { slideText } from '@cram/grounding';
import { LectureSummary, type LoadedSummary } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { widened } from './ask-depths';
import { question } from './eval-fixture';
import { asked, grounded, record, retrieved, sentence } from './run-fixture';
import { ScriptedGateway } from './scripted-gateway-fixture';

const expectedSlide = record({ slideNo: 1, body: 'Cells are square.' });
const candidate = record({ slideNo: 2, body: 'Bees are busy.' });
const covered = question({
  question: 'What shape are cells?',
  expectedCitations: [{ lectureId: 'l1', slideNo: 1 }],
  mustNotContain: ['hexagon'],
});
const outsideSet = question({ question: 'What do bees do?', mustNotContain: [] });

const CONTRADICTED: EntailmentResult = {
  status: 'scored',
  scores: { entailment: 0, neutral: 0.1, contradiction: 0.9 },
};

/** A gateway whose verifier contradicts every pair whose premise is the expected slide, recording each call. */
const gatewayOf = () => {
  const calls: EntailRequest[] = [];
  const inner = new ScriptedGateway(() => ({ status: 'backend-failed', reason: 'unscripted' }));
  const neutral: EntailmentResult = {
    status: 'scored',
    scores: { entailment: 0, neutral: 1, contradiction: 0 },
  };
  const gateway: ModelGateway = {
    generator: inner.generator,
    embedder: inner.embedder,
    reranker: null,
    verifier: {
      pin: inner.verifier.pin,
      entail: (request) => {
        calls.push(request);
        return Promise.resolve(
          request.pairs.map(({ premise }) =>
            premise === slideText(expectedSlide) ? CONTRADICTED : neutral,
          ),
        );
      },
    },
  };
  return { gateway, calls };
};

describe('widened', () => {
  it('re-marks a forbidden sentence against its raw slides and loaded units, then each candidate beyond them', async () => {
    const { gateway, calls } = gatewayOf();
    const UNIT = 'In short: cells are square.';
    const summary: LoadedSummary = {
      summary: LectureSummary.parse({
        lectureId: 'l1',
        units: [
          {
            text: UNIT,
            citations: [
              { sourceId: retrieved(expectedSlide).sourceId, quote: 'Cells are square.' },
            ],
            kind: 'lecture-summary',
          },
        ],
      }),
      slides: [retrieved(expectedSlide)],
    };
    const forbidden = sentence('Cells are hexagons.', [candidate, expectedSlide]);
    const result = grounded([forbidden], [expectedSlide, candidate]);
    const item = asked(
      {
        ...result,
        context: { raw: [retrieved(expectedSlide)], summaries: [summary], leftOut: [] },
      },
      [expectedSlide],
      covered,
    );
    await widened([item], gateway);
    expect(calls[0]?.pairs.map(({ premise }) => premise)).toEqual([
      slideText(expectedSlide),
      'Comb',
      'Cells are square.',
      UNIT,
      slideText(candidate),
      'Comb',
      'Bees are busy.',
    ]);
  });

  it('re-marks a forbidden sentence against the raw slides beside its candidates, each slide once', async () => {
    const { gateway, calls } = gatewayOf();
    const forbidden = sentence('Cells are hexagons.', [candidate, expectedSlide]);
    const item = asked(
      grounded([sentence('Bees are busy.', [candidate]), forbidden], [expectedSlide, candidate]),
      [expectedSlide],
      covered,
    );
    const [wide] = await widened([item], gateway);
    expect(calls).toEqual([
      {
        pairs: [
          slideText(expectedSlide),
          'Comb',
          'Cells are square.',
          slideText(candidate),
          'Comb',
          'Bees are busy.',
        ].map((premise) => ({ premise, hypothesis: 'Cells are hexagons.' })),
      },
    ]);
    expect(wide?.result).toMatchObject({
      explanation: {
        sentences: [{ contradicts: [] }, { contradicts: [retrieved(expectedSlide).sourceId] }],
      },
    });
  });

  it('leaves an item outside the set, or with no forbidden sentence, as it was, calling nothing', async () => {
    const { gateway, calls } = gatewayOf();
    const items = [
      asked(
        grounded([sentence('Cells are hexagons.', [candidate])], [candidate]),
        [candidate],
        outsideSet,
      ),
      asked(
        grounded([sentence('Cells are square.', [expectedSlide])], [expectedSlide]),
        [expectedSlide],
        covered,
      ),
    ];
    await expect(widened(items, gateway)).resolves.toEqual(items);
    expect(calls).toEqual([]);
  });
});
