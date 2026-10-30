/**
 * Husky installer that tolerates a checkout without `.git` (reviewer sandboxes,
 * exported archives, CI tarballs). Without this guard `pnpm install` fails on the
 * `prepare` lifecycle script in exactly those environments.
 *
 * (`.git` না থাকলে husky install বাদ দিই — নাহলে pnpm install-ই ভেঙে যাবে।)
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('.git')) {
  console.warn('[prepare] no .git directory — skipping husky hook installation');
  process.exit(0);
}

execSync('husky', { stdio: 'inherit' });
