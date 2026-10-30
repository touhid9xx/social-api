import { z } from 'zod';

import type { ProfileUpdate, SelfProfile } from '@/lib/api/users';

/**
 * Settings → profile form schema.
 *
 * Mirrors `ProfileUpdate` in `src/social_api/modules/users/schemas.py` field by
 * field. Two rules matter and neither is obvious from the backend model:
 *
 *  1. **Empty means null.** Every column is nullable and `display_name` carries
 *     `min_length=1`, so a cleared input must travel as `null`. Validating a
 *     blank name as "too short" would trap the user: the only way to clear a
 *     field would be a server round trip that always fails. All fields are
 *     therefore allowed to be blank, and the caller maps `''` → `null`.
 *  2. **`version` is not here.** It is not something the user edits; it comes
 *     from the profile that was read and is attached at submit time. Putting it
 *     in the form state would let a re-render send a stale lock.
 *
 * Messages are i18n KEYS (`settings.validation.<key>`), never sentences — the
 * same convention as `@/lib/validation/auth` and `@/lib/validation/post`.
 */

export const DISPLAY_NAME_MAX_LENGTH = 64;
export const BIO_MAX_LENGTH = 500;
export const LOCATION_MAX_LENGTH = 128;
export const PHONE_MAX_LENGTH = 32;
export const ADDRESS_MAX_LENGTH = 512;

/** `VisibilityLiteral` — shared by `visibility` and `pii_visibility`. */
export const PROFILE_VISIBILITIES = ['public', 'followers', 'private'] as const;

export type ProfileVisibility = (typeof PROFILE_VISIBILITIES)[number];

const DOB_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A real calendar date in `YYYY-MM-DD`.
 *
 * `new Date('2024-02-31')` rolls over to March 2 instead of failing, so a
 * pattern check alone would let an impossible date reach the server — and the
 * backend's `date.fromisoformat` would then reject the whole PATCH. Round-trip
 * the parts instead.
 */
function isIsoDate(value: string): boolean {
  if (!DOB_PATTERN.test(value)) return false;

  const [yearPart, monthPart, dayPart] = value.split('-');
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * An absolute http(s) URL.
 *
 * `ProfileUpdate.website` / `avatar_url` are `HttpUrl`, which accepts only
 * http/https — `z.string().url()` is looser (it allows `javascript:` and
 * `mailto:`), so relaxing to it would ship a stored-XSS vector that the backend
 * happens to reject today. Same rule `safeWebsite` applies when rendering.
 */
function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

const websiteField = z
  .string()
  .trim()
  .max(2048, { message: 'websiteInvalid' })
  .refine((value) => value === '' || isHttpUrl(value), { message: 'websiteInvalid' });

const dobField = z
  .string()
  .trim()
  .refine((value) => value === '' || isIsoDate(value), { message: 'dobInvalid' });

export const profileSchema = z.object({
  display_name: z.string().trim().max(DISPLAY_NAME_MAX_LENGTH, { message: 'displayNameTooLong' }),
  bio: z.string().trim().max(BIO_MAX_LENGTH, { message: 'bioTooLong' }),
  location: z.string().trim().max(LOCATION_MAX_LENGTH, { message: 'locationTooLong' }),
  website: websiteField,
  phone: z.string().trim().max(PHONE_MAX_LENGTH, { message: 'phoneTooLong' }),
  address: z.string().trim().max(ADDRESS_MAX_LENGTH, { message: 'addressTooLong' }),
  dob: dobField,
  visibility: z.enum(PROFILE_VISIBILITIES, { message: 'visibilityInvalid' }),
  pii_visibility: z.enum(PROFILE_VISIBILITIES, { message: 'visibilityInvalid' }),
});

export type ProfileValues = z.infer<typeof profileSchema>;

/** Empty form state — every field is a string because every control is a text input. */
export const EMPTY_PROFILE_VALUES: ProfileValues = {
  display_name: '',
  bio: '',
  location: '',
  website: '',
  phone: '',
  address: '',
  dob: '',
  visibility: 'public',
  pii_visibility: 'private',
};

/**
 * The text fields shared by `ProfileSelf` and `ProfileUpdate`.
 *
 * Listed once so `toProfileValues` and `toProfileUpdate` cannot drift: adding a
 * column to the backend and the Zod schema still requires touching this array,
 * which is the point — it is the single list of "things edited by a text input".
 * `visibility` / `pii_visibility` are excluded because they are selects whose
 * value is never blank.
 */
const TEXT_FIELDS = [
  'display_name',
  'bio',
  'location',
  'website',
  'phone',
  'address',
  'dob',
] as const;

/** A profile as the form wants it: every control is a string. */
export function toProfileValues(profile: SelfProfile): ProfileValues {
  return {
    display_name: profile.display_name ?? '',
    bio: profile.bio ?? '',
    location: profile.location ?? '',
    website: profile.website ?? '',
    phone: profile.phone ?? '',
    address: profile.address ?? '',
    dob: profile.dob ?? '',
    visibility: profile.visibility,
    pii_visibility: profile.pii_visibility,
  };
}

/**
 * Form values -> `PATCH /users/me` body.
 *
 * Three rules, each of which is load-bearing:
 *
 *  1. **`version` comes from the profile, never the form.** It is the lock the
 *     backend compares against; taking it from state the user can re-render
 *     would let a stale value overwrite someone else's change.
 *  2. **Blank becomes `null`, not `undefined`.** `undefined` means "leave this
 *     alone" to `model_dump(exclude_unset=True)`, so omitting a cleared field
 *     would silently keep the old value and the input would appear to save
 *     nothing.
 *  3. **Unchanged fields are omitted.** The model is `extra="forbid"` and every
 *     send is a write, so shipping noise merely widens the lost-update window.
 *     Comparison is against the profile that was read, which is where `version`
 *     came from — the two must agree or the diff is meaningless.
 */
export function toProfileUpdate(values: ProfileValues, profile: SelfProfile): ProfileUpdate {
  const payload: ProfileUpdate = { version: profile.version };

  for (const field of TEXT_FIELDS) {
    const trimmed = values[field].trim();
    const next = trimmed === '' ? null : trimmed;

    if (next !== (profile[field] ?? null)) {
      payload[field] = next;
    }
  }

  if (values.visibility !== profile.visibility) {
    payload.visibility = values.visibility;
  }

  if (values.pii_visibility !== profile.pii_visibility) {
    payload.pii_visibility = values.pii_visibility;
  }

  return payload;
}
