import {
  type EmbedSlides,
  type OpenCourseResult,
  type ParseDeck,
  rebuildCourse,
  type RebuildCourseResult,
  reembedCourse,
} from '@cram/index';
import type { CourseId, DiscardedTable } from '@cram/shared';
import { courseFilePath } from './data-directory';
import { type IngestDeps, ingestFile } from './ingest-deck';
import { embedSlides } from './slide-embedding';

/**
 * A stored deck read again. Its stored title goes in as the file name, which `@cram/ingest` titles
 * a lecture from when its first slide has none (`slidesFromPages`). The bytes are a plain
 * `Uint8Array` view, since SQLite hands back a `Buffer`, which pdf.js refuses (`readBody`).
 */
const parseStored: ParseDeck = async (deck, courseId) => {
  const { buffer, byteOffset, byteLength } = deck.content;
  const ingested = await ingestFile(deck.mediaType, {
    bytes: new Uint8Array(buffer, byteOffset, byteLength),
    fileName: `${deck.lectureTitle}.deck`,
    courseId,
    lectureId: deck.lectureId,
  });
  if (ingested.status === 'unreadable')
    throw new Error(`repairCourse: lecture ${deck.lectureId} no longer reads: ${ingested.reason}`);
  return ingested.slides;
};

/** Rejects on an over-length slide: `EmbedSlides` has no value arm for it yet (#184). */
const embedOrReject =
  (deps: IngestDeps): EmbedSlides =>
  async (slides) => {
    const embedded = await embedSlides(deps.embedder, slides);
    if (embedded.status === 'over-length')
      throw new Error(`repairCourse: slides ${embedded.slideNos.join(', ')} are over-length`);
    return embedded.slides.map(({ embedding }) => embedding);
  };

/** What one repair did, for the log; `open` is a file that needed nothing. */
export type RepairOutcome =
  RebuildCourseResult['status'] | OpenCourseResult['status'] | 'reembedded';

export interface CourseRepaired {
  readonly outcome: RepairOutcome;
  /** The rows a rebuild could not carry over, which the student is told of (#225). */
  readonly discarded: readonly DiscardedTable[];
}

/**
 * Brings a course file to the running schema and embedder. A rebuild discards what it cannot
 * carry over and reports it (`docs/adr/0004-storage.md` § Decision (d)).
 */
export const repairCourse = async (
  courseId: CourseId,
  deps: IngestDeps,
): Promise<CourseRepaired> => {
  const spec = {
    path: courseFilePath(deps.files.dataDir, courseId),
    courseId,
    embedder: deps.files.embedder,
  };
  const embed = embedOrReject(deps);
  const rebuilt = await rebuildCourse(spec, { parse: parseStored, embed });
  if (rebuilt.status !== 'embedder-mismatch') {
    if ('course' in rebuilt) rebuilt.course.close();
    return {
      outcome: rebuilt.status,
      discarded: rebuilt.status === 'rebuilt' ? rebuilt.discarded : [],
    };
  }
  const reembedded = await reembedCourse(spec, embed);
  if (reembedded.status !== 'open') return { outcome: reembedded.status, discarded: [] };
  reembedded.course.close();
  return { outcome: 'reembedded', discarded: [] };
};
