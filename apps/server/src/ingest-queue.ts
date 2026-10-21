import { randomUUID } from 'node:crypto';
import {
  type CourseId,
  type CourseRepair,
  type Upload,
  UploadId,
  type UploadProgress,
} from '@cram/shared';
import { type CourseRepaired, repairCourse, type RepairOutcome } from './course-repair';
import { type IngestDeps, ingestDeck, type IngestJob } from './ingest-deck';
import { errorName, type ServerLog } from './server-log';

/** The outcomes after which the course file opens under the running schema and embedder. */
const OPENS: ReadonlySet<RepairOutcome> = new Set(['open', 'rebuilt', 'reembedded']);

const repairState = ({ outcome, discarded }: CourseRepaired): CourseRepair =>
  OPENS.has(outcome) ? { state: 'done', discarded: [...discarded] } : { state: 'failed' };

/**
 * Runs every course-file write, uploads and the repairs `startServer` queues, one at a time and
 * process-wide, so each course file has a single writer. Upload progress lives in memory, for
 * uploads since the server started; what a restart keeps is the course file's (`storedLectures`).
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

  /** Queues `repairCourse` behind every write queued so far; an outcome other than `open` is logged. */
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
      outcome = repaired.outcome;
      this.#repairs.set(courseId, repairState(repaired));
    } catch (error) {
      outcome = errorName(error);
      this.#repairs.set(courseId, { state: 'failed' });
    }
    if (outcome !== 'open') this.#log({ operation: 'repair', courseId, outcome });
  }

  /** The course's repair since the server started. */
  repairOf(courseId: CourseId): CourseRepair {
    return this.#repairs.get(courseId) ?? { state: 'none' };
  }

  /** Every course with an upload since the server started. */
  courseIds(): readonly CourseId[] {
    return [...this.#uploads.keys()];
  }

  uploads(courseId: CourseId): readonly Upload[] {
    return [...(this.#uploads.get(courseId)?.values() ?? [])];
  }

  /** Settles once every job queued so far has finished. */
  idle(): Promise<void> {
    return this.#tail;
  }
}
