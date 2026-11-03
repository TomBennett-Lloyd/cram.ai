import { CourseId, LectureId } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { hrefOf, routeOf } from './route';

const bio = CourseId.parse('bio-101');

describe('routeOf', () => {
  it('reads an empty, bare or root hash as the courses screen', () => {
    for (const hash of ['', '#', '#/']) expect(routeOf(hash)).toEqual({ screen: 'courses' });
  });

  it('reads a course hash as its ask screen, and its decks hash as its decks screen', () => {
    expect(routeOf('#/courses/bio-101')).toEqual({ screen: 'ask', courseId: bio });
    expect(routeOf('#/courses/bio-101/decks')).toEqual({ screen: 'decks', courseId: bio });
  });

  it('reads anything else as not found, a course id the server would refuse included', () => {
    for (const hash of [
      '#/courses',
      '#/courses/',
      '#/courses/Bio',
      '#/courses/con',
      '#/courses/bio/ask',
      '#/courses/bio/decks/',
      '#/courses/bio/decks/l1/x',
      '#/courses/bio/decks/%E0%A4%A',
      '#/courses/Bio/decks/l1',
      '#courses/bio',
      '#/x/courses/bio',
      '##/courses/bio',
    ])
      expect(routeOf(hash), hash).toEqual({ screen: 'not-found' });
  });
});

describe('routeOf, a lecture’s slides', () => {
  it('reads a lecture under a course’s decks as its slide browser, decoding the lecture id', () => {
    for (const [segment, lectureId] of [
      ['l1', 'l1'],
      ['week%202%2Flab', 'week 2/lab'],
      ['caf%C3%A9', 'café'],
      ['%25', '%'],
    ] as const)
      expect(routeOf(`#/courses/bio-101/decks/${segment}`), segment).toEqual({
        screen: 'slides',
        courseId: bio,
        lectureId: LectureId.parse(lectureId),
      });
  });
});

describe('hrefOf', () => {
  it('writes the hash routeOf reads back', () => {
    for (const route of [
      { screen: 'courses' } as const,
      { screen: 'ask', courseId: bio } as const,
      { screen: 'decks', courseId: bio } as const,
      ...['l1', 'week 2/lab', 'a#b?c', '%', 'café'].map(
        (id) => ({ screen: 'slides', courseId: bio, lectureId: LectureId.parse(id) }) as const,
      ),
    ])
      expect(routeOf(hrefOf(route))).toEqual(route);
  });
});
