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
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  setFontAndSize,
  showText,
  StandardFonts,
  type PDFRef,
} from 'pdf-lib';

export interface FixtureLine {
  readonly text: string;
  readonly size: number;
  /** Draw through a scaled graphics state, so pdf.js recovers `size` in floating point. */
  readonly scaled?: true;
  /**
   * Draw ASCII `text` through a font whose `/ToUnicode` maps its letters to math italic: assumed to be how a
   * PowerPoint equation exported to PDF carries them (#194). Check it on a self-authored export of `E=mc^2`:
   * `pdftotext <deck>.pdf - | grep -o '[𝐸𝑚𝑐]'`.
   */
  readonly mathItalic?: true;
}

export interface FixtureAnnotation {
  /** Omitted: an annotation with no `/Subtype`, which pdf.js reports as `null`. */
  readonly subtype?: 'Text' | 'Link';
  readonly contents: string;
}

export interface FixturePage {
  readonly lines: readonly FixtureLine[];
  readonly annotations?: readonly FixtureAnnotation[];
}

export interface FixtureDeck {
  readonly pages: readonly FixturePage[];
  readonly metadataTitle?: string;
  readonly encrypted?: true;
  /** Replace the second page's entry in the page tree with a number, which pdf.js rejects on `getPage`. */
  readonly brokenPageTree?: true;
}

const PAGE: [number, number] = [960, 540];
const SCALE = 0.3;
const MATH_FONT = 'MathItalic';

/** U+1D434 is math italic `A`, U+1D44E `a`; italic `h` is the Letterlike U+210E. */
const mathItalicOf = (code: number): number => {
  if (code === 0x68) return 0x210e;
  return code < 0x61 ? 0x1d434 + code - 0x41 : 0x1d44e + code - 0x61;
};

/** Each UTF-16 code unit of `text` as `width` hex digits. */
const hex = (text: string, width: number): string =>
  Array.from({ length: text.length }, (_, index) =>
    text.charCodeAt(index).toString(16).padStart(width, '0'),
  ).join('');

const LETTERS = [0x41, 0x61].flatMap((first) => Array.from({ length: 26 }, (_, i) => first + i));

/** Helvetica, its letters' `/ToUnicode` entries math italic (PDF 32000-1 § 9.10.3). */
const mathItalicFont = (doc: PDFDocument): PDFRef => {
  const entries = LETTERS.map(
    (code) => `<${code.toString(16)}> <${hex(String.fromCodePoint(mathItalicOf(code)), 4)}>`,
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

/** A synthetic PDF deck authored in memory for the adapter tests (docs/standards/testing.md rule 3). */
export const buildDeck = async (deck: FixtureDeck): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const mathFont = mathItalicFont(doc);
  if (deck.metadataTitle !== undefined) doc.setTitle(deck.metadataTitle);
  for (const fixture of deck.pages) {
    const page = doc.addPage(PAGE);
    page.node.setFontDictionary(PDFName.of(MATH_FONT), mathFont);
    let y = PAGE[1];
    for (const line of fixture.lines) {
      y -= line.size * 1.2;
      if (line.mathItalic) {
        page.pushOperators(
          beginText(),
          setFontAndSize(MATH_FONT, line.size),
          moveText(40, y),
          showText(PDFHexString.of(hex(line.text, 2))),
          endText(),
        );
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
            Contents: PDFString.of(contents),
          }),
        ),
      );
      page.node.set(PDFName.of('Annots'), doc.context.obj(refs));
    }
  }
  if (deck.brokenPageTree) {
    doc.catalog.Pages().lookup(PDFName.of('Kids'), PDFArray).set(1, PDFNumber.of(7));
  }
  if (deck.encrypted) {
    const filler = (byte: string): PDFHexString => PDFHexString.of(byte.repeat(32));
    doc.context.trailerInfo.Encrypt = doc.context.register(
      doc.context.obj({ Filter: 'Standard', V: 1, R: 2, O: filler('11'), U: filler('22'), P: -4 }),
    );
    doc.context.trailerInfo.ID = doc.context.obj([filler('33'), filler('33')]);
  }
  return doc.save({ useObjectStreams: false });
};
