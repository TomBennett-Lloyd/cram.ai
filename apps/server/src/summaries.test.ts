import {
  type ChatRequest,
  type ChatResult,
  type EntailmentResult,
  type Generator,
  type ModelGateway,
  PROVISIONAL_DEFAULT_PINS,
  type Recording,
} from '@cram/gateway';
import { slideLines, splitClaims } from '@cram/grounding';
import { CourseSummaries, type RetrievedSlide, SlideKind } from '@cram/shared';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CourseId } from '@cram/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { courseFilePath } from './data-directory';
import { markOlder, seededDataDir } from './repair-fixture';
import {
  gatewayOf,
  PDF,
  pdfDeck,
  retrievedFrom,
  send,
  settledStatus,
  startTestServer,
  stopTestServer,
  summarised,
  type TestServer,
  uploadPath,
} from './server-fixture';

const HIVE = [['The Hive', 'Worker bees are male in this course.'], []];
const MALE = 'Workers are male.';
const ENTAILED: EntailmentResult = {
  status: 'scored',
  scores: { entailment: 0.9, neutral: 0.05, contradiction: 0.05 },
};
const NEUTRAL: EntailmentResult = {
  status: 'scored',
  scores: { entailment: 0.05, neutral: 0.9, contradiction: 0.05 },
};
const FAILED = { status: 'backend-failed', cause: 'request-error', reason: 'down' } as const;

let test: TestServer | undefined;
afterEach(async () => {
  if (test !== undefined) await stopTestServer(test);
  test = undefined;
});

const started = async (gateway?: ModelGateway): Promise<TestServer> => {
  test = await startTestServer(gateway);
  return test;
};

const upload = async ({ server }: TestServer, bytes: Uint8Array) =>
  send(server.port, {
    method: 'POST',
    path: uploadPath('bio', 'l1', 'hive.pdf'),
    headers: { 'content-type': PDF },
    body: bytes,
  });

/** The slides a summary call is given: none a references page or without lines. */
const summarisable = (slides: readonly RetrievedSlide[]) =>
  slides.filter(
    ({ record }) => record.kind !== SlideKind.enum.references && slideLines(record).length > 0,
  );

/** The hive deck's summary call answered with one unit citing its body line, and that unit's verdict. */
const hiveSummary = async (
  bytes: Uint8Array,
  verdict: EntailmentResult = ENTAILED,
): Promise<readonly Recording[]> => {
  const slides = summarisable(await retrievedFrom(bytes, 'bio', 'l1', 'hive.pdf'));
  const [first] = slides;
  if (first === undefined) throw new Error('hive deck has no slide');
  const unit = { text: MALE, citations: [{ sourceId: first.sourceId, line: 2 }] };
  const quote = slideLines(first.record)[1] ?? '';
  return [
    summarised('The Hive', slides, {
      status: 'content',
      content: JSON.stringify({ units: [unit] }),
    }),
    {
      role: 'verifier',
      pin: PROVISIONAL_DEFAULT_PINS.verifier,
      request: { pairs: splitClaims(MALE).map((hypothesis) => ({ premise: quote, hypothesis })) },
      reply: { results: [verdict] },
    },
  ];
};

const status = async ({ server }: TestServer) =>
  (await settledStatus(server.port, 'bio')).json as {
    stored: { lectures: { summarised: boolean; withheld: number }[] };
    uploads: { progress: { state: string; summarised?: boolean } }[];
    remakes: unknown[];
  };

const summaries = async ({ server }: TestServer) =>
  send(server.port, { method: 'GET', path: '/courses/bio/summaries' });

const remake = async ({ server }: TestServer, body: unknown, contentType = 'application/json') =>
  send(server.port, {
    method: 'POST',
    path: '/courses/bio/remakes',
    headers: { 'content-type': contentType },
    body: JSON.stringify(body),
  });

/** Fails its first lecture-summary call as a value, then answers as `inner` does. */
class FailsFirstSummary implements Generator {
  readonly #inner: Generator;
  #failed = false;
  readonly pin: Generator['pin'];
  readonly sampling: Generator['sampling'];
  readonly served: Generator['served'];

  constructor(inner: Generator) {
    this.#inner = inner;
    this.pin = inner.pin;
    this.sampling = inner.sampling;
    this.served = inner.served;
  }

