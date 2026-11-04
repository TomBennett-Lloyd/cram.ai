import type { EntailmentResult, Recording } from '@cram/gateway';
import { LectureId, type RetrievedSlide, SlideNo } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { splitClaims } from './claims';
import {
  answer,
  cite,
  ENTAILED,
  fakeGateway,
  generatorRecording,
  generatorReplies,
  NEUTRAL,
  slide,
  verifierRecording,
} from './fake-gateway-fixture';
import { PROVISIONAL_NLI_THRESHOLDS } from './nli-verdict';
import { estimateTokens } from './prompt-budget';
import { generationRequest, type SummaryTask } from './prompts/generation-prompt';
import { sourceBlock } from './prompts/source-block';
import { digestOf, SUMMARY_MAX_UNITS, summariseLecture, summaryParts } from './summarise-lecture';

const lecture = { lectureId: LectureId.parse('l1'), lectureTitle: 'The Hive' };
const task: SummaryTask = {
  kind: 'lecture-summary',
  lectureTitle: lecture.lectureTitle,
  maxUnits: SUMMARY_MAX_UNITS,
};
const workers = slide('l1/1', 'Worker bees are male.');
const comb = slide('l1/2', 'Bees build comb from square cells.', { slideNo: SlideNo.parse(2) });
const drones = slide('l1/3', 'Drones never forage.', { slideNo: SlideNo.parse(3) });

const unitCiting = (text: string, sourceId: string) => ({
  text,
  citations: [{ sourceId, line: 1 }],
});
const replies = (slides: readonly RetrievedSlide[], ...units: object[]): Recording =>
  generatorReplies(generationRequest(task, slides), { units });
const judged = (text: string, quote: string, result: EntailmentResult): Recording =>
  verifierRecording(
    splitClaims(text).map((hypothesis) => ({ premise: quote, hypothesis })),
    [result],
  );

const summarise = (
  slides: readonly RetrievedSlide[],
  recordings: readonly Recording[],
  budget?: number,
) =>
  summariseLecture(lecture, slides, {
    gateway: fakeGateway(recordings),
    strategy: 'nli',
    thresholds: PROVISIONAL_NLI_THRESHOLDS,
    ...(budget === undefined ? {} : { budget }),
  });

/** The prompt's fixed text plus the named slides' blocks, as `summaryParts` counts them. */
const tokensFor = (...slides: readonly RetrievedSlide[]): number =>
  generationRequest(task, []).messages.reduce(
    (sum, { content }) => sum + estimateTokens(content),
    0,
  ) + slides.reduce((sum, each) => sum + estimateTokens(`${sourceBlock(each)}\n\n`), 0);

