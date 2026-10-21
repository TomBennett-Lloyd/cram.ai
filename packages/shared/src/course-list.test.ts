import { describe, expect, it } from 'vitest';
import { CourseList } from './course-list';

describe('CourseList', () => {
  it('parses an empty list and a list of course ids', () => {
    expect(CourseList.parse({ courses: [] })).toEqual({ courses: [] });
    expect(CourseList.parse({ courses: ['bio', 'chem'] }).courses).toEqual(['bio', 'chem']);
  });

  it('refuses a blank course id and an unknown field', () => {
    expect(CourseList.safeParse({ courses: [''] }).success).toBe(false);
    expect(CourseList.safeParse({ courses: [], total: 0 }).success).toBe(false);
  });
});
