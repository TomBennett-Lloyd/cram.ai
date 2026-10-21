import { describe, expect, it } from 'vitest';
import { IngestStatus, StoredLectures, UploadProgress } from './ingest-status';

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

  it('refuses a state that is not an ingest stage', () => {
    expect(UploadProgress.safeParse({ state: 'queued' }).success).toBe(true);
    expect(UploadProgress.safeParse({ state: 'done' }).success).toBe(false);
  });
});

describe('IngestStatus', () => {
  const lecture = { lectureId: 'l1', lectureTitle: 'Bees', slideCount: 2, imageOnly: [2] };

  it('carries the course file’s lectures beside the uploads, and refuses a status without them', () => {
    const stored = { state: 'read', lectures: [lecture] };
    expect(IngestStatus.safeParse({ courseId: 'bio', stored, uploads: [] }).success).toBe(true);
    expect(IngestStatus.safeParse({ courseId: 'bio', uploads: [] }).success).toBe(false);
  });

  it('names why a course file cannot be read, and each lecture by a title, never blank', () => {
    const unavailable = { state: 'course-unavailable' };
    expect(StoredLectures.safeParse({ ...unavailable, problem: 'newer-schema' }).success).toBe(
      true,
    );
    expect(StoredLectures.safeParse({ ...unavailable, problem: ' ' }).success).toBe(false);
    const read = (overrides: object) =>
      StoredLectures.safeParse({ state: 'read', lectures: [{ ...lecture, ...overrides }] }).success;
    expect(read({})).toBe(true);
    expect(read({ imageOnly: [0] })).toBe(false);
    expect(read({ lectureTitle: ' ' })).toBe(false);
  });
});
