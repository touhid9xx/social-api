import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import type { components } from '@/types/api';

import { apiClient, apiRequest } from './client';

/**
 * Audit trail — [contracts/api_reference.md:17].
 *
 * `GET /audit` is admin-only (`require_roles(ADMIN)`); `GET /audit/me` is the
 * caller's own trail and is what `queryKeys.audit.mine` exists for. Both return
 * the same page shape, so the same list component can serve either — this
 * module only exposes the admin one until a screen needs the personal trail.
 *
 * `before`/`after` are already PII-redacted at write time
 * (`social_api.modules.audit.service.redact_payload`), so rendering them is
 * safe; they are still machine data, not copy, and the UI shows them as a
 * collapsible JSON blob rather than sentences.
 *
 * The `action` and `entity` query values are enums in the contract; they live
 * here as literal tuples so the filter selects are exhaustive by construction.
 */

export type AuditLogView = components['schemas']['AuditLogView'];

export type AuditPage = components['schemas']['AuditPage'];

/**
 * Mirrors `AuditActionLiteral` in `social_api/modules/audit/router.py`.
 * The backend rejects any other value with 422, so this tuple must stay a
 * superset-equal copy: an action written by a service but missing here is
 * unreachable through the filter select. Grouped the same way as the router
 * literals so the two are diffable by eye.
 */
export const AUDIT_ACTIONS = [
  // auth
  'REGISTER',
  'LOGIN',
  'LOGOUT',
  'VERIFY_EMAIL',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET_COMPLETED',
  'PASSWORD_CHANGED',
  // users
  'PROFILE_UPDATE',
  'CONSENT_GRANTED',
  'CONSENT_REVOKED',
  'USER_SOFT_DELETE',
  // posts
  'DELETE_POST',
  // comments
  'DELETE_COMMENT',
  // follows
  'BLOCK',
  'UNBLOCK',
  'MUTE',
  'UNMUTE',
  // chat
  'CREATE_CHAT_GROUP',
  'UPDATE_CHAT_GROUP_TITLE',
  'ADD_CHAT_MEMBER',
  'REMOVE_CHAT_MEMBER',
  'DELETE_CHAT_MESSAGE',
  // moderation
  'MODERATION_STATUS_UPDATE',
  // gdpr
  'GDPR_DELETE_SCHEDULED',
  'GDPR_DELETE_CANCELLED',
  // feature flags
  'FEATURE_FLAG_OVERRIDE',
  // retention worker
  'USER_HARD_DELETED',
  'RETENTION_NOTIFICATIONS_PURGED',
  'RETENTION_AUDIT_PURGED',
  'RETENTION_ORPHAN_MEDIA_PURGED',
  'RETENTION_MESSAGES_PURGED',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Mirrors `AuditEntityLiteral` — the table `entity_id` points at. */
export const AUDIT_ENTITIES = [
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
] as const;

export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

export type AuditQuery = {
  /** Opaque cursor from the previous page. `null`/omitted asks for the first. */
  cursor?: string | null;
  action?: AuditAction | null;
  entity?: AuditEntity | null;
  /** Who acted. `null` covers system-written rows. */
  actorId?: number | null;
  limit?: number;
};

export async function getAuditLog({
  cursor = null,
  action = null,
  entity = null,
  actorId = null,
  limit = DEFAULT_PAGE_SIZE,
}: AuditQuery = {}): Promise<AuditPage> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/audit', {
      params: { query: { cursor, action, entity, actor_id: actorId, limit } },
    }),
  );
}
