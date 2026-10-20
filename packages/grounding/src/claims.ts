const CLAIM_BOUNDARY = /(?<=[.!?])\s+(?=[\p{Lu}\p{N}])|(?<=;)\s+/u;

/** The claim split that lets a three-class model return `partial` (`docs/adr/0003-model-roles-and-backends.md` § Decision (d)). */
export const splitClaims = (text: string): readonly string[] =>
  text
    .split(CLAIM_BOUNDARY)
    .map((claim) => claim.trim())
    .filter((claim) => claim.length > 0);
