import { z } from 'zod';

/**
 * Auth form schemas.
 *
 * These mirror the backend contract exactly — do not relax them:
 *   `RegisterRequest.password`  Field(min_length=12, max_length=128)
 *                               + `validate_password_policy` (upper, lower, digit, symbol)
 *   `LoginRequest.password`     Field(min_length=1, max_length=128)
 *   `email`                     EmailStr
 * Source: src/social_api/modules/auth/schemas.py + src/social_api/core/password.py.
 *
 * Validation messages are i18n KEYS, not sentences: the form translates
 * `auth.validation.<key>` so both locales stay in sync. Zod issues are never
 * rendered raw.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const EMAIL_MAX_LENGTH = 254;

/** One flag per policy clause the backend enforces. */
export const PASSWORD_RULES = ['length', 'lower', 'upper', 'digit', 'symbol'] as const;

export type PasswordRule = (typeof PASSWORD_RULES)[number];

export type PasswordChecks = Record<PasswordRule, boolean>;

/** Live policy checklist for the UI (same clauses as `_PASSWORD_RE`). */
export function passwordChecks(value: string): PasswordChecks {
  return {
    length: value.length >= PASSWORD_MIN_LENGTH,
    lower: /[a-z]/.test(value),
    upper: /[A-Z]/.test(value),
    digit: /\d/.test(value),
    symbol: /[^A-Za-z0-9]/.test(value),
  };
}

const emailField = z
  .string()
  .trim()
  .min(1, { message: 'emailRequired' })
  .max(EMAIL_MAX_LENGTH, { message: 'emailInvalid' })
  .email({ message: 'emailInvalid' });

export const loginSchema = z.object({
  email: emailField,
  password: z
    .string()
    .min(1, { message: 'passwordRequired' })
    .max(PASSWORD_MAX_LENGTH, { message: 'passwordTooLong' }),
});

export type LoginValues = z.infer<typeof loginSchema>;

/**
 * A password the backend will actually accept.
 *
 * Shared by registration and reset: `RegisterRequest.password` and
 * `ResetPasswordRequest.new_password` carry the SAME `Field(12..128)` bounds and
 * the same `validate_password_policy` validator, so two schemas that could drift
 * apart would be two chances to disagree with the contract. One definition, two
 * forms.
 */
const strongPasswordField = z
  .string()
  .min(1, { message: 'passwordRequired' })
  .max(PASSWORD_MAX_LENGTH, { message: 'passwordTooLong' })
  .superRefine((value, ctx) => {
    const checks = passwordChecks(value);
    if (!checks.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'passwordTooShort' });
      return;
    }
    if (!checks.lower || !checks.upper || !checks.digit || !checks.symbol) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'passwordTooWeak' });
    }
  });

export const registerSchema = z.object({
  email: emailField,
  password: strongPasswordField,
});

export type RegisterValues = z.infer<typeof registerSchema>;

/** `ForgotPasswordRequest` is `{ email: EmailStr }` — nothing else. */
export const forgotPasswordSchema = z.object({ email: emailField });

export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

/**
 * The password half of `ResetPasswordRequest`.
 *
 * The token is NOT part of this schema: it arrives in the URL, not in the form,
 * and `resetPasswordSchema` validating a field the user cannot edit would only
 * produce an error message pointing at nothing.
 */
export const resetPasswordSchema = z.object({ password: strongPasswordField });

export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

/**
 * The two halves of `ChangePasswordRequest`.
 *
 * `new_password` gets the SAME `strongPasswordField` as registration and reset —
 * the backend runs `validate_password_policy` on it identically — while
 * `current_password` is only bounded like `LoginRequest.password` (1..128): it is
 * compared, never stored, and over-validating it would turn a wrong-password
 * guess into a 422 that leaks the expected shape.
 *
 * No "must differ from the current one" rule: the backend does not enforce it, so
 * a schema that rejected it would refuse input the API accepts.
 */
export const changePasswordSchema = z.object({
  currentPassword: z
    .string()
    .min(1, { message: 'passwordRequired' })
    .max(PASSWORD_MAX_LENGTH, { message: 'passwordTooLong' }),
  newPassword: strongPasswordField,
});

export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

export type FieldErrors<TValues> = Partial<Record<keyof TValues & string, string>>;

/** First issue per field, keyed by field name — enough to render one message each. */
export function toFieldErrors<TValues>(error: z.ZodError): FieldErrors<TValues> {
  const errors: FieldErrors<TValues> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field !== 'string') continue;
    const key = field as keyof TValues & string;
    errors[key] ??= issue.message;
  }
  return errors;
}
