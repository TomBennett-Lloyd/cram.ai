import type { PageText } from './page-text';

const MATH_ALPHANUMERIC = /[\u{1D400}-\u{1D7FF}ℂℊℋℌℍℎℐℑℒℕℙℚℛℜℝℤℨℬℭℯℰℱℳℴ]/gu;

/** Every adapter's text as stored: math alphanumerics as plain letters, then NFC, since resolution normalises only whitespace (`docs/standards/grounding.md` rule 3; #159, #194). */
export const storedText = (text: string): string =>
  text.replace(MATH_ALPHANUMERIC, (letter) => letter.normalize('NFKC')).normalize('NFC');

export const storedPage = (page: PageText): PageText => ({
  ...(page.markedTitle === undefined ? {} : { markedTitle: storedText(page.markedTitle) }),
  lines: page.lines.map((line) => ({ ...line, text: storedText(line.text) })),
  notes: storedText(page.notes),
});
