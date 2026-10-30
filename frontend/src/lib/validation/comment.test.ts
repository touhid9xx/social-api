import { describe, expect, it } from 'vitest';
import type { ZodError } from 'zod';

import {
  COMMENT_BODY_MAX_LENGTH,
  type CommentValues,
  DEFAULT_COMMENT_VALUES,
  commentSchema,
} from './comment';

/**
 * The comment schema.
 *
 * Same two rules as the composer: the body is trimmed BEFORE the length check,
 * and every message is an i18n KEY under `feed.comments.validation`, so neither
 * locale can drift.
 *
 * `parent_id` is deliberately NOT part of this schema. It is not user input — it
 * is the id of the comment the reply box was opened from — so validating it would
 * mean validating a value the user cannot see or change. It is checked by the
 * backend (`ge=1`) and by the depth rule.
 *
 * (space দিয়ে কমেন্ট করা যায় না — server-এ যাওয়ার আগেই এখানে ধরা পড়ে।)
 */

type ParseLike = { success: boolean; error?: ZodError };

function firstMessage(result: ParseLike): string | undefined {
  return result.error?.issues.map((issue) => issue.message)[0];
}

describe('commentSchema constraints', () => {
  it('matches the backend column cap', () => {
    // `comments/schemas.py`: Field(min_length=1, max_length=2000)
    expect(COMMENT_BODY_MAX_LENGTH).toBe(2000);
  });

  it('starts from an empty draft', () => {
    expect(DEFAULT_COMMENT_VALUES).toEqual({ body: '' });
    expect(firstMessage(commentSchema.safeParse(DEFAULT_COMMENT_VALUES))).toBe('bodyRequired');
  });

  it('rejects a whitespace-only body instead of posting it', () => {
    expect(firstMessage(commentSchema.safeParse({ body: '  \n\t ' }))).toBe('bodyRequired');
  });

  it('trims before validating', () => {
    const parsed: CommentValues = commentSchema.parse({ body: '  Nice post  ' });

    expect(parsed.body).toBe('Nice post');
  });

  it('accepts exactly the maximum length', () => {
    const body = 'a'.repeat(COMMENT_BODY_MAX_LENGTH);

    expect(commentSchema.safeParse({ body }).success).toBe(true);
  });

  it('rejects one character past the maximum, with a key', () => {
    const body = 'a'.repeat(COMMENT_BODY_MAX_LENGTH + 1);

    expect(firstMessage(commentSchema.safeParse({ body }))).toBe('bodyTooLong');
  });

  it('measures the trimmed body, not the padding', () => {
    const body = `  ${'a'.repeat(COMMENT_BODY_MAX_LENGTH)}  `;

    expect(commentSchema.safeParse({ body }).success).toBe(true);
  });
});
