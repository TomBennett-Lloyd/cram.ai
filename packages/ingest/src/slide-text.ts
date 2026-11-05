import type { SlideKind, SlideNo } from '@cram/shared';
import type { LineBox, PageText, TextLine } from './page-text';

/** A page with fewer words than this outside its page number and boilerplate has a thin text layer (#9; `docs/adr/0006-image-only-slides.md` § Decision (a)). */
export const THIN_TEXT_LAYER_WORDS = 5;

export const BULLET_MARKERS = ['•', '◦', '▪', '‣', '○', '■', '□', '–', '➢', '➤'] as const;

/** Titles that mark a references page (#9), which `CourseIndex.search` leaves out by default (#78). */
export const REFERENCES_TITLE =
  /^(references|reference list|bibliography|further readings?|reading lists?|works cited)\b/i;

/** A line this many ems below a bullet's last line, or nearer, can be its wrapped continuation: a wrap at double spacing still is (slide-text.test.ts). */
export const CONTINUATION_EMS = 2.5;

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

const joinedBox = (marker: TextLine, next: TextLine): { box?: LineBox } => {
  if (next.box === undefined) return {};
  if (marker.box === undefined) return { box: next.box };
  return {
    box: {
      left: Math.min(marker.box.left, next.box.left),
      right: Math.max(marker.box.right, next.box.right),
      baseline: next.box.baseline,
    },
  };
};

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
    if (next !== undefined)
      joined.push({ text: `${line.text} ${next.text}`, size: next.size, ...joinedBox(line, next) });
    i++;
  }
  return joined;
};

const isTitleCandidate = (line: TextLine): boolean =>
  !DIGITS_ONLY.test(line.text) && markerOf(line.text) === undefined;

/** The size carrying the most characters; a tie goes to the smaller size, body text being smaller. */
export const modalSize = (lines: readonly TextLine[]): number => {
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

type Fit = 'continues' | 'beside' | 'stops';

const fitOf = (last: TextLine, line: TextLine): Fit => {
  if (last.box === undefined || line.box === undefined) return 'continues';
  if (line.box.left > last.box.right || line.box.right < last.box.left) return 'beside';
  const drop = last.box.baseline - line.box.baseline;
  return drop > 0 && drop <= CONTINUATION_EMS * Math.max(last.size, line.size)
    ? 'continues'
    : 'stops';
};

/** One bullet or plain line per `\n`: a line `fitOf` continues joins the open bullet, one beside it stands alone and leaves it open. */
const bodyOf = (lines: readonly TextLine[]): string => {
  const blocks: string[] = [];
  let bullet: { text: string; last: TextLine } | undefined;
  for (const line of lines) {
    const fit = bullet === undefined ? 'stops' : fitOf(bullet.last, line);
    if (markerOf(line.text) !== undefined) {
      if (bullet !== undefined) blocks.push(bullet.text);
      bullet = { text: line.text, last: line };
    } else if (bullet !== undefined && fit === 'continues') {
      bullet = { text: `${bullet.text} ${line.text}`, last: line };
    } else if (fit === 'beside') {
      blocks.push(line.text);
    } else {
      if (bullet !== undefined) blocks.push(bullet.text);
      bullet = undefined;
      blocks.push(line.text);
    }
  }
  if (bullet !== undefined) blocks.push(bullet.text);
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

export const pageLines = (page: PageText, slideNo: SlideNo): TextLine[] =>
  joinBulletMarkers(
    page.lines
      .map((line) => ({ ...line, text: collapse(line.text) }))
      .filter((line) => line.text !== '' && !isPageNumber(line, slideNo)),
  );

const NO_BOILERPLATE: ReadonlySet<string> = new Set();

/** A page's title, body and kind: the title the format marks, else the one its text layer implies (#9); a `boilerplate` line leaves the body, never the title (#641). */
export const slideText = (
  page: PageText,
  slideNo: SlideNo,
  boilerplate = NO_BOILERPLATE,
): SlideText => {
  const lines = pageLines(page, slideNo);
  const { title, bodyLines: titled } =
    page.markedTitle === undefined
      ? inferTitle(lines)
      : { title: collapse(page.markedTitle), bodyLines: lines };
  const bodyLines = titled.filter((line) => !boilerplate.has(line.text));
  const words = bodyLines.reduce((count, line) => count + wordCount(line.text), wordCount(title));
  if (words < THIN_TEXT_LAYER_WORDS) return { kind: 'image-only', title, body: '' };
  return {
    kind: REFERENCES_TITLE.test(title) ? 'references' : 'content',
    title,
    body: bodyOf(bodyLines),
  };
};
