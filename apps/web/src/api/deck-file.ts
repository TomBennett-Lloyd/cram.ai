import { DeckMediaType, LectureId } from '@cram/shared';

const MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, DeckMediaType>> = {
  pdf: DeckMediaType.enum['application/pdf'],
  pptx: DeckMediaType.enum[
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ],
};

const extensionOf = (fileName: string): string =>
  /\.([^.]+)$/.exec(fileName)?.[1]?.toLowerCase() ?? '';

/** By extension, because browsers report no type for a `.pptx` on some platforms. */
export const deckMediaType = (fileName: string): DeckMediaType | undefined =>
  MEDIA_TYPE_BY_EXTENSION[extensionOf(fileName)];

/** One lecture per file, named by its stem, so re-uploading a deck replaces that lecture (`apps/server/src/ingest-deck.ts`). */
export const lectureIdOf = (fileName: string): LectureId => {
  const stem = fileName.replace(/\.[^.]*$/, '').trim();
  return LectureId.parse(stem === '' ? fileName : stem);
};
