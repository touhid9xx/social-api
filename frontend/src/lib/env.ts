import { z } from 'zod';

/**
 * Public (browser-exposed) environment. Validated once at module load so a
 * misconfigured deployment fails loudly instead of firing requests at the
 * wrong origin.
 *
 * (public env build-time-এ inline হয়, তাই প্রতিটি key সরাসরি process.env.X
 *  আকারে লিখতে হয় — destructuring করলে ট্রি-শেকিং value হারিয়ে যায়।)
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url().default('http://localhost'),
  NEXT_PUBLIC_WS_URL: z.string().url().default('ws://localhost'),
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default('Social'),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

const parsed = publicEnvSchema.safeParse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
});

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid public environment variables:\n${details}`);
}

export const env: PublicEnv = parsed.data;

/** HTTP API origin without a trailing slash, e.g. `http://localhost`. */
export const apiBaseUrl: string = env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '');

/** WebSocket origin without a trailing slash, e.g. `ws://localhost`. */
export const wsBaseUrl: string = env.NEXT_PUBLIC_WS_URL.replace(/\/+$/, '');
