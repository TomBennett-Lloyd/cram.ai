import type { PageText } from './page-text';

const MATH_ALPHANUMERIC = /[\u{1D400}-\u{1D7FF}ℂℊℋℌℍℎℐℑℒℕℙℚℛℜℝℤℨℬℭℯℰℱℳℴ]/gu;

/** pdf.js's `normalizeUnicode` set, folded here for both formats with pdf.js's own fold off (#256); stored-text.test.ts holds it to pdf.js's. */
const PDFJS_FOLDED =
  /[\u00a0\u00b5\u037e\u0eb3\u2000-\u200a\u202f\u2126\ufb00-\ufb06\ufb20-\ufb36\ufb38-\ufb3c\ufb3e\ufb40\ufb41\ufb43\ufb44\ufb46-\ufba1\ufba4-\ufba9\ufbae-\ufbb1\ufbd3-\ufbdc\ufbde-\ufbe7\ufbea-\ufbf8\ufbfc\ufbfd\ufc00-\ufc5d\ufc64-\ufcf1\ufcf5-\ufd3d\ufd88\ufdf4\ufdfa\ufdfb\ufe71\ufe77\ufe79\ufe7b\ufe7d]/gu;

const compatibilityForm = (character: string): string => character.normalize('NFKC');

/** Every adapter's text as stored: math alphanumerics and `PDFJS_FOLDED` in their NFKC form, then NFC, since resolution normalises only whitespace (`docs/standards/grounding.md` rule 3; #159, #194, #256). */
export const storedText = (text: string): string =>
  text
    .replace(MATH_ALPHANUMERIC, compatibilityForm)
    .replace(PDFJS_FOLDED, compatibilityForm)
    .normalize('NFC');

export const storedPage = (page: PageText): PageText => ({
  ...(page.markedTitle === undefined ? {} : { markedTitle: storedText(page.markedTitle) }),
  lines: page.lines.map((line) => ({ ...line, text: storedText(line.text) })),
  notes: storedText(page.notes),
});
