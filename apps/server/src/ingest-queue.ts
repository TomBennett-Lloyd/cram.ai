import { randomUUID } from 'node:crypto';
import {
  type CourseId,
  type CourseRepair,
  type RebuildReportRevision,
  type Upload,
  UploadId,
  type UploadProgress,
} from '@cram/shared';
import { dismissRebuildReport, type RebuildReportDismissal } from './course-file';
import { repairCourse, type RepairOutcome } from './course-repair';
import { type IngestDeps, ingestDeck, type IngestJob } from './ingest-deck';
import { errorName, type ServerLog } from './server-log';

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
 * Runs every course-file write, uploads, the repairs `startServer` queues and dismissals, one at a
 * time and process-wide, so each course file has a single writer.
 */
export class IngestQueue {
  readonly #deps: IngestDeps;
  readonly #log: ServerLog;
  readonly #uploads = new Map<CourseId, Map<UploadId, Upload>>();
  readonly #repairs = new Map<CourseId, CourseRepair>();
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

  /** The job's top-level boundary (`docs/standards/error-handling.md` rule 2): a throw is `failed`, logged. */
  async #run(job: IngestJob, upload: Upload): Promise<void> {
    this.#progress(job, upload, { state: 'ingesting' });
    try {
      this.#progress(job, upload, await ingestDeck(job, this.#deps));
    } catch (error) {
      this.#log({ operation: 'ingest', courseId: job.courseId, outcome: errorName(error) });
      this.#progress(job, upload, { state: 'failed' });
    }
  }

  enqueue(job: IngestJob): Upload {
    const upload: Upload = {
      uploadId: UploadId.parse(randomUUID()),
      lectureId: job.lectureId,
      fileName: job.fileName,
      progress: { state: 'queued' },
    };
    this.#record(job.courseId, upload);
    this.#tail = this.#tail.then(() => this.#run(job, upload));
    return upload;
  }

  repair(courseId: CourseId): void {
    this.#repairs.set(courseId, { state: 'queued' });
    this.#tail = this.#tail.then(() => this.#repair(courseId));
  }

  /** The repair's top-level boundary (`docs/standards/error-handling.md` rule 2): a throw is logged by name. */
  async #repair(courseId: CourseId): Promise<void> {
    this.#repairs.set(courseId, { state: 'running' });
    let outcome: string;
    try {
      const repaired = await repairCourse(courseId, this.#deps);
      outcome = repaired;
      this.#repairs.set(courseId, { state: REPAIR_STATE[repaired] });
    } catch (error) {
      outcome = errorName(error);
      this.#repairs.set(courseId, { state: 'failed' });
    }
    if (outcome !== 'open') this.#log({ operation: 'repair', courseId, outcome });
  }

  /** Queued behind every write so far; a rejection reaches the caller and never stalls the queue. */
  dismissRebuildReport(
    courseId: CourseId,
    revision: RebuildReportRevision,
  ): Promise<RebuildReportDismissal> {
    const dismissed = this.#tail.then(() =>
      dismissRebuildReport(this.#deps.files, courseId, revision),
    );
    this.#tail = dismissed.then(
      () => undefined,
      () => undefined,
    );
    return dismissed;
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
