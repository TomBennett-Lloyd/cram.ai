import {
  beginText,
  concatTransformationMatrix,
  endText,
  moveText,
  PDFArray,
  PDFNumber,
  PDFDocument,
  PDFHexString,
  PDFName,
  popGraphicsState,
  pushGraphicsState,
  setFontAndSize,
  showText,
  StandardFonts,
  type PDFPage,
  type PDFRef,
} from 'pdf-lib';

export interface FixtureLine {
  readonly text: string;
  readonly size: number;
  readonly scaled?: true;
  /**
   * Draw ASCII `text` through a font whose `/ToUnicode` maps its letters to math italic: assumed to be how a
   * PowerPoint equation exported to PDF carries them (#194). Check it on a self-authored export of `E=mc^2`:
   * `pdftotext <deck>.pdf - | grep -o '[𝐸𝑚𝑐]'`.
   */
  readonly mathItalic?: true;
  /**
   * Draw `text` through a font whose `/ToUnicode` carries each of its characters, so any one reads back, the way a
   * PDF carries a ligature glyph. Assumed to be how a typeset deck's PDF stores `ﬁ` (#256): check it on a
   * self-authored pdfLaTeX export of `first`, `pdftotext <deck>.pdf - | grep -o 'ﬁ'`.
   */
  readonly toUnicode?: true;
}

export interface FixtureAnnotation {
  /** Omitted: an annotation with no `/Subtype`, which pdf.js reports as `null`. */
  readonly subtype?: 'Text' | 'Link';
  readonly contents: string;
}

export interface FixturePage {
  readonly lines: readonly FixtureLine[];
  readonly size?: readonly [number, number];
  readonly annotations?: readonly FixtureAnnotation[];
}

export interface FixtureDeck {
  readonly pages: readonly FixturePage[];
  readonly metadataTitle?: string;
  readonly encrypted?: 'password' | 'algorithm-3' | 'custom-handler';
  readonly brokenPageTree?: 'kid-not-a-reference' | 'kids-not-an-array' | 'circular';
}

const PAGE: [number, number] = [960, 540];
const SCALE = 0.3;
const MATH_FONT = 'MathItalic';
const TO_UNICODE_FONT = 'ToUnicode';

const mathItalicOf = (code: number): number => {
  if (code === 0x68) return 0x210e;
  return code < 0x61 ? 0x1d434 + code - 0x41 : 0x1d44e + code - 0x61;
};

const hex = (text: string, width: number): string =>
  Array.from({ length: text.length }, (_, index) =>
    text.charCodeAt(index).toString(16).padStart(width, '0'),
  ).join('');

const LETTERS = [0x41, 0x61].flatMap((first) => Array.from({ length: 26 }, (_, i) => first + i));

/** Helvetica, each code's `/ToUnicode` entry its text (PDF 32000-1 § 9.10.3). */
const toUnicodeFont = (doc: PDFDocument, texts: ReadonlyMap<number, string>): PDFRef => {
  const entries = [...texts].map(
    ([code, text]) => `<${hex(String.fromCharCode(code), 2)}> <${hex(text, 4)}>`,
  );
  const cmap = [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def /CMapType 2 def',
    '1 begincodespacerange <00> <FF> endcodespacerange',
    `${String(entries.length)} beginbfchar`,
    ...entries,
    'endbfchar endcmap CMapName currentdict /CMap defineresource pop end end',
  ].join('\n');
  return doc.context.register(
    doc.context.obj({
      Type: 'Font',
      Subtype: 'Type1',
      BaseFont: 'Helvetica',
      Encoding: 'WinAnsiEncoding',
      ToUnicode: doc.context.register(doc.context.stream(cmap)),
    }),
  );
};

/** `text` as single-byte hex codes, and each code's character: a space is itself, so pdf.js reads it as one, and the rest count up from `A`. */
const encode = (
  text: string,
): { readonly codes: string; readonly texts: ReadonlyMap<number, string> } => {
  const characters = Array.from(new Set(Array.from(text)));
  const glyphs = characters.filter((character) => character !== ' ');
  const codeOf = (character: string): number =>
    character === ' ' ? 0x20 : 0x41 + glyphs.indexOf(character);
  return {
    codes: Array.from(text, (character) => hex(String.fromCharCode(codeOf(character)), 2)).join(''),
    texts: new Map(characters.map((character) => [codeOf(character), character])),
  };
};

