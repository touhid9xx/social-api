import { describe, expect, it } from 'vitest';

import { queryKeys } from './query-keys';

/**
 * Two invariants that, if broken, are invisible until the cache behaves bizarrely
 * in production: cursor pagination must not fragment a key, and keys must nest
 * so one `invalidateQueries` reaches lists *and* details.
 *
 * (cursor key-তে ঢুকলে প্রতি page আলাদা cache entry হয়ে যেত — তাই এখানে lock করা।)
 */

/** Walk to the deepest string, so nested keys can be compared structurally. */
function startsWithRoot(key: readonly unknown[]): boolean {
  return key[0] === queryKeys.all[0];
}

describe('queryKeys hierarchy', () => {
  it('roots every key under the single app key', () => {
    expect(queryKeys.users.me()).toEqual(['social', 'users', 'me']);
    expect(startsWithRoot(queryKeys.feed.home())).toBe(true);
    expect(startsWithRoot(queryKeys.posts.detail(1))).toBe(true);
    expect(startsWithRoot(queryKeys.notifications.unreadCount())).toBe(true);
    expect(startsWithRoot(queryKeys.chat.room(7))).toBe(true);
  });

  it('makes every family key a prefix of its detail keys', () => {
    const isPrefix = (prefix: readonly unknown[], key: readonly unknown[]) =>
      prefix.every((segment, index) => key[index] === segment);

    expect(isPrefix(queryKeys.posts.all, queryKeys.posts.detail(5))).toBe(true);
    expect(isPrefix(queryKeys.posts.all, queryKeys.posts.comments(5))).toBe(true);
    expect(isPrefix(queryKeys.users.all, queryKeys.users.profile(5))).toBe(true);
    expect(isPrefix(queryKeys.chat.all, queryKeys.chat.messages(5))).toBe(true);
    expect(isPrefix(queryKeys.moderation.all, queryKeys.moderation.report(5))).toBe(true);
    expect(isPrefix(queryKeys.gdpr.all, queryKeys.gdpr.deletionStatus())).toBe(true);
  });

  it('keeps ids distinct so two entities never share a cache entry', () => {
    expect(queryKeys.posts.detail(1)).not.toEqual(queryKeys.posts.detail(2));
    expect(queryKeys.users.profile(1)).not.toEqual(queryKeys.users.profile(2));
    expect(queryKeys.chat.messages(1)).not.toEqual(queryKeys.chat.members(1));
  });
});

describe('queryKeys never contain a cursor', () => {
  it('ignores a cursor entirely', () => {
    expect(queryKeys.feed.home({ cursor: 'opaque-cursor' })).toEqual(queryKeys.feed.home());
    expect(queryKeys.feed.explore({ cursor: 'opaque-cursor' })).toEqual(queryKeys.feed.explore());
    expect(queryKeys.users.followers(1, { cursor: 'c' })).toEqual(queryKeys.users.followers(1));
    expect(queryKeys.users.following(1, { cursor: 'c' })).toEqual(queryKeys.users.following(1));
    expect(queryKeys.posts.byAuthor(1, { cursor: 'c' })).toEqual(queryKeys.posts.byAuthor(1));
    expect(queryKeys.posts.comments(1, { cursor: 'c' })).toEqual(queryKeys.posts.comments(1));
    expect(queryKeys.notifications.list({ cursor: 'c' })).toEqual(queryKeys.notifications.list());
    expect(queryKeys.audit.mine({ cursor: 'c' })).toEqual(queryKeys.audit.mine());
    expect(queryKeys.audit.list({ cursor: 'c' })).toEqual(queryKeys.audit.list());
    expect(queryKeys.moderation.reports({ cursor: 'c' })).toEqual(queryKeys.moderation.reports());
  });

  it('does not leak a null cursor either', () => {
    expect(queryKeys.feed.home({ cursor: null })).toEqual(queryKeys.feed.home());
  });

  it('keeps non-cursor filters, because they change the result set', () => {
    expect(queryKeys.feed.home({ limit: 10 })).not.toEqual(queryKeys.feed.home());
    expect(queryKeys.moderation.reports({ status: 'open' })).not.toEqual(
      queryKeys.moderation.reports(),
    );
    expect(queryKeys.moderation.reports({ targetType: 'post' })).not.toEqual(
      queryKeys.moderation.reports(),
    );
  });
});

describe('queryKeys are cache-safe', () => {
  it('serialises deterministically to the same JSON', () => {
    const a = JSON.stringify(queryKeys.posts.likers('post', 3, { limit: 5 }));
    const b = JSON.stringify(queryKeys.posts.likers('post', 3, { limit: 5 }));
    expect(a).toBe(b);
  });

  it('contains only primitives and plain objects', () => {
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      if (value !== null && typeof value === 'object') {
        Object.values(value).forEach(walk);
        return;
      }
      expect(['string', 'number', 'boolean']).toContain(typeof value);
    };

    walk(queryKeys.posts.comments(1, { limit: 20 }));
    walk(queryKeys.moderation.reports({ status: 'open', limit: 10 }));
  });
});
