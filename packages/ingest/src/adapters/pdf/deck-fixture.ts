import {
  concatTransformationMatrix,
  PDFArray,
  PDFNumber,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  StandardFonts,
} from 'pdf-lib';

export interface FixtureLine {
  readonly text: string;
  readonly size: number;
  /** Draw through a scaled graphics state, so pdf.js recovers `size` in floating point. */
  readonly scaled?: true;
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

/** A synthetic PDF deck authored in memory for the adapter tests (docs/standards/testing.md rule 3). */
export const buildDeck = async (deck: FixtureDeck): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  if (deck.metadataTitle !== undefined) doc.setTitle(deck.metadataTitle);
  for (const fixture of deck.pages) {
    const page = doc.addPage(PAGE);
    let y = PAGE[1];
    for (const line of fixture.lines) {
      y -= line.size * 1.2;
      if (line.scaled) {
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
