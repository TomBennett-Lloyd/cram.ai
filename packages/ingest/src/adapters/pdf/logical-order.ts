/** A code unit's direction as pdf.js's `bidi` resolves it: strong left, strong right, or taken from its neighbours. */
type Direction = 'L' | 'R' | 'N';

interface CodeUnit {
  readonly text: string;
  readonly pdfjs: Direction;
  readonly logical: Direction;
}

/** Units `bidi` may type outside L, R and the neutrals: EN, AN and NSM resolve from one neighbour, controls take the paragraph's level. */
const UNMODELLED = /[\p{Cc}\u00ad0-9\u00b2\u00b3\u00b9\u0600-\u06ff]/u;
const LETTER = /\p{L}/u;
const PDFJS_RIGHT = /[\u0590-\u05f4\u0700-\u08ac\ufb50-\ufdff\ufe70-\ufeff]/;
const HEBREW_PRESENTATION = /[\ufb1d-\ufb4f]/;

/** `bidi`'s type for `unit` (unpdf 1.9.0): its own table below U+0100, R or AL for its Hebrew and Arabic ranges, L above. */
const pdfjsDirection = (unit: string): Direction => {
  if (PDFJS_RIGHT.test(unit)) return 'R';
  return unit.charCodeAt(0) > 0xff || LETTER.test(unit) ? 'L' : 'N';
};

const codeUnitsOf = (text: string): CodeUnit[] | undefined => {
  const units = text.split('');
  if (units.some((unit) => UNMODELLED.test(unit))) return undefined;
  return units.map((unit) => {
    const pdfjs = pdfjsDirection(unit);
    return { text: unit, pdfjs, logical: HEBREW_PRESENTATION.test(unit) ? 'R' : pdfjs };
  });
};

/** A neutral takes the direction of the strong units either side when they agree, the paragraph's otherwise. */
const resolved = (directions: readonly Direction[], paragraph: Direction): Direction[] =>
  directions.map((direction, index) => {
    if (direction !== 'N') return direction;
    const before = directions.slice(0, index).findLast((other) => other !== 'N') ?? paragraph;
    const after = directions.slice(index + 1).find((other) => other !== 'N') ?? paragraph;
    return before === after ? before : paragraph;
  });

const reversedRuns = <T>(items: readonly T[], levels: readonly number[], floor: number): T[] => {
  const out: T[] = [];
  let run: T[] = [];
  for (const [index, item] of items.entries()) {
    if ((levels[index] ?? 0) >= floor) {
      run.unshift(item);
      continue;
    }
    out.push(...run, item);
    run = [];
  }
  return [...out, ...run];
};

/** `bidi`'s reorder of one text item, with `directionOf` typing each unit. */
const reorder = (units: readonly CodeUnit[], directionOf: (unit: CodeUnit) => Direction) => {
  const directions = units.map(directionOf);
  const right = directions.filter((direction) => direction === 'R').length;
  if (right === 0) return units;
  const paragraph = right / units.length < 0.3 && units.length > 4 ? 'L' : 'R';
  const levels = resolved(directions, paragraph).map((direction) => {
    if (direction === 'R') return 1;
    return paragraph === 'L' ? 0 : 2;
  });
  return reversedRuns(reversedRuns(units, levels, 2), levels, 1);
};

/**
 * A pdf.js text item in logical order: `bidi` orders Hebrew presentation forms left to right (#283). On the units
 * `codeUnitsOf` admits its reorder is its own inverse, so applying it again gives the drawn order, which is then
 * ordered with those forms right to left; an item holding any other unit keeps pdf.js's order (logical-order.test.ts).
 */
export const logicalOrder = (text: string): string => {
  const units = codeUnitsOf(text);
  if (units === undefined) return text;
  const drawn = reorder(units, (unit) => unit.pdfjs);
  return reorder(drawn, (unit) => unit.logical)
    .map((unit) => unit.text)
    .join('');
};
