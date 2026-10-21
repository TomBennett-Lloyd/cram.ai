import {
  type EmbedSlides,
  type OpenCourseResult,
  type ParseDeck,
  rebuildCourse,
  type RebuildCourseResult,
  reembedCourse,
} from '@cram/index';
import type { CourseId } from '@cram/shared';
import { courseFilePath } from './data-directory';
import { type IngestDeps, ingestFile } from './ingest-deck';
import { embedSlides } from './slide-embedding';

const parseStored: ParseDeck = async (deck, courseId) => {
  const ingested = await ingestFile(deck.mediaType, {
    bytes: deck.content,
    fileName: deck.lectureId,
    storedTitle: deck.lectureTitle,
    courseId,
    lectureId: deck.lectureId,
  });
  return ingested.status === 'unreadable'
    ? { status: 'unreadable' }
    : { status: 'parsed', slides: ingested.slides };
};

/** Embeds a stored deck's slides the way an upload does, so a rebuild reproduces what it stored (#338). */
const embedStored =
  (deps: IngestDeps): EmbedSlides =>
  (slides) =>
    embedSlides(deps.embedder, slides);

/** What one repair did, for the log; `open` is a file that needed nothing. */
export type RepairOutcome =
  RebuildCourseResult['status'] | OpenCourseResult['status'] | 'reembedded';

export const repairCourse = async (
  courseId: CourseId,
  deps: IngestDeps,
): Promise<RepairOutcome> => {
  const spec = {
    path: courseFilePath(deps.files.dataDir, courseId),
    courseId,
    embedder: deps.files.embedder,
  };
  const embed = embedStored(deps);
  const rebuilt = await rebuildCourse(spec, { parse: parseStored, embed });
  if (rebuilt.status !== 'embedder-mismatch') {
    if ('course' in rebuilt) rebuilt.course.close();
    return rebuilt.status;
  }
  const reembedded = await reembedCourse(spec, embed);
  if (reembedded.status !== 'open') return reembedded.status;
  reembedded.course.close();
  return 'reembedded';
};
