import type {
  AuditLogView,
  AuthTokens,
  CancelResponse,
  CommentView,
  ConsentRecord,
  DeleteMeResponse,
  DeletionStatusView,
  FollowCounts,
  FollowStatus,
  FollowUserView,
  MemberReadState,
  MessageView,
  NotificationView,
  PostView,
  ProfilePublic,
  ProfileSelf,
  ReportView,
  RoomMembersList,
  RoomView,
  UnreadCount,
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
 * The consent screen's read (F20), covering all three states the UI must render.
 *
 * `GET /users/me/consent` returns ONLY channels the user has ever acted on, so
 * this list is deliberately incomplete — and that is the point:
 *
 *  - `email_marketing` — granted and never revoked → switch ON;
 *  - `analytics`       — granted once, then revoked → switch OFF, but the row
 *                        EXISTS, so the UI must read `granted` and not "row present";
 *  - `sms_marketing` / `product_updates` — absent entirely, which is a real "never
 *                        acted on" and must also read OFF.
 *
 * A UI built from the response alone would hide the last two channels, which is
 * why `CONSENT_CHANNELS` (the contract enum) drives the switch list instead.
 */
export const consents: ConsentRecord[] = [
  {
    channel: 'email_marketing',
    granted: true,
    granted_at: '2026-01-02T09:00:00.000Z',
    revoked_at: null,
  },
  {
    channel: 'analytics',
    granted: false,
    granted_at: '2026-01-02T09:00:00.000Z',
    revoked_at: '2026-01-10T09:00:00.000Z',
  },
];

/** What `GET /gdpr/deletion-status` answers for a live account: nothing scheduled. */
export const deletionStatusNone: DeletionStatusView = {
  scheduled: false,
  scheduled_hard_delete_at: null,
  status: 'none',
};

/**
 * The scheduled state, for tests that need the "cancel my deletion" branch.
 *
 * Not the default answer: a scheduled deletion is the exceptional case, and a
 * mock that opened in it would make the ordinary "delete my account" button
 * unreachable without an override in every test.
 */
export const deletionStatusScheduled: DeletionStatusView = {
  scheduled: true,
  scheduled_hard_delete_at: '2026-02-14T10:00:00.000Z',
  status: 'scheduled',
};

/**
 * `DELETE /users/me` — soft-delete now, hard-delete at the end of the grace
 * period. `hard_delete_after` is the only field the client cannot derive: it is
 * what the panel shows as the exact deadline.
 */
export const deleteMeResponse: DeleteMeResponse = {
  message: 'Account scheduled for deletion',
  hard_delete_after: '2026-02-14T10:00:00.000Z',
};

export const cancelDeletionResponse: CancelResponse = {
  message: 'Deletion cancelled',
};

/**
 * `GET /gdpr/export` — a `Content-Disposition` JSON download in production, typed
 * `unknown` in the contract. Small enough to assert on, shaped like a real export
 * (a top-level object, not an array), so a test can prove the bytes came back
 * rather than a 204.
 */
export const exportedData = {
  user: { id: 21, email: DEMO_ADMIN_EMAIL },
  posts: [],
  comments: [],
  exported_at: FIXTURE_NOW,
};

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

// ---------------------------------------------------------------------------
// Chat (F21).
//
// Ids start at 601 for rooms and 701/801 for messages, clear of posts
// (101–103, 201–203, 401–403) and comments (501–503), so a test can always tell
// which endpoint a rendered row came from.
//
// The two rooms exist because `RoomView` names them in two different ways, and
// the UI has to handle both: a direct room has `title: null` and the peer is
// DERIVED from the member list (`peerIdOf`), while a group room is labelled by
// its title. The members are drawn from `authorProfiles` on purpose — user 22
// ("Alice Rahman") resolves, and user 24 has a null display name so the sender
// fallback ("User 24") is reachable without inventing a new account.
// ---------------------------------------------------------------------------

/** Newest activity first in `chatRooms` — that is the server's ordering. */
export const directRoom: RoomView = {
  id: 601,
  type: 'direct',
  title: null,
  created_at: '2026-01-10T09:00:00.000Z',
  updated_at: '2026-01-15T10:00:00.000Z',
};

export const groupRoom: RoomView = {
  id: 602,
  type: 'group',
  title: 'Design crew',
  created_at: '2026-01-08T09:00:00.000Z',
  updated_at: '2026-01-15T09:57:00.000Z',
};

/**
 * `GET /chat/rooms` — a BARE ARRAY, capped at 100 by the server, already ordered
 * by latest activity. There is no `next_cursor` here, which is why the room list
 * is a plain query and not an infinite one.
 */
export const chatRooms: RoomView[] = [directRoom, groupRoom];

/**
 * `GET /chat/rooms/{id}/members`, keyed by room id.
 *
 * This is not decoration: it is the ONLY place a direct room's peer can be found
 * (`RoomView` carries no participants). Room 601 lists admin (21) and Alice (22),
 * so the peer is unambiguous; room 602 carries three members, which is also the
 * "many peers, use the title" case `peerIdOf` refuses to guess at.
 */
export const roomMembers: Record<number, RoomMembersList> = {
  601: {
    members: [
      { user_id: 21, role: 'member', joined_at: '2026-01-10T09:00:00.000Z' },
      { user_id: 22, role: 'member', joined_at: '2026-01-10T09:00:00.000Z' },
    ],
  },
  602: {
    members: [
      { user_id: 21, role: 'admin', joined_at: '2026-01-08T09:00:00.000Z' },
      { user_id: 23, role: 'member', joined_at: '2026-01-08T09:05:00.000Z' },
      { user_id: 24, role: 'member', joined_at: '2026-01-08T09:10:00.000Z' },
    ],
  },
};

/**
 * `GET /chat/rooms/{id}/messages`, NEWEST FIRST — the direction "load older"
 * pages in. Five messages in room 601 means a `limit=3` read produces two pages
 * (3 + 2), which is what the "load older" test needs; the display order is the
 * client's reversal, never the query's.
 *
 * Two details carried on purpose: message 702 is `is_edited: true` so the
 * "edited" marker is reachable, and message 801 is sent by user 24 — whose
 * display name is null — so the sender fallback is reachable too.
 */
export const roomMessages: Record<number, MessageView[]> = {
  601: [
    {
      id: 705,
      room_id: 601,
      sender_id: 22,
      body: "Sounds good — I'll push it tonight.",
      media_id: null,
      created_at: '2026-01-15T10:00:00.000Z',
    },
    {
      id: 704,
      room_id: 601,
      sender_id: 21,
      body: 'Then it is a plan.',
      media_id: null,
      created_at: '2026-01-15T09:58:00.000Z',
    },
    {
      id: 703,
      room_id: 601,
      sender_id: 22,
      body: "Let's ship the cursor fix first.",
      media_id: null,
      created_at: '2026-01-15T09:55:00.000Z',
    },
    {
      id: 702,
      room_id: 601,
      sender_id: 21,
      body: 'The thread reverses at render time.',
      media_id: null,
      created_at: '2026-01-15T09:50:00.000Z',
      is_edited: true,
    },
    {
      id: 701,
      room_id: 601,
      sender_id: 22,
      body: 'Hey! Did the pagination land?',
      media_id: null,
      created_at: '2026-01-15T09:40:00.000Z',
    },
  ],
  602: [
    {
      id: 803,
      room_id: 602,
      sender_id: 23,
      body: 'Anyone up for a review of the chat screens?',
      media_id: null,
      created_at: '2026-01-15T09:57:00.000Z',
    },
    {
      id: 802,
      room_id: 602,
      sender_id: 21,
      body: 'A group room needs a title — this one has it.',
      media_id: null,
      created_at: '2026-01-15T09:55:00.000Z',
    },
    {
      id: 801,
      room_id: 602,
      sender_id: 24,
      body: 'No display name, so this row has to fall back.',
      media_id: null,
      created_at: '2026-01-15T09:50:00.000Z',
    },
  ],
};

/** `GET /chat/rooms/{id}/read-receipts` — my watermark and the peer's, per room. */
export const roomReadState: Record<number, MemberReadState[]> = {
  601: [
    { user_id: 21, last_read_message_id: 705 },
    { user_id: 22, last_read_message_id: 704 },
  ],
  602: [
    { user_id: 21, last_read_message_id: 803 },
    { user_id: 23, last_read_message_id: 802 },
    { user_id: 24, last_read_message_id: 801 },
  ],
};

/**
 * `GET /chat/rooms/{id}/unread-count`, per room.
 *
 * Deliberately per-room and NOT in `RoomView`: that is exactly why the room list
 * has no unread badge — a badge there would cost one request per row.
 */
export const roomUnreadCounts: Record<number, UnreadCount> = {
  601: { unread: 0 },
  602: { unread: 2 },
};

// ---------------------------------------------------------------------------
// Moderation + audit (F22).
//
// Ids start at 901 for reports and 951 for audit rows — clear of posts
// (101–103, 201–203, 401–403), comments (501–503), rooms (601–602) and messages
// (701–705, 801–803), so a rendered row always says which endpoint it came from.
//
// The two reports are deliberately the two shapes the queue has to survive:
// one is still `open` (so the triage buttons and the note field are reachable)
// and one is `resolved` (terminal, versioned, with a reviewer, a resolution
// note and a `resolved_at`). The resolved one also has `details: null` so the
// "no details" branch is reachable without inventing a third row.
// ---------------------------------------------------------------------------

/**
 * `GET /moderation/reports` — newest first, which is the order the server
 * returns and therefore the order the mock slices in.
 */
export const reports: ReportView[] = [
  {
    id: 901,
    reporter_id: 22,
    target_type: 'post',
    target_id: 101,
    reason: 'spam',
    details: 'Same promotional link pasted under four different posts.',
    status: 'open',
    reviewer_id: null,
    resolution_note: null,
    resolved_at: null,
    created_at: '2026-01-15T09:45:00.000Z',
    updated_at: '2026-01-15T09:45:00.000Z',
    version: 1,
  },
  {
    id: 902,
    reporter_id: 23,
    target_type: 'comment',
    target_id: 501,
    reason: 'harassment',
    details: null,
    status: 'resolved',
    reviewer_id: 21,
    resolution_note: 'Removed the reply and warned the author.',
    resolved_at: '2026-01-15T09:30:00.000Z',
    created_at: '2026-01-15T09:00:00.000Z',
    updated_at: '2026-01-15T09:30:00.000Z',
    version: 2,
  },
];

/**
 * `GET /audit` — newest first, admin-only.
 *
 * Three rows, each carrying a different nullable combination on purpose:
 *  - 953 has an actor (21, "Admin User"), an ip, a user agent and BOTH payloads;
 *  - 952 has an actor whose profile resolves, no user agent and no request id;
 *  - 951 has `actor_id: null`, which is the system-actor path, and only an
 *    `after` payload — so the diff block shows one section, not two.
 *
 * The action/entity values are real enum members (`AUDIT_ACTIONS` /
 * `AUDIT_ENTITIES`) because a fixture that invented its own would make the
 * filter selects look exhaustive while proving nothing.
 */
export const auditLogs: AuditLogView[] = [
  {
    id: 953,
    actor_id: 21,
    action: 'MODERATION_STATUS_UPDATE',
    entity: 'report',
    entity_id: 902,
    before: { status: 'under_review' },
    after: { status: 'resolved' },
    ip: '203.0.113.10',
    user_agent: 'Mozilla/5.0 (test)',
    request_id: 'req-audit-953',
    created_at: '2026-01-15T09:30:00.000Z',
  },
  {
    id: 952,
    actor_id: 22,
    action: 'PROFILE_UPDATE',
    entity: 'profile',
    entity_id: 22,
    before: { bio: null },
    after: { bio: 'Building things.' },
    ip: '198.51.100.4',
    user_agent: null,
    request_id: null,
    created_at: '2026-01-15T09:20:00.000Z',
  },
  {
    id: 951,
    actor_id: null,
    action: 'DELETE_CHAT_MESSAGE',
    entity: 'message',
    entity_id: 801,
    before: null,
    after: { deleted: true },
    ip: null,
    user_agent: null,
    request_id: null,
    created_at: '2026-01-15T09:10:00.000Z',
  },
  {
    // Auth and retention events: written by services other than the ones the
    // admin UI usually drives, so they are the rows most likely to drift out
    // of the filter enum unnoticed. Kept here as a live regression check.
    id: 950,
    actor_id: 22,
    action: 'VERIFY_EMAIL',
    entity: 'user',
    entity_id: 22,
    before: { is_verified: false },
    after: { is_verified: true },
    ip: '198.51.100.4',
    user_agent: null,
    request_id: null,
    created_at: '2026-01-15T09:05:00.000Z',
  },
  {
    id: 949,
    actor_id: null,
    action: 'RETENTION_AUDIT_PURGED',
    entity: 'audit_log',
    entity_id: null,
    before: null,
    after: { deleted: 12, cutoff_days: 365 },
    ip: null,
    user_agent: null,
    request_id: null,
    created_at: '2026-01-15T09:00:00.000Z',
  },
];
