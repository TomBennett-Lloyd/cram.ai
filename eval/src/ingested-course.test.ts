import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CourseId } from '@cram/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lecture, slide } from './eval-fixture';
import { ingestedCourse } from './ingested-course';

const COURSE = CourseId.parse('hollowmere');

/** Over `THIN_TEXT_LAYER_WORDS` (`packages/ingest/src/slide-text.ts`). */
const BODY =
  'Every cell of a Hollowmere comb is square, and each frame holds a fixed count of them.';

let dir = '';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cram-eval-134-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('ingestedCourse', () => {
  it('holds each lecture as its stored PDF beside the records ingest made of it', async () => {
    const deck = [
      lecture('l1', [slide({ body: [BODY] })]),
      lecture('l2', [
        slide({ title: 'Drones', body: [BODY] }),
        slide({ slideNo: 2, imageOnly: true }),
      ]),
    ];
    const lectures = await ingestedCourse(deck, COURSE, dir);
    expect(lectures.map(({ deck: stored }) => [stored.lectureId, stored.mediaType])).toEqual([
      ['l1', 'application/pdf'],
      ['l2', 'application/pdf'],
    ]);
    expect(
      lectures.map(({ slides }) =>
        slides.map(({ courseId, slideNo, kind }) => [courseId, slideNo, kind]),
      ),
    ).toEqual([
      [['hollowmere', 1, 'content']],
      [
        ['hollowmere', 1, 'content'],
        ['hollowmere', 2, 'image-only'],
      ],
    ]);
  });
});