  chat<T>(request: ChatRequest<T>): Promise<ChatResult<T>> {
    if (this.#failed || request.output.name !== 'units') return this.#inner.chat(request);
    this.#failed = true;
    return Promise.resolve(FAILED);
  }
}

describe('the lecture digest at upload', () => {
  it('stores the verified summary, reports the upload summarised, and serves its lines with their slides', async () => {
    const bytes = await pdfDeck(HIVE);
    const server = await started(gatewayOf(await hiveSummary(bytes)));
    await upload(server, bytes);
    const settled = await status(server);
    expect(settled.uploads.map(({ progress }) => progress)).toEqual([
      { state: 'indexed', slideCount: 2, imageOnly: [2], unembedded: [], summarised: true },
    ]);
    expect(settled.stored.lectures.map(({ summarised: made }) => made)).toEqual([true]);
    const read = await summaries(server);
    expect(read.status).toBe(200);
    const parsed = CourseSummaries.parse(read.json);
    if (parsed.state !== 'read') throw new Error('summaries unread');
    expect(parsed.summaries.map(({ units }) => units.map(({ text }) => text))).toEqual([[MALE]]);
    const [slide] = await retrievedFrom(bytes, 'bio', 'l1', 'hive.pdf');
    expect(parsed.slides).toEqual([slide]);
    expect(server.logs).toEqual([]);
  });

  it('stores a lecture whose every unit was withheld as no summary, and serves the withheld unit with its slide', async () => {
    const bytes = await pdfDeck(HIVE);
    const server = await started(gatewayOf(await hiveSummary(bytes, NEUTRAL)));
    await upload(server, bytes);
    const settled = await status(server);
    expect(settled.uploads.map(({ progress }) => progress.summarised)).toEqual([false]);
    expect(
      settled.stored.lectures.map(({ summarised: made, withheld }) => [made, withheld]),
    ).toEqual([[false, 1]]);
    const parsed = CourseSummaries.parse((await summaries(server)).json);
    if (parsed.state !== 'read') throw new Error('summaries unread');
    const [slide] = await retrievedFrom(bytes, 'bio', 'l1', 'hive.pdf');
    if (slide === undefined) throw new Error('hive deck has no slide');
    expect(parsed.summaries).toEqual([
      {
        lectureId: 'l1',
        units: [],
        withheld: [
          {
            reason: 'unsupported',
            unit: {
              text: MALE,
              citations: [{ sourceId: slide.sourceId, quote: slideLines(slide.record)[1] }],
              kind: 'lecture-summary',
            },
          },
        ],
      },
    ]);
    expect(parsed.slides).toEqual([slide]);
  });

  it('stores nothing and reports the upload unsummarised when the model fails, logging the failure', async () => {
    const bytes = await pdfDeck(HIVE);
    const slides = summarisable(await retrievedFrom(bytes, 'bio', 'l1', 'hive.pdf'));
    const server = await started(gatewayOf([summarised('The Hive', slides, FAILED)]));
    await upload(server, bytes);
    const settled = await status(server);
    expect(settled.uploads.map(({ progress }) => progress.summarised)).toEqual([false]);
    expect(settled.stored.lectures.map(({ summarised: made }) => made)).toEqual([false]);
    expect((await summaries(server)).json).toEqual({ state: 'read', summaries: [], slides: [] });
    expect(server.logs).toEqual([
      {
        operation: 'summarise generate',
        courseId: 'bio',
        lectureKey: 1,
        outcome: 'backend-failed request-error',
      },
    ]);
  });

  it('keeps the upload indexed when the summary job throws, logging it by name', async () => {
    const bytes = await pdfDeck(HIVE);
    const gateway = gatewayOf([]);
    const server = await started({
      ...gateway,
      generator: { ...gateway.generator, chat: () => Promise.reject(new TypeError('broken')) },
    });
    await upload(server, bytes);
    expect((await status(server)).uploads.map(({ progress }) => progress)).toEqual([
      { state: 'indexed', slideCount: 2, imageOnly: [2], unembedded: [], summarised: false },
    ]);
    expect(server.logs).toEqual([
      { operation: 'tag', courseId: 'bio', lectureKey: 1, outcome: 'TypeError' },
      { operation: 'summarise', courseId: 'bio', lectureKey: 1, outcome: 'TypeError' },
    ]);
  });

  it('replaces the old summary with the new run’s digest when the lecture is uploaded again', async () => {
    const bytes = await pdfDeck(HIVE);
    const server = await started(gatewayOf(await hiveSummary(bytes)));
    await upload(server, bytes);
    await status(server);
    await upload(server, await pdfDeck([['The Hive', 'Drones never forage.']]));
    const settled = await status(server);
    expect(settled.uploads.map(({ progress }) => progress.summarised)).toEqual([true, false]);
    const unscripted = { text: 'Unscripted.', citations: [], kind: 'lecture-summary' };
    expect((await summaries(server)).json).toEqual({
      state: 'read',
      summaries: [
        {
          lectureId: 'l1',
          units: [],
          withheld: [{ reason: 'dangling-citation', unit: unscripted }],
        },
      ],
      slides: [],
    });
  });
});

describe('POST /courses/:id/remakes', () => {
  it('makes a missing summary again, reporting it queued, then done', async () => {
    const bytes = await pdfDeck(HIVE);
    const inner = gatewayOf(await hiveSummary(bytes));
    const server = await started({ ...inner, generator: new FailsFirstSummary(inner.generator) });
    await upload(server, bytes);
    expect((await status(server)).stored.lectures.map(({ summarised: made }) => made)).toEqual([
      false,
    ]);
    const accepted = await remake(server, { lectureId: 'l1' });
    expect(accepted).toMatchObject({
      status: 202,
      json: { lectureId: 'l1', progress: { state: 'queued' } },
    });
    const settled = await status(server);
    expect(settled.remakes).toEqual([
      { lectureId: 'l1', progress: { state: 'done', summarised: true } },
    ]);
    expect(settled.stored.lectures.map(({ summarised: made }) => made)).toEqual([true]);
  });

  it('reports a re-make that stored nothing as done, unsummarised', async () => {
    const server = await started();
    await upload(server, await pdfDeck(HIVE));
    await status(server);
    await remake(server, { lectureId: 'l1' });
    expect((await status(server)).remakes).toEqual([
      { lectureId: 'l1', progress: { state: 'done', summarised: false } },
    ]);
  });

  it('refuses a lecture the course does not hold, a course it does not know, and a body that is not one', async () => {
    const server = await started();
    expect(await remake(server, { lectureId: 'l1' })).toMatchObject({
      status: 404,
      json: { status: 'no-such-course' },
    });
    await upload(server, await pdfDeck(HIVE));
    await status(server);
    expect(await remake(server, { lectureId: 'l9' })).toMatchObject({
      status: 404,
      json: { status: 'not-found' },
    });
    expect(await remake(server, { lecture: 'l1' })).toMatchObject({ status: 400 });
    expect(await remake(server, { lectureId: 'l1', extra: true })).toMatchObject({ status: 400 });
    expect(await remake(server, { lectureId: 1 })).toMatchObject({ status: 400 });
    expect(await remake(server, { lectureId: 'l1' }, 'text/plain')).toMatchObject({ status: 415 });
    expect((await status(server)).remakes).toEqual([]);
  });
});

describe('GET /courses/:id/summaries', () => {
  it('refuses a course it does not know, and names why a course file cannot be read', async () => {
    const { server, dataDir } = await started();
    expect(await summaries({ server, dataDir, logs: [] })).toMatchObject({
      status: 404,
      json: { status: 'no-such-course' },
    });
    const path = courseFilePath(dataDir, CourseId.parse('bio'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'not a course file');
    expect(await summaries({ server, dataDir, logs: [] })).toMatchObject({
      status: 409,
      json: { status: 'course-unavailable', problem: 'not-a-course-file' },
    });
  });
});

describe('the start-up rebuild', () => {
  it('re-makes the summary of every lecture it rebuilds, which held none it could carry', async () => {
    const bytes = await pdfDeck(HIVE);
    const dataDir = await seededDataDir(HIVE);
    markOlder(dataDir);
    test = await startTestServer(gatewayOf(await hiveSummary(bytes)), dataDir);
    const settled = await status(test);
    expect(settled.remakes).toEqual([
      { lectureId: 'l1', progress: { state: 'done', summarised: true } },
    ]);
    expect(settled.stored.lectures.map(({ summarised: made }) => made)).toEqual([true]);
  });
});
