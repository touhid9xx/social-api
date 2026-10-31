'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { PostFeed, type FeedQueryResult } from '@/components/feed/post-feed';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { SEARCH_MIN_TERM_LENGTH, type SearchUserHit } from '@/lib/api/search';
import { mediaUrl } from '@/lib/api/media';
import { ROUTES } from '@/lib/constants';
import { useSearch } from '@/hooks/use-search';

/**
 * `/search?q=…` — people first, then the matching posts.
 *
 * The shape of the answer is what makes this component different from a feed:
 * `GET /search` returns `{ users, posts, next_cursor }`, so two kinds of result
 * arrive in one envelope and only the posts are paginated. The posts half is
 * therefore mapped onto the existing `PostFeed` contract rather than paginated
 * again here — that is one `map` over `pages`, and it buys the skeleton, the
 * error state, the dedupe, the sentinel and the accessible "Load more" button
 * for free, all of which a second implementation would get subtly wrong.
 *
 * `users` is a shortlist the backend caps at ten and repeats on every page, so
 * it is read from the first page only — appending `pages` would render the same
 * people again under each loaded page of posts.
 *
 * Below the backend's length floor nothing is fetched at all: the request could
 * only answer `400 QUERY_TOO_SHORT`, so the dashboard shows the hint instead.
 * (ছোট শব্দে রিকোয়েস্ট যায় না — শুধু সংকেত দেখানো হয়।)
 */
export function SearchResults({ term }: { term: string }) {
  const t = useTranslations('search');
  const trimmed = term.trim();

  if (trimmed.length < SEARCH_MIN_TERM_LENGTH) {
    return (
      <div className="space-y-2 rounded-xl border border-dashed border-border p-8 text-center">
        <h2 className="text-base font-semibold text-foreground">{t('tooShortTitle')}</h2>
        <p className="text-sm text-pretty text-muted-foreground">
          {t('tooShortBody', { count: SEARCH_MIN_TERM_LENGTH })}
        </p>
      </div>
    );
  }

  // Split in two so `useSearch` is never called conditionally.
  return <ResolvedResults term={trimmed} />;
}

function ResolvedResults({ term }: { term: string }) {
  const t = useTranslations('search');
  const {
    data,
    isPending,
    isError,
    error,
    isFetching,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    refetch,
    fetchNextPage,
  } = useSearch(term);

  // The people block is complete on page one, so later pages add nothing.
  const users = data?.pages[0]?.users ?? [];

  const feedQuery: FeedQueryResult = {
    data: data ? { pages: data.pages.map((page) => ({ items: page.posts })) } : undefined,
    isPending,
    isError,
    error,
    isFetching,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    refetch,
    fetchNextPage,
  };

  return (
    <div className="space-y-8">
      {users.length > 0 ? (
        <section aria-label={t('peopleTitle')} className="space-y-3">
          <h2 className="text-sm font-semibold tracking-tight text-muted-foreground uppercase">
            {t('peopleTitle')}
          </h2>

          <ul className="grid gap-3 sm:grid-cols-2">
            {users.map((user) => (
              <li key={user.user_id}>
                <PersonCard user={user} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label={t('postsTitle')} className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight text-muted-foreground uppercase">
          {t('postsTitle')}
        </h2>

        <PostFeed
          query={feedQuery}
          emptyTitle={t('emptyTitle', { term })}
          emptyBody={t('emptyBody')}
          loadingLabel={t('loading')}
        />
      </section>
    </div>
  );
}

/**
 * One person, resolved from the row itself.
 *
 * `SearchUserHit` carries `display_name` and `avatar_url` — the same deal as
 * `FollowUserView` — so this must not call `useAuthor`: one extra request per
 * hit for data already in hand.
 */
function PersonCard({ user }: { user: SearchUserHit }) {
  const t = useTranslations('search');
  const tFeed = useTranslations('feed');

  const name = user.display_name?.trim() || tFeed('authorFallback', { id: user.user_id });
  const initial = name.slice(0, 1).toUpperCase();

  return (
    <Link
      href={`${ROUTES.profile}/${String(user.user_id)}`}
      aria-label={t('openProfile', { name })}
      className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Avatar size="default">
        {user.avatar_url ? <AvatarImage src={mediaUrl(user.avatar_url)} alt="" /> : null}
        <AvatarFallback aria-hidden="true">{initial}</AvatarFallback>
      </Avatar>

      <span className="block min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
        {name}
      </span>
    </Link>
  );
}
