import { describe, expect, it } from 'vitest';

import bn from '../../../messages/bn.json';
import en from '../../../messages/en.json';

import {
  AppApiError,
  ERROR_MESSAGE_KEY,
  errorMessageKey,
  isApiErrorBody,
  isAppApiError,
  SYNTHETIC_ERRORS,
  toAppApiError,
} from './errors';

/**
 * Locks down the error layer: envelope parsing, the status-class getters that
 * drive retry/refresh decisions, and the code -> message-key catalogue.
 *
 * The catalogue half is the important one. `errorMessageKey()` promises "no user
 * ever sees a raw code", so every code the backend can emit must resolve to a
 * string that actually exists in BOTH catalogs. That is asserted here, not
 * assumed.
 *
 * (backend-এর প্রতিটি error code-এর en+bn message থাকতে হবে — নইলে UI-তে কাঁচা code দেখাবে।)
 */

const envelope = {
  error: 'POST_NOT_FOUND',
  status: 404,
  detail: { post_id: 5 },
  path: '/api/v1/posts/5',
  request_id: 'req-123',
};

describe('AppApiError', () => {
  it('copies every envelope field and uses the code as the message', () => {
    const error = new AppApiError(envelope);

    expect(error.name).toBe('AppApiError');
    expect(error.message).toBe('POST_NOT_FOUND');
    expect(error.code).toBe('POST_NOT_FOUND');
    expect(error.status).toBe(404);
    expect(error.detail).toEqual({ post_id: 5 });
    expect(error.path).toBe('/api/v1/posts/5');
    expect(error.requestId).toBe('req-123');
    expect(error).toBeInstanceOf(Error);
  });

  it('classifies 401 as unauthorized and never as transient', () => {
    const error = new AppApiError({ ...envelope, error: 'UNAUTHORIZED', status: 401 });

    expect(error.isUnauthorized).toBe(true);
    expect(error.isClientError).toBe(true);
    expect(error.isTransient).toBe(false);
  });

  it('classifies 422 as a client error, not an auth failure', () => {
    const error = new AppApiError({ ...envelope, error: 'VALIDATION_ERROR', status: 422 });

    expect(error.isUnauthorized).toBe(false);
    expect(error.isClientError).toBe(true);
    expect(error.isTransient).toBe(false);
  });

  it('classifies 5xx and transport failures (status 0) as transient', () => {
    expect(new AppApiError({ ...envelope, status: 503 }).isTransient).toBe(true);
    expect(new AppApiError({ ...envelope, status: 500 }).isTransient).toBe(true);
    expect(new AppApiError({ ...envelope, status: 0 }).isTransient).toBe(true);
    expect(new AppApiError({ ...envelope, status: 0 }).isClientError).toBe(false);
  });
});

describe('isApiErrorBody', () => {
  it('accepts a real envelope', () => {
    expect(isApiErrorBody(envelope)).toBe(true);
  });

  it('rejects everything that is not an envelope', () => {
    expect(isApiErrorBody(null)).toBe(false);
    expect(isApiErrorBody(undefined)).toBe(false);
    expect(isApiErrorBody('UNAUTHORIZED')).toBe(false);
    expect(isApiErrorBody(401)).toBe(false);
    expect(isApiErrorBody([])).toBe(false);
    expect(isApiErrorBody({})).toBe(false);
    expect(isApiErrorBody({ error: 'X' })).toBe(false);
    expect(isApiErrorBody({ error: '', status: 400 })).toBe(false);
    expect(isApiErrorBody({ error: 'X', status: '400' })).toBe(false);
  });
});

