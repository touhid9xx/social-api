import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle at .next/standalone so the Docker
  // runtime image needs neither node_modules nor pnpm (see frontend/Dockerfile).
  // Harmless for `next dev` and `next start` on the host.
  output: 'standalone',
  // This app lives at <repo>/frontend, nested inside the Python backend repo,
  // which has its own package-lock.json one level up. Left unset, Next walks
  // up, picks that lockfile as the workspace root and traces the ENTIRE
  // backend (src, venv, data/) into the build output, plus prints a
  // "multiple lockfiles" warning on every dev start. Pin it to this package.
  outputFileTracingRoot: path.resolve(process.cwd()),
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'https', hostname: 'localhost' },
    ],
  },
};

export default withNextIntl(nextConfig);
