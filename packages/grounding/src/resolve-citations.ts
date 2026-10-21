import {
  type Citation,
  quoteSpan,
  type RetrievedSlide,
  type SourceId,
  type Unit,
  type WithheldUnit,
} from '@cram/shared';
import { slideText } from './slide-text';
import type { Quotes } from './verifier-input';

export interface ResolvedUnit {
  readonly unit: Unit;
  readonly quotes: Quotes;
}

export interface Resolution {
  readonly resolved: readonly ResolvedUnit[];
  readonly withheld: readonly WithheldUnit[];
}

const resolves = (citation: Citation, textById: ReadonlyMap<SourceId, string>): boolean => {
  const text = textById.get(citation.sourceId);
  return text !== undefined && quoteSpan(text, citation.quote) !== undefined;
};

/** Mechanical, before any model sees a unit (`docs/standards/grounding.md` rule 3). */
export const resolveCitations = (
  units: readonly Unit[],
  retrieved: readonly RetrievedSlide[],
): Resolution => {
  const textById = new Map(retrieved.map((slide) => [slide.sourceId, slideText(slide.record)]));
  const resolved: ResolvedUnit[] = [];
  const withheld: WithheldUnit[] = [];
  for (const unit of units) {
    const [first, ...rest] = unit.citations;
    if (first !== undefined && unit.citations.every((citation) => resolves(citation, textById))) {
      resolved.push({ unit, quotes: [first.quote, ...rest.map((citation) => citation.quote)] });
    } else {
      withheld.push({ reason: 'dangling-citation', unit });
    }
  }
  return { resolved, withheld };
};
