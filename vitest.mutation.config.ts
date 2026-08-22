/**
 * Vitest config for mutation testing (see stryker.config.json).
 *
 * Extends the root config but narrows the test set to the sync domain. A
 * mutation run executes tests once per surviving mutant; the full suite is
 * 3,300+ tests over ~165s, so running it whole is not viable. Narrowing the
 * tests keeps both the dry run and every per-mutant run small.
 *
 * Scope rationale: `src/domains/sync/**` (plus the `src/app/sync/**` wiring)
 * is the code that drives y-cinder, y-idb and zustand-middleware-yjs, and it
 * is where a silent defect costs the most — divergence or data loss across a
 * user's devices, which no user-visible error surfaces. It is also
 * self-contained enough that its own tests are the tests that cover it.
 */
import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: [
        'src/domains/sync/**/*.{test,spec}.?(c|m)[jt]s?(x)',
        'src/app/sync/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      ],
    },
  })
);
