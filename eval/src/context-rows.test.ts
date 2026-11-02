import {
  type AssembledContext,
  EMPTY_CONTEXT,
  type ExplainResult,
  explanationRequest,
  PROMPT_TOKEN_BUDGET,
  requestTokens,
} from '@cram/grounding';
import { LectureSummary, type LoadedSummary, type SlideRecord } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { contextOverflow, promptTokens, sourceCoverage } from './context-rows';
import { asked, grounded, NOT_COVERED, record, retrieved, sentence } from './run-fixture';

const square = record({ slideNo: 1, body: 'Cells are square.' });
const wax = record({ slideNo: 2, body: 'Comb is wax.' });
const drones = record({ slideNo: 3, body: 'Drones are male.' });

const summaryCiting = (...slides: readonly SlideRecord[]): LoadedSummary => ({
  summary: LectureSummary.parse({
    lectureId: 'l1',
    units: slides.map((slide) => ({
      text: `In short: ${slide.body}`,
      citations: [{ sourceId: retrieved(slide).sourceId, quote: slide.body }],
      kind: 'lecture-summary',
    })),
  }),
  slides: slides.map(retrieved),
});

const withContext = (result: ExplainResult, context: Partial<AssembledContext>): ExplainResult => ({
  ...result,
  context: { ...EMPTY_CONTEXT, ...context },
});

describe('contextOverflow', () => {
  it('counts the prompts that left something out among those assembled', () => {
    const fit = withContext(NOT_COVERED, { raw: [retrieved(square)] });
    const over = withContext(NOT_COVERED, {
      raw: [retrieved(square)],
      leftOut: [retrieved(wax).sourceId],
    });
    expect(contextOverflow([asked(fit), asked(over), asked(NOT_COVERED)])).toMatchObject({
      ratio: { numerator: 1, denominator: 2 },
    });
    expect(contextOverflow([asked(NOT_COVERED)])).toMatchObject({ status: 'not-measurable' });
  });
});

describe('sourceCoverage', () => {
  it('credits each loaded slide a shown sentence names, raw or cited by a loaded unit, once', () => {
    const result = withContext(
      grounded([
        sentence('Drones are male.', [drones]),
        sentence('So cells are square.', [drones]),
      ]),
      { raw: [retrieved(square), retrieved(wax)], summaries: [summaryCiting(drones, square)] },
    );
    expect(sourceCoverage([asked(result)])).toMatchObject({
      ratio: { numerator: 1, denominator: 3 },
    });
  });

  it('credits nothing a withheld or not-covered reply loaded, and credits no slide it did not load', () => {
    const outside = withContext(grounded([sentence('Drones are male.', [drones])]), {
      raw: [retrieved(square)],
    });
    const uncovered = withContext(NOT_COVERED, { raw: [retrieved(wax)] });
    expect(sourceCoverage([asked(outside), asked(uncovered)])).toMatchObject({
      ratio: { numerator: 0, denominator: 2 },
    });
    expect(sourceCoverage([asked(NOT_COVERED)])).toMatchObject({ status: 'not-measurable' });
  });
});

describe('promptTokens', () => {
  it('reports the largest prompt assembled beside the budget', () => {
    const small = withContext(NOT_COVERED, { raw: [retrieved(square)] });
    const large = withContext(NOT_COVERED, {
      raw: [retrieved(square), retrieved(wax)],
      summaries: [summaryCiting(drones)],
    });
    const item = asked(large);
    expect(promptTokens([asked(small), item, asked(NOT_COVERED)])).toEqual({
      budget: PROMPT_TOKEN_BUDGET,
      estimate: {
        status: 'measured',
        samples: 2,
        maxTokens: requestTokens(explanationRequest(item.question.question, large.context)),
      },
    });
    expect(promptTokens([asked(NOT_COVERED)]).estimate).toMatchObject({
      status: 'not-measurable',
    });
  });
});
