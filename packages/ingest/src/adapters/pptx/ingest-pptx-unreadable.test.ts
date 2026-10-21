import { strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  buildDeck,
  deckFile,
  FIXTURE_FILE_NAME,
  SLIDE_RELATIONSHIP,
  titledSlide as titled,
} from './deck-fixture';
import { ingestPptx } from './ingest-pptx';
import { NS } from './ooxml';

const SLIDE_1 = 'ppt/slides/slide1.xml';

const ingest = (bytes: Uint8Array) => ingestPptx(deckFile(bytes));

describe('ingestPptx unreadable decks', () => {
  const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const ole = (stream: string): Uint8Array =>
    new Uint8Array([...OLE, ...new Uint8Array(504), ...Buffer.from(stream, 'utf16le')]);

  const reasonOf = (bytes: Uint8Array) => {
    const result = ingest(bytes);
    if (result.status !== 'unreadable') throw new Error('expected an unreadable deck');
    expect(result.fileName).toBe(FIXTURE_FILE_NAME);
    expect(result.detail.trim()).not.toBe('');
    return result.reason;
  };

  it('reports bytes that are not a zip as not a pptx', () => {
    expect(reasonOf(new TextEncoder().encode('not a pptx'))).toBe('not-a-pptx');
  });

  it('reports a password-protected package as encrypted', () => {
    expect(reasonOf(ole('EncryptedPackage'))).toBe('encrypted');
  });

  it('reads the encrypted-package name outside an OLE file as not a pptx', () => {
    expect(reasonOf(Buffer.from('EncryptedPackage', 'utf16le'))).toBe('not-a-pptx');
  });

  it('reports an OLE file with no encrypted package as not a pptx', () => {
    expect(reasonOf(ole('PowerPoint Document'))).toBe('not-a-pptx');
  });

  it.each([
    ['no package relationships part', null],
    [
      'package relationships with no officeDocument relationship',
      `<Relationships xmlns="${NS.rel}"><Relationship Id="rId1" Type="${SLIDE_RELATIONSHIP}" Target="ppt/presentation.xml"/></Relationships>`,
    ],
  ])('reports a zip with %s as not a pptx', (_, rels) => {
    const deck = { slides: [titled('Rate laws')], parts: { '_rels/.rels': rels } };
    expect(reasonOf(buildDeck(deck))).toBe('not-a-pptx');
  });

  it('reports a main part the package relationships name but the zip lacks as damaged', () => {
    const deck = { slides: [titled('Rate laws')], parts: { 'ppt/presentation.xml': null } };
    expect(ingest(buildDeck(deck))).toMatchObject({
      reason: 'damaged',
      detail: 'ppt/presentation.xml is missing',
    });
  });

  it('reports a Strict presentation as a limit of this reader, not of the deck', () => {
    const deck = {
      slides: [titled('Rate laws')],
      presentationNamespace: 'http://purl.oclc.org/ooxml/presentationml/main',
      officeDocumentRelationship:
        'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument',
    };
    expect(reasonOf(buildDeck(deck))).toBe('reader-limit');
  });

  it('reports a presentation part outside PresentationML as not a pptx', () => {
    const deck = { slides: [titled('Rate laws')], presentationNamespace: NS.a };
    expect(reasonOf(buildDeck(deck))).toBe('not-a-pptx');
  });

  it('reports a truncated zip as damaged', () => {
    const bytes = buildDeck({ slides: [titled('Rate laws')] });
    expect(reasonOf(bytes.slice(0, bytes.length / 2))).toBe('damaged');
  });

  it('reports a missing slide part as damaged, naming it', () => {
    const result = ingest(buildDeck({ slides: [titled('Rate laws')], parts: { [SLIDE_1]: null } }));
    expect(result).toMatchObject({ reason: 'damaged', detail: `${SLIDE_1} is missing` });
  });

  it('reports a slide id with no relationship as damaged', () => {
    expect(reasonOf(buildDeck({ slides: [titled('Rate laws')], danglingSlideId: true }))).toBe(
      'damaged',
    );
  });

  it.each([
    ['an unclosed element', `<p:sld xmlns:p="${NS.p}"><unclosed>`],
    ['a bare < in text', `<p:sld xmlns:p="${NS.p}"><p:cSld>1 < 2</p:cSld></p:sld>`],
  ])('reports a part that is not well-formed XML (%s) as damaged', (_, slide) => {
    const deck = { slides: [titled('Rate laws')], parts: { [SLIDE_1]: slide } };
    expect(reasonOf(buildDeck(deck))).toBe('damaged');
  });

  it('reports a part that is not UTF-8 as damaged', () => {
    const bytes = new Uint8Array([
      ...strToU8(`<p:sld xmlns:p="${NS.p}"><p:cSld>Rate `),
      0xff,
      ...strToU8(' laws</p:cSld></p:sld>'),
    ]);
    expect(
      reasonOf(buildDeck({ slides: [titled('Rate laws')], parts: { [SLIDE_1]: bytes } })),
    ).toBe('damaged');
  });

  it.each([
    ['UTF-16LE', [0xff, 0xfe, 0x00, 0xd8]],
    ['UTF-16BE', [0xfe, 0xff, 0xd8, 0x00]],
  ])('reports a %s part holding a lone surrogate as damaged', (encoding, bytes) => {
    const deck = { slides: [titled('Rate laws')], parts: { [SLIDE_1]: new Uint8Array(bytes) } };
    expect(ingest(buildDeck(deck))).toMatchObject({
      reason: 'damaged',
      detail: `${SLIDE_1} is not ${encoding}`,
    });
  });

  it.each([
    ['FF', 0xff],
    ['FE', 0xfe],
  ])('reads a part opening with half a byte-order mark (%s) as UTF-8', (_, byte) => {
    const slide = new Uint8Array([byte, ...strToU8(`<p:sld xmlns:p="${NS.p}"/>`)]);
    const deck = { slides: [titled('Rate laws')], parts: { [SLIDE_1]: slide } };
    expect(ingest(buildDeck(deck))).toMatchObject({
      reason: 'damaged',
      detail: `${SLIDE_1} is not UTF-8`,
    });
  });

  it('reports a relationship with no target as damaged, even one no slide needs', () => {
    const rels = `<Relationships xmlns="${NS.rel}"><Relationship Id="rId1" Type="${SLIDE_RELATIONSHIP}" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="${SLIDE_RELATIONSHIP}"/></Relationships>`;
    const deck = {
      slides: [titled('Rate laws')],
      parts: { 'ppt/_rels/presentation.xml.rels': rels },
    };
    expect(reasonOf(buildDeck(deck))).toBe('damaged');
  });
});
