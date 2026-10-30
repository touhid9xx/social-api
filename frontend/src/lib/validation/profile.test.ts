import type { ZodError } from 'zod';
import { describe, expect, it } from 'vitest';

import type { SelfProfile } from '@/lib/api/users';

import {
  DISPLAY_NAME_MAX_LENGTH,
  EMPTY_PROFILE_VALUES,
  PROFILE_VISIBILITIES,
  profileSchema,
  toProfileUpdate,
  toProfileValues,
} from './profile';

/**
 * The settings profile schema and its two mappers.
 *
 * Two rules are only reachable here rather than through the form:
 *
 *  1. **A real calendar date.** `new Date('2024-02-31')` rolls over to March 2
 *     instead of failing, so the check round-trips the parts. A `type="date"`
 *     input cannot even hold an impossible value, so no component test can
 *     express this case.
 *  2. **http(s) only.** `z.string().url()` accepts `javascript:` and `mailto:`,
 *     which the backend's `HttpUrl` rejects today — relaxing to it would ship a
 *     stored-XSS vector the moment that validation moves.
 *
 * `toProfileUpdate` is pinned field by field because it is the only place the
 * three rules of the PATCH body (version from the profile, blank -> null,
 * unchanged omitted) exist.
 *
 * (খালি মান `null` হয়ে যায়, আর বদলানো হয়নি এমন ফিল্ড পাঠানো হয় না।)
 */

type ParseLike = { success: boolean; error?: ZodError };

function messages(result: ParseLike): string[] {
  return result.error?.issues.map((issue) => issue.message) ?? [];
}

function firstMessage(result: ParseLike): string | undefined {
  return messages(result)[0];
}

/** Nothing changed from the profile below: the baseline every diff starts from. */
const profile: SelfProfile = {
  user_id: 21,
  display_name: 'Admin',
  bio: 'Runs the place.',
  avatar_url: null,
  location: 'Dhaka',
  website: null,
  visibility: 'public',
  pii_visibility: 'private',
  dob: null,
  phone: null,
  address: null,
  version: 7,
  created_at: '2026-01-01T09:00:00.000Z',
  updated_at: '2026-01-01T09:00:00.000Z',
};

describe('profileSchema', () => {
  it('promotes an entirely blank form — blank means "clear", not "invalid"', () => {
    // `display_name` is `min_length=1` on the backend, so a blank name has to be
    // allowed here and mapped to `null` at submit time. Validating it as "too
    // short" would make clearing a field impossible.
    expect(profileSchema.safeParse(EMPTY_PROFILE_VALUES).success).toBe(true);
  });

  it('matches the backend column caps', () => {
    // `users/schemas.py::ProfileUpdate`
    expect(DISPLAY_NAME_MAX_LENGTH).toBe(64);
    expect(
      firstMessage(
        profileSchema.safeParse({ ...EMPTY_PROFILE_VALUES, display_name: 'a'.repeat(65) }),
      ),
    ).toBe('displayNameTooLong');
    expect(
      profileSchema.safeParse({ ...EMPTY_PROFILE_VALUES, display_name: 'a'.repeat(64) }).success,
    ).toBe(true);
  });

  it('trims before measuring', () => {
    const parsed = profileSchema.parse({ ...EMPTY_PROFILE_VALUES, display_name: '  Admin  ' });

    expect(parsed.display_name).toBe('Admin');
  });

  it.each(['https://example.com', 'http://example.com/@me'])(
    'accepts the http url %s',
    (website) => {
      expect(profileSchema.safeParse({ ...EMPTY_PROFILE_VALUES, website }).success).toBe(true);
    },
  );

  it.each(['javascript:alert(1)', 'mailto:me@example.com', 'example.com'])(
    'rejects the non-http url %s',
    (website) => {
      // `HttpUrl` on the backend, `safeWebsite` on the render side, this here: the
      // rule has to hold at every hop or the loosest one wins.
      expect(firstMessage(profileSchema.safeParse({ ...EMPTY_PROFILE_VALUES, website }))).toBe(
        'websiteInvalid',
      );
    },
  );

  it.each(['2024-02-29', '1990-12-31'])('accepts the real date %s', (dob) => {
    expect(profileSchema.safeParse({ ...EMPTY_PROFILE_VALUES, dob }).success).toBe(true);
  });

  it('rejects a date that only looks valid', () => {
    // Roll-over, not a parse error: `new Date('2024-02-31')` is March 2nd.
    expect(
      firstMessage(profileSchema.safeParse({ ...EMPTY_PROFILE_VALUES, dob: '2024-02-31' })),
    ).toBe('dobInvalid');
  });

  it('rejects a date that is not a leap day', () => {
    // 2023 is not a leap year, so February 29th does not exist.
    expect(
      firstMessage(profileSchema.safeParse({ ...EMPTY_PROFILE_VALUES, dob: '2023-02-29' })),
    ).toBe('dobInvalid');
  });

  it('offers exactly the visibilities ProfileUpdate accepts', () => {
    expect([...PROFILE_VISIBILITIES]).toEqual(['public', 'followers', 'private']);
    expect(
      firstMessage(profileSchema.safeParse({ ...EMPTY_PROFILE_VALUES, visibility: 'everyone' })),
    ).toBe('visibilityInvalid');
  });
});

