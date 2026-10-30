/**
 * Lint/format gate for the `frontend/` workspace, run by `.husky/pre-commit`.
 *
 * This config sits at the repository root on purpose. lint-staged resolves every
 * staged path with `path.resolve(cwd, filename)`, and git reports filenames
 * relative to the repository root — so running it from `frontend/` would turn a
 * staged `frontend/src/x.ts` into `frontend/frontend/src/x.ts`. It therefore runs
 * from the root, and the pattern below carries the `frontend/` prefix instead of
 * being scoped by a working directory.
 *
 * The `/` in the pattern is also load-bearing: lint-staged enables picomatch's
 * `matchBase` for slash-free patterns, which would make `*.ts` match
 * `contracts/types.ts` as well.
 *
 * Both tools are invoked through `frontend/scripts/lint-staged-checks.mjs`
 * because ESLint and Prettier resolve their config — and Prettier its plugins —
 * from the working directory, which here is the root. The wrapper re-roots them
 * in `frontend/`, delegates the per-extension split (lint + format for
 * TypeScript, format-only for the rest) and keeps the toolchain options in
 * `frontend/.prettierrc.json` and `frontend/eslint.config.mjs` only.
 */
export default {
  'frontend/**/*.{ts,tsx,json,md,css,mjs,yml,yaml}': 'node frontend/scripts/lint-staged-checks.mjs',
};
