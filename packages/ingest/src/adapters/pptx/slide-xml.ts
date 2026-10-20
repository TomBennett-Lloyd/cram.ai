import type { Document, Element, Node } from '@xmldom/xmldom';
import type { PageText, TextLine } from '../../page-text';
import { NS } from './ooxml';

const TITLE_PLACEHOLDERS: ReadonlySet<string> = new Set(['title', 'ctrTitle']);
const SKIPPED_PLACEHOLDERS: ReadonlySet<string> = new Set(['sldNum', 'ftr', 'dt']);

/** `a:rPr`'s `sz` is hundredths of a point (ECMA-376 `ST_TextFontSize`). */
const SZ_PER_POINT = 100;

interface Paragraph {
  /** The `p:ph` type of the shape holding it. */
  readonly placeholder: string | undefined;
  readonly element: Element;
}

const ancestorsOf = (node: Node): Node[] => {
  const ancestors: Node[] = [];
  for (let parent = node.parentNode; parent !== null; parent = parent.parentNode) {
    ancestors.push(parent);
  }
  return ancestors;
};

/** `mc:Fallback` repeats its `mc:Choice` for older readers, so reading both would read it twice. */
const isFallback = (node: Node): boolean =>
  node.namespaceURI === NS.mc && node.localName === 'Fallback';

const isTitle = (placeholder: string | undefined): boolean =>
  placeholder !== undefined && TITLE_PLACEHOLDERS.has(placeholder);

const placeholderOf = (shape: Element): string | undefined =>
  shape.getElementsByTagNameNS(NS.p, 'ph')[0]?.getAttribute('type') ?? undefined;

/** Each shape outside `mc:Fallback`, with its placeholder type. */
const shapesOf = (doc: Document): ReadonlyMap<Node, string | undefined> => {
  const placeholders = new Map<Node, string | undefined>();
  for (const shape of doc.getElementsByTagNameNS(NS.p, 'sp')) {
    if (!ancestorsOf(shape).some(isFallback)) placeholders.set(shape, placeholderOf(shape));
  }
  return placeholders;
};

/** Every paragraph of `placeholders`' shapes and of table cells, in document order. */
const paragraphsOf = (
  doc: Document,
  placeholders: ReadonlyMap<Node, string | undefined>,
): Paragraph[] => {
  const paragraphs: Paragraph[] = [];
  for (const element of doc.getElementsByTagNameNS(NS.a, 'p')) {
    const ancestors = ancestorsOf(element);
    if (ancestors.some(isFallback)) continue;
    const shape = ancestors.find((ancestor) => placeholders.has(ancestor));
    paragraphs.push({
      placeholder: shape === undefined ? undefined : placeholders.get(shape),
      element,
    });
  }
  return paragraphs;
};

const textOf = (paragraph: Element): string =>
  [...paragraph.getElementsByTagNameNS(NS.a, '*')]
    .map((element) => {
      if (element.localName === 't') return element.textContent ?? '';
      return element.localName === 'br' ? ' ' : '';
    })
    .join('');

/** The largest explicit run size; a size inherited from the layout or master reads as 0. */
const sizeOf = (paragraph: Element): number =>
  Math.max(
    0,
    ...[...paragraph.getElementsByTagNameNS(NS.a, 'rPr')]
      .map((properties) => Number(properties.getAttribute('sz')) / SZ_PER_POINT)
      .filter(Number.isFinite),
  );

/** A slide's text: a title placeholder marks the title, even an empty one; without one the core infers it. */
export const slideContent = (slide: Document): Omit<PageText, 'notes'> => {
  const shapes = shapesOf(slide);
  const title: string[] = [];
  const lines: TextLine[] = [];
  for (const { placeholder, element } of paragraphsOf(slide, shapes)) {
    if (placeholder !== undefined && SKIPPED_PLACEHOLDERS.has(placeholder)) continue;
    if (isTitle(placeholder)) {
      title.push(textOf(element));
    } else {
      lines.push({ text: textOf(element), size: sizeOf(element) });
    }
  }
  return [...shapes.values()].some(isTitle) ? { markedTitle: title.join(' '), lines } : { lines };
};

/** The notes slide's body placeholder, one paragraph per line; its slide image and number are not notes. */
export const notesText = (notes: Document): string =>
  paragraphsOf(notes, shapesOf(notes))
    .filter(({ placeholder }) => placeholder === 'body')
    .map(({ element }) => textOf(element))
    .join('\n');