describe('toProfileValues', () => {
  it('turns every nullable column into the empty string a control can hold', () => {
    expect(toProfileValues(profile)).toEqual({
      display_name: 'Admin',
      bio: 'Runs the place.',
      location: 'Dhaka',
      website: '',
      phone: '',
      address: '',
      dob: '',
      visibility: 'public',
      pii_visibility: 'private',
    });
  });
});

describe('toProfileUpdate', () => {
  it('sends nothing but the lock when the form is untouched', () => {
    // `extra="forbid"`: an unchanged field is still a write, and a write only
    // widens the lost-update window.
    expect(toProfileUpdate(toProfileValues(profile), profile)).toEqual({ version: 7 });
  });

  it('takes the version from the profile, never from the values', () => {
    // The lock is what makes a lost update fail loudly rather than silently win.
    expect(toProfileUpdate(toProfileValues(profile), { ...profile, version: 12 }).version).toBe(12);
  });

  it('maps an emptied field to null so the column is actually cleared', () => {
    const payload = toProfileUpdate(
      { ...toProfileValues(profile), bio: '', display_name: '   ' },
      profile,
    );

    expect(payload).toEqual({ version: 7, bio: null, display_name: null });
  });

  it('sends only the fields that differ', () => {
    const payload = toProfileUpdate(
      { ...toProfileValues(profile), location: 'Chattogram' },
      profile,
    );

    expect(payload).toEqual({ version: 7, location: 'Chattogram' });
  });

  it('treats a whitespace-padded edit of the same value as no change', () => {
    const payload = toProfileUpdate(
      { ...toProfileValues(profile), bio: '  Runs the place.  ' },
      profile,
    );

    expect(payload).toEqual({ version: 7 });
  });

  it('sends both visibilities when they move, and neither when they do not', () => {
    const changed = toProfileUpdate(
      { ...toProfileValues(profile), visibility: 'followers', pii_visibility: 'public' },
      profile,
    );

    expect(changed).toEqual({ version: 7, visibility: 'followers', pii_visibility: 'public' });
  });

  it('distinguishes "still null" from "cleared"', () => {
    // `website` is null on this profile, so leaving it blank changes nothing,
    // while setting it is a real edit — the two must not collapse.
    expect(toProfileUpdate({ ...toProfileValues(profile), website: '' }, profile)).toEqual({
      version: 7,
    });
    expect(
      toProfileUpdate({ ...toProfileValues(profile), website: 'https://a.example' }, profile),
    ).toEqual({ version: 7, website: 'https://a.example' });
  });
});
