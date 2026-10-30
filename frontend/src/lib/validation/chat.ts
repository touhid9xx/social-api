import { z } from 'zod';

/**
 * Composer schema for `MessageCreate`.
 *
 * Mirrors `src/social_api/modules/chat/schemas.py`:
 *   `body`     Field(min_length=1, max_length=4000)
 *   `media_id` Field(default=None, ge=1)
 *
 * Same conventions as `./comment`: the body is trimmed BEFORE the length check
 * (a message of spaces is empty even though it is not zero characters), and
 * errors are i18n KEYS (`chat.validation.<key>`), never sentences, so both
 * locales stay in sync.
 *
 * `media_id` is deliberately absent. The backend accepts one, but nothing in the
 * app can produce a media id yet (there is no upload UI), so putting it in the
 * form would add a field that can only ever be null. The API layer still accepts
 * it — see `sendMessage` — so the day an uploader lands, only the composer grows.
 */

export const MESSAGE_BODY_MAX_LENGTH = 4000;

export const messageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, { message: 'bodyRequired' })
    .max(MESSAGE_BODY_MAX_LENGTH, { message: 'bodyTooLong' }),
});

export type MessageValues = z.infer<typeof messageSchema>;

export const EMPTY_MESSAGE_VALUES: MessageValues = { body: '' };
