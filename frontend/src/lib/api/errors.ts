import type { ApiErrorBody } from '@/types';

/**
 * The one error type every data-layer failure becomes.
 *
 * Backend envelopes come from `social_api/exceptions.py::_error_body`:
 * `{ error, status, detail, path, request_id }`. Two synthetic codes cover the
 * failures that never produce a JSON envelope: `NETWORK_ERROR` (fetch threw /
 * offline) and `UNEXPECTED_ERROR` (non-JSON body, proxy HTML, etc.).
 *
 * (`detail` is typed `unknown` on purpose — it is machine data, never copy.)
 */

export const SYNTHETIC_ERRORS = {
  network: 'NETWORK_ERROR',
  unexpected: 'UNEXPECTED_ERROR',
} as const;

export class AppApiError extends Error {
  /** Stable backend error code, e.g. `INVALID_CREDENTIALS`. */
  readonly code: string;
  /** HTTP status, or `0` when the request never reached the server. */
  readonly status: number;
  /** Raw `detail` from the envelope — machine data, do not render. */
  readonly detail: unknown;
  /** Request path from the envelope, or the URL we tried to call. */
  readonly path: string;
  /** Correlates a user report with a backend log line. */
  readonly requestId: string | null;

  constructor(body: ApiErrorBody) {
    super(body.error);
    this.name = 'AppApiError';
    this.code = body.error;
    this.status = body.status;
    this.detail = body.detail;
    this.path = body.path;
    this.requestId = body.request_id;
  }

  /** 401 — worth one refresh-and-retry, then give up. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** 4xx — retrying the same call cannot help. */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  /** 5xx or transport failure — the operation may succeed later. */
  get isTransient(): boolean {
    return this.status >= 500 || this.status === 0;
  }
}

export function isAppApiError(value: unknown): value is AppApiError {
  return value instanceof AppApiError;
}

/** Runtime guard for the error envelope; the OpenAPI schema does not describe it. */
export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Record<keyof ApiErrorBody, unknown>>;
  return (
    typeof candidate.error === 'string' &&
    candidate.error.length > 0 &&
    typeof candidate.status === 'number'
  );
}

/**
 * Normalise anything thrown by the client into an `AppApiError`.
 * `requestPath` is only used when the server did not tell us the path itself.
 */
export function toAppApiError(error: unknown, requestPath = ''): AppApiError {
  if (isAppApiError(error)) return error;

  if (isApiErrorBody(error)) return new AppApiError(error);

  if (typeof Response !== 'undefined' && error instanceof Response) {
    return new AppApiError({
      error: SYNTHETIC_ERRORS.unexpected,
      status: error.status,
      detail: error.statusText,
      path: requestPath,
      request_id: error.headers.get('x-request-id'),
    });
  }

  // A transport failure: offline, DNS, CORS preflight rejection, aborted fetch.
  return new AppApiError({
    error: SYNTHETIC_ERRORS.network,
    status: 0,
    detail: error instanceof Error ? error.message : String(error),
    path: requestPath,
    request_id: null,
  });
}

/**
 * Error code -> i18n message key. Keys live under the `errors` namespace in
 * `messages/{en,bn}.json`; every code declared under `src/social_api/…` in the
 * exception modules has an entry, so no user ever sees a raw code.
 */
