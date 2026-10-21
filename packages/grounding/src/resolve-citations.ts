import {
  type Citation,
  quoteSpan,
  type RetrievedSlide,
  type SlideRecord,
  type SourceId,
  type Unit,
  type WithheldUnit,
} from '@cram/shared';
import type { DraftUnit } from './generate-units';
import type { LineCitation } from './prompts/generation-prompt';
import { slideLines, slideText } from './slide-text';
import type { Quotes } from './verifier-input';

export interface ResolvedUnit {
  readonly unit: Unit;
  readonly quotes: Quotes;
}

export interface Resolution {
  readonly resolved: readonly ResolvedUnit[];
  readonly withheld: readonly WithheldUnit[];
}

type Records = ReadonlyMap<SourceId, SlideRecord>;

const recordsOf = (retrieved: readonly RetrievedSlide[]): Records =>
  new Map(retrieved.map((slide) => [slide.sourceId, slide.record]));

const resolves = (citation: Citation, records: Records): boolean => {
  const record = records.get(citation.sourceId);
  return record !== undefined && quoteSpan(slideText(record), citation.quote) !== undefined;
};

const quotesResolveIn = (unit: Unit, records: Records): boolean =>
  unit.citations.length > 0 && unit.citations.every((citation) => resolves(citation, records));

export const quotesResolve = (unit: Unit, retrieved: readonly RetrievedSlide[]): boolean =>
  quotesResolveIn(unit, recordsOf(retrieved));

const quoted = (citation: LineCitation, records: Records): Citation | undefined => {
  const record = records.get(citation.sourceId);
  const quote = record === undefined ? undefined : slideLines(record)[citation.line - 1];
  return quote === undefined ? undefined : { sourceId: citation.sourceId, quote };
};

/** Mechanical, before any model sees a unit: each quote is the cited line looked up, never the model's copy (`docs/standards/grounding.md` rule 3; #367). */
export const resolveCitations = (
  units: readonly DraftUnit[],
  retrieved: readonly RetrievedSlide[],
): Resolution => {
  const records = recordsOf(retrieved);
  const resolved: ResolvedUnit[] = [];
  const withheld: WithheldUnit[] = [];
  for (const draft of units) {
    const looked = draft.citations.map((citation) => quoted(citation, records));
    const citations = looked.filter((citation) => citation !== undefined);
    const unit: Unit = { text: draft.text, citations, kind: draft.kind };
    const [first, ...rest] = citations;
    if (first !== undefined && citations.length === looked.length && quotesResolveIn(unit, records))
      resolved.push({ unit, quotes: [first.quote, ...rest.map((citation) => citation.quote)] });
    else withheld.push({ reason: 'dangling-citation', unit });
  }
  return { resolved, withheld };
};
