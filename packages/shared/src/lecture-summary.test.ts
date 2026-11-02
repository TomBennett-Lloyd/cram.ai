import { describe, expect, it } from 'vitest';
import { CourseSummaries, LectureSummary } from './lecture-summary';

const unit = {
  text: 'Drones leave the hive in autumn.',
  citations: [{ sourceId: 'l1/2', quote: 'Drones leave in autumn' }],
  kind: 'lecture-summary',
};

describe('LectureSummary', () => {
  it('holds at least one unit, each a lecture-summary line', () => {
    expect(LectureSummary.safeParse({ lectureId: 'l1', units: [unit] }).success).toBe(true);
    expect(LectureSummary.safeParse({ lectureId: 'l1', units: [] }).success).toBe(false);
    const exam = { ...unit, kind: 'exam-question' };
    expect(LectureSummary.safeParse({ lectureId: 'l1', units: [exam] }).success).toBe(false);
    expect(LectureSummary.safeParse({ lectureId: '', units: [unit] }).success).toBe(false);
  });
});

describe('CourseSummaries', () => {
  it('carries the summaries beside the slides they cite, or why the file could not be read', () => {
    expect(CourseSummaries.safeParse({ state: 'read', summaries: [], slides: [] }).success).toBe(
      true,
    );
    expect(CourseSummaries.safeParse({ state: 'read', summaries: [] }).success).toBe(false);
    const unavailable = { state: 'course-unavailable', problem: 'newer-schema' };
    expect(CourseSummaries.safeParse(unavailable).success).toBe(true);
    expect(CourseSummaries.safeParse({ ...unavailable, problem: 'open' }).success).toBe(false);
  });
});