export const ERROR_MESSAGE_KEY = {
  // core/social_api/exceptions.py
  APP_ERROR: 'appError',
  BAD_REQUEST: 'badRequest',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'notFound',
  CONFLICT: 'conflict',
  RATE_LIMITED: 'rateLimited',
  INTERNAL_ERROR: 'internalError',
  SERVICE_UNAVAILABLE: 'serviceUnavailable',
  VALIDATION_ERROR: 'validationError',
  INVALID_IDEMPOTENCY_KEY: 'invalidIdempotencyKey',
  // modules/auth
  INVALID_CREDENTIALS: 'invalidCredentials',
  EMAIL_ALREADY_REGISTERED: 'emailAlreadyRegistered',
  INACTIVE_USER: 'inactiveUser',
  EMAIL_NOT_VERIFIED: 'emailNotVerified',
  INVALID_TOKEN: 'invalidToken',
  TOKEN_REVOKED: 'tokenRevoked',
  // modules/users
  PROFILE_NOT_FOUND: 'profileNotFound',
  PROFILE_NOT_VISIBLE: 'profileNotVisible',
  VERSION_CONFLICT: 'versionConflict',
  CONSENT_NOT_FOUND: 'consentNotFound',
  CANNOT_MODIFY_SELF: 'cannotModifySelf',
  LAST_ADMIN_PROTECTED: 'lastAdminProtected',
  EMPTY_UPDATE: 'emptyUpdate',
  ALREADY_VERIFIED: 'alreadyVerified',
  // modules/posts
  POST_NOT_FOUND: 'postNotFound',
  COMMENT_NOT_FOUND: 'commentNotFound',
  POST_FORBIDDEN: 'postForbidden',
  COMMENT_FORBIDDEN: 'commentForbidden',
  COMMENT_DEPTH_EXCEEDED: 'commentDepthExceeded',
  LIKE_TARGET_NOT_FOUND: 'likeTargetNotFound',
  // modules/chat
  CHAT_ROOM_NOT_FOUND: 'chatRoomNotFound',
  CHAT_ROOM_FORBIDDEN: 'chatRoomForbidden',
  CANNOT_CHAT_WITH_SELF: 'cannotChatWithSelf',
  CHAT_BLOCKED: 'chatBlocked',
  MESSAGE_NOT_FOUND: 'messageNotFound',
  MESSAGE_FORBIDDEN: 'messageForbidden',
  READ_RECEIPT_INVALID: 'readReceiptInvalid',
  GROUP_CHAT_NOT_ALLOWED: 'groupChatNotAllowed',
  DIRECT_CHAT_NOT_ALLOWED: 'directChatNotAllowed',
  ADMIN_REQUIRED: 'adminRequired',
  LAST_ADMIN_CANNOT_LEAVE: 'lastAdminCannotLeave',
  ALREADY_MEMBER: 'alreadyMember',
  MEDIA_NOT_OWNED: 'mediaNotOwned',
  MEDIA_ALREADY_USED: 'mediaAlreadyUsed',
  // modules/audit
  AUDIT_FORBIDDEN: 'auditForbidden',
  // modules/gdpr
  ALREADY_SCHEDULED_FOR_DELETION: 'alreadyScheduledForDeletion',
  NO_ACTIVE_DELETION: 'noActiveDeletion',
  // modules/follows
  CANNOT_FOLLOW_SELF: 'cannotFollowSelf',
  USER_BLOCKED: 'userBlocked',
  FOLLOW_TARGET_NOT_FOUND: 'followTargetNotFound',
  // modules/feed
  FEED_UNAVAILABLE: 'feedUnavailable',
  // modules/notifications
  NOTIFICATION_NOT_FOUND: 'notificationNotFound',
  NOTIFICATION_FORBIDDEN: 'notificationForbidden',
  // modules/idempotency
  IDEMPOTENCY_KEY_CONFLICT: 'idempotencyKeyConflict',
  IDEMPOTENCY_KEY_IN_PROGRESS: 'idempotencyKeyInProgress',
  // modules/moderation
  REPORT_NOT_FOUND: 'reportNotFound',
  REPORT_TARGET_NOT_FOUND: 'reportTargetNotFound',
  CANNOT_REPORT_SELF: 'cannotReportSelf',
  REPORT_ALREADY_EXISTS: 'reportAlreadyExists',
  REPORT_STATUS_TRANSITION: 'reportStatusTransition',
  REPORT_LOCKED: 'reportLocked',
  // modules/media
  MEDIA_NOT_FOUND: 'mediaNotFound',
  MEDIA_FORBIDDEN: 'mediaForbidden',
  UNSUPPORTED_MEDIA_TYPE: 'unsupportedMediaType',
  MEDIA_TOO_LARGE: 'mediaTooLarge',
  MEDIA_ALREADY_ATTACHED: 'mediaAlreadyAttached',
  MEDIA_VIRUS_SCAN_FAILED: 'mediaVirusScanFailed',
  // synthetic
  NETWORK_ERROR: 'networkError',
  UNEXPECTED_ERROR: 'unexpectedError',
} as const satisfies Record<string, string>;

export type ErrorCode = keyof typeof ERROR_MESSAGE_KEY;

const MESSAGE_KEYS: Record<string, string> = ERROR_MESSAGE_KEY;

/**
 * Stable i18n key for any error. Unknown codes fall back to a status-class
 * message instead of leaking the raw code into the UI.
 */
export function errorMessageKey(error: unknown): string {
  const appError = toAppApiError(error);
  const mapped = MESSAGE_KEYS[appError.code];
  if (mapped) return `errors.${mapped}`;

  if (appError.status >= 500 || appError.status === 0) return 'errors.unexpectedError';
  if (appError.isUnauthorized) return 'errors.unauthorized';
  if (appError.status === 403) return 'errors.forbidden';
  if (appError.status === 404) return 'errors.notFound';
  if (appError.status === 409) return 'errors.conflict';
  if (appError.status === 429) return 'errors.rateLimited';
  if (appError.status === 422) return 'errors.validationError';
  return 'errors.badRequest';
}
