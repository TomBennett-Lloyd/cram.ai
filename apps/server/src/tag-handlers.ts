import { LectureId, TagEdit } from '@cram/shared';
import { z } from 'zod';
import type { HandlerContext } from './handlers';
import { sendJson, sendRefusal } from './http-body';
import { badRequest, courseIdOf, jsonBody, type RouteRequest } from './route-request';
import { storedLectureSlides } from './slide-topics';

/** A chunk's tag list is a few short phrases. */
export const MAX_TAG_EDIT_BYTES = 16 * 1024;

const LectureParams = z.object({ lectureId: LectureId });

export const sendLectureSlides = (route: RouteRequest, context: HandlerContext): void => {
  const courseId = courseIdOf(route);
  if (courseId === undefined) return;
  const params = LectureParams.safeParse(Object.fromEntries(route.url.searchParams));
  if (!params.success) {
    badRequest(route.response, z.prettifyError(params.error));
    return;
  }
  const stored = storedLectureSlides(context.files, courseId, params.data.lectureId);
  switch (stored.status) {
    case 'found':
      sendJson(route.response, 200, stored.slides);
      return;
    case 'no-such-course':
      sendRefusal(route.response, 404, { status: 'no-such-course' });
      return;
    case 'no-such-lecture':
      sendRefusal(route.response, 404, { status: 'not-found' });
      return;
    case 'course-unavailable':
      sendRefusal(route.response, 409, stored);
  }
};

export const editTags = async (route: RouteRequest, context: HandlerContext): Promise<void> => {
  const courseId = courseIdOf(route);
  if (courseId === undefined) return;
  const body = await jsonBody(route, MAX_TAG_EDIT_BYTES);
  if (body.status === 'refused') return;
  const parsed = TagEdit.safeParse(body.value);
  if (!parsed.success) {
    badRequest(route.response, z.prettifyError(parsed.error));
    return;
  }
  const outcome = await context.queue.editTags(courseId, parsed.data);
  switch (outcome.status) {
    case 'edited':
      sendJson(route.response, 200, outcome.edited);
      return;
    case 'no-such-course':
      sendRefusal(route.response, 404, { status: 'no-such-course' });
      return;
    case 'no-such-fact':
      sendRefusal(route.response, 404, { status: 'not-found' });
      return;
    case 'chunk-changed':
    case 'tags-changed':
    case 'course-unavailable':
      sendRefusal(route.response, 409, outcome);
  }
};
