import { describe, expect, it } from 'vitest';
import { ROUTE_COURSE_ID_MAX_LENGTH as MAX, RouteCourseId } from './route-course-id';

describe('RouteCourseId', () => {
  it('accepts lowercase letters and digits with inner hyphens, up to the maximum length', () => {
    for (const id of ['a', '7', 'bio-101', 'a-b-c', 'x'.repeat(MAX), 'com0', 'lpt10', 'console'])
      expect(RouteCourseId.safeParse(id).success, id).toBe(true);
  });

  it('refuses anything else, a Windows device name included', () => {
    for (const id of [
      '',
      'Bio',
      '-bio',
      'bio-',
      'bio_101',
      'bio 101',
      'bio%20',
      'x'.repeat(MAX + 1),
      'con',
      'prn',
      'aux',
      'nul',
      'com1',
      'lpt9',
    ])
      expect(RouteCourseId.safeParse(id).success, id).toBe(false);
  });
});
