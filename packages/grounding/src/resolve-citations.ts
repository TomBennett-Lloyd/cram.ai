import {
  type Citation,
  quoteSpan,
  type RetrievedSlide,
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

const resolves = (citation: Citation, retrieved: readonly RetrievedSlide[]): boolean => {
  const slide = retrieved.find(({ sourceId }) => sourceId === citation.sourceId);
  return slide !== undefined && quoteSpan(slideText(slide.record), citation.quote) !== undefined;
};

export const quotesResolve = (unit: Unit, retrieved: readonly RetrievedSlide[]): boolean =>
  unit.citations.length > 0 && unit.citations.every((citation) => resolves(citation, retrieved));

const quoted = (
  citation: LineCitation,
  linesById: ReadonlyMap<SourceId, readonly string[]>,
): Citation | undefined => {
  const quote = linesById.get(citation.sourceId)?.[citation.line - 1];
  return quote === undefined ? undefined : { sourceId: citation.sourceId, quote };
};

/** Mechanical, before any model sees a unit: each quote is the cited line looked up, never the model's copy (`docs/standards/grounding.md` rule 3; #367). */
export const resolveCitations = (
  units: readonly DraftUnit[],
  retrieved: readonly RetrievedSlide[],
): Resolution => {
  const linesById = new Map(retrieved.map((slide) => [slide.sourceId, slideLines(slide.record)]));
  const resolved: ResolvedUnit[] = [];
  const withheld: WithheldUnit[] = [];
  for (const draft of units) {
    const looked = draft.citations.map((citation) => quoted(citation, linesById));
    const citations = looked.filter((citation) => citation !== undefined);
    const unit: Unit = { text: draft.text, citations, kind: draft.kind };
    const [first, ...rest] = citations;
    if (first !== undefined && citations.length === looked.length && quotesResolve(unit, retrieved))
      resolved.push({ unit, quotes: [first.quote, ...rest.map((citation) => citation.quote)] });
    else withheld.push({ reason: 'dangling-citation', unit });
  }
  return { resolved, withheld };
};
