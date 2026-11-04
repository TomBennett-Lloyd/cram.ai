import { z } from 'zod';
import type { LineBox, TextLine } from '../../page-text';
import { modalSize } from '../../slide-text';
import { logicalOrder } from './logical-order';
import type { PdfDocument } from './render-page';

export const PdfTextItem = z.object({
  str: z.string(),
  transform: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]),
  width: z.number(),
  hasEOL: z.boolean(),
});
export type PdfTextItem = z.infer<typeof PdfTextItem>;

const ViewBox = z.tuple([z.number(), z.number(), z.number(), z.number()]);

export interface PdfPageText {
  readonly items: readonly PdfTextItem[];
  readonly bottom: number;
  readonly height: number;
}

export const pageTextOf = async (pdf: PdfDocument, pageNo: number): Promise<PdfPageText> => {
  const page = await pdf.getPage(pageNo);
  const { items } = await page.getTextContent({ disableNormalization: true });
  const [, bottom, , top] = ViewBox.parse(page.view);
  return { items: z.array(PdfTextItem).parse(items), bottom, height: top - bottom };
};

export interface LaidOutPage<P extends PdfPageText> {
  readonly page: P;
  readonly lines: readonly TextLine[];
  readonly footer: readonly TextLine[];
}

/** The share of a page's height, from its bottom edge, a footer sits in (page-layout.test.ts). */
export const FOOTER_BAND = 0.1;

/** A gap wider than this many ems of the smaller glyph, either side of a line on its baseline, separates two columns (page-layout.test.ts). */
export const COLUMN_GAP_EMS = 3;

const DIGITS_ONLY = /^\d+$/;

interface Placed extends LineBox {
  readonly size: number;
}

/** Hundredths of a point: pdf.js composes matrices in floating point, so equal sizes can differ in the last bits. */
const glyphSize = (transform: PdfTextItem['transform']): number =>
  Math.round(Math.hypot(transform[2], transform[3]) * 100) / 100;

/** Only an upright item has a left, a right and a baseline these rules can read; a rotated one keeps `hasEOL`'s lines (#567). */
const placedOf = ({ transform, width }: PdfTextItem): Placed | undefined =>
  transform[0] > 0 && transform[1] === 0 && transform[2] === 0
    ? {
        left: transform[4],
        right: transform[4] + width,
        baseline: transform[5],
        size: glyphSize(transform),
      }
    : undefined;

const inFooterBand = (baseline: number, page: PdfPageText): boolean =>
  baseline - page.bottom < FOOTER_BAND * page.height;

const isPageNumber = (
  item: PdfTextItem,
  placed: Placed,
  pageNo: number,
  page: PdfPageText,
): boolean => {
  const text = item.str.trim();
  return DIGITS_ONLY.test(text) && Number(text) === pageNo && inFooterBand(placed.baseline, page);
};

/** pdf.js joins what its content stream orders next, a form XObject's text included (#567); a sub- or superscript moves the baseline by less than its glyph. */
const breaksLine = (line: LineBox, last: Placed, next: Placed): boolean => {
  const em = Math.min(last.size, next.size);
  return (
    Math.abs(next.baseline - last.baseline) > em ||
    Math.max(next.left - line.right, line.left - next.right) > COLUMN_GAP_EMS * em
  );
};

export const linesOf = (page: PdfPageText, pageNo: number): TextLine[] => {
  const lines: TextLine[] = [];
  let text = '';
  let size = 0;
  let box: LineBox | undefined;
  let last: Placed | undefined;
  const end = (): void => {
    lines.push(box === undefined ? { text, size } : { text, size, box });
    text = '';
    size = 0;
    box = undefined;
  };
  for (const item of page.items) {
    const blank = item.str.trim() === '';
    const placed = blank ? undefined : placedOf(item);
    if (placed !== undefined && isPageNumber(item, placed, pageNo, page)) {
      if (item.hasEOL) end();
      continue;
    }
    if (
      placed !== undefined &&
      box !== undefined &&
      last !== undefined &&
      breaksLine(box, last, placed)
    )
      end();
    text += logicalOrder(item.str);
    if (!blank) size = Math.max(size, glyphSize(item.transform));
    if (placed !== undefined) {
      box =
        box === undefined
          ? { left: placed.left, right: placed.right, baseline: placed.baseline }
          : {
              ...box,
              left: Math.min(box.left, placed.left),
              right: Math.max(box.right, placed.right),
            };
      last = placed;
    }
    if (item.hasEOL) end();
  }
  end();
  return lines;
};

const positionKey = (line: TextLine, box: LineBox): string =>
  [line.text.replace(/\s+/g, ' ').trim(), Math.round(box.left), Math.round(box.baseline)].join(
    '\u0000',
  );

const inLowerHalf = (box: LineBox, page: PdfPageText): boolean =>
  box.baseline - page.bottom < page.height / 2;

type FooterTest = (line: TextLine, page: PdfPageText) => boolean;

const repeatedFooter = (
  pages: readonly (readonly [PdfPageText, readonly TextLine[]])[],
): FooterTest => {
  const pagesWith = new Map<string, number>();
  for (const [, lines] of pages) {
    const keys = new Set(
      lines.flatMap(({ box, ...line }) => (box === undefined ? [] : [positionKey(line, box)])),
    );
    for (const key of keys) pagesWith.set(key, (pagesWith.get(key) ?? 0) + 1);
  }
  const recurs = (line: TextLine): line is TextLine & { box: LineBox } =>
    line.box !== undefined && (pagesWith.get(positionKey(line, line.box)) ?? 0) > pages.length / 2;
  const all = pages.flatMap(([, lines]) => lines.filter((line) => line.text.trim() !== ''));
  const rest = all.filter((line) => !recurs(line));
  const bodySize = modalSize(rest.length > 0 ? rest : all);
  return (line, page) => recurs(line) && line.size < bodySize && inLowerHalf(line.box, page);
};

const bandFooter: FooterTest = (line, page) =>
  line.box !== undefined && inFooterBand(line.box.baseline, page);

/** Every page's lines, less its footer: lines repeated low on most pages and smaller than the rest of the deck's text (all of it, when every line recurs), so a build's repeated step stays, or a one-page deck's bottom band (#567). */
export const layOutPages = <P extends PdfPageText>(pages: readonly P[]): LaidOutPage<P>[] => {
  const lined = pages.map((page, index) => [page, linesOf(page, index + 1)] as const);
  const isFooter = pages.length === 1 ? bandFooter : repeatedFooter(lined);
  return lined.map(([page, lines]) => ({
    page,
    lines: lines.filter((line) => !isFooter(line, page)),
    footer: lines.filter((line) => isFooter(line, page)),
  }));
};
