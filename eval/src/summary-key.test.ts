import type { SummaryOutcome } from '@cram/grounding';
import { LectureId, type RetrievedSlide, SlideRecord, SourceId } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { keyTotals, lectureKeyRow, type LooseUnits } from './summary-key';

const slide = (id: string, title: string, body: string): RetrievedSlide => ({
  sourceId: SourceId.parse(id),
  record: SlideRecord.parse({
    courseId: 'hollowmere',
    lectureId: 'l1',
    lectureTitle: 'The Hive',
    slideNo: Number(id.split('/')[1]),
    kind: 'content',
    title,
    body,
    speakerNotes: '',
    imageCaptions: [],
    derived: false,
    sourceHash: 'h',
  }),
});

const castes = slide('l1/1', 'Castes', 'Worker bees are female.\nDrones are male.');
const repeated = slide('l1/2', 'Comb', 'Comb\nCells are hexagonal.');
const SLIDES = [castes, repeated];

const reply = (text: string, citation: Record<string, unknown>): LooseUnits => ({
  units: [{ text, citations: [{ sourceId: 'l1/1', ...citation }] }],
});

const summarised = (...texts: string[]): SummaryOutcome => ({
  status: 'summarised',
  summary: {
    lectureId: LectureId.parse('l1'),
    units: texts.map((text) => ({
      text,
      kind: 'lecture-summary' as const,
      citations: [{ sourceId: SourceId.parse('l1/1'), quote: 'Drones are male.' }],
    })),
  },
  withheld: [],
  drafted: texts.length,
});

const row = (replies: readonly LooseUnits[], outcome = summarised()) =>
  lectureKeyRow('l1', SLIDES, replies, outcome);

describe('lectureKeyRow', () => {
  it('reads a numbered citation by its number, and counts it as carrying no copy', () => {
    expect(row([reply('Drones are the males.', { line: 3 })]).citations).toMatchObject({
      total: 1,
      byNumber: 1,
      byCopy: 0,
      copyAbsent: 1,
      numberAbsent: 0,
    });
  });

  it('reads a copied citation by its copy, and counts it as carrying no number', () => {
    expect(
      row([reply('Drones are the males.', { line: 'Drones are male.' })]).citations,
    ).toMatchObject({
      total: 1,
      byNumber: 0,
      byCopy: 1,
      copyAbsent: 0,
      numberAbsent: 1,
    });
  });

  it('counts a copy and a number as agreeing only when they name the same line', () => {
    const same = row([reply('Drones are the males.', { line: 'Drones are male.', lineNo: 3 })]);
    const other = row([reply('Drones are the males.', { line: 'Drones are male.', lineNo: 2 })]);
    expect([same.citations.bothAgree, other.citations.bothAgree]).toEqual([1, 0]);
  });

  it('counts a copy of a line its slide holds twice as ambiguous and unresolved', () => {
    const read = lectureKeyRow(
      'l1',
      SLIDES,
      [{ units: [{ text: 'Comb is built.', citations: [{ sourceId: 'l1/2', line: 'Comb' }] }] }],
      summarised(),
    );
    expect(read.citations).toMatchObject({ ambiguous: 1, byCopy: 0 });
  });

  it('counts a unit whose text is a slide line as verbatim, and not one that paraphrases', () => {
    const read = row([
      reply('Drones are male.', { line: 3 }),
      reply('The drones are the hive’s males.', { line: 3 }),
    ]);
    expect(read.verbatim).toBe(1);
  });

  it('counts a stored unit as agreeing only when every citation of its reply agrees', () => {
    const outcome = summarised('Drones are the males.', 'Workers are the females.');
    const read = row(
      [
        reply('Drones are the males.', { line: 'Drones are male.', lineNo: 3 }),
        reply('Workers are the females.', { line: 'Worker bees are female.', lineNo: 3 }),
      ],
      outcome,
    );
    expect([read.stored, read.storedAgreeing]).toEqual([2, 1]);
  });

  it('counts withheld units by whether resolution or the verifier withheld them', () => {
    const unit = { text: 'Drones sting.', kind: 'lecture-summary' as const, citations: [] };
    const read = row([], {
      status: 'unsummarised',
      reason: 'no-unit-survived',
      withheld: [
        { reason: 'dangling-citation', unit },
        { reason: 'unsupported', unit },
      ],
      drafted: 2,
    });
    expect(read).toMatchObject({ stored: 0, drafted: 2, dangling: 1, verifierWithheld: 1 });
  });
});

describe('keyTotals', () => {
  it('states each yield as a part over the units drafted, and the summary yield over lectures', () => {
    const outcome = summarised('Drones are male.');
    const totals = keyTotals([
      row([reply('Drones are male.', { line: 'Drones are male.' })], outcome),
      lectureKeyRow('l2', [], [], {
        status: 'unsummarised',
        reason: 'nothing-to-summarise',
        withheld: [],
        drafted: 0,
      }),
    ]);
    expect(totals).toMatchObject({
      summaryYield: '1/2',
      summaryUnitYield: '1/1',
      verbatimShare: '1/1',
      byCopy: '1/1',
    });
  });
});
