import { SlideRecord } from '@cram/shared';
import { z } from 'zod';
import { parseJsonText } from './json-text';

/**
 * One slide as the eval deck's source holds it. An `imageOnly` slide's text exists
 * only as an image in any rendering of the deck, and the source keeps its true text
 * (`docs/adr/0005-evaluation-as-gate.md` § Decision (a)).
 */
export const DeckSlide = z.strictObject({
  slideNo: SlideRecord.shape.slideNo,
  title: SlideRecord.shape.title,
  body: z.array(z.string()),
  speakerNotes: SlideRecord.shape.speakerNotes.default(''),
  imageOnly: z.boolean().default(false),
});
export type DeckSlide = z.infer<typeof DeckSlide>;

export const DeckLecture = z.strictObject({
  lectureId: SlideRecord.shape.lectureId,
  lectureTitle: SlideRecord.shape.lectureTitle,
  slides: z.array(DeckSlide).min(1),
});
export type DeckLecture = z.infer<typeof DeckLecture>;

export type Deck = readonly DeckLecture[];

export interface DeckFile {
  readonly name: string;
  readonly text: string;
}

export type DeckParse =
  | { readonly status: 'parsed'; readonly deck: Deck }
  | { readonly status: 'invalid'; readonly file: string; readonly message: string };

/** Everything a slide says, in reading order, as one string. */
export const slideText = (slide: DeckSlide): string =>
  [slide.title, ...slide.body, slide.speakerNotes].join('\n');

const byName = (a: DeckFile, b: DeckFile): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/** Lectures in file-name order, which is the deck's lecture order. */
export const parseDeck = (files: readonly DeckFile[]): DeckParse => {
  const deck: DeckLecture[] = [];
  for (const file of [...files].sort(byName)) {
    const parsed = parseJsonText(file.text, DeckLecture);
    if (!parsed.ok) return { status: 'invalid', file: file.name, message: parsed.message };
    deck.push(parsed.value);
  }
  return { status: 'parsed', deck };
};
