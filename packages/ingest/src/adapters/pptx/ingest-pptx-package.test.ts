import { describe, expect, it } from 'vitest';
import {
  buildDeck,
  deckFile,
  ingestedSlides as ingested,
  OFFICE_DOCUMENT_RELATIONSHIP,
  titledSlide as titled,
} from './deck-fixture';
import { ingestPptx } from './ingest-pptx';
import { NS } from './ooxml';

const CORE_PROPERTIES_RELATIONSHIP =
  'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties';

describe('ingestPptx packages', () => {
  it.each([
    ['a part outside ppt/', { presentationPart: 'deck/main.xml' }],
    [
      'an absolute part name',
      {
        parts: {
          '_rels/.rels': `<Relationships xmlns="${NS.rel}"><Relationship Id="rId9" Type="${CORE_PROPERTIES_RELATIONSHIP}" Target="docProps/core.xml"/><Relationship Id="rId1" Type="${OFFICE_DOCUMENT_RELATIONSHIP}" Target="/ppt/presentation.xml"/></Relationships>`,
        },
      },
    ],
  ])('reads the main part the package relationships name, as %s', (_, deck) => {
    const read = ingested({ slides: [titled('First'), titled('Second')], ...deck });
    expect(read.map(({ title }) => title)).toEqual(['First', 'Second']);
  });

  it('reads a deck handed over as a Buffer like its plain bytes', () => {
    const bytes = buildDeck({ slides: [titled('Kinetics')] });
    expect(ingestPptx(deckFile(Buffer.from(bytes)))).toEqual(ingestPptx(deckFile(bytes)));
  });
});
