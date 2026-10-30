import { describe, expect, it } from 'vitest';
import type { ZodError } from 'zod';

import { DEFAULT_POST_VALUES, POST_BODY_MAX_LENGTH, POST_VISIBILITIES, postSchema } from './post';

/**
 * The composer schema.
 *
 * Two behaviours are worth pinning because the server would reject them anyway
 * but only after a round trip: the body is trimmed BEFORE the length check (a
 * post of spaces is empty to every reader), and the visibility enum mirrors
 * `PostCreate` exactly, so an invented option can never reach the request body.
 *
 * Messages are i18n KEYS, not sentences — asserted as such, because a sentence
 * here would only ever be translated on one locale.
 *
 * (space দিয়ে পোস্ট করা যায় না — server-এ যাওয়ার আগেই এখানে ধরা পড়ে।)
 */

type ParseLike = { success: boolean; error?: ZodError };

function messages(result: ParseLike): string[] {
  return result.error?.issues.map((issue) => issue.message) ?? [];
}

function firstMessage(result: ParseLike): string | undefined {
  return messages(result)[0];
}

describe('postSchema constraints', () => {
  it('matches the backend column cap', () => {
    // `posts/schemas.py`: Field(min_length=1, max_length=5000)
    expect(POST_BODY_MAX_LENGTH).toBe(5000);
  });

  it('offers exactly the visibilities PostCreate accepts', () => {
    expect([...POST_VISIBILITIES]).toEqual(['public', 'followers', 'private']);
  });

  it('starts from an empty public draft', () => {
    expect(DEFAULT_POST_VALUES).toEqual({ body: '', visibility: 'public' });
    // The default must be valid except for the body, or the composer would open
    // with a visibility error the user never caused.
    expect(firstMessage(postSchema.safeParse(DEFAULT_POST_VALUES))).toBe('bodyRequired');
  });
});

describe('postSchema body', () => {
  it('accepts a normal body', () => {
    expect(postSchema.safeParse({ body: 'Hello feed', visibility: 'public' }).success).toBe(true);
  });

  it('trims surrounding whitespace before validating', () => {
    const parsed = postSchema.parse({ body: '  Hello feed  ', visibility: 'public' });

    expect(parsed.body).toBe('Hello feed');
  });

  it('rejects an empty body with a message KEY, not a sentence', () => {
    expect(firstMessage(postSchema.safeParse({ body: '', visibility: 'public' }))).toBe(
      'bodyRequired',
    );
  });

  it('rejects a whitespace-only body', () => {
    // 3 characters, zero words: trimming happens first, so this is empty.
    expect(firstMessage(postSchema.safeParse({ body: '   \n\t ', visibility: 'public' }))).toBe(
      'bodyRequired',
    );
  });

  it('accepts a body of exactly the maximum length', () => {
    const body = 'a'.repeat(POST_BODY_MAX_LENGTH);

    expect(postSchema.safeParse({ body, visibility: 'public' }).success).toBe(true);
  });

  it('rejects one character past the maximum', () => {
    const body = 'a'.repeat(POST_BODY_MAX_LENGTH + 1);

    expect(firstMessage(postSchema.safeParse({ body, visibility: 'public' }))).toBe('bodyTooLong');
  });

  it('measures the trimmed body, not the padding', () => {
    // 5000 real characters plus surrounding space is still a legal post.
    const parsed = postSchema.safeParse({
      body: `   ${'a'.repeat(POST_BODY_MAX_LENGTH)}   `,
      visibility: 'public',
    });

    expect(parsed.success).toBe(true);
  });
});

describe('postSchema visibility', () => {
  it.each(['public', 'followers', 'private'] as const)('accepts %s', (visibility) => {
    expect(postSchema.safeParse({ body: 'Hello', visibility }).success).toBe(true);
  });

  it('rejects anything the backend Literal would reject', () => {
    expect(firstMessage(postSchema.safeParse({ body: 'Hello', visibility: 'everyone' }))).toBe(
      'visibilityInvalid',
    );
  });

  it('does not fall back to a default for a bad visibility', () => {
    // A silent default would publish a private draft to the public feed.
    const parsed = postSchema.safeParse({ body: 'Hello', visibility: '' });

    expect(parsed.success).toBe(false);
  });
});
