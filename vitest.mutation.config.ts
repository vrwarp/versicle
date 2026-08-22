/**
 * Vitest config for mutation testing (see stryker.config.json).
 *
 * A mutation run executes tests once per surviving mutant, and the full
 * suite is 3,300+ tests over ~136s, so it narrows the test set to the sync
 * domain. `include` is set by REPLACING it rather than via mergeConfig —
 * mergeConfig concatenates arrays, which silently keeps the base config's
 * globs and runs everything.
 *
 * Scope rationale: `src/domains/sync/**` (plus the `src/app/sync/**`
 * wiring) is the code that drives y-cinder, y-idb and
 * zustand-middleware-yjs, and it is where a silent defect costs the most —
 * divergence or data loss across a user's devices, which no user-visible
 * error surfaces.
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
      'src/app/sync/**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    coverage: { enabled: false },
  },
});
