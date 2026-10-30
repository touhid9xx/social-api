import type {
  AuthTokens,
  CommentView,
  FollowCounts,
  FollowStatus,
  FollowUserView,
  NotificationView,
  PostView,
  ProfilePublic,
  ProfileSelf,
  UserPublic,
} from '../../contracts/types';

/**
 * Contract-accurate fixtures for tests and MSW. Types come straight from the
 * generated `contracts/types.ts`, so a backend shape change breaks the build here
 * instead of silently drifting. Values mirror the seeded demo accounts.
 *
 * (fixture গুলো generated contract types থেকে টাইপ করা — backend shape বদলালে test compile-এ ধরা পড়বে।)
 */

export const DEMO_PASSWORD = 'DemoPass123!';
export const DEMO_ADMIN_EMAIL = 'admin@example.com';

/**
 * The one token value the mock endpoints in `./handlers` accept.
 *
 * The real endpoints consume self-contained JWTs minted by the backend
 * (`type` claim = `verify` | `reset`), which no fixture can reproduce. Any other
 * value is answered with a real 401 `INVALID_TOKEN`, so a test that passes a
 * bogus token exercises the expired-link path instead of silently succeeding.
 */
export const VERIFY_EMAIL_TOKEN = 'verify-email-token-ok';
export const RESET_PASSWORD_TOKEN = 'reset-password-token-ok';

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

/**
 * What the same-origin `POST /api/auth/refresh` route returns to the browser:
 * the access token ONLY. The rotated refresh token goes into the httpOnly
 * cookie, never into the response body.
 */
