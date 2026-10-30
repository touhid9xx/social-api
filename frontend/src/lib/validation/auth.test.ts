import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import {
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES,
  loginSchema,
  passwordChecks,
  registerSchema,
  toFieldErrors,
} from './auth';

/** 12 characters, every policy class satisfied. */
const STRONG = 'StrongPass12!';

type ParseLike = { success: boolean; error?: ZodError };

function messages(result: ParseLike): string[] {
  return result.error?.issues.map((issue) => issue.message) ?? [];
}

function firstMessage(result: ParseLike): string | undefined {
  return messages(result)[0];
}

describe('loginSchema', () => {
  it('accepts a well-formed email and any non-empty password', () => {
    const parsed = loginSchema.safeParse({ email: 'admin@example.com', password: 'x' });

    expect(parsed.success).toBe(true);
  });

  it('trims surrounding whitespace from the email', () => {
    const parsed = loginSchema.parse({ email: '  admin@example.com  ', password: 'x' });

    expect(parsed.email).toBe('admin@example.com');
  });

  it('rejects an empty email with a message KEY, not a sentence', () => {
    expect(firstMessage(loginSchema.safeParse({ email: '', password: 'x' }))).toBe('emailRequired');
  });

  it('rejects a malformed email', () => {
    expect(firstMessage(loginSchema.safeParse({ email: 'not-an-email', password: 'x' }))).toBe(
      'emailInvalid',
    );
  });

  it('rejects an email longer than the column allows', () => {
    const email = `${'a'.repeat(EMAIL_MAX_LENGTH)}@example.com`;

    expect(firstMessage(loginSchema.safeParse({ email, password: 'x' }))).toBe('emailInvalid');
  });

  it('rejects an empty password', () => {
    expect(firstMessage(loginSchema.safeParse({ email: 'admin@example.com', password: '' }))).toBe(
      'passwordRequired',
    );
  });

  it('rejects a password past the backend max length', () => {
    const result = loginSchema.safeParse({
      email: 'admin@example.com',
      password: 'a'.repeat(PASSWORD_MAX_LENGTH + 1),
    });

    expect(firstMessage(result)).toBe('passwordTooLong');
  });

  it('does not enforce the registration policy on sign-in', () => {
    // Existing accounts may predate the policy; login must not lock them out.
    const result = loginSchema.safeParse({ email: 'admin@example.com', password: 'weak' });

    expect(result.success).toBe(true);
  });
});

describe('registerSchema', () => {
  it('accepts a password that satisfies every clause', () => {
    const result = registerSchema.safeParse({ email: 'new@example.com', password: STRONG });

    expect(result.success).toBe(true);
  });

  it('accepts exactly the minimum length', () => {
    const password = 'Abcdefghi1!x';
    expect(password).toHaveLength(PASSWORD_MIN_LENGTH);

    expect(registerSchema.safeParse({ email: 'new@example.com', password }).success).toBe(true);
  });

  it('reports the length problem before the class problems', () => {
    const result = registerSchema.safeParse({ email: 'new@example.com', password: 'short' });

    expect(messages(result)).toEqual(['passwordTooShort']);
  });

  it.each([
    ['no uppercase', 'lowercase123!'],
    ['no lowercase', 'UPPERCASE123!'],
    ['no digit', 'NoDigitsHere!'],
    ['no symbol', 'NoSymbols123'],
  ])('rejects a password with %s', (_label, password) => {
    const result = registerSchema.safeParse({ email: 'new@example.com', password });

    expect(result.success).toBe(false);
    expect(messages(result)).toContain('passwordTooWeak');
  });

  it('rejects a strong-but-too-long password on length only', () => {
    const password = `${'a'.repeat(PASSWORD_MAX_LENGTH - 3)}A1!b`;
    expect(password.length).toBeGreaterThan(PASSWORD_MAX_LENGTH);

    const result = registerSchema.safeParse({ email: 'new@example.com', password });

    expect(messages(result)).toEqual(['passwordTooLong']);
  });

  it('requires a valid email too', () => {
    const result = registerSchema.safeParse({ email: 'new@example', password: STRONG });

    expect(firstMessage(result)).toBe('emailInvalid');
  });
});

describe('passwordChecks', () => {
  it('flags every clause independently', () => {
    expect(passwordChecks('abcdefghijkl')).toEqual({
      length: true,
      lower: true,
      upper: false,
      digit: false,
      symbol: false,
    });

    expect(passwordChecks('ABC123!')).toEqual({
      length: false,
      lower: false,
      upper: true,
      digit: true,
      symbol: true,
    });

    expect(passwordChecks('')).toEqual({
      length: false,
      lower: false,
      upper: false,
      digit: false,
      symbol: false,
    });
  });

  it('treats non-ASCII characters as symbols, matching the backend regex', () => {
    // src/social_api/core/password.py tests [^A-Za-z0-9] for the symbol clause.
    expect(passwordChecks('aaaaaaaaaaaa১').symbol).toBe(true);
  });

  it('exposes one rule key per clause the backend enforces', () => {
    expect([...PASSWORD_RULES]).toEqual(['length', 'lower', 'upper', 'digit', 'symbol']);
    expect(Object.keys(passwordChecks(''))).toEqual([...PASSWORD_RULES]);
  });
});

describe('toFieldErrors', () => {
  it('keeps the first issue per field', () => {
    const errors = toFieldErrors<{ email: string; password: string }>(
      registerSchema.safeParse({ email: '', password: '' }).error!,
    );

    expect(errors).toEqual({ email: 'emailRequired', password: 'passwordRequired' });
  });

  it('drops issues that are not attached to a named field', () => {
    // A root-level refinement carries an empty path — there is no field to key it by.
    const rootIssue = new ZodError([{ code: 'custom', message: 'rootProblem', path: [] }]);

    expect(toFieldErrors<{ email: string }>(rootIssue)).toEqual({});
  });
});