describe('toAppApiError', () => {
  it('returns an existing AppApiError unchanged', () => {
    const original = new AppApiError(envelope);
    expect(toAppApiError(original)).toBe(original);
  });

  it('wraps a JSON envelope', () => {
    const error = toAppApiError(envelope);
    expect(error).toBeInstanceOf(AppApiError);
    expect(error.code).toBe('POST_NOT_FOUND');
    expect(error.requestId).toBe('req-123');
  });

  it('turns a non-JSON Response into UNEXPECTED_ERROR and keeps the request id header', () => {
    const response = new Response('<html>bad gateway</html>', {
      status: 502,
      statusText: 'Bad Gateway',
      headers: { 'x-request-id': 'edge-42' },
    });

    const error = toAppApiError(response, '/api/v1/feed/home');

    expect(error.code).toBe(SYNTHETIC_ERRORS.unexpected);
    expect(error.status).toBe(502);
    expect(error.path).toBe('/api/v1/feed/home');
    expect(error.requestId).toBe('edge-42');
    expect(error.isTransient).toBe(true);
  });

  it('turns a thrown Error into NETWORK_ERROR with status 0', () => {
    const error = toAppApiError(new TypeError('Failed to fetch'), '/api/v1/users/me');

    expect(error.code).toBe(SYNTHETIC_ERRORS.network);
    expect(error.status).toBe(0);
    expect(error.path).toBe('/api/v1/users/me');
    expect(error.detail).toBe('Failed to fetch');
    expect(error.requestId).toBeNull();
    expect(error.isTransient).toBe(true);
    expect(isAppApiError(error)).toBe(true);
  });
});

describe('errorMessageKey', () => {
  it('maps a known code to its catalog key', () => {
    expect(errorMessageKey(new AppApiError(envelope))).toBe('errors.postNotFound');
    expect(
      errorMessageKey(new AppApiError({ ...envelope, error: 'INVALID_CREDENTIALS', status: 401 })),
    ).toBe('errors.invalidCredentials');
  });

  it('maps a raw envelope object without constructing an AppApiError first', () => {
    expect(errorMessageKey(envelope)).toBe('errors.postNotFound');
  });

  it('falls back to the status class for an unmapped code', () => {
    const unknown = (status: number) =>
      errorMessageKey({ ...envelope, error: 'SOMETHING_NEW', status });

    expect(unknown(404)).toBe('errors.notFound');
    expect(unknown(403)).toBe('errors.forbidden');
    expect(unknown(409)).toBe('errors.conflict');
    expect(unknown(429)).toBe('errors.rateLimited');
    expect(unknown(422)).toBe('errors.validationError');
    expect(unknown(418)).toBe('errors.badRequest');
    expect(unknown(500)).toBe('errors.unexpectedError');
    expect(unknown(0)).toBe('errors.unexpectedError');
  });
});

describe('error catalogue covers the backend', () => {
  const enErrors: Record<string, string> = en.errors;
  const bnErrors: Record<string, string> = bn.errors;
  const messageKeys = new Set<string>(Object.values(ERROR_MESSAGE_KEY));

  it('declares all 68 backend codes plus the 2 synthetic ones', () => {
    // 66 unique codes from src/social_api/**/exceptions.py
    //  + APP_ERROR and INVALID_IDEMPOTENCY_KEY (declared outside the pattern)
    //  + NETWORK_ERROR and UNEXPECTED_ERROR (synthetic, never sent by the server)
    expect(Object.keys(ERROR_MESSAGE_KEY)).toHaveLength(70);
  });

  it('has an English message for every code', () => {
    for (const key of messageKeys) expect(enErrors).toHaveProperty(key);
  });

  it('has a Bengali message for every code', () => {
    for (const key of messageKeys) expect(bnErrors).toHaveProperty(key);
  });

  it('keeps en and bn in exact key parity', () => {
    expect(Object.keys(bnErrors).sort()).toEqual(Object.keys(enErrors).sort());
  });

  it('carries no unused strings in the catalog', () => {
    expect(Object.keys(enErrors).sort()).toEqual([...messageKeys].sort());
  });

  it('actually translates every message to Bengali', () => {
    const untranslated = [...messageKeys].filter((key) => bnErrors[key] === enErrors[key]);
    expect(untranslated).toEqual([]);
  });

  it('never leaves an empty message', () => {
    const empty = [...messageKeys].filter(
      (key) => !enErrors[key]?.trim() || !bnErrors[key]?.trim(),
    );
    expect(empty).toEqual([]);
  });
});
