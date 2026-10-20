import { describe, expect, it } from 'vitest';
import { RouteCourseId } from './route-course-id';

describe('RouteCourseId', () => {
  it('accepts lowercase letters and digits with inner hyphens, up to 64 characters', () => {
    for (const id of ['a', '7', 'bio-101', 'a-b-c', 'x'.repeat(64), 'com0', 'lpt10', 'console'])
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
      'x'.repeat(65),
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
