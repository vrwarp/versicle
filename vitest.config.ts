import { defineConfig, configDefaults } from 'vitest/config';

// THE single vitest config. Do not add a `test` block to vite.config.ts —
// when a root vitest.config.ts exists, vitest ignores the `test` field of
// vite.config.ts entirely, so anything added there is silently dead
// (this exact drift already happened once: the .claude worktree excludes
// landed in vite.config.ts and never took effect).
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 60000,
    // All unit/integration tests live under src/. The explicit include keeps
    // vitest from discovering stray *.test.* files at the repo root or inside
    // agent worktrees (.claude/worktrees/<name>/ are full repo checkouts).
    include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    // Defense in depth if the include ever widens: never descend into the
    // Playwright suite (verification/) or .claude/ worktrees.
    exclude: [...configDefaults.exclude, 'verification/**', '.claude/**', '**/.claude/**'],
  },
});
