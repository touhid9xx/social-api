'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthor } from '@/hooks/use-author';
import { useComments } from '@/hooks/use-comments';
import { useInView } from '@/hooks/use-in-view';
import type { CommentView } from '@/lib/api/comments';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

import { CommentForm } from './comment-form';
import { LikeButton } from './like-button';

/**
 * One post's comments.
 *
 * The list is flat-ish on purpose: `GET /comments` paginates TOP-LEVEL comments
 * and serialises each one's replies inline, and the backend caps depth at 2
 * (`MAX_COMMENT_DEPTH`). So the thread is rendered as exactly two levels and the
 * "Reply" control is only offered on the outer one — a reply-to-a-reply would be
 * a guaranteed `COMMENT_DEPTH_EXCEEDED`, and offering a button whose only outcome
 * is that error is worse than not offering it.
 *
 * Like the feed, a failed *next page* must not wipe the comments already read,
 * and "load more" exists both as a sentinel and as a real button.
 *
 * (কমেন্টের গভীরতা সর্বোচ্চ দুই স্তর — তাই reply শুধু উপরের স্তরে।)
 */

function flattenComments(pages: Array<{ items: CommentView[] }>): CommentView[] {
  const seen = new Set<number>();
  const comments: CommentView[] = [];

  for (const page of pages) {
    for (const comment of page.items) {
      if (seen.has(comment.id)) continue;
      seen.add(comment.id);
      comments.push(comment);
    }
  }

  return comments;
}

function CommentItem({
  comment,
  postId,
  canReply,
}: {
  comment: CommentView;
  postId: number;
  /** False for replies — depth is capped at two on the server. */
  canReply: boolean;
}) {
  const t = useTranslations('feed');
  const tComments = useTranslations('feed.comments');
  const locale = useLocale();
  const { data: author } = useAuthor(comment.author_id);
  const [replying, setReplying] = useState(false);

  // Same fallback the feed card uses: the payload carries an id, not a name, and
  // a thread that renders a blank author is unreadable while the profile loads.
  const displayName =
    author?.display_name?.trim() || t('authorFallback', { id: comment.author_id });

  const replies = comment.replies ?? [];

  return (
    <li className="space-y-2">
      <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-semibold text-foreground">{displayName}</span>

          <span aria-hidden="true" className="text-xs text-muted-foreground">
            ·
          </span>

          <time dateTime={comment.created_at} className="text-xs text-muted-foreground">
            {formatRelativeTime(comment.created_at, locale)}
          </time>

          {comment.is_edited ? (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[0.7rem] font-medium text-muted-foreground">
              {t('edited')}
            </span>
          ) : null}
        </header>

        <p className="mt-2 text-[0.925rem] leading-relaxed text-pretty break-words whitespace-pre-line text-card-foreground">
          {comment.body}
        </p>

        <footer className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
          <LikeButton
            targetId={comment.id}
            targetType="comment"
            isLiked={comment.is_liked_by_me}
            count={comment.like_count}
          />

          {canReply ? (
            <button
              type="button"
              onClick={() => setReplying((open) => !open)}
              aria-expanded={replying}
              className={cn(
                'rounded-full px-1.5 py-0.5 font-medium transition-colors',
                'hover:bg-accent hover:text-accent-foreground',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              )}
            >
              {tComments('reply')}
            </button>
          ) : null}
        </footer>
      </div>

      {replying ? (
        <div className="ml-4 sm:ml-6">
          <CommentForm
            postId={postId}
            parentId={comment.id}
            replyingTo={displayName}
            onDone={() => setReplying(false)}
            autoFocus
          />
        </div>
      ) : null}

      {replies.length > 0 ? (
        <ul className="ml-4 space-y-2 border-l border-border/60 pl-3 sm:ml-6">
          {replies.map((reply) => (
            <CommentItem key={reply.id} comment={reply} postId={postId} canReply={false} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function CommentsSkeleton() {
  const tComments = useTranslations('feed.comments');

  return (
    <div aria-busy="true" aria-live="polite" className="space-y-3">
      <span className="sr-only">{tComments('loadingComments')}</span>
      {[0, 1].map((index) => (
        <div key={index} className="space-y-2 rounded-xl border border-border bg-card p-4">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      ))}
    </div>
  );
}

export function CommentThread({ postId }: { postId: number }) {
  const tFeed = useTranslations('feed');
  const t = useTranslations('feed.comments');
  const {
    data,
    isPending,
    isError,
    isFetching,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isFetchNextPageError,
  } = useComments(postId);

  const canLoadMore = hasNextPage && !isFetchingNextPage;
  const sentinelRef = useInView<HTMLDivElement>(() => {
    if (canLoadMore) void fetchNextPage();
  }, canLoadMore);

  if (isPending) return <CommentsSkeleton />;

  const comments = data ? flattenComments(data.pages) : [];

  // A failed next page also flips `isError`; only claim the page-level failure
  // when nothing loaded, otherwise the comments on screen would vanish.
  if (isError && comments.length === 0) {
    return (
      <div
        role="alert"
        className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center"
      >
        <h3 className="text-base font-semibold text-foreground">{tFeed('errorTitle')}</h3>
        <p className="text-sm text-muted-foreground">{tFeed('errorBody')}</p>
        <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
          {tFeed('retry')}
        </Button>
      </div>
    );
  }

  if (comments.length === 0) {
    return (
      <div className="space-y-2 rounded-xl border border-dashed border-border p-6 text-center">
        <h3 className="text-base font-semibold text-foreground">{t('emptyTitle')}</h3>
        <p className="text-sm text-pretty text-muted-foreground">{t('emptyBody')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {comments.map((comment) => (
          <CommentItem key={comment.id} comment={comment} postId={postId} canReply />
        ))}
      </ul>

      {hasNextPage ? (
        <div className="space-y-3">
          <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />

          <div className="flex flex-col items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchNextPage()}
              disabled={!canLoadMore}
              aria-busy={isFetchingNextPage}
            >
              {isFetchingNextPage ? t('loadingMore') : t('loadMore')}
            </Button>

            {isFetchNextPageError ? (
              <p role="alert" className="text-xs text-destructive">
                {t('loadMoreFailed')}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
