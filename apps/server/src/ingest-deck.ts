import type { ModelGateway } from '@cram/gateway';
import {
  type DeckFile,
  ingestPdf,
  ingestPptx,
  renderPdfDeck,
  UNTITLED_LECTURE,
} from '@cram/ingest';
import {
  type CourseId,
  Deck,
  type DeckMediaType,
  type LectureId,
  type SlideImage,
  type SlideRecord,
  type UploadProgress,
} from '@cram/shared';
import { type CourseFiles, openForWrite } from './course-file';
import { embedSlides } from './slide-embedding';

export interface IngestJob {
  readonly courseId: CourseId;
  readonly lectureId: LectureId;
  readonly fileName: string;
  readonly mediaType: DeckMediaType;
  readonly bytes: Uint8Array;
}

export type IngestGateway = Pick<ModelGateway, 'embedder' | 'generator' | 'verifier'>;

export interface IngestDeps {
  readonly files: CourseFiles;
  readonly gateway: IngestGateway;
}

const ADAPTERS = {
  'application/pdf': ingestPdf,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ingestPptx,
} satisfies Record<DeckMediaType, (deck: DeckFile) => unknown>;

export const ingestFile = (mediaType: DeckMediaType, deck: DeckFile) => ADAPTERS[mediaType](deck);

const RENDERERS = {
  'application/pdf': renderPdfDeck,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': () =>
    Promise.resolve([]),
} satisfies Record<DeckMediaType, (bytes: Uint8Array) => Promise<readonly SlideImage[]>>;

/** One image per slide of a deck `ingestFile` read; PPTX renders none yet (#169). */
export const renderFile = (mediaType: DeckMediaType, bytes: Uint8Array) =>
  RENDERERS[mediaType](bytes);

/** The deck as the course file stores it; a deck with no slides has no title to read. */
export const lectureDeck = (job: IngestJob, records: readonly SlideRecord[]): Deck =>
  Deck.parse({
    lectureId: job.lectureId,
    lectureTitle: records[0]?.lectureTitle ?? UNTITLED_LECTURE,
    mediaType: job.mediaType,
    content: job.bytes,
  });

/** Ingest → embed → index one deck, replacing its lecture whole (`CourseIndex.replaceLecture`), its old summary with it. */
export const ingestDeck = async (job: IngestJob, deps: IngestDeps): Promise<UploadProgress> => {
  const ingested = await ingestFile(job.mediaType, job);
  if (ingested.status === 'unreadable')
    return { state: 'unreadable', reason: ingested.reason, detail: ingested.detail };
  const records = ingested.slides;
  const images = await renderFile(job.mediaType, job.bytes);
  const slides = await embedSlides(deps.gateway.embedder, records);
  const opened = openForWrite(deps.files, job.courseId);
  if (opened.status !== 'open') return { state: 'course-unavailable', problem: opened.status };
  try {
    opened.course.replaceLecture(lectureDeck(job, records), images, slides);
    const stored = opened.course.lectures().find(({ lectureId }) => lectureId === job.lectureId);
    if (stored === undefined)
      throw new Error(`ingestDeck: lecture ${job.lectureId} was not stored`);
    const { slideCount, imageOnly, unembedded, summarised } = stored;
    return { state: 'indexed', slideCount, imageOnly, unembedded, summarised };
  } finally {
    opened.course.close();
  }
};
