import {
  ApiRefusal,
  AskReply,
  type CourseId,
  CourseList,
  type DeckMediaType,
  IngestStatus,
  type LectureId,
  Upload,
} from '@cram/shared';
import type { z } from 'zod';
import type { ApiResult } from './api-result';

export type Fetch = (request: Request) => Promise<Response>;

export interface DeckUpload {
  readonly lectureId: LectureId;
  readonly mediaType: DeckMediaType | undefined;
  readonly file: File;
}

/** A body is the success schema's, else a refusal's; the two vocabularies share no `status`. */
const parsedBody = async <T>(response: Response, schema: z.ZodType<T>): Promise<ApiResult<T>> => {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: 'malformed' };
  }
  const value = schema.safeParse(body);
  if (value.success) return { status: 'ok', value: value.data };
  const refusal = ApiRefusal.safeParse(body);
  return refusal.success ? { status: 'refused', refusal: refusal.data } : { status: 'malformed' };
};

/** The server's API, same-origin (`apps/server/src/routes.ts`). Every reply is parsed before use. */
export class ApiClient {
  readonly #fetch: Fetch;

  constructor(fetchFn: Fetch) {
    this.#fetch = fetchFn;
  }

  /**
   * The request is built before the `try`, so a malformed one throws as the bug it is; past that,
   * `fetch` rejects with a `TypeError` only when the round trip failed (`docs/standards/error-handling.md` rule 2).
   */
  async #call<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<ApiResult<T>> {
    const request = new Request(new URL(path, document.baseURI), init);
    let response: Response;
    try {
      response = await this.#fetch(request);
    } catch (error) {
      if (error instanceof TypeError) return { status: 'unreachable' };
      throw error;
    }
    return parsedBody(response, schema);
  }

  courses(): Promise<ApiResult<CourseList>> {
    return this.#call('/courses', { method: 'GET' }, CourseList);
  }

  ingestStatus(courseId: CourseId): Promise<ApiResult<IngestStatus>> {
    return this.#call(`/courses/${courseId}/ingest`, { method: 'GET' }, IngestStatus);
  }

  uploadDeck(courseId: CourseId, deck: DeckUpload): Promise<ApiResult<Upload>> {
    const query = new URLSearchParams({ lectureId: deck.lectureId, fileName: deck.file.name });
    const headers = { 'content-type': deck.mediaType ?? deck.file.type };
    return this.#call(
      `/courses/${courseId}/decks?${query.toString()}`,
      { method: 'POST', headers, body: deck.file },
      Upload,
    );
  }

  ask(courseId: CourseId, question: string): Promise<ApiResult<AskReply>> {
    return this.#call(
      `/courses/${courseId}/ask`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question }),
      },
      AskReply,
    );
  }
}