describe('summariseLecture', () => {
  it('stores the verified units in order and reports a withheld one beside them, counting both as drafted', async () => {
    const male = 'Workers are male.';
    const night = 'Workers forage at night.';
    const outcome = await summarise(
      [workers],
      [
        replies([workers], unitCiting(male, 'l1/1'), unitCiting(night, 'l1/1')),
        judged(male, 'Worker bees are male.', ENTAILED),
        judged(night, 'Worker bees are male.', NEUTRAL),
      ],
    );
    expect(outcome).toEqual({
      status: 'summarised',
      summary: { lectureId: 'l1', units: [answer(male, [cite('l1/1', 'Worker bees are male.')])] },
      withheld: [
        { reason: 'unsupported', unit: answer(night, [cite('l1/1', 'Worker bees are male.')]) },
      ],
      drafted: 2,
    });
  });

  it('drops a unit only partly supported rather than asking for a rewrite', async () => {
    const half = 'Workers are male. Workers forage at night.';
    const outcome = await summarise(
      [workers],
      [
        replies([workers], unitCiting(half, 'l1/1')),
        verifierRecording(
          splitClaims(half).map((hypothesis) => ({ premise: 'Worker bees are male.', hypothesis })),
          [ENTAILED, NEUTRAL],
        ),
      ],
    );
    expect(outcome).toEqual({
      status: 'unsummarised',
      reason: 'no-unit-survived',
      withheld: [
        {
          reason: 'partial',
          policy: 'drop',
          unit: answer(half, [cite('l1/1', 'Worker bees are male.')]),
        },
      ],
      drafted: 1,
    });
  });

  it('is model-failed, with no summary, when the generator fails', async () => {
    const failed = {
      status: 'backend-failed',
      cause: 'request-error',
      reason: 'connection refused',
    } as const;
    await expect(
      summarise([workers], [generatorRecording(generationRequest(task, [workers]), failed)]),
    ).resolves.toEqual({ status: 'model-failed', stage: 'generate', failure: failed, drafted: 0 });
  });

  it('is unsummarised when every drafted unit is withheld, never an empty summary, and reports each', async () => {
    const night = 'Workers forage at night.';
    await expect(
      summarise(
        [workers],
        [
          replies([workers], unitCiting(night, 'l1/1')),
          judged(night, 'Worker bees are male.', NEUTRAL),
        ],
      ),
    ).resolves.toEqual({
      status: 'unsummarised',
      reason: 'no-unit-survived',
      withheld: [
        { reason: 'unsupported', unit: answer(night, [cite('l1/1', 'Worker bees are male.')]) },
      ],
      drafted: 1,
    });
  });

  it('reports a unit citing a line its slide does not have as dangling, never sending it to the verifier', async () => {
    const male = 'Workers are male.';
    const stray = 'Workers sting.';
    await expect(
      summarise(
        [workers],
        [
          replies([workers], unitCiting(male, 'l1/1'), {
            text: stray,
            citations: [{ sourceId: 'l1/1', line: 9 }],
          }),
          judged(male, 'Worker bees are male.', ENTAILED),
        ],
      ),
    ).resolves.toMatchObject({
      status: 'summarised',
      withheld: [{ reason: 'dangling-citation', unit: answer(stray, []) }],
      drafted: 2,
    });
  });

  it('sends no references page and no slide without lines, but sends text read from a picture, and makes no call for a lecture of only the first two', async () => {
    const references = slide('l1/4', 'Hollowmere Guild, 1890.', {
      slideNo: SlideNo.parse(4),
      kind: 'references',
    });
    const blank = slide('l1/5', '', { slideNo: SlideNo.parse(5), kind: 'image-only' });
    const read = slide('l1/6', 'Smoke calms the guards.', {
      slideNo: SlideNo.parse(6),
      kind: 'image-only',
      derived: true,
    });
    const blankLines = slide('l1/7', ' \n\t', { slideNo: SlideNo.parse(7), title: '  ' });
    await expect(summarise([references, blank, blankLines], [])).resolves.toEqual({
      status: 'unsummarised',
      reason: 'nothing-to-summarise',
      withheld: [],
      drafted: 0,
    });
    const male = 'Workers are male.';
    await expect(
      summarise(
        [references, workers, blank, read],
        [
          replies([workers, read], unitCiting(male, 'l1/1')),
          judged(male, 'Worker bees are male.', ENTAILED),
        ],
      ),
    ).resolves.toMatchObject({ status: 'summarised', drafted: 1 });
  });

  it('summarises an over-budget lecture in parts, one call each, the units and the withheld in part order', async () => {
    const male = 'Workers are male.';
    const square = 'Comb cells are square.';
    const night = 'Workers forage at night.';
    const idle = 'Drones sleep all day.';
    const outcome = await summarise(
      [workers, comb, drones],
      [
        replies(
          [workers, comb],
          unitCiting(male, 'l1/1'),
          unitCiting(night, 'l1/1'),
          unitCiting(square, 'l1/2'),
        ),
        replies([drones], unitCiting(idle, 'l1/3'), unitCiting('Drones do not forage.', 'l1/3')),
        judged(male, 'Worker bees are male.', ENTAILED),
        judged(night, 'Worker bees are male.', NEUTRAL),
        judged(square, 'Bees build comb from square cells.', ENTAILED),
        judged(idle, 'Drones never forage.', NEUTRAL),
        judged('Drones do not forage.', 'Drones never forage.', ENTAILED),
      ],
      tokensFor(workers, comb),
    );
    expect(
      outcome.status === 'summarised' && outcome.summary.units.map(({ text }) => text),
    ).toEqual([male, square, 'Drones do not forage.']);
    expect(
      outcome.status !== 'model-failed' && outcome.withheld.map(({ unit }) => unit.text),
    ).toEqual([night, idle]);
    expect(outcome.drafted).toBe(5);
  });

  it('stores nothing when a later part fails, though an earlier one was summarised', async () => {
    const male = 'Workers are male.';
    const failed = {
      status: 'backend-failed',
      cause: 'request-error',
      reason: 'connection refused',
    } as const;
    await expect(
      summarise(
        [workers, drones],
        [
          replies([workers], unitCiting(male, 'l1/1')),
          judged(male, 'Worker bees are male.', ENTAILED),
          generatorRecording(generationRequest(task, [drones]), failed),
        ],
        tokensFor(workers),
      ),
    ).resolves.toEqual({ status: 'model-failed', stage: 'generate', failure: failed, drafted: 1 });
  });

  it('counts an earlier part’s withheld units as drafted when a later part fails', async () => {
    const night = 'Workers forage at night.';
    const failed = {
      status: 'backend-failed',
      cause: 'request-error',
      reason: 'connection refused',
    } as const;
    await expect(
      summarise(
        [workers, drones],
        [
          replies([workers], unitCiting(night, 'l1/1')),
          judged(night, 'Worker bees are male.', NEUTRAL),
          generatorRecording(generationRequest(task, [drones]), failed),
        ],
        tokensFor(workers),
      ),
    ).resolves.toEqual({ status: 'model-failed', stage: 'generate', failure: failed, drafted: 1 });
  });

  it('is unsummarised, with no call, when one slide alone is over the budget', async () => {
    await expect(summarise([workers, comb], [], tokensFor(comb) - 1)).resolves.toEqual({
      status: 'unsummarised',
      reason: 'slide-over-budget',
      withheld: [],
      drafted: 0,
    });
  });
});

