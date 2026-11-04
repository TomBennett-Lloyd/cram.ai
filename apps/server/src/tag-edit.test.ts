import { ChunkNo, LectureSlides, SourceId, TopicTag } from '@cram/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { markOlder, openedUnder, restarted, seededDataDir, uploadTo } from './repair-fixture';
import { GatedEmbedder, pdfDeck, send, settledStatus, WordEmbedder } from './server-fixture';
import {
  brokenCourseFile,
  EDIT,
  FACT,
  FIRST,
  firstChunkTags,
  forgetStarted,
  HELD,
  hive,
  lecture,
  put,
  QUEEN,
  SECOND,
  stopStarted,
  SWARM,
} from './slide-browser-fixture';
import { MAX_TAG_EDIT_BYTES } from './tag-handlers';

afterEach(stopStarted);

describe('PUT /courses/:id/tags', () => {
  it('sets the chunk’s whole list, keeping a held tag’s origin, and a later read and a restarted server read it back', async () => {
    const { server, dataDir } = await hive();
    const edited = await put(server.port, { ...EDIT, tags: ['the queen', 'swarming'] });
    const expected = [
      { tag: 'swarming', origin: 'student' },
      { tag: 'the queen', origin: 'tagger' },
    ];
    expect(edited).toMatchObject({ status: 200, json: { ...FACT, tags: expected } });
    expect(firstChunkTags(await lecture(server.port))).toEqual(expected);
    await server.close();
    forgetStarted();
    const again = await restarted(dataDir);
    expect(firstChunkTags(await lecture(again.server.port))).toEqual(expected);
  });

  it('leaves the slide’s other chunks and slides as they were', async () => {
    const { server } = await hive();
    await put(server.port, { ...SECOND, base: [], tags: ['bloom count'] });
    const served = LectureSlides.parse((await lecture(server.port)).json);
    expect(served.slides.map(({ chunks }) => chunks.map(({ tags }) => tags))).toEqual([
      [
        [
          { tag: 'castes', origin: 'student' },
          { tag: 'the queen', origin: 'tagger' },
        ],
      ],
      [[{ tag: 'bloom count', origin: 'student' }]],
    ]);
  });

  it('refuses a body that is not JSON, too large, or not a tag edit, and a course or slide it does not know', async () => {
    const { server, dataDir } = await hive();
    const tags = ['castes'];
    const oversized = JSON.stringify({ ...EDIT, tags: ['x'.repeat(MAX_TAG_EDIT_BYTES)] });
    const refusals = [
      [
        await put(server.port, { ...EDIT, tags }, 'bio', 'text/plain'),
        415,
        'unsupported-media-type',
      ],
      [await put(server.port, oversized), 413, 'payload-too-large'],
      [await put(server.port, '{'), 400, 'bad-request'],
      [await put(server.port, { ...EDIT, tags: ['castes '] }), 400, 'bad-request'],
      [await put(server.port, { ...EDIT, tags, origin: 'tagger' }), 400, 'bad-request'],
      [
        await put(server.port, { sourceId: 'l1/1', chunkNo: 1, base: HELD, tags }),
        400,
        'bad-request',
      ],
      [await put(server.port, { ...EDIT, textHash: 'x', tags }), 400, 'bad-request'],
      [await put(server.port, { ...EDIT, tags }, 'Bio'), 400, 'bad-request'],
      [await put(server.port, { ...EDIT, tags }, 'chem'), 404, 'no-such-course'],
      [await put(server.port, { ...EDIT, sourceId: 'l9/1', tags }), 404, 'not-found'],
    ] as const;
    for (const [received, status, refusal] of refusals)
      expect([received.status, received.json]).toMatchObject([status, { status: refusal }]);
    expect(firstChunkTags(await lecture(server.port))).toHaveLength(2);
    brokenCourseFile(dataDir, 'not a course file');
    expect(await put(server.port, { ...EDIT, tags })).toMatchObject({
      status: 409,
      json: { status: 'course-unavailable', problem: 'not-a-course-file' },
    });
  });

  it('waits behind an upload already queued, so the re-uploaded lecture keeps the edit', async () => {
    const gated = new GatedEmbedder();
    const { server } = await restarted(await seededDataDir([QUEEN, SWARM]), gated);
    await uploadTo(server.port, await pdfDeck([QUEEN, ['Drones', 'Drones do not forage']]));
    const edit = put(server.port, { ...FIRST, base: [], tags: ['royalty'] });
    gated.open();
    expect(await edit).toMatchObject({ status: 200 });
    await settledStatus(server.port, 'bio');
    expect(firstChunkTags(await lecture(server.port))).toEqual([
      { tag: 'royalty', origin: 'student' },
    ]);
  });

  it('refuses an edit made against a list other than the chunk’s, sending the chunk’s and writing nothing', async () => {
    const { server } = await hive();
    const stale = [
      [HELD[0]],
      [...HELD, { tag: 'drones', origin: 'student' }],
      [{ tag: 'castes', origin: 'tagger' }, HELD[1]],
      [HELD[0], { tag: 'the queen', origin: 'student' }],
      [{ tag: 'caste', origin: 'student' }, HELD[1]],
      [HELD[0], HELD[0], HELD[1]],
      [HELD[0], HELD[1], HELD[1]],
      [HELD[0], { tag: 'castes', origin: 'tagger' }, HELD[1]],
      [],
    ];
    for (const base of stale)
      expect(
        await put(server.port, { ...FIRST, base, tags: ['royalty'] }),
        JSON.stringify(base),
      ).toMatchObject({ status: 409, json: { status: 'tags-changed', tags: HELD } });
    expect(firstChunkTags(await lecture(server.port))).toEqual(HELD);
  });

  it('matches a base listed in another order', async () => {
    const { server } = await hive();
    const edited = await put(server.port, { ...FIRST, base: [...HELD].reverse(), tags: [] });
    expect(edited).toMatchObject({ status: 200, json: { ...FACT, tags: [] } });
  });

  it('refuses the second of two edits made against the same list, whichever reaches the queue last', async () => {
    const { server } = await hive();
    const [first, second] = await Promise.all([
      put(server.port, { ...EDIT, tags: ['castes', 'drones'] }),
      put(server.port, { ...EDIT, tags: ['royalty'] }),
    ]);
    const answers = [first, second].map((received) => received.status).sort();
    expect(answers).toEqual([200, 409]);
    const won = first.status === 200 ? first : second;
    const lost = first.status === 200 ? second : first;
    const stored = firstChunkTags(await lecture(server.port));
    expect(won.json).toMatchObject({ tags: stored });
    expect(lost.json).toEqual({ status: 'tags-changed', tags: stored });
  });

  it('refuses an edit made before a rebuild it waited behind, the rebuild having discarded the list', async () => {
    const dataDir = await seededDataDir([QUEEN, SWARM]);
    const seeded = await openedUnder(dataDir, new WordEmbedder());
    if (seeded.status !== 'open') throw new Error(`course file: ${seeded.status}`);
    seeded.course.setTopics(
      { sourceId: SourceId.parse('l1/1'), chunkNo: ChunkNo.parse(1) },
      'student',
      [TopicTag.parse('castes')],
    );
    seeded.course.close();
    markOlder(dataDir);
    const gated = new GatedEmbedder();
    const { server } = await restarted(dataDir, gated);
    const edit = put(server.port, { ...FIRST, base: [HELD[0]], tags: ['castes', 'drones'] });
    gated.open();
    expect(await edit).toMatchObject({ status: 409, json: { status: 'tags-changed', tags: [] } });
    expect(firstChunkTags(await lecture(server.port))).toEqual([]);
  });

  it('refuses an edit made against chunk text the file no longer holds, whatever its base, sending the slide as stored and writing nothing', async () => {
    const { server } = await hive();
    const queen = ['The queen', 'One queen per hive', 'She lays every egg'];
    const swarm = ['Swarm watch', SWARM[1] ?? ''];
    await uploadTo(server.port, await pdfDeck([queen, swarm]));
    await settledStatus(server.port, 'bio');
    const stored = LectureSlides.parse((await lecture(server.port)).json).slides;
    const stale = [
      [{ ...SECOND, base: [] }, stored[1]],
      [{ ...EDIT }, stored[0]],
      [{ ...FIRST, base: [] }, stored[0]],
    ] as const;
    for (const [edit, slide] of stale)
      expect(await put(server.port, { ...edit, tags: ['royalty'] }), edit.sourceId).toEqual(
        expect.objectContaining({ status: 409, json: { status: 'chunk-changed', slide } }),
      );
    const after = LectureSlides.parse((await lecture(server.port)).json).slides;
    expect(after.map(({ chunks }) => chunks.map(({ tags }) => tags))).toEqual([[[]], [[]]]);
    const current = stored[1]?.chunks[0]?.textHash;
    const edited = await put(server.port, {
      ...SECOND,
      textHash: current,
      base: [],
      tags: ['bloom'],
    });
    expect(edited).toMatchObject({
      status: 200,
      json: { tags: [{ tag: 'bloom', origin: 'student' }] },
    });
  });

  it('refuses a chunk number past the slide’s last as changed text, sending the slide', async () => {
    const { server } = await hive();
    const [slide] = LectureSlides.parse((await lecture(server.port)).json).slides;
    expect(await put(server.port, { ...EDIT, chunkNo: 2, tags: [] })).toMatchObject({
      status: 409,
      json: { status: 'chunk-changed', slide },
    });
    expect(firstChunkTags(await lecture(server.port))).toEqual(HELD);
  });

  it('refuses a re-upload that changes only the slide’s title, and accepts one that changes nothing', async () => {
    const { server } = await hive();
    await uploadTo(server.port, await pdfDeck([['The queens', ...QUEEN.slice(1)], SWARM]));
    await settledStatus(server.port, 'bio');
    expect(await put(server.port, { ...FIRST, base: [], tags: [] })).toMatchObject({
      status: 409,
      json: { status: 'chunk-changed' },
    });
    await uploadTo(server.port, await pdfDeck([QUEEN, SWARM]));
    await settledStatus(server.port, 'bio');
    expect(await put(server.port, { ...FIRST, base: [], tags: ['royalty'] })).toMatchObject({
      status: 200,
    });
  });

  it('answers only PUT', async () => {
    const { server } = await hive();
    const got = await send(server.port, { method: 'GET', path: '/courses/bio/tags' });
    expect([got.status, got.headers.allow]).toEqual([405, 'PUT']);
  });
});
