import { fileURLToPath, URL } from 'node:url';
import { defineConfig, configDefaults } from 'vitest/config';

// THE single vitest config. Do not add a `test` block to vite.config.ts —
// when a root vitest.config.ts exists, vitest ignores the `test` field of
// vite.config.ts entirely, so anything added there is silently dead
// (this exact drift already happened once: the .claude worktree excludes
// landed in vite.config.ts and never took effect).
//
// Path aliases: because this file REPLACES vite.config.ts for vitest (it
// does not merge it), the resolve.alias map below is a deliberate copy of
// the one in vite.config.ts. Keep both in sync with the `paths` map in
// tsconfig.app.json.
const srcAlias = (dir: string) => fileURLToPath(new URL(`./src/${dir}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // `virtual:pwa-register/react` only exists inside a Vite build with
      // vite-plugin-pwa active (Phase 8 §G); vitest resolves it to a typed
      // inert stub with the same API shape.
      'virtual:pwa-register/react': fileURLToPath(
        new URL('./src/test/harness/pwaRegisterStub.ts', import.meta.url),
      ),
      '@app': srcAlias('app'),
      '@components': srcAlias('components'),
      '@data': srcAlias('data'),
      '@domains': srcAlias('domains'),
      '@hooks': srcAlias('hooks'),
      '@kernel': srcAlias('kernel'),
      '@lib': srcAlias('lib'),
      '@store': srcAlias('store'),
      '~types': srcAlias('types'),
      '@test': srcAlias('test'),
      '@workers': srcAlias('workers'),
    },
    // Single-instance guard (phase2-fork-surgery.md §6.6c): the upstream
    // y-cinder / y-idb / zustand-middleware-yjs deps declare yjs/zustand/lib0
    // as peers; dedupe is the bundler-level belt-and-braces so a second copy
    // can never split `instanceof Y.Map` identity (or y-idb's lib0/observable
    // base). Keep in sync with vite.config.ts and assert-single-instance.cjs.
    dedupe: ['yjs', 'zustand', 'lib0'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 60000,
    // All unit/integration tests live under src/, plus the relocated
    // contract suites for the upstream y-idb / y-cinder / zustand-middleware-yjs
    // deps (test/vendor-contracts/, black-box against the published packages).
    // The explicit include keeps vitest from discovering stray *.test.* files at
    // the repo root or inside agent worktrees (.claude/worktrees/<name>/ are
    // full repo checkouts).
    include: [
      'src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'test/**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    // Defense in depth if the include ever widens: never descend into the
    // Playwright suite (verification/) or .claude/ worktrees.
    exclude: [...configDefaults.exclude, 'verification/**', '.claude/**', '**/.claude/**'],
    // Coverage baseline (Phase 0; plan/overhaul/README.md §4 rule 8): run via
    // `npm run coverage`; totals are pinned in coverage-baseline.json and may
    // not decrease. Not a PR-blocking gate yet — the ratchet is enforced by
    // review against the committed baseline until a CI gate lands.
    coverage: {
      provider: 'v8',
      // Count ALL src code (not just files a test happens to import) so the
      // denominator is stable: deleting a test (or its imports) cannot
      // inflate the percentages. Test files themselves are excluded by
      // vitest automatically; src/test/ harness code is excluded here.
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**'],
      reporter: ['text-summary', 'json-summary'],
    },
  },
});
