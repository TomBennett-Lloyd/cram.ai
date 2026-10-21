/*
 * The raw-colour patterns the frontend gate refuses, owned here so that
 * stylelint.config.mjs and eslint.config.mjs refuse one set (#273). Each is a
 * regex literal in the `/source/flags` form both tools parse from a string, and
 * each is case-insensitive because CSS is, for function names and hex digits.
 */

/**
 * A hex colour: 3, 4, 6 or 8 hex digits (CSS Color 4 § 5.2) that are the whole
 * hash token, so `url(#fade-mask)` is a fragment rather than a colour. A
 * fragment id made only of hex digits (`url(#face)`) is still refused: the
 * pattern cannot see the `url(` around it.
 */
export const HEX_COLOUR = String.raw`/#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})(?![\w-])/i`;

/**
 * A call to a function CSS Color 4 or 5 defines as producing a colour, when
 * the name is not the tail of a longer identifier: `oklab(` is not `lab(`, and
 * `Matlab(R)` is not a colour.
 */
export const COLOUR_FUNCTION = String.raw`/(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|contrast-color|device-cmyk|light-dark)\(/i`;
