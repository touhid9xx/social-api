/**
 * App-level helper types. API request/response shapes are NEVER hand-written
 * here — they live in `src/types/api.d.ts`, generated from the backend
 * OpenAPI contract via `pnpm gen-types`. The one exception is `ApiErrorBody`:
 * the backend's error envelope is produced by an exception handler, so it is
 * absent from the OpenAPI schema and has to be mirrored by hand.
 */

export type Nullable<T> = T | null;

/** The cursor envelope every backend list endpoint returns. */
export type ListEnvelope<T> = {
  items: T[];
  next_cursor: Nullable<string>;
  cache_hit?: boolean;
};

/**
 * Shape of every non-2xx JSON body, from `social_api/exceptions.py::_error_body`.
 * `detail` is `unknown` on purpose — never render it raw to a user.
 */
export type ApiErrorBody = {
  error: string;
  status: number;
  detail: unknown;
  path: string;
  request_id: string | null;
};
