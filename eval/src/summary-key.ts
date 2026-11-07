import {
  copiedLine,
  copiedLines,
  slideLines,
  slideText,
  type SummaryOutcome,
} from '@cram/grounding';
import { quoteSpan, type RetrievedSlide, type SlideRecord } from '@cram/shared';
import { z } from 'zod';

/**
 * A generator citation in any of the shapes #481 measures: `line` a number (before), `line` a
 * copied line (option 1), or a copy beside `lineNo` (options 2 and 3).
 */
const LooseCitation = z.object({
  sourceId: z.string(),
  line: z.union([z.number(), z.string()]).optional(),
  lineNo: z.number().optional(),
});
type LooseCitation = z.infer<typeof LooseCitation>;

export const LooseUnits = z.object({
  units: z.array(z.object({ text: z.string(), citations: z.array(LooseCitation) })),
});
export type LooseUnits = z.infer<typeof LooseUnits>;

export interface CitationCounts {
  readonly total: number;
  readonly byNumber: number;
  readonly byCopy: number;
  readonly bothAgree: number;
  readonly ambiguous: number;
  readonly numberAbsent: number;
  readonly copyAbsent: number;
}

export interface LectureKeyRow {
  readonly lectureId: string;
  readonly status: SummaryOutcome['status'];
  readonly drafted: number;
  readonly stored: number;
  readonly dangling: number;
  readonly verifierWithheld: number;
  readonly storedAgreeing: number;
  readonly verbatim: number;
  readonly citations: CitationCounts;
}

interface Read {
  readonly byNumber: string | undefined;
  readonly byCopy: string | undefined;
  readonly ambiguous: boolean;
  readonly hasNumber: boolean;
  readonly hasCopy: boolean;
}

const readCitation = (
  records: ReadonlyMap<string, SlideRecord>,
  { sourceId, line, lineNo }: LooseCitation,
): Read => {
  const record = records.get(sourceId);
  const number = typeof line === 'number' ? line : lineNo;
  const copy = typeof line === 'string' ? line : undefined;
  return {
    byNumber:
      record === undefined || number === undefined ? undefined : slideLines(record)[number - 1],
    byCopy: record === undefined || copy === undefined ? undefined : copiedLine(record, copy),
    ambiguous: record !== undefined && copy !== undefined && copiedLines(record, copy).length > 1,
    hasNumber: number !== undefined,
    hasCopy: copy !== undefined,
  };
};

const agrees = (read: Read): boolean =>
  read.byNumber !== undefined && read.byNumber === read.byCopy;

const count = (reads: readonly Read[], test: (read: Read) => boolean): number =>
  reads.filter(test).length;

/** One lecture's summary call, read back from its replies and its outcome (#481's measurement). */
export const lectureKeyRow = (
  lectureId: string,
  slides: readonly RetrievedSlide[],
  replies: readonly LooseUnits[],
  outcome: SummaryOutcome,
): LectureKeyRow => {
  const records = new Map<string, SlideRecord>(slides.map((s) => [s.sourceId, s.record]));
  const units = replies.flatMap(({ units: replied }) => replied);
  const reads = units.flatMap(({ citations }) => citations.map((c) => readCitation(records, c)));
  const storedUnits = outcome.status === 'summarised' ? outcome.summary.units : [];
  const withheld = outcome.status === 'model-failed' ? [] : outcome.withheld;
  const dangling = withheld.filter(({ reason }) => reason === 'dangling-citation').length;
  const storedAgreeing = storedUnits.filter((stored) => {
    const replied = units.find(({ text }) => text === stored.text);
    return replied?.citations.every((citation) => agrees(readCitation(records, citation))) === true;
  }).length;
  const verbatim = units.filter(({ text }) =>
    slides.some(({ record }) => quoteSpan(slideText(record), text) !== undefined),
  ).length;
  return {
    lectureId,
    status: outcome.status,
    drafted: outcome.drafted,
    stored: storedUnits.length,
    dangling,
    verifierWithheld: withheld.length - dangling,
    storedAgreeing,
    verbatim,
    citations: {
      total: reads.length,
      byNumber: count(reads, (read) => read.byNumber !== undefined),
      byCopy: count(reads, (read) => read.byCopy !== undefined),
      bothAgree: count(reads, agrees),
      ambiguous: count(reads, (read) => read.ambiguous),
      numberAbsent: count(reads, (read) => !read.hasNumber),
      copyAbsent: count(reads, (read) => !read.hasCopy),
    },
  };
};

const ratio = (part: number, whole: number): string => `${String(part)}/${String(whole)}`;

/** The rows summed, with the two eval yields as `eval/src/summary-rows.ts` defines them. */
export const keyTotals = (rows: readonly LectureKeyRow[]) => {
  const sum = (pick: (row: LectureKeyRow) => number): number =>
    rows.reduce((total, row) => total + pick(row), 0);
  const drafted = sum((row) => row.drafted);
  const total = sum((row) => row.citations.total);
  return {
    summaryYield: ratio(rows.filter((row) => row.status === 'summarised').length, rows.length),
    summaryUnitYield: ratio(
      sum((row) => row.stored),
      drafted,
    ),
    agreeingUnitYield: ratio(
      sum((row) => row.storedAgreeing),
      drafted,
    ),
    verbatimShare: ratio(
      sum((row) => row.verbatim),
      drafted,
    ),
    dangling: sum((row) => row.dangling),
    verifierWithheld: sum((row) => row.verifierWithheld),
    byNumber: ratio(
      sum((row) => row.citations.byNumber),
      total,
    ),
    byCopy: ratio(
      sum((row) => row.citations.byCopy),
      total,
    ),
    bothAgree: ratio(
      sum((row) => row.citations.bothAgree),
      total,
    ),
    ambiguous: ratio(
      sum((row) => row.citations.ambiguous),
      total,
    ),
    numberAbsent: sum((row) => row.citations.numberAbsent),
    copyAbsent: sum((row) => row.citations.copyAbsent),
  };
};
