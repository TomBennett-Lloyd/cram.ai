import { posix } from 'node:path';
import { DOMParser, onErrorStopParsing, ParseError, type Document } from '@xmldom/xmldom';
import { z } from 'zod';

export const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  m: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
  a14: 'http://schemas.microsoft.com/office/drawing/2010/main',
} as const;

export const NOTES_SLIDE_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide';

/** Each way a deck can fail to read, and the reason it reports: `reader-limit` blames this reader, not the deck (docs/standards/error-handling.md rule 1). */
const UNREADABLE = {
  'not-zip': 'not-a-pptx',
  'not-ooxml': 'not-a-pptx',
  'encrypted-package': 'encrypted',
  'no-presentation': 'not-a-pptx',
  'not-presentationml': 'not-a-pptx',
  'strict-presentationml': 'reader-limit',
  'corrupt-zip': 'damaged',
  'missing-part': 'damaged',
  'undecodable-part': 'damaged',
  'not-well-formed': 'damaged',
  'incomplete-relationship': 'damaged',
  'unresolved-slide': 'damaged',
} as const;

type PptxFailure = keyof typeof UNREADABLE;

/** Derived from `UNREADABLE`, so every reason has a failure that produces it (#185). */
export type PptxUnreadableReason = (typeof UNREADABLE)[PptxFailure];

/** A deck its own bytes cannot yield; `ingestPptx` returns it as a value (docs/standards/error-handling.md rule 1). */
export class UnreadablePptx extends Error {
  readonly reason: PptxUnreadableReason;

  constructor(failure: PptxFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.reason = UNREADABLE[failure];
  }
}

export type Parts = Readonly<Record<string, Uint8Array>>;

export interface Relationship {
  readonly type: string;
  /** The part name the target resolves to. */
  readonly target: string;
}

const RelationshipAttributes = z.object({
  Id: z.string(),
  Type: z.string(),
  Target: z.string(),
});

export const startsWith = (bytes: Uint8Array, magic: readonly number[]): boolean =>
  magic.every((byte, index) => bytes[index] === byte);

const BYTE_ORDER_MARKS = [
  { mark: [0xff, 0xfe], encoding: 'UTF-16LE' },
  { mark: [0xfe, 0xff], encoding: 'UTF-16BE' },
] as const;

/** OPC parts are UTF-8 or UTF-16, and a UTF-16 part opens with its byte-order mark (XML 1.0 §4.3.3, #185). */
const decodePart = (bytes: Uint8Array, partName: string): string => {
  const encoding =
    BYTE_ORDER_MARKS.find(({ mark }) => startsWith(bytes, mark))?.encoding ?? 'UTF-8';
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch (error) {
    throw new UnreadablePptx('undecodable-part', `${partName} is not ${encoding}`, {
      cause: error,
    });
  }
};

export const readXml = (parts: Parts, partName: string): Document => {
  const bytes = parts[partName];
  if (bytes === undefined) throw new UnreadablePptx('missing-part', `${partName} is missing`);
  const text = decodePart(bytes, partName);
  try {
    return new DOMParser({ onError: onErrorStopParsing }).parseFromString(text, 'text/xml');
  } catch (error) {
    if (!(error instanceof ParseError)) throw error;
    throw new UnreadablePptx(
      'not-well-formed',
      `${partName} is not well-formed XML: ${error.message}`,
      {
        cause: error,
      },
    );
  }
};

const resolveTarget = (partName: string, target: string): string =>
  target.startsWith('/') ? target.slice(1) : posix.join(posix.dirname(partName), target);

/** A part's relationships by id; a part with no relationships part has none. */
export const relationshipsOf = (
  parts: Parts,
  partName: string,
): ReadonlyMap<string, Relationship> => {
  const relsName = posix.join(posix.dirname(partName), '_rels', `${posix.basename(partName)}.rels`);
  const relationships = new Map<string, Relationship>();
  if (parts[relsName] === undefined) return relationships;
  for (const element of readXml(parts, relsName).getElementsByTagNameNS(NS.rel, 'Relationship')) {
    const attributes = RelationshipAttributes.safeParse({
      Id: element.getAttribute('Id'),
      Type: element.getAttribute('Type'),
      Target: element.getAttribute('Target'),
    });
    if (!attributes.success)
      throw new UnreadablePptx(
        'incomplete-relationship',
        `${relsName} has a relationship without Id, Type or Target`,
      );
    const { Id, Type, Target } = attributes.data;
    relationships.set(Id, { type: Type, target: resolveTarget(partName, Target) });
  }
  return relationships;
};
