/**
 * Ambient declaration for global stylesheet side-effect imports.
 *
 * `app/layout.tsx` does `import './globals.css'`, which carries no types of its
 * own. Next only ships declarations for `next/image` assets, and the generated
 * `.next/types/*` files are build artefacts that do not exist on a fresh clone —
 * so without this, a type-check before the first `next build` reports
 * "Cannot find module or type declarations for side-effect import" (ts2882).
 *
 * Side-effect imports are intentionally untyped (`any`): nothing can import
 * *values* from a global stylesheet, so there is nothing to get wrong.
 */
declare module '*.css';
