/**
 * Husky installer for a package nested inside the repository.
 *
 * `frontend/` has no `.git` of its own — the repository root is one level up — so
 * this cannot guard on a relative `.git` stat: doing that made it bail on every
 * real `pnpm install`, which is why the hooks never installed.
 *
 * It installs from the toplevel instead, which husky also requires: husky refuses
 * to run without `.git` in the current directory, writes `core.hooksPath`
 * relative to the repository root, and generates its shims under
 * `<toplevel>/.husky/_`. The tracked hook bodies live in the repository-root
 * `.husky/` directory. (`.husky/pre-commit` there explains why they cannot live
 * inside `frontend/`.)
 *
 * The guard is kept because `pnpm install` must stay green in reviewer
 * sandboxes, exported archives and CI tarballs that carry no `.git` at all.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HUSKY_BIN = fileURLToPath(new URL('../node_modules/husky/bin.js', import.meta.url));

/** Repo root of the working tree we are in, or '' when there is no git at all. */
function gitToplevel() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

const root = gitToplevel();

if (!root) {
  console.warn('[prepare] not inside a git work tree — skipping husky hook installation');
  process.exit(0);
}

execFileSync(process.execPath, [HUSKY_BIN], { cwd: root, stdio: 'inherit' });
