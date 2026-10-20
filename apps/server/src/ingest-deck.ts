import type { Embedder } from '@cram/gateway';
import { type DeckFile, ingestPdf, ingestPptx, UNTITLED_LECTURE } from '@cram/ingest';
import {
  type CourseId,
  Deck,
  type DeckMediaType,
  type LectureId,
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

export interface IngestDeps {
  readonly files: CourseFiles;
  readonly embedder: Embedder;
}

const ADAPTERS = {
  'application/pdf': ingestPdf,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ingestPptx,
} satisfies Record<DeckMediaType, (deck: DeckFile) => unknown>;

/** Ingest → embed → index one deck, replacing its lecture whole (`CourseIndex.replaceLecture`). */
export const ingestDeck = async (job: IngestJob, deps: IngestDeps): Promise<UploadProgress> => {
  const ingested = await ADAPTERS[job.mediaType](job);
  if (ingested.status === 'unreadable')
    return { state: 'unreadable', reason: ingested.reason, detail: ingested.detail };
  const records = ingested.slides.map((slide) => slide.record);
  const indexed = await embedSlides(deps.embedder, records);
  const opened = openForWrite(deps.files, job.courseId);
  if (opened.status !== 'open') return { state: 'course-unavailable', problem: opened.status };
  const deck = Deck.parse({
    lectureId: job.lectureId,
    lectureTitle: records[0]?.lectureTitle ?? UNTITLED_LECTURE,
    mediaType: job.mediaType,
    content: job.bytes,
  });
  try {
    opened.course.replaceLecture(deck, [], indexed);
  } finally {
    opened.course.close();
  }
  return {
    state: 'indexed',
    slideCount: records.length,
    imageOnly: ingested.slides
      .filter((slide) => slide.kind === 'image-only')
      .map((slide) => slide.record.slideNo),
  };
};
