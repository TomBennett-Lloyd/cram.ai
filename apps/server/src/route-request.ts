import type { IncomingMessage, ServerResponse } from 'node:http';
import { CourseId } from '@cram/shared';
import { z } from 'zod';
import { readBody, sendRefusal } from './http-body';

export interface RouteRequest {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly url: URL;
  readonly courseSegment: string;
}

export const badRequest = (response: ServerResponse, issue: string): void => {
  sendRefusal(response, 400, { status: 'bad-request', issue });
};

export const mediaTypeOf = (request: IncomingMessage): string =>
  (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';

export const courseIdOf = ({ response, courseSegment }: RouteRequest): CourseId | undefined => {
  const parsed = CourseId.safeParse(courseSegment);
  if (parsed.success) return parsed.data;
  badRequest(response, `course id: ${z.prettifyError(parsed.error)}`);
  return undefined;
};

const parsedJson = (bytes: Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
};

type JsonBody =
  { readonly status: 'parsed'; readonly value: unknown } | { readonly status: 'refused' };

/** JSON only, so a cross-site form post cannot reach it: a form cannot send `application/json`. */
export const jsonBody = async (
  { request, response }: RouteRequest,
  maxBytes: number,
): Promise<JsonBody> => {
  if (mediaTypeOf(request) !== 'application/json') {
    sendRefusal(response, 415, { status: 'unsupported-media-type' });
    return { status: 'refused' };
  }
  const body = await readBody(request, maxBytes);
  if (body.status === 'too-large') {
    sendRefusal(response, 413, { status: 'payload-too-large' });
    return { status: 'refused' };
  }
  return { status: 'parsed', value: parsedJson(body.bytes) };
};
