/**
 * Vitest config for mutation testing (see stryker.config.json).
 *
 * A mutation run executes tests once per surviving mutant, and the full
 * suite is 3,300+ tests over ~136s, so it narrows the test set to the sync
 * domain. `include` is set by REPLACING it rather than via mergeConfig —
 * mergeConfig concatenates arrays, which silently keeps the base config's
 * globs and runs everything.
 *
 * Scope: the sync, reader and library domains (plus the `src/app/sync/**`
 * wiring). Sync drives y-cinder, y-idb and zustand-middleware-yjs, where a
 * silent defect means divergence or data loss across a user's devices;
 * library owns import, identity and reingest, where a defect corrupts or
 * loses a book; reader owns the engine and session recording. All three
 * fail quietly rather than loudly, which is what makes mutation testing
 * worth its runtime on them.
 */
import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

const base = baseConfig as { test?: Record<string, unknown>; resolve?: unknown; plugins?: unknown };

export default defineConfig({
  resolve: base.resolve as never,
  test: {
    ...(base.test ?? {}),
    include: [
      'src/domains/sync/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/domains/reader/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/domains/library/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/app/sync/**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    coverage: { enabled: false },
  },
});
