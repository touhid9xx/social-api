/**
 * Every TanStack Query key in the app, in one place.
 *
 * Two rules that keep the cache honest:
 *  1. Cursor pagination is NEVER a key. `next_cursor` goes into `pageParam`, so
 *     one infinite query owns the whole list and invalidating its key refreshes
 *     it from the top.
 *  2. Keys are hierarchical: `queryKeys.posts.all` is a prefix of
 *     `queryKeys.posts.detail(id)`, so `invalidateQueries({ queryKey:
 *     queryKeys.posts.all })` clears lists and details together.
 *
 * Rule 1 is enforced by `listKey()` rather than by convention: every builder
 * funnels its filters through it, so passing a cursor cannot leak one into a key
 * and fragment the cache into one entry per page.
 *
 * (cursor কখনও key-তে যায় না — `listKey()` নিজেই বাদ দেয়; key invalidate করলেই পুরো list রিফ্রেশ।)
 */

export type ListFilters = {
  cursor?: string | null;
  limit?: number;
};

/**
 * Drop the pagination cursor before it reaches a cache key.
 *
 * `limit` and any other filter (status, targetType, …) stay: a different page
 * size is genuinely a different list. Only the cursor is page identity, and
 * page identity belongs to `pageParam`.
 */
function listKey<T extends ListFilters>(filters: T): Omit<T, 'cursor'> {
  const { cursor: _cursor, ...rest } = filters;
  return rest;
}

export const queryKeys = {
  /** Root — invalidate everything with this one key. */
  all: ['social'] as const,

  auth: {
    all: ['social', 'auth'] as const,
    me: () => ['social', 'auth', 'me'] as const,
    session: () => ['social', 'auth', 'session'] as const,
  },

  users: {
    all: ['social', 'users'] as const,
    me: () => ['social', 'users', 'me'] as const,
    profile: (userId: number) => ['social', 'users', 'profile', userId] as const,
    byUsername: (username: string) => ['social', 'users', 'by-username', username] as const,
    consents: () => ['social', 'users', 'consents'] as const,
    followCounts: (userId: number) => ['social', 'users', 'follow-counts', userId] as const,
    followStatus: (userId: number) => ['social', 'users', 'follow-status', userId] as const,
    followers: (userId: number, filters: ListFilters = {}) =>
      ['social', 'users', 'followers', userId, listKey(filters)] as const,
    following: (userId: number, filters: ListFilters = {}) =>
      ['social', 'users', 'following', userId, listKey(filters)] as const,
    presence: (userId: number) => ['social', 'users', 'presence', userId] as const,
  },

  posts: {
    all: ['social', 'posts'] as const,
    detail: (postId: number) => ['social', 'posts', 'detail', postId] as const,
    byAuthor: (authorId: number, filters: ListFilters = {}) =>
      ['social', 'posts', 'by-author', authorId, listKey(filters)] as const,
    /** Prefix for every page-size variant of one post's comments. */
    commentThreads: (postId: number) => ['social', 'posts', 'comments', postId] as const,
    comments: (postId: number, filters: ListFilters = {}) =>
      ['social', 'posts', 'comments', postId, listKey(filters)] as const,
    likers: (targetType: string, targetId: number, filters: ListFilters = {}) =>
      ['social', 'posts', 'likers', targetType, targetId, listKey(filters)] as const,
  },

  feed: {
    all: ['social', 'feed'] as const,
    home: (filters: ListFilters = {}) => ['social', 'feed', 'home', listKey(filters)] as const,
    explore: (filters: ListFilters = {}) =>
      ['social', 'feed', 'explore', listKey(filters)] as const,
  },

  notifications: {
    all: ['social', 'notifications'] as const,
    list: (filters: ListFilters & { unreadOnly?: boolean } = {}) =>
      ['social', 'notifications', 'list', listKey(filters)] as const,
    unreadCount: () => ['social', 'notifications', 'unread-count'] as const,
  },

  chat: {
    all: ['social', 'chat'] as const,
    rooms: () => ['social', 'chat', 'rooms'] as const,
    room: (roomId: number) => ['social', 'chat', 'room', roomId] as const,
    members: (roomId: number) => ['social', 'chat', 'room', roomId, 'members'] as const,
    messages: (roomId: number) => ['social', 'chat', 'room', roomId, 'messages'] as const,
    readReceipts: (roomId: number) => ['social', 'chat', 'room', roomId, 'read-receipts'] as const,
    unreadCount: (roomId: number) => ['social', 'chat', 'room', roomId, 'unread-count'] as const,
  },

  media: {
    all: ['social', 'media'] as const,
    detail: (mediaId: number) => ['social', 'media', 'detail', mediaId] as const,
  },

  moderation: {
    all: ['social', 'moderation'] as const,
    reports: (filters: ListFilters & { status?: string; targetType?: string } = {}) =>
      ['social', 'moderation', 'reports', listKey(filters)] as const,
    report: (reportId: number) => ['social', 'moderation', 'reports', reportId] as const,
  },

  audit: {
    all: ['social', 'audit'] as const,
    mine: (filters: ListFilters = {}) => ['social', 'audit', 'me', listKey(filters)] as const,
    list: (filters: ListFilters = {}) => ['social', 'audit', 'list', listKey(filters)] as const,
  },

  gdpr: {
    all: ['social', 'gdpr'] as const,
    deletionStatus: () => ['social', 'gdpr', 'deletion-status'] as const,
    export: () => ['social', 'gdpr', 'export'] as const,
  },

  flags: {
    all: ['social', 'flags'] as const,
    list: () => ['social', 'flags', 'list'] as const,
  },

  search: {
    all: ['social', 'search'] as const,
    query: (term: string) => ['social', 'search', term] as const,
  },
} as const;
