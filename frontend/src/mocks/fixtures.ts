import type { AuthTokens, PostView, ProfileSelf, UserPublic } from '../../contracts/types';

/**
 * Contract-accurate fixtures for tests and MSW. Types come straight from the
 * generated `contracts/types.ts`, so a backend shape change breaks the build here
 * instead of silently drifting. Values mirror the seeded demo accounts.
 *
 * (fixture গুলো generated contract types থেকে টাইপ করা — backend shape বদলালে test compile-এ ধরা পড়বে।)
 */

export const DEMO_PASSWORD = 'DemoPass123!';
export const DEMO_ADMIN_EMAIL = 'admin@example.com';

/** ISO-8601 UTC, the only format allowed in state and query cache. */
export const FIXTURE_NOW = '2026-01-15T10:00:00.000Z';

export const adminUser: UserPublic = {
  id: 21,
  role: 'admin',
  is_active: true,
  is_verified: true,
  created_at: '2026-01-01T09:00:00.000Z',
};

export const adminTokens: AuthTokens = {
  access_token: 'test.access.token',
  refresh_token: 'test.refresh.token',
  token_type: 'Bearer',
  expires_in: 900,
};

/** The refresh response is FLAT — it is not nested under `tokens` like login. */
export const refreshedTokens: AuthTokens = {
  access_token: 'test.access.token.rotated',
  refresh_token: 'test.refresh.token.rotated',
  token_type: 'Bearer',
  expires_in: 900,
};

export const adminProfile: ProfileSelf = {
  user_id: 21,
  display_name: 'Admin',
  bio: 'Runs the place.',
  avatar_url: null,
  location: 'Dhaka',
  website: null,
  visibility: 'public',
  pii_visibility: 'private',
  dob: null,
  phone: null,
  address: null,
  version: 1,
  created_at: '2026-01-01T09:00:00.000Z',
  updated_at: '2026-01-01T09:00:00.000Z',
};

export const homeFeedPosts: PostView[] = [
  {
    id: 101,
    author_id: 22,
    body: 'Cursor pagination means the list never jumps under your thumb.',
    visibility: 'public',
    like_count: 12,
    comment_count: 3,
    media_count: 0,
    version: 1,
    created_at: '2026-01-15T09:58:00.000Z',
    updated_at: '2026-01-15T09:58:00.000Z',
    is_liked_by_me: false,
    is_edited: false,
  },
  {
    id: 102,
    author_id: 23,
    body: 'Dark mode finally looks right.',
    visibility: 'public',
    like_count: 4,
    comment_count: 0,
    media_count: 1,
    version: 1,
    created_at: '2026-01-15T09:40:00.000Z',
    updated_at: '2026-01-15T09:40:00.000Z',
    is_liked_by_me: true,
    is_edited: false,
  },
  {
    id: 103,
    author_id: 24,
    body: 'Optimistic likes, rolled back on error.',
    visibility: 'followers',
    like_count: 0,
    comment_count: 1,
    media_count: 0,
    version: 2,
    created_at: '2026-01-15T09:10:00.000Z',
    updated_at: '2026-01-15T09:20:00.000Z',
    is_liked_by_me: false,
    is_edited: true,
  },
];

export const unreadNotificationCount = { unread: 3 };
