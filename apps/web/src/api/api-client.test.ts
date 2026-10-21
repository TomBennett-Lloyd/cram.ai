import { CourseId, LectureId, RebuildReportRevision } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { ApiClient } from './api-client';
import { fakeApi, GROUNDED } from './api-fixture';

const bio = CourseId.parse('bio');

describe('ApiClient', () => {
  it('reads a reply its schema accepts as ok', async () => {
    const { api, sent } = fakeApi(() => ({ status: 200, body: { courses: ['bio'] } }));
    expect(await api.courses()).toEqual({ status: 'ok', value: { courses: ['bio'] } });
    expect(sent.map(({ path, method }) => [path, method])).toEqual([['/courses', 'GET']]);
  });

  it('reads a model-failed ask reply as ok, whatever its HTTP status', async () => {
    const { api } = fakeApi(() => ({ status: 502, body: { status: 'model-failed' } }));
    expect(await api.ask(bio, 'Why?')).toEqual({ status: 'ok', value: { status: 'model-failed' } });
  });

  it('reads a refusal body as refused', async () => {
    const refusal = { status: 'question-over-length', maxInputTokens: 512 };
    const { api } = fakeApi(() => ({ status: 422, body: refusal }));
    expect(await api.ask(bio, 'Why?')).toEqual({ status: 'refused', refusal });
  });

  it('reads a body neither schema accepts, and a body that is not JSON, as malformed', async () => {
    const { api } = fakeApi(() => ({ status: 200, body: { courses: [1] } }));
    expect(await api.courses()).toEqual({ status: 'malformed' });
    const text = new ApiClient(() => Promise.resolve(new Response('<html>', { status: 200 })));
    expect(await text.courses()).toEqual({ status: 'malformed' });
  });

  it('reads a fetch that found no server as unreachable, and lets any other throw through', async () => {
    const down = new ApiClient(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await down.ingestStatus(bio)).toEqual({ status: 'unreachable' });
    const broken = new ApiClient(() => Promise.reject(new RangeError('bug')));
    await expect(broken.ingestStatus(bio)).rejects.toThrow('bug');
  });

  it('asks with a JSON body naming the question, at the course’s ask route', async () => {
    const { api, sent } = fakeApi(() => ({ status: 200, body: GROUNDED }));
    await api.ask(bio, 'Are drones male?');
    expect(sent[0]?.path).toBe('/courses/bio/ask');
    expect(sent[0]?.method).toBe('POST');
    expect(sent[0]?.contentType).toBe('application/json');
    expect(sent[0]?.body).toBe('{"question":"Are drones male?"}');
  });

  it('dismisses a rebuild report with a DELETE naming its revision at the course’s rebuild-report route', async () => {
    const { api, sent } = fakeApi(() => ({ status: 200, body: { status: 'dismissed' } }));
    const revision = RebuildReportRevision.parse('ab'.repeat(32));
    expect(await api.dismissRebuildReport(bio, revision)).toEqual({
      status: 'ok',
      value: { status: 'dismissed' },
    });
    expect(sent.map(({ path, method }) => [path, method])).toEqual([
      [`/courses/bio/rebuild-report?revision=${'ab'.repeat(32)}`, 'DELETE'],
    ]);
  });

  it('uploads the file as the body, naming its lecture and file name and its media type', async () => {
    const upload = {
      uploadId: 'u1',
      lectureId: 'lecture 4',
      fileName: 'lecture 4.pdf',
      progress: { state: 'queued' },
    };
    const { api, sent } = fakeApi(() => ({ status: 202, body: upload }));
    const file = new File(['%PDF'], 'lecture 4.pdf');
    const deck = { file, lectureId: LectureId.parse('lecture 4'), mediaType: undefined };
    expect((await api.uploadDeck(bio, deck)).status).toBe('ok');
    expect(sent[0]?.path).toBe('/courses/bio/decks?lectureId=lecture+4&fileName=lecture+4.pdf');
    expect(sent[0]?.body).toBe('%PDF');
    expect(sent[0]?.contentType).toBe('');
    await api.uploadDeck(bio, { ...deck, mediaType: 'application/pdf' });
    expect(sent[1]?.contentType).toBe('application/pdf');
  });
});
