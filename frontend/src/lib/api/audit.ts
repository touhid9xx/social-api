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

export const AUDIT_ACTIONS = [
  'REGISTER',
  'LOGIN',
  'LOGOUT',
  'PROFILE_UPDATE',
  'DELETE_POST',
  'DELETE_COMMENT',
  'BLOCK',
  'UNBLOCK',
  'MUTE',
  'UNMUTE',
  'CREATE_CHAT_GROUP',
  'UPDATE_CHAT_GROUP_TITLE',
  'ADD_CHAT_MEMBER',
  'REMOVE_CHAT_MEMBER',
  'DELETE_CHAT_MESSAGE',
  'MODERATION_STATUS_UPDATE',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITIES = [
  'user',
  'profile',
  'post',
  'comment',
  'message',
  'chat_room',
  'report',
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