const showCodes = (page: PDFPage, name: string, codes: string, size: number, y: number): void => {
  page.pushOperators(
    beginText(),
    setFontAndSize(name, size),
    moveText(40, y),
    showText(PDFHexString.of(codes)),
    endText(),
  );
};

const breakPageTree = (doc: PDFDocument, how: NonNullable<FixtureDeck['brokenPageTree']>): void => {
  const pages = doc.catalog.Pages();
  const kids = pages.lookup(PDFName.of('Kids'), PDFArray);
  if (how === 'kid-not-a-reference') kids.set(1, PDFNumber.of(7));
  if (how === 'kids-not-an-array') pages.set(PDFName.of('Kids'), PDFNumber.of(7));
  if (how === 'circular') {
    const root = doc.catalog.get(PDFName.of('Pages'));
    if (root === undefined) throw new Error('buildDeck: the catalog has no page tree');
    kids.set(1, root);
  }
};

const ENCRYPTION = {
  password: { Filter: 'Standard', V: 1, R: 2 },
  'algorithm-3': { Filter: 'Standard', V: 3, R: 3 },
  'custom-handler': { Filter: 'Custom', V: 1, R: 2 },
} as const;

const encrypt = (doc: PDFDocument, how: NonNullable<FixtureDeck['encrypted']>): void => {
  const filler = (byte: string): PDFHexString => PDFHexString.of(byte.repeat(32));
  doc.context.trailerInfo.Encrypt = doc.context.register(
    doc.context.obj({ ...ENCRYPTION[how], O: filler('11'), U: filler('22'), P: -4 }),
  );
  doc.context.trailerInfo.ID = doc.context.obj([filler('33'), filler('33')]);
};

/** A synthetic PDF deck authored in memory for the adapter tests (docs/standards/testing.md rule 3). */
export const buildDeck = async (deck: FixtureDeck): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const mathFont = toUnicodeFont(
    doc,
    new Map(LETTERS.map((code) => [code, String.fromCodePoint(mathItalicOf(code))])),
  );
  if (deck.metadataTitle !== undefined) doc.setTitle(deck.metadataTitle);
  for (const fixture of deck.pages) {
    const size = fixture.size ?? PAGE;
    const page = doc.addPage([size[0], size[1]]);
    page.node.setFontDictionary(PDFName.of(MATH_FONT), mathFont);
    let y = size[1];
    for (const [index, line] of fixture.lines.entries()) {
      y -= line.size * 1.2;
      if (line.mathItalic) {
        showCodes(page, MATH_FONT, hex(line.text, 2), line.size, y);
      } else if (line.toUnicode) {
        const { codes, texts } = encode(line.text);
        const name = `${TO_UNICODE_FONT}${String(index)}`;
        page.node.setFontDictionary(PDFName.of(name), toUnicodeFont(doc, texts));
        showCodes(page, name, codes, line.size, y);
      } else if (line.scaled) {
        page.pushOperators(
          pushGraphicsState(),
          concatTransformationMatrix(SCALE, 0, 0, SCALE, 0, 0),
        );
        page.drawText(line.text, { x: 40 / SCALE, y: y / SCALE, size: line.size / SCALE, font });
        page.pushOperators(popGraphicsState());
      } else {
        page.drawText(line.text, { x: 40, y, size: line.size, font });
      }
    }
    if (fixture.annotations !== undefined) {
      const refs = fixture.annotations.map(({ subtype, contents }) =>
        doc.context.register(
          doc.context.obj({
            Type: 'Annot',
            Subtype: subtype,
            Rect: [0, 0, 10, 10],
            Contents: PDFHexString.fromText(contents),
          }),
        ),
      );
      page.node.set(PDFName.of('Annots'), doc.context.obj(refs));
    }
  }
  if (deck.brokenPageTree !== undefined) breakPageTree(doc, deck.brokenPageTree);
  if (deck.encrypted !== undefined) encrypt(doc, deck.encrypted);
  return doc.save({ useObjectStreams: false });
};
