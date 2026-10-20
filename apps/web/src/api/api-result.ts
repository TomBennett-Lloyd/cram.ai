import type { ApiRefusal } from '@cram/shared';

/** What one call to the server came to (`docs/standards/typing.md` rule 4). */
export type ApiResult<T> =
  | { readonly status: 'ok'; readonly value: T }
  | { readonly status: 'refused'; readonly refusal: ApiRefusal }
  | { readonly status: 'unreachable' }
  | { readonly status: 'malformed' };

export type ApiFailure = Exclude<ApiResult<unknown>, { readonly status: 'ok' }>;
