import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { auditLogs } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { AUDIT_ACTIONS, AUDIT_ENTITIES, getAuditLog } from './audit';
import { AppApiError } from './errors';

/**
 * The admin audit trail client.
 *
 * Three contract facts are pinned:
 *
 *  - the first page sends NO cursor, and an opaque one round-trips untouched;
 *  - `action` and `entity` are enum filters the SERVER applies, so the mock
 *    slices the filtered list — a short page must never mean "the filter lied";
 *  - `actor_id` is the one filter that is a number, and it is sent as
 *    `actor_id` (snake_case, matching the contract) rather than `actorId`.
 *
 * `before`/`after` are already PII-redacted at write time, so this layer passes
 * them through untouched instead of second-guessing their shape.
 *
 * (ফিল্টার সার্ভারে প্রয়োগ হয়; cursor প্রথম পাতায় যায় না।)
 */

const AUDIT_PATH = '*/api/v1/audit';

function errorBody(error: string, status: number, path: string): ApiErrorBody {
  return { error, status, detail: 'test', path, request_id: 'req-1' };
}

describe('getAuditLog', () => {
  it('returns the trail from the shared fixture', async () => {
    const page = await getAuditLog();

    expect(page.items.map((log) => log.id)).toEqual(auditLogs.map((log) => log.id));
    expect(page.next_cursor).toBeNull();
  });

  it('omits the cursor and both filters on the first page', async () => {
    let search = '';
    server.use(
      http.get(AUDIT_PATH, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
    );

    await getAuditLog({ limit: 5 });

    const params = new URLSearchParams(search);
    expect(params.get('limit')).toBe('5');
    // A `cursor=null` would be forwarded as the string "null", and
    // `action=null` would filter on an action that does not exist.
    expect(params.has('cursor')).toBe(false);
    expect(params.has('action')).toBe(false);
    expect(params.has('entity')).toBe(false);
    expect(params.has('actor_id')).toBe(false);
  });

  it('sends `action` under its contract name', async () => {
    let action: string | null = null;
    server.use(
      http.get(AUDIT_PATH, ({ request }) => {
        action = new URL(request.url).searchParams.get('action');
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
    );

    await getAuditLog({ action: 'PROFILE_UPDATE' });

    expect(action).toBe('PROFILE_UPDATE');
  });

  it('sends `actor_id`, not `actorId`', async () => {
    let actorId: string | null = null;
    server.use(
      http.get(AUDIT_PATH, ({ request }) => {
        actorId = new URL(request.url).searchParams.get('actor_id');
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
    );

    await getAuditLog({ actorId: 21 });

    expect(actorId).toBe('21');
  });

  it('honours the entity filter server-side', async () => {
    const page = await getAuditLog({ entity: 'report' });

    expect(page.items).toHaveLength(auditLogs.filter((log) => log.entity === 'report').length);
    expect(page.items.every((log) => log.entity === 'report')).toBe(true);
  });

  it('passes an opaque cursor back verbatim', async () => {
    const page = await getAuditLog({ cursor: '1', limit: 1 });

    // The fixture holds three rows, so starting at offset 1 must skip the first.
    expect(page.items.map((log) => log.id)).toEqual(auditLogs.slice(1, 2).map((log) => log.id));
    expect(page.next_cursor).toBe('2');
  });

  it('carries redacted payloads through unchanged', async () => {
    const page = await getAuditLog();
    const withDiff = page.items.find((log) => log.before !== null && log.after !== null);

    // The client must not reshape machine data: whatever the server redacted and
    // stored is exactly what the screen renders.
    expect(withDiff?.before).toEqual({ status: 'under_review' });
    expect(withDiff?.after).toEqual({ status: 'resolved' });
  });

  it('normalises an admin-only refusal into an AppApiError', async () => {
    server.use(
      http.get(AUDIT_PATH, () =>
        HttpResponse.json(errorBody('AUDIT_FORBIDDEN', 403, '/api/v1/audit'), { status: 403 }),
      ),
    );

    const error = await getAuditLog().catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    expect(error.code).toBe('AUDIT_FORBIDDEN');
    // The endpoint is admin-only and the frontend cannot know the caller's role,
    // so 403 is expected — it must settle in one request, never a retry storm.
    expect(error.isClientError).toBe(true);
  });
});

// The two tuples build the filter selects, so a value the backend writes that
// is missing here would silently become unfilterable. `tests/unit/
// test_audit_filters.py` proves the backend pair is exactly what the services
// emit; these checks keep the frontend copy from falling behind it.
describe('filter tuples', () => {
  it('lists every action the backend can record', () => {
    expect(AUDIT_ACTIONS).toContain('MODERATION_STATUS_UPDATE');
    expect(AUDIT_ACTIONS).toContain('DELETE_CHAT_MESSAGE');
    // The fixture's rows must all be selectable, or the filter would hide them.
    for (const log of auditLogs) {
      expect(AUDIT_ACTIONS).toContain(log.action);
      expect(AUDIT_ENTITIES).toContain(log.entity);
    }
  });

  it('covers the auth lifecycle, not just CRUD', () => {
    // Registration and sign-in are the busiest write sites in the app; leaving
    // them out of the tuple would make the dropdown blind to most traffic.
    for (const action of [
      'REGISTER',
      'LOGIN',
      'LOGOUT',
      'VERIFY_EMAIL',
      'PASSWORD_RESET_REQUESTED',
      'PASSWORD_RESET_COMPLETED',
      'PASSWORD_CHANGED',
    ]) {
      expect(AUDIT_ACTIONS).toContain(action);
    }
  });

  it('covers user, GDPR, flag and retention events', () => {
    for (const action of [
      'PROFILE_UPDATE',
      'CONSENT_GRANTED',
      'CONSENT_REVOKED',
      'USER_SOFT_DELETE',
      'GDPR_DELETE_SCHEDULED',
      'GDPR_DELETE_CANCELLED',
      'FEATURE_FLAG_OVERRIDE',
      'USER_HARD_DELETED',
      'RETENTION_NOTIFICATIONS_PURGED',
      'RETENTION_AUDIT_PURGED',
      'RETENTION_ORPHAN_MEDIA_PURGED',
      'RETENTION_MESSAGES_PURGED',
    ]) {
      expect(AUDIT_ACTIONS).toContain(action);
    }
  });

  it('covers every chat operation the service audits', () => {
    for (const action of [
      'CREATE_CHAT_GROUP',
      'UPDATE_CHAT_GROUP_TITLE',
      'ADD_CHAT_MEMBER',
      'REMOVE_CHAT_MEMBER',
      'DELETE_CHAT_MESSAGE',
    ]) {
      expect(AUDIT_ACTIONS).toContain(action);
    }
  });

  it('lists every entity an audit row can point at', () => {
    // `notification`, `audit_log` and `media` were written but unreachable
    // before the enum was widened, so they are asserted explicitly.
    for (const entity of [
      'user',
      'profile',
      'post',
      'comment',
      'message',
      'chat_room',
      'report',
      'notification',
      'audit_log',
      'media',
    ]) {
      expect(AUDIT_ENTITIES).toContain(entity);
    }
  });

  it('has no duplicate entries', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
    expect(new Set(AUDIT_ENTITIES).size).toBe(AUDIT_ENTITIES.length);
  });
});