describe('digestOf', () => {
  const kept = answer('Workers are male.', [cite('l1/1', 'Worker bees are male.')]);
  const dropped = { reason: 'unsupported', unit: answer('Workers fly.', []) } as const;

  it('stores a summary’s units beside its withheld ones', () => {
    expect(
      digestOf(lecture.lectureId, {
        status: 'summarised',
        summary: { lectureId: lecture.lectureId, units: [{ ...kept, kind: 'lecture-summary' }] },
        withheld: [dropped],
        drafted: 2,
      }),
    ).toEqual({ lectureId: 'l1', units: [kept], withheld: [dropped] });
  });

  it('stores no unit, and every withheld one, for an unsummarised run', () => {
    expect(
      digestOf(lecture.lectureId, {
        status: 'unsummarised',
        reason: 'no-unit-survived',
        withheld: [dropped],
        drafted: 1,
      }),
    ).toEqual({ lectureId: 'l1', units: [], withheld: [dropped] });
  });
});

describe('summaryParts', () => {
  it('keeps slides that fit the budget exactly in one part, and splits at one token less', () => {
    const exact = tokensFor(workers, comb, drones);
    expect(summaryParts(task, [workers, comb, drones], exact)).toEqual([[workers, comb, drones]]);
    expect(summaryParts(task, [workers, comb, drones], exact - 1)).toEqual([
      [workers, comb],
      [drones],
    ]);
  });

  it('gives a slide that fits only alone a part of its own', () => {
    expect(summaryParts(task, [workers, comb], tokensFor(comb))).toEqual([[workers], [comb]]);
  });

  it('makes no part for no slide', () => {
    expect(summaryParts(task, [], tokensFor())).toEqual([]);
  });
});
