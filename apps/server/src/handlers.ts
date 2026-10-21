import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  AskRequest,
  type CourseId,
  type CourseList,
  DeckMediaType,
  type IngestStatus,
  LectureId,
  NonBlankText,
  RouteCourseId,
} from '@cram/shared';
import { z } from 'zod';
import { type AskDeps, askCourse } from './ask-course';
import { courseExists, storedCourses, storedLectures } from './course-file';
import { readBody, sendJson, sendRefusal } from './http-body';
import type { IngestQueue } from './ingest-queue';

/** Ceilings on what one request may send; a deck is a whole lecture, a question is a sentence or two. */
export const MAX_DECK_BYTES = 256 * 1024 * 1024;
export const MAX_ASK_BYTES = 64 * 1024;

export interface HandlerContext extends AskDeps {
  readonly queue: IngestQueue;
}

export interface RouteRequest {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly url: URL;
  readonly courseSegment: string;
}

const badRequest = (response: ServerResponse, issue: string): void => {
  sendRefusal(response, 400, { status: 'bad-request', issue });
};

const mediaTypeOf = (request: IncomingMessage): string =>
  (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';

const courseIdOf = ({ response, courseSegment }: RouteRequest): CourseId | undefined => {
  const parsed = RouteCourseId.safeParse(courseSegment);
  if (parsed.success) return parsed.data;
  badRequest(response, `course id: ${z.prettifyError(parsed.error)}`);
  return undefined;
};

const UploadParams = z.object({ lectureId: LectureId, fileName: NonBlankText });

export const uploadDeck = async (route: RouteRequest, context: HandlerContext): Promise<void> => {
  const { request, response, url } = route;
  const courseId = courseIdOf(route);
  if (courseId === undefined) return;
  const params = UploadParams.safeParse(Object.fromEntries(url.searchParams));
  if (!params.success) {
    badRequest(response, z.prettifyError(params.error));
    return;
  }
  const mediaType = DeckMediaType.safeParse(mediaTypeOf(request));
  if (!mediaType.success) {
    sendRefusal(response, 415, { status: 'unsupported-media-type' });
    return;
  }
  const body = await readBody(request, MAX_DECK_BYTES);
  if (body.status === 'too-large') {
    sendRefusal(response, 413, { status: 'payload-too-large' });
    return;
  }
  if (body.bytes.length === 0) {
    badRequest(response, 'the deck is empty');
    return;
  }
  const upload = context.queue.enqueue({
    courseId,
    ...params.data,
    mediaType: mediaType.data,
    bytes: body.bytes,
  });
  sendJson(response, 202, upload);
};

export const listCourses = (response: ServerResponse, context: HandlerContext): void => {
  const ids = new Set([...storedCourses(context.files), ...context.queue.courseIds()]);
  const list: CourseList = { courses: [...ids].sort() };
  sendJson(response, 200, list);
};

export const ingestStatus = (route: RouteRequest, context: HandlerContext): void => {
  const courseId = courseIdOf(route);
  if (courseId === undefined) return;
  const uploads = context.queue.uploads(courseId);
  if (uploads.length === 0 && !courseExists(context.files, courseId)) {
    sendRefusal(route.response, 404, { status: 'no-such-course' });
    return;
  }
  const status: IngestStatus = {
    courseId,
    stored: storedLectures(context.files, courseId),
    uploads: [...uploads],
  };
  sendJson(route.response, 200, status);
};

const parsedJson = (bytes: Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
};

/** JSON only, so a cross-site form post cannot reach it: a form cannot send `application/json`. */
export const askQuestion = async (route: RouteRequest, context: HandlerContext): Promise<void> => {
  const { request, response } = route;
  const courseId = courseIdOf(route);
  if (courseId === undefined) return;
  if (mediaTypeOf(request) !== 'application/json') {
    sendRefusal(response, 415, { status: 'unsupported-media-type' });
    return;
  }
  const body = await readBody(request, MAX_ASK_BYTES);
  if (body.status === 'too-large') {
    sendRefusal(response, 413, { status: 'payload-too-large' });
    return;
  }
  const parsed = AskRequest.safeParse(parsedJson(body.bytes));
  if (!parsed.success) {
    badRequest(response, z.prettifyError(parsed.error));
    return;
  }
  const outcome = await askCourse(courseId, parsed.data.question, context);
  switch (outcome.status) {
    case 'no-such-course':
      sendRefusal(response, 404, { status: 'no-such-course' });
      return;
    case 'question-over-length':
      sendRefusal(response, 422, outcome);
      return;
    case 'course-unavailable':
      sendRefusal(response, 409, { status: 'course-unavailable', problem: outcome.problem });
      return;
    case 'replied':
      sendJson(response, outcome.reply.status === 'model-failed' ? 502 : 200, outcome.reply);
  }
};
