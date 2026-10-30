import { z } from 'zod';

/**
 * Composer schema for `CommentCreate`.
 *
 * Mirrors `src/social_api/modules/comments/schemas.py`:
 *   `body`      Field(min_length=1, max_length=2000)
 *   `parent_id` Field(default=None, ge=1)
 *
 * Same two conventions as `./post`: the body is trimmed BEFORE the length check
 * (a comment of spaces is empty to every reader even though it is 3 characters
 * long), and messages are i18n KEYS (`feed.comments.validation.<key>`), never
 * sentences, so both locales stay in sync.
 */

export const COMMENT_BODY_MAX_LENGTH = 2000;

export const commentSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, { message: 'bodyRequired' })
    .max(COMMENT_BODY_MAX_LENGTH, { message: 'bodyTooLong' }),
});

export type CommentValues = z.infer<typeof commentSchema>;

export const DEFAULT_COMMENT_VALUES: CommentValues = { body: '' };
