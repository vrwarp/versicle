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
      '@app': srcAlias('app'),
      '@components': srcAlias('components'),
      '@data': srcAlias('data'),
      '@domains': srcAlias('domains'),
      '@hooks': srcAlias('hooks'),
      '@lib': srcAlias('lib'),
      '@store': srcAlias('store'),
      '~types': srcAlias('types'),
      '@test': srcAlias('test'),
      '@workers': srcAlias('workers'),
    },
    // Single-yjs-instance guard (phase2-fork-surgery.md §6.6c): the vendored
    // zustand-middleware-yjs workspace declares yjs/zustand as peers; dedupe
    // is the bundler-level belt-and-braces so a second copy can never split
    // `instanceof Y.Map` identity. Keep in sync with vite.config.ts.
    dedupe: ['yjs', 'zustand'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 60000,
    // All unit/integration tests live under src/, plus the vendored
    // zustand-middleware-yjs workspace package (its ported upstream specs in
    // src/ and the Phase 2 fork contract suite in test/). The explicit
    // include keeps vitest from discovering stray *.test.* files at the repo
    // root or inside agent worktrees (.claude/worktrees/<name>/ are full
    // repo checkouts).
    include: [
      'src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'packages/*/{src,test}/**/*.{test,spec}.?(c|m)[jt]s?(x)',
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
