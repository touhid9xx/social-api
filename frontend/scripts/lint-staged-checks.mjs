#!/usr/bin/env node
/**
 * Staged-file lint/format pass for the `frontend/` package, invoked by
 * lint-staged via `.husky/pre-commit` at the repository root.
 *
 * The hook has to run from the git toplevel (the Python project), but both
 * tools resolve configuration from their *working directory* — not from the
 * directory of the file being processed:
 *
 *   - ESLint 9 discovers its flat config by searching up from `process.cwd()`,
 *     so from the toplevel it aborts with "couldn't find an eslint.config".
 *   - Prettier resolves `plugins` from `process.cwd()` too, so from the
 *     toplevel it fails with "Cannot find package
 *     'prettier-plugin-tailwindcss'". (`--config` does not help: the plugin is
 *     still imported from a `noop.js` anchored at the cwd.)
 *
 * Rather than duplicating the toolchain options on the command line, this
 * wrapper re-roots the processes in `frontend/`, which is exactly the
 * environment `pnpm lint` and `pnpm format` use — one source of truth,
 * `frontend/.prettierrc.json`, and identical output to a manual run.
 *
 * lint-staged hands us absolute file paths, so re-rooting the cwd does not
 * affect which files are processed.
 *
 * Files are ordered eslint-first: `eslint --fix` can rewrite code, and the
 * formatter must see the final text.
 *
 * `NODE_PATH` is the other half of re-rooting. `eslint-config-next` pulls in
 * `eslint-plugin-react-hooks` & friends, which pnpm keeps in its hidden hoist
 * directory (`node_modules/.pnpm/node_modules`) instead of linking them beside
 * `eslint`. `pnpm exec`/`pnpm run` export that directory on `NODE_PATH`, so
 * eslint resolves them; a bare `node …/eslint.js` does not, and dies with
 * "couldn't find the plugin". Mirroring the variable here keeps the hook
 * behaving exactly like `pnpm lint`.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND_DIR = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const ESLINT_BIN = path.join(FRONTEND_DIR, 'node_modules', 'eslint', 'bin', 'eslint.js');
const PRETTIER_BIN = path.join(FRONTEND_DIR, 'node_modules', 'prettier', 'bin', 'prettier.cjs');

/** pnpm's hidden hoist directory — where eslint-config-next's plugins live. */
const HOISTED_MODULES = path.join(FRONTEND_DIR, 'node_modules', '.pnpm', 'node_modules');

/** Only TypeScript sources are linted; everything else is format-only. */
const LINTABLE_EXTENSIONS = new Set(['.ts', '.tsx']);

const files = process.argv.slice(2).filter(Boolean);

if (files.length === 0) process.exit(0);

const nodePath = [HOISTED_MODULES, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);

/** Runs a Node CLI from the frontend package root and returns its exit code. */
const run = (bin, args) => {
  const { status, error } = spawnSync(process.execPath, [bin, ...args], {
    cwd: FRONTEND_DIR,
    stdio: 'inherit',
    env: { ...process.env, NODE_PATH: nodePath },
  });
  if (error) throw error;
  return status ?? 1;
};

const lintable = files.filter((file) => LINTABLE_EXTENSIONS.has(path.extname(file).toLowerCase()));

let status = 0;

if (lintable.length > 0) status = run(ESLINT_BIN, ['--fix', ...lintable]) || status;
status = run(PRETTIER_BIN, ['--write', ...files]) || status;

process.exit(status);
