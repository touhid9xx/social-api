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

export const registerSchema = z.object({
  email: emailField,
  password: z
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
    }),
});

export type RegisterValues = z.infer<typeof registerSchema>;

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
