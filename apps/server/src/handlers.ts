import type { ServerResponse } from 'node:http';
import {
  AskRequest,
  type CourseList,
  DeckMediaType,
  type IngestStatus,
  LectureId,
  NonBlankText,
  RebuildReportRevision,
  SlideNo,
  SummaryRemakeRequest,
} from '@cram/shared';
import { z } from 'zod';
import { type AskDeps, askCourse } from './ask-course';
import {
  courseExists,
  storedCourses,
  storedLectures,
  storedSlideImage,
  storedSummaries,
} from './course-file';
import { readBody, sendBytes, sendJson, sendRefusal } from './http-body';
import type { IngestQueue } from './ingest-queue';
import { badRequest, courseIdOf, jsonBody, mediaTypeOf, type RouteRequest } from './route-request';

/** Ceilings on what one request may send; a deck is a whole lecture, a question is a sentence or two. */
export const MAX_DECK_BYTES = 256 * 1024 * 1024;
export const MAX_ASK_BYTES = 64 * 1024;
export const MAX_REMAKE_BYTES = 4 * 1024;

export interface HandlerContext extends AskDeps {
  readonly queue: IngestQueue;
}

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

/** The report the student was shown, so a later one is not dismissed unseen (#299). */
const DismissalParams = z.object({ revision: RebuildReportRevision });

export const dismissRebuildReport = async (
  route: RouteRequest,
  context: HandlerContext,
): Promise<void> => {
  const courseId = courseIdOf(route);
  if (courseId === undefined) return;
  const params = DismissalParams.safeParse(Object.fromEntries(route.url.searchParams));
  if (!params.success) {
    badRequest(route.response, z.prettifyError(params.error));
    return;
  }
  const dismissal = await context.queue.dismissRebuildReport(courseId, params.data.revision);
  switch (dismissal.status) {
    case 'dismissed':
      sendJson(route.response, 200, dismissal);
      return;
    case 'no-such-course':
      sendRefusal(route.response, 404, dismissal);
      return;
    case 'course-unavailable':
    case 'report-changed':
      sendRefusal(route.response, 409, dismissal);
  }
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
    repair: context.queue.repairOf(courseId),
    uploads: [...uploads],
    remakes: [...context.queue.remakes(courseId)],
  };
  sendJson(route.response, 200, status);
};

export const courseSummaries = (route: RouteRequest, context: HandlerContext): void => {
  const courseId = courseIdOf(route);
  if (courseId === undefined) return;
  if (!courseExists(context.files, courseId)) {
    sendRefusal(route.response, 404, { status: 'no-such-course' });
    return;
  }
  const summaries = storedSummaries(context.files, courseId);
  if (summaries.state === 'course-unavailable')
    sendRefusal(route.response, 409, { status: 'course-unavailable', problem: summaries.problem });
  else sendJson(route.response, 200, summaries);
};

const SlideNoParam = z
  .string()
  .regex(/^[1-9][0-9]*$/, 'a page number counted from 1')
  .transform(Number)
  .pipe(SlideNo);

const SlideImageParams = z.object({ lectureId: LectureId, slideNo: SlideNoParam });

export const sendSlideImage = (route: RouteRequest, context: HandlerContext): void => {
  const courseId = courseIdOf(route);
  if (courseId === undefined) return;
  const params = SlideImageParams.safeParse(Object.fromEntries(route.url.searchParams));
  if (!params.success) {
    badRequest(route.response, z.prettifyError(params.error));
    return;
  }
  const { lectureId, slideNo } = params.data;
  const stored = storedSlideImage(context.files, courseId, lectureId, slideNo);
  switch (stored.status) {
    case 'found':
      sendBytes(route.response, stored.image.mediaType, stored.image.content);
      return;
    case 'no-such-course':
      sendRefusal(route.response, 404, stored);
      return;
    case 'no-such-image':
      sendRefusal(route.response, 404, { status: 'not-found' });
      return;
    case 'course-unavailable':
      sendRefusal(route.response, 409, stored);
  }
};

export const remakeSummary = async (
  route: RouteRequest,
  context: HandlerContext,
): Promise<void> => {
  const courseId = courseIdOf(route);
  if (courseId === undefined) return;
  const body = await jsonBody(route, MAX_REMAKE_BYTES);
  if (body.status === 'refused') return;
  const parsed = SummaryRemakeRequest.safeParse(body.value);
  if (!parsed.success) {
    badRequest(route.response, z.prettifyError(parsed.error));
    return;
  }
  if (!courseExists(context.files, courseId)) {
    sendRefusal(route.response, 404, { status: 'no-such-course' });
    return;
  }
  const stored = storedLectures(context.files, courseId);
  if (stored.state === 'course-unavailable') {
    sendRefusal(route.response, 409, { status: 'course-unavailable', problem: stored.problem });
    return;
  }
  const { lectureId } = parsed.data;
  if (!stored.lectures.some((lecture) => lecture.lectureId === lectureId)) {
    sendRefusal(route.response, 404, { status: 'not-found' });
    return;
  }
  sendJson(route.response, 202, context.queue.remake(courseId, lectureId));
};

export const askQuestion = async (route: RouteRequest, context: HandlerContext): Promise<void> => {
  const { response } = route;
  const courseId = courseIdOf(route);
  if (courseId === undefined) return;
  const body = await jsonBody(route, MAX_ASK_BYTES);
  if (body.status === 'refused') return;
  const parsed = AskRequest.safeParse(body.value);
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
