import { SlideKind } from '@cram/shared';
import { UNCONFIRMED_DERIVED } from './confirmation';

/** What a query leaves out of both ranked lists, before each is cut to depth. */
export interface ListExclusions {
  readonly references: boolean;
  readonly unconfirmedDerived: boolean;
}

export interface ListFilters {
  readonly bm25: string;
  readonly vector: string;
}

const REFERENCES = `kind = '${SlideKind.enum.references}'`;

/**
 * One subquery per list, over the chunks of the slides it names (`docs/adr/0008-slide-chunking.md` § Decision (b)). vec0 drops rows
 * before `k` only for `rowid in`; FTS5 given `rowid in` re-runs its MATCH once per id, so it takes `not in` (#78's PR; `search-plan.test.ts`).
 */
export const listFilters = (exclusions: ListExclusions): ListFilters => {
  const left = [
    ...(exclusions.references ? [REFERENCES] : []),
    ...(exclusions.unconfirmedDerived ? [UNCONFIRMED_DERIVED] : []),
  ];
  if (left.length === 0) return { bm25: '', vector: '' };
  const leftOut = left.map((condition) => `(${condition})`).join(' or ');
  return {
    bm25: `and rowid not in (select id from chunks where slide_id in (select id from slides where ${leftOut}))`,
    vector: `and rowid in (select id from chunks where slide_id in (select id from slides where not (${leftOut})))`,
  };
};

/** A listing exam generation can draw its target slides from (`docs/plan.md` §3.5). */
export interface SlideListing {
  readonly excludeUnconfirmedDerived?: boolean;
}

export const listed = (listing: SlideListing): string =>
  listing.excludeUnconfirmedDerived === true ? `and not (${UNCONFIRMED_DERIVED})` : '';
