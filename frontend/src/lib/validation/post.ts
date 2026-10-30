import { z } from 'zod';

/**
 * Composer schema for `PostCreate`.
 *
 * Mirrors `src/social_api/modules/posts/schemas.py`:
 *   `body`       Field(min_length=1, max_length=5000)
 *   `visibility` Literal["public", "followers", "private"] (default "public")
 *
 * The body is trimmed before the length check, because a post of spaces is
 * empty to every reader even though it is 3 characters long. Messages are i18n
 * KEYS (`feed.composer.validation.<key>`), never sentences, so both locales
 * stay in sync — the same convention as `@/lib/validation/auth`.
 */

export const POST_BODY_MAX_LENGTH = 5000;

export const POST_VISIBILITIES = ['public', 'followers', 'private'] as const;

export type PostVisibility = (typeof POST_VISIBILITIES)[number];

export const postSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, { message: 'bodyRequired' })
    .max(POST_BODY_MAX_LENGTH, { message: 'bodyTooLong' }),
  visibility: z.enum(POST_VISIBILITIES, { message: 'visibilityInvalid' }),
});

export type PostValues = z.infer<typeof postSchema>;

export const DEFAULT_POST_VALUES: PostValues = { body: '', visibility: 'public' };
