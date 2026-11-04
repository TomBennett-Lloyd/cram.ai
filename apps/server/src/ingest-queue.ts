import { randomUUID } from 'node:crypto';
import {
  type CourseId,
  type CourseRepair,
  type LectureId,
  type RebuildReportRevision,
  type SummaryRemake,
  type TagEdit,
  type Upload,
  UploadId,
  type UploadProgress,
} from '@cram/shared';
import type { LectureKey } from '@cram/index';
import {
  dismissRebuildReport,
  lectureKeyOf,
  type RebuildReportDismissal,
  storedLectures,
} from './course-file';
import { repairCourse, type RepairOutcome } from './course-repair';
import { type IngestDeps, ingestDeck, type IngestJob } from './ingest-deck';
import { tagStored, taggingLogOutcome } from './fact-tagging';
import { type DigestOutcome, summariseStored } from './lecture-digest';
import { errorName, lectureEntry, type LogEntry, type ServerLog } from './server-log';
import { editStoredTags, type TagEditOutcome } from './slide-topics';

const REPAIR_STATE: Readonly<Record<RepairOutcome, 'done' | 'failed'>> = {
  open: 'done',
  rebuilt: 'done',
  reembedded: 'done',
  'newer-schema': 'failed',
  'older-schema': 'failed',
  'not-a-course-file': 'failed',
  'course-mismatch': 'failed',
  'embedder-mismatch': 'failed',
  'no-stored-decks': 'failed',
  'deck-unreadable': 'failed',
};

/**
 * Runs every course-file write, uploads, summaries, topic tagging, the repairs `startServer`
 * queues, dismissals and tag edits, one at a time and process-wide, so each course file has a single writer.
 */
export class IngestQueue {
  readonly #deps: IngestDeps;
  readonly #log: ServerLog;
  readonly #uploads = new Map<CourseId, Map<UploadId, Upload>>();
  readonly #repairs = new Map<CourseId, CourseRepair>();
  readonly #remakes = new Map<CourseId, Map<LectureId, SummaryRemake>>();
  #tail: Promise<void> = Promise.resolve();

  constructor(deps: IngestDeps, log: ServerLog) {
    this.#deps = deps;
    this.#log = log;
  }

