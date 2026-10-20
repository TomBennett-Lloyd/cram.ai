import type { SlideNo } from '@cram/shared';
import type { PageText, SlideKind, TextLine } from './page-text';

/** A page with fewer words than this outside its page number has a thin text layer (#9). */
export const THIN_TEXT_LAYER_WORDS = 5;

export const BULLET_MARKERS = ['•', '◦', '▪', '‣', '○', '■', '□', '–', '➢', '➤'] as const;

/** Titles that mark a references page (#9); keeping those out of retrieval is #78's. */
export const REFERENCES_TITLE =
  /^(references|reference list|bibliography|further readings?|reading lists?|works cited)\b/i;

export interface SlideText {
  readonly kind: SlideKind;
  readonly title: string;
  readonly body: string;
}

const DIGITS_ONLY = /^\d+$/;
const WORD = /[\p{L}\p{N}]+/gu;

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** A marker counts only before whitespace or alone, so `–0.76 V` stays a negative number. */
const markerOf = (text: string): string | undefined =>
  BULLET_MARKERS.find((marker) => text === marker || text.startsWith(`${marker} `));

const isPageNumber = (line: TextLine, slideNo: SlideNo): boolean =>
  DIGITS_ONLY.test(line.text) && Number(line.text) === slideNo;

/** A line that is only a bullet marker takes the line after it; a trailing one is dropped. */
const joinBulletMarkers = (lines: readonly TextLine[]): TextLine[] => {
  const joined: TextLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (markerOf(line.text) !== line.text) {
      joined.push(line);
      continue;
    }
    const next = lines[i + 1];
    if (next !== undefined) joined.push({ text: `${line.text} ${next.text}`, size: next.size });
    i++;
  }
  return joined;
};

const isTitleCandidate = (line: TextLine): boolean =>
  !DIGITS_ONLY.test(line.text) && markerOf(line.text) === undefined;

/** The size carrying the most characters; a tie goes to the smaller size, body text being smaller. */
const modalSize = (lines: readonly TextLine[]): number => {
  const chars = new Map<number, number>();
  for (const line of lines) chars.set(line.size, (chars.get(line.size) ?? 0) + line.text.length);
  let modal = 0;
  let most = -1;
  for (const [size, count] of chars) {
    if (count > most || (count === most && size < modal)) {
      modal = size;
      most = count;
    }
  }
  return modal;
};

/** Index range [start, end) of the title: the first run at the largest size if it beats the modal size, else the first line. */
const titleRange = (lines: readonly TextLine[]): readonly [number, number] => {
  const largest = Math.max(...lines.filter(isTitleCandidate).map((line) => line.size));
  const isTitleLine = (line: TextLine): boolean => isTitleCandidate(line) && line.size === largest;
  if (largest > modalSize(lines)) {
    const start = lines.findIndex(isTitleLine);
    const run = lines.slice(start).findIndex((line) => !isTitleLine(line));
    return [start, run === -1 ? lines.length : start + run];
  }
  const first = lines[0];
  return first !== undefined && isTitleCandidate(first) ? [0, 1] : [0, 0];
};

/** One bullet or plain line per `\n`: an unmarked line after a bullet is its wrapped continuation. */
const bodyOf = (lines: readonly TextLine[]): string => {
  const blocks: string[] = [];
  let bullet: string | undefined;
  for (const { text } of lines) {
    if (markerOf(text) !== undefined) {
      if (bullet !== undefined) blocks.push(bullet);
      bullet = text;
    } else if (bullet !== undefined) {
      bullet += ` ${text}`;
    } else {
      blocks.push(text);
    }
  }
  if (bullet !== undefined) blocks.push(bullet);
  return blocks.join('\n');
};

interface TitledLines {
  readonly title: string;
  readonly bodyLines: readonly TextLine[];
}

const inferTitle = (lines: readonly TextLine[]): TitledLines => {
  const [start, end] = titleRange(lines);
  return {
    title: lines
      .slice(start, end)
      .map((line) => line.text)
      .join(' '),
    bodyLines: [...lines.slice(0, start), ...lines.slice(end)],
  };
};

const wordCount = (text: string): number => text.match(WORD)?.length ?? 0;

/** A page's title, body and kind: the title the format marks, else the one its text layer implies (#9). */
export const slideText = (page: PageText, slideNo: SlideNo): SlideText => {
  const lines = joinBulletMarkers(
    page.lines
      .map((line) => ({ text: collapse(line.text), size: line.size }))
      .filter((line) => line.text !== '' && !isPageNumber(line, slideNo)),
  );
  const { title, bodyLines } =
    page.markedTitle === undefined
      ? inferTitle(lines)
      : { title: collapse(page.markedTitle), bodyLines: lines };
  const words = bodyLines.reduce((count, line) => count + wordCount(line.text), wordCount(title));
  if (words < THIN_TEXT_LAYER_WORDS) return { kind: 'image-only', title, body: '' };
  return {
    kind: REFERENCES_TITLE.test(title) ? 'references' : 'content',
    title,
    body: bodyOf(bodyLines),
  };
};