export const refreshedAccess: Omit<AuthTokens, 'refresh_token'> = {
  access_token: refreshedTokens.access_token,
  token_type: 'Bearer',
  expires_in: refreshedTokens.expires_in,
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

/**
 * Authors of the feed fixtures, keyed by `user_id`.
 *
 * `PostView` carries only `author_id`, so the feed UI resolves each author from
 * `GET /api/v1/users/{user_id}`. Keeping them in one map means the mock server
 * answers exactly the ids the fixtures reference — anything else is a genuine
 * 404, and a test that asks for a missing author fails loudly instead of
 * rendering a name that does not exist.
 */
export const authorProfiles: Record<number, ProfilePublic> = {
  21: {
    user_id: 21,
    display_name: 'Admin',
    bio: 'Runs the place.',
    avatar_url: null,
    location: 'Dhaka',
    website: null,
    visibility: 'public',
  },
  22: {
    user_id: 22,
    display_name: 'Alice Rahman',
    bio: 'Writes about feeds.',
    avatar_url: null,
    location: 'Chattogram',
    website: null,
    visibility: 'public',
  },
  23: {
    user_id: 23,
    display_name: 'Bashir Hossain',
    bio: null,
    avatar_url: null,
    location: null,
    website: null,
    visibility: 'public',
  },
  24: {
    user_id: 24,
    display_name: null,
    bio: null,
    avatar_url: null,
    location: null,
    website: null,
    visibility: 'followers',
  },
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

/**
 * The thread under post 101 — two top-level comments, one of which carries a
 * reply, for three comments in total. That matches `homeFeedPosts[0]`'s
 * `comment_count: 3`, so a detail page and a feed card cannot disagree.
 *
 * `depth` is part of the contract, and the backend caps it at 2: replies here are
 * `depth: 1` and are never given a `replies` array, because a reply-to-a-reply is
 * a real `COMMENT_DEPTH_EXCEEDED`.
 */
export const postComments: CommentView[] = [
  {
    id: 501,
    post_id: 101,
    author_id: 23,
    parent_id: null,
    depth: 0,
    body: 'This is exactly the problem I kept hitting.',
    like_count: 2,
    created_at: '2026-01-15T09:58:30.000Z',
    updated_at: '2026-01-15T09:58:30.000Z',
    is_liked_by_me: false,
    is_edited: false,
    replies: [
      {
        id: 503,
        post_id: 101,
        author_id: 22,
        parent_id: 501,
        depth: 1,
        body: 'Glad it landed.',
        like_count: 0,
        created_at: '2026-01-15T09:59:00.000Z',
        updated_at: '2026-01-15T09:59:00.000Z',
        is_liked_by_me: false,
        is_edited: false,
      },
    ],
  },
  {
    id: 502,
    post_id: 101,
    author_id: 24,
    parent_id: null,
    depth: 0,
    body: 'Does this hold up on a slow connection?',
    like_count: 1,
    created_at: '2026-01-15T09:58:45.000Z',
    updated_at: '2026-01-15T09:58:45.000Z',
    is_liked_by_me: true,
    is_edited: false,
  },
];

/**
 * The discovery corpus, deliberately DISJOINT from `homeFeedPosts`.
 *
 * Explore answers a different question than the home feed ("what is out there"
 * versus "what did the people I follow say"), so sharing rows would make a test
 * unable to tell which endpoint a page came from. Ids start at 201 for the same
 * reason comment ids start at 501.
 */
export const exploreFeedPosts: PostView[] = [
  {
    id: 201,
    author_id: 23,
    body: 'Ranked discovery, so a post does not need a follower to be read.',
    visibility: 'public',
    like_count: 40,
    comment_count: 0,
    media_count: 0,
    version: 1,
    created_at: '2026-01-15T08:00:00.000Z',
    updated_at: '2026-01-15T08:00:00.000Z',
    is_liked_by_me: false,
    is_edited: false,
  },
  {
    id: 202,
    author_id: 22,
    body: 'Opaque cursors mean the client never learns how the ranking works.',
    visibility: 'public',
    like_count: 7,
    comment_count: 0,
    media_count: 0,
    version: 1,
    created_at: '2026-01-15T07:30:00.000Z',
    updated_at: '2026-01-15T07:30:00.000Z',
    is_liked_by_me: true,
    is_edited: false,
  },
  {
    id: 203,
    author_id: 24,
    body: 'A private post, visible here only because this viewer may see it.',
    visibility: 'private',
    like_count: 0,
    comment_count: 0,
    media_count: 0,
    version: 1,
    created_at: '2026-01-15T07:00:00.000Z',
    updated_at: '2026-01-15T07:00:00.000Z',
    is_liked_by_me: false,
    is_edited: false,
  },
];

/**
 * The inbox: four rows, three of them unread — which is exactly what
 * `unreadNotificationCount` above advertises, so a badge and the list it points
 * at cannot disagree.
 *
 * Every `type` in `NOTIFICATION_TYPES` except `comment_reply` appears, and the
 * rows deliberately vary in two ways that the UI must handle:
 *  - `target_type` is `post` (linkable, `/posts/{id}`), `user` (linkable,
 *    `/profile/{id}`) and `comment` (NOT linkable: a comment id is not a post
 *    id and there is no comment route);
 *  - `actor_id` 24 has a null display name, so the row must fall back to
 *    "User {id}" rather than render an empty name.
 */
export const notifications: NotificationView[] = [
  {
    id: 301,
    type: 'like_post',
    target_type: 'post',
    target_id: 101,
    actor_id: 22,
    is_read: false,
    read_at: null,
    preview: 'Cursor pagination means the list never jumps under your thumb.',
    created_at: '2026-01-15T09:59:00.000Z',
  },
  {
    id: 302,
    type: 'follow',
    target_type: 'user',
    target_id: 23,
    actor_id: 23,
    is_read: false,
    read_at: null,
    preview: null,
    created_at: '2026-01-15T09:55:00.000Z',
  },
  {
    id: 303,
    type: 'comment_post',
    target_type: 'post',
    target_id: 101,
    actor_id: 24,
    is_read: false,
    read_at: null,
    preview: 'Does this hold up on a slow connection?',
    created_at: '2026-01-15T09:50:00.000Z',
  },
  {
    id: 304,
    type: 'like_comment',
    target_type: 'comment',
    target_id: 501,
    actor_id: 22,
    is_read: true,
    read_at: '2026-01-15T09:45:00.000Z',
    preview: 'This is exactly the problem I kept hitting.',
    created_at: '2026-01-15T09:40:00.000Z',
  },
];

/** Three of the four rows above are unread — see the note on `notifications`. */
export const unreadNotificationCount = { unread: 3 };

/**
 * Follow status, VIEWER-RELATIVE to the signed-in admin (user 21).
 *
 * `GET /users/{id}/follow-status` answers for the caller, so a shared value
 * would be a lie: this map is only meaningful while the session is `adminUser`.
 * The four entries give the profile screen one of each state it must render,
 * which is the whole reason they exist:
 *
 *  21 — the viewer themself: the button must not appear at all (`CANNOT_FOLLOW_SELF`);
 *  22 — not followed yet: the button reads "Follow";
 *  23 — already followed: "Following";
 *  24 — THEY blocked the viewer: every follow would be rejected, so the control
 *       becomes copy (`profile.blockedByThem`) instead of a button that cannot work.
 *
 * The one state missing here is `is_blocked_by_me`, which hides the control; it
 * is rarer and asserted by overriding this handler in the test rather than by
 * inventing a fifth user no post or list refers to.
 */
export const followStatus: Record<number, FollowStatus> = {
  21: {
    is_following: false,
    is_followed_by: false,
    is_blocked_by_me: false,
    has_blocked_me: false,
    is_muted_by_me: false,
  },
  22: {
    is_following: false,
    is_followed_by: true,
    is_blocked_by_me: false,
    has_blocked_me: false,
    is_muted_by_me: false,
  },
  23: {
    is_following: true,
    is_followed_by: false,
    is_blocked_by_me: false,
    has_blocked_me: false,
    is_muted_by_me: true,
  },
  24: {
    is_following: false,
    is_followed_by: false,
    is_blocked_by_me: false,
    has_blocked_me: true,
    is_muted_by_me: false,
  },
};

/**
 * Public follower/following totals. Separate from `followStatus` because the
 * backend serves them from a different endpoint with a different cache lifetime
 * — public and slow-changing versus private and instant.
 */
export const followCounts: Record<number, FollowCounts> = {
  21: { followers: 12, following: 5 },
  22: { followers: 3, following: 7 },
  23: { followers: 8, following: 2 },
  24: { followers: 0, following: 0 },
};

/**
 * The two ends of Alice's (user 22) follow graph.
 *
 * `FollowUserView` carries `display_name` and `avatar_url` inline, so these rows
 * deliberately do NOT need `authorProfiles` to render — that is the contract
 * detail `follow-list.tsx` is built on. Row 24 has a null name so the list must
 * fall back to "User {id}" rather than render a blank line.
 */
export const followersOf22: FollowUserView[] = [
  {
    user_id: 21,
    display_name: 'Admin',
    avatar_url: null,
    followed_at: '2026-01-14T09:00:00.000Z',
  },
  {
    user_id: 23,
    display_name: 'Bashir Hossain',
    avatar_url: null,
    followed_at: '2026-01-13T09:00:00.000Z',
  },
  {
    user_id: 24,
    display_name: null,
    avatar_url: null,
    followed_at: '2026-01-12T09:00:00.000Z',
  },
];

export const followingOf22: FollowUserView[] = [
  {
    user_id: 23,
    display_name: 'Bashir Hossain',
    avatar_url: null,
    followed_at: '2026-01-11T09:00:00.000Z',
  },
];

/**
 * Posts per author — the profile's feed.
 *
 * Ids start at 401, disjoint from the home feed (101–103) and explore (201–203)
 * for the same reason those two are disjoint from each other: a test that reads
 * a post on a profile must be able to prove it came from
 * `GET /posts/by-author/{id}` and not from a list that happened to be cached.
 *
 * An author with no entry has simply never posted, which is a real 200 with an
 * empty page — not a 404. Only an unknown *user* is a 404, and the profile
 * request answers that before the posts are ever asked for.
 */
export const authorPosts: Record<number, PostView[]> = {
  22: [
    {
      id: 401,
      author_id: 22,
      body: 'Every milestone so far has been a small contract change.',
      visibility: 'public',
      like_count: 5,
      comment_count: 0,
      media_count: 0,
      version: 1,
      created_at: '2026-01-15T08:30:00.000Z',
      updated_at: '2026-01-15T08:30:00.000Z',
      is_liked_by_me: false,
      is_edited: false,
    },
    {
      id: 402,
      author_id: 22,
      body: 'Pagination is an API design problem, not a UI one.',
      visibility: 'public',
      like_count: 2,
      comment_count: 1,
      media_count: 0,
      version: 1,
      created_at: '2026-01-15T08:10:00.000Z',
      updated_at: '2026-01-15T08:10:00.000Z',
      is_liked_by_me: true,
      is_edited: false,
    },
  ],
  23: [
    {
      id: 403,
      author_id: 23,
      body: 'The follow graph is the part nobody tests enough.',
      visibility: 'public',
      like_count: 1,
      comment_count: 0,
      media_count: 0,
      version: 1,
      created_at: '2026-01-15T07:45:00.000Z',
      updated_at: '2026-01-15T07:45:00.000Z',
      is_liked_by_me: false,
      is_edited: false,
    },
  ],
};