  #record(courseId: CourseId, upload: Upload): void {
    const uploads = this.#uploads.get(courseId) ?? new Map<UploadId, Upload>();
    uploads.set(upload.uploadId, upload);
    this.#uploads.set(courseId, uploads);
  }

  #progress(job: IngestJob, upload: Upload, progress: UploadProgress): void {
    this.#record(job.courseId, { ...upload, progress });
  }

  #keyOf(courseId: CourseId, lectureId: LectureId): LectureKey | undefined {
    return lectureKeyOf(this.#deps.files, courseId, lectureId);
  }

  /** The job's top-level boundary (`docs/standards/error-handling.md` rule 2): a throw is `failed`, logged. */
  async #run(job: IngestJob, upload: Upload): Promise<void> {
    this.#progress(job, upload, { state: 'ingesting' });
    let key: LectureKey | undefined;
    try {
      key = this.#keyOf(job.courseId, job.lectureId);
      const progress = await ingestDeck(job, this.#deps);
      if (progress.state === 'indexed') await this.#tag(job);
      this.#progress(job, upload, progress);
    } catch (error) {
      this.#log(lectureEntry('ingest', job.courseId, key, errorName(error)));
      this.#progress(job, upload, { state: 'failed' });
    }
  }

  async #tag(job: IngestJob): Promise<void> {
    let key: LectureKey | undefined;
    try {
      key = this.#keyOf(job.courseId, job.lectureId);
      const logged = taggingLogOutcome(await tagStored(job.courseId, job.lectureId, this.#deps));
      if (logged !== undefined) this.#log(lectureEntry('tag', job.courseId, key, logged));
    } catch (error) {
      this.#log(lectureEntry('tag', job.courseId, key, errorName(error)));
    }
  }

  async #summarise(
    courseId: CourseId,
    lectureId: LectureId,
    key: LectureKey | undefined,
  ): Promise<DigestOutcome> {
    const outcome = await summariseStored(courseId, lectureId, this.#deps);
    if (outcome.status === 'model-failed')
      this.#log(lectureEntry(`summarise ${outcome.stage}`, courseId, key, outcome.failure.status));
    return outcome;
  }

  /** The upload's summary job, after its ingest job; its top-level boundary (`docs/standards/error-handling.md` rule 2) leaves the lecture unsummarised. */
  async #summariseUpload(job: IngestJob, upload: Upload): Promise<void> {
    const indexed = this.#uploads.get(job.courseId)?.get(upload.uploadId)?.progress;
    if (indexed?.state !== 'indexed') return;
    this.#progress(job, upload, { state: 'summarising' });
    let summarised = false;
    let key: LectureKey | undefined;
    try {
      key = this.#keyOf(job.courseId, job.lectureId);
      const outcome = await this.#summarise(job.courseId, job.lectureId, key);
      summarised = outcome.status === 'summarised';
    } catch (error) {
      this.#log(lectureEntry('summarise', job.courseId, key, errorName(error)));
    }
    this.#progress(job, upload, { ...indexed, summarised });
  }

  enqueue(job: IngestJob): Upload {
    const upload: Upload = {
      uploadId: UploadId.parse(randomUUID()),
      lectureId: job.lectureId,
      fileName: job.fileName,
      progress: { state: 'queued' },
    };
    this.#record(job.courseId, upload);
    this.#tail = this.#tail
      .then(() => this.#run(job, upload))
      .then(() => this.#summariseUpload(job, upload));
    return upload;
  }

  #setRemake(courseId: CourseId, remake: SummaryRemake): void {
    const remakes = this.#remakes.get(courseId) ?? new Map<LectureId, SummaryRemake>();
    remakes.set(remake.lectureId, remake);
    this.#remakes.set(courseId, remakes);
  }

  remake(courseId: CourseId, lectureId: LectureId): SummaryRemake {
    const remake: SummaryRemake = { lectureId, progress: { state: 'queued' } };
    this.#setRemake(courseId, remake);
    this.#tail = this.#tail.then(() => this.#remake(courseId, lectureId));
    return remake;
  }

  /** The re-make's top-level boundary (`docs/standards/error-handling.md` rule 2): a throw is `failed`, logged. */
  async #remake(courseId: CourseId, lectureId: LectureId): Promise<void> {
    this.#setRemake(courseId, { lectureId, progress: { state: 'running' } });
    let key: LectureKey | undefined;
    try {
      key = this.#keyOf(courseId, lectureId);
      const outcome = await this.#summarise(courseId, lectureId, key);
      const done =
        outcome.status === 'course-unavailable' || outcome.status === 'no-such-lecture'
          ? { state: 'failed' as const }
          : { state: 'done' as const, summarised: outcome.status === 'summarised' };
      this.#setRemake(courseId, { lectureId, progress: done });
    } catch (error) {
      this.#log(lectureEntry('summarise', courseId, key, errorName(error)));
      this.#setRemake(courseId, { lectureId, progress: { state: 'failed' } });
    }
  }

  remakes(courseId: CourseId): readonly SummaryRemake[] {
    return [...(this.#remakes.get(courseId)?.values() ?? [])];
  }

  repair(courseId: CourseId): void {
    this.#repairs.set(courseId, { state: 'queued' });
    this.#tail = this.#tail.then(() => this.#repair(courseId));
  }

  /** The repair's top-level boundary (`docs/standards/error-handling.md` rule 2): a throw is logged by name. */
  async #repair(courseId: CourseId): Promise<void> {
    this.#repairs.set(courseId, { state: 'running' });
    let report: Pick<LogEntry, 'outcome' | 'lectureKey'>;
    try {
      const repaired = await repairCourse(courseId, this.#deps);
      report = repaired;
      this.#repairs.set(courseId, { state: REPAIR_STATE[repaired.outcome] });
      if (repaired.outcome === 'rebuilt') this.#remakeAll(courseId);
    } catch (error) {
      report = { outcome: errorName(error) };
      this.#repairs.set(courseId, { state: 'failed' });
    }
    if (report.outcome !== 'open') this.#log({ operation: 'repair', courseId, ...report });
  }

  /** Queued behind every write so far; a rejection reaches the caller and never stalls the queue. */
  #queued<T>(write: () => T): Promise<T> {
    const written = this.#tail.then(write);
    this.#tail = written.then(
      () => undefined,
      () => undefined,
    );
    return written;
  }

  dismissRebuildReport(
    courseId: CourseId,
    revision: RebuildReportRevision,
  ): Promise<RebuildReportDismissal> {
    return this.#queued(() => dismissRebuildReport(this.#deps.files, courseId, revision));
  }

  editTags(courseId: CourseId, edit: TagEdit): Promise<TagEditOutcome> {
    return this.#queued(() => editStoredTags(this.#deps.files, courseId, edit));
  }

  /** A rebuilt file holds no summary, so each lecture's is re-made from its rebuilt slides (`docs/adr/0009-explanation-answers.md` § Decision (l)). */
  #remakeAll(courseId: CourseId): void {
    const stored = storedLectures(this.#deps.files, courseId);
    if (stored.state !== 'read') return;
    for (const { lectureId } of stored.lectures) this.remake(courseId, lectureId);
  }

  repairOf(courseId: CourseId): CourseRepair {
    return this.#repairs.get(courseId) ?? { state: 'none' };
  }

  courseIds(): readonly CourseId[] {
    return [...this.#uploads.keys()];
  }

  uploads(courseId: CourseId): readonly Upload[] {
    return [...(this.#uploads.get(courseId)?.values() ?? [])];
  }

  idle(): Promise<void> {
    return this.#tail;
  }
}
