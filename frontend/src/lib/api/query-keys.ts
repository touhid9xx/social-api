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
 * The inbox' own filters. `scope` is declared as a plain string rather than
 * imported from `./notifications` so this module keeps its zero-import shape —
 * the key factory is the bottom of the dependency graph, and the API layer
 * imports it, not the other way round.
 */
export type NotificationListFilters = ListFilters & {
  unreadOnly?: boolean;
  scope?: string;
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
    /**
     * Email verification is a one-shot POST, but it is keyed like a read so
     * TanStack Query de-duplicates it: the token is the identity of the request,
     * and re-mounting the panel must not spend a second slot of the 3/hour
     * budget the endpoint allows.
     */
    verifyEmail: (token: string) => ['social', 'auth', 'verify-email', token] as const,
  },

  users: {
    all: ['social', 'users'] as const,
    me: () => ['social', 'users', 'me'] as const,
    profile: (userId: number) => ['social', 'users', 'profile', userId] as const,
    consents: () => ['social', 'users', 'consents'] as const,
    followCounts: (userId: number) => ['social', 'users', 'follow-counts', userId] as const,
    followStatus: (userId: number) => ['social', 'users', 'follow-status', userId] as const,
    followers: (userId: number, filters: ListFilters = {}) =>
      ['social', 'users', 'followers', userId, listKey(filters)] as const,
    following: (userId: number, filters: ListFilters = {}) =>
      ['social', 'users', 'following', userId, listKey(filters)] as const,
    presence: (userId: number) => ['social', 'users', 'presence', userId] as const,
    /**
     * The staff-only directory. Nested under `users` on purpose so the existing
     * `queryKeys.users.all` prefix already invalidates it — a new account
     * appearing in the console is the same event as a profile changing.
     */
    directory: (filters: ListFilters = {}) =>
      ['social', 'users', 'directory', listKey(filters)] as const,
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
    /**
     * The scope is a PATH segment, not part of the filter object, because the
     * WebSocket bridge has to target exactly one inbox when a row is pushed:
     * `[..., 'list', 'system']` selects the staff screen's cache, and a
     * person-to-person row must never land in it.
     */
    listRoot: () => ['social', 'notifications', 'list'] as const,
    /**
     * Every filter variant of ONE scope — the prefix a scoped write needs.
     * `list({ scope })` cannot serve that purpose: it appends an empty filter
     * object, and prefix matching is elementwise, so `[...]'social', {}]` is not
     * a prefix of `[...]'social', { limit: 20 }]`.
     */
    listByScope: (scope: string = 'social') => ['social', 'notifications', 'list', scope] as const,
    list: ({ scope = 'social', ...filters }: NotificationListFilters = {}) =>
      ['social', 'notifications', 'list', scope, listKey(filters)] as const,
    /** Prefix over every scope — invalidating this refetches all badges. */
    unreadCountRoot: () => ['social', 'notifications', 'unread-count'] as const,
    unreadCount: (scope: string = 'social') =>
      ['social', 'notifications', 'unread-count', scope] as const,
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
    list: (filters: ListFilters & { action?: string; entity?: string } = {}) =>
      ['social', 'audit', 'list', listKey(filters)] as const,
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

  dashboard: {
    all: ['social', 'dashboard'] as const,
    /**
     * The window IS the identity of the read: a 7-day overview is a different
     * aggregate, not a page of the 30-day one. No cursor, so `listKey()` is not
     * involved — this is a plain query, not an infinite list.
     */
    overview: (windowDays: number) => ['social', 'dashboard', 'overview', windowDays] as const,
  },

  search: {
    all: ['social', 'search'] as const,
    /**
     * The term IS the identity of a search, so it sits in the key — that is what
     * makes typing "bang" then "bangladesh" two cached results instead of one
     * overwritten entry. The cursor still goes through `listKey()`: one infinite
     * query owns every page of a single term.
     */
    query: (term: string, filters: ListFilters = {}) =>
      ['social', 'search', term, listKey(filters)] as const,
  },
} as const;
