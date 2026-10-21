import { describe, expect, it } from 'vitest';
import { CourseRepair, IngestStatus, StoredLectures, UploadProgress } from './ingest-status';

describe('UploadProgress', () => {
  it('reports image-only pages by slide number, counted from 1', () => {
    const indexed = { state: 'indexed', slideCount: 2 };
    expect(UploadProgress.safeParse({ ...indexed, imageOnly: [2] }).success).toBe(true);
    expect(UploadProgress.safeParse({ ...indexed, imageOnly: [0] }).success).toBe(false);
  });

  it('names at least one slide, and the limit, of an over-length deck', () => {
    const over = { state: 'over-length', maxInputTokens: 512 };
    expect(UploadProgress.safeParse({ ...over, slides: [3] }).success).toBe(true);
    expect(UploadProgress.safeParse({ ...over, slides: [] }).success).toBe(false);
    expect(UploadProgress.safeParse({ ...over, slides: [3], maxInputTokens: 0 }).success).toBe(
      false,
    );
  });

  it('names why the course file could not take the deck by @cram/index’s open status', () => {
    const unavailable = { state: 'course-unavailable' };
    expect(UploadProgress.safeParse({ ...unavailable, problem: 'newer-schema' }).success).toBe(
      true,
    );
    expect(UploadProgress.safeParse({ ...unavailable, problem: 'open' }).success).toBe(false);
  });

  it('refuses a state that is not an ingest stage', () => {
    expect(UploadProgress.safeParse({ state: 'queued' }).success).toBe(true);
    expect(UploadProgress.safeParse({ state: 'done' }).success).toBe(false);
  });
});

describe('IngestStatus', () => {
  const lecture = { lectureId: 'l1', lectureTitle: 'Bees', slideCount: 2, imageOnly: [2] };

  it('carries the course file’s lectures beside the uploads, and refuses a status without them', () => {
    const stored = { state: 'read', lectures: [lecture], report: { state: 'none' } };
    const repair = { state: 'none' };
    expect(IngestStatus.safeParse({ courseId: 'bio', stored, repair, uploads: [] }).success).toBe(
      true,
    );
    expect(IngestStatus.safeParse({ courseId: 'bio', repair, uploads: [] }).success).toBe(false);
    expect(IngestStatus.safeParse({ courseId: 'bio', stored, uploads: [] }).success).toBe(false);
  });

  it('names why a course file cannot be read, and each lecture by a title, never blank', () => {
    const unavailable = { state: 'course-unavailable' };
    expect(StoredLectures.safeParse({ ...unavailable, problem: 'newer-schema' }).success).toBe(
      true,
    );
    expect(StoredLectures.safeParse({ ...unavailable, problem: 'open' }).success).toBe(false);
    const read = (overrides: object) =>
      StoredLectures.safeParse({
        state: 'read',
        lectures: [{ ...lecture, ...overrides }],
        report: { state: 'none' },
      }).success;
    expect(read({})).toBe(true);
    expect(read({ imageOnly: [0] })).toBe(false);
    expect(read({ lectureTitle: ' ' })).toBe(false);
  });
});

describe('the rebuild report', () => {
  const REVISION = 'a'.repeat(64);
  const read = (report: unknown) =>
    StoredLectures.safeParse({ state: 'read', lectures: [], report }).success;
  const undismissed = (discarded: unknown, revision: unknown = REVISION) =>
    read({ state: 'undismissed', discarded, revision });

  it('names each discarded table and how many of its rows were lost, at least one', () => {
    expect(read({ state: 'none' })).toBe(true);
    expect(undismissed([{ table: 'topics', rows: 12 }])).toBe(true);
    expect(undismissed([{ table: 'notes', rows: 1 }])).toBe(true);
    expect(undismissed([])).toBe(false);
    expect(undismissed([{ table: 'topics', rows: 0 }])).toBe(false);
    expect(undismissed([{ table: 'topics', rows: 1.5 }])).toBe(false);
    expect(undismissed([{ table: ' ', rows: 1 }])).toBe(false);
    expect(read(undefined)).toBe(false);
    expect(read({ state: 'none', discarded: [] })).toBe(false);
  });

  it('names an undismissed report by a sha-256 in hex', () => {
    const rows = [{ table: 'topics', rows: 1 }];
    expect(undismissed(rows, '0123456789abcdef'.repeat(4))).toBe(true);
    expect(undismissed(rows, 'a'.repeat(63))).toBe(false);
    expect(undismissed(rows, 'a'.repeat(65))).toBe(false);
    expect(undismissed(rows, 'A'.repeat(64))).toBe(false);
    expect(undismissed(rows, `${'a'.repeat(63)}g`)).toBe(false);
    expect(read({ state: 'undismissed', discarded: rows })).toBe(false);
  });
});

describe('CourseRepair', () => {
  it('refuses a state that is not a repair stage', () => {
    for (const state of ['none', 'queued', 'running', 'done', 'failed'])
      expect(CourseRepair.safeParse({ state }).success).toBe(true);
    expect(CourseRepair.safeParse({ state: 'rebuilt' }).success).toBe(false);
    expect(CourseRepair.safeParse({ state: 'done', discarded: [] }).success).toBe(false);
  });
});
