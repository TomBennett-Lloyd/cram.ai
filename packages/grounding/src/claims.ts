import { BLANK_LINE } from '@cram/shared';

const UAX29_CONTINUE_MARKS = String.raw`\u055D\u060D\u066B\u066C\uFE10\uFE11\uFE13\uFE14`;
const MARK_RUN = String.raw`(?:(?![\p{Pd}\p{Term}\p{Cased}${UAX29_CONTINUE_MARKS}])[\p{P}\p{S}])*`;
const CLAIM_BOUNDARY = new RegExp(
  String.raw`(?<=[.!?]${MARK_RUN})\s+(?=${MARK_RUN}[\p{Lu}\p{N}])|(?<=;)\s+|${BLANK_LINE.source}`,
  'u',
);

/** The claim split that lets a three-class model return `partial` (`docs/adr/0003-model-roles-and-backends.md` § Decision (d)). */
export const splitClaims = (text: string): readonly string[] =>
  text
    .split(CLAIM_BOUNDARY)
    .map((claim) => claim.trim())
    .filter((claim) => claim.length > 0);

export interface ClaimSpan {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** Where each of `claims` sits in `text`, in order; each must be a substring of `text` past the one before it. */
export const spansOf = (text: string, claims: readonly string[]): readonly ClaimSpan[] => {
  let from = 0;
  return claims.map((claim) => {
    const start = text.indexOf(claim, from);
    if (start === -1)
      throw new Error(`spansOf: "${claim}" is not in the text past ${String(from)}`);
    from = start + claim.length;
    return { text: claim, start, end: from };
  });
};

/** `splitClaims`'s claims with where each sits in `text`. */
export const claimSpans = (text: string): readonly ClaimSpan[] => spansOf(text, splitClaims(text));
