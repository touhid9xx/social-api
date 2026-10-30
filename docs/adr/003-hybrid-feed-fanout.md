# ADR-003: Hybrid feed fanout

**Status:** Accepted

## Context

Home feed = posts from accounts the viewer follows, sorted newest-first.

Two classic approaches:

1. **Read fanout** (pull): on GET /feed, query DB for posts from
   following ∪ self, sorted, paginated.
2. **Write fanout** (push): on POST /posts, insert the new post ID into
   every follower's cached feed (Redis ZSET).

Each has a failure mode:
- **Read fanout at scale** — every GET is a `GROUP BY`/join over
  potentially thousands of followed authors. With 1M users each
  following ~200 accounts, that's a heavy query per request.
- **Write fanout at scale** — a "celebrity" with 1M followers requires
  1M Redis writes per post. At 10 posts/minute that's 166K writes/sec
  to Redis — impossible.

## Decision

**Hybrid: write fanout for normal authors, read merge for celebrities.**

Celebrity threshold: `FEED_FANOUT_THRESHOLD` (default 5000 followers).

### Write path (POST /posts)
followers = SELECT follower_ids LIMIT threshold
if len(followers) < threshold:
enqueue fanout_new_post (Celery task)
→ task: ZADD feed:home:{follower} for each follower + author
else:
invalidate follower caches (no per-follower writes)
skip fanout entirely
text

### Read path (GET /feed/home)
Read cache (ZSET feed:home:{user}, newest 500 IDs).

If miss: query DB for post IDs (following ∪ self), populate cache.

Identify celebrity authors in following set (follower_count ≥ threshold).

Merge cached posts + celebrity authors' recent posts.

Dedupe by post_id, sort by (created_at DESC, id DESC).

Apply cursor + limit.

## Consequences

**Positive:**
- Normal-author posts reach follower feeds in < 5s (fanout latency).
- Celebrity posts reach everyone in O(1) per viewer (a DB query per
  celebrity-authors-in-following, bounded by max followings per viewer).
- Fanout task size bounded by `threshold` (5000) — no infinite loops.

**Negative:**
- Complexity: two code paths (write fanout vs read merge) that can drift.
  Mitigation: E2E test in M25 explicitly exercises both (famous user + normal user).
- Celebrity set is recomputed per feed request → extra DB query per GET.
  Mitigation: cache the set in Redis per user (M21+ optimization; not yet implemented).
- Threshold is a magic number. At 5000 followers, a fanout is 5000
  Redis ZADDs × 3 = 15K ops. At 5ms per op = 75ms per celebrity-following
  request during fanout. Acceptable; would need tuning at 10× scale.

**Alternative rejected:** uniform write fanout. Celebrity posts would
need pre-computed fanout (batch every 5m — defeats "newest first"),
or a push notification hack. Complexity similar; latency worse.

## Future

- Store celebrity set per user in Redis (`feed:celebrities:{user}`),
  refreshed on follow/unfollow. Saves one DB query per feed GET.
- Consider a hybrid threshold per-request based on viewer's following
  count (viewers following >10K accounts get read-only feed).
- Batch fanout via a single `pipeline.ZADD` with all followers
  (already done in `_do_fanout`, chunked at 500).
