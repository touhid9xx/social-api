import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

const PUBLIC_KEYS = ['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_WS_URL', 'NEXT_PUBLIC_APP_NAME'] as const;

type PublicKey = (typeof PUBLIC_KEYS)[number];

/**
 * `lib/env.ts` validates at module load, so each case needs a fresh module
 * registry AND a controlled `process.env` before the import happens.
 *
 * (module-load-এ validate হয়, তাই প্রতি case-এ resetModules করে আবার import করতে হয়।)
 */
async function importEnv(overrides: Partial<Record<PublicKey, string>>) {
  vi.resetModules();
  for (const key of PUBLIC_KEYS) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
  return import('./env');
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe('public env contract', () => {
  it('falls back to local defaults when nothing is configured', async () => {
    const { apiBaseUrl, env, wsBaseUrl } = await importEnv({});

    expect(env.NEXT_PUBLIC_APP_NAME).toBe('Social');
    expect(apiBaseUrl).toBe('http://localhost');
    expect(wsBaseUrl).toBe('ws://localhost');
  });

  it('strips trailing slashes so callers can append a path safely', async () => {
    const { apiBaseUrl } = await importEnv({ NEXT_PUBLIC_API_URL: 'https://api.example.com/' });

    expect(apiBaseUrl).toBe('https://api.example.com');
  });

  it('fails loudly instead of firing requests at a malformed origin', async () => {
    await expect(importEnv({ NEXT_PUBLIC_API_URL: 'not-a-url' })).rejects.toThrow(
      /Invalid public environment variables/,
    );
  });
});
