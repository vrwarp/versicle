import js from '@eslint/js';
import globals from 'globals';
import importPlugin from 'eslint-plugin-import';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

// Phase 0 ratchet (plan/overhaul/README.md §4 rule 3): new rule sets land at
// "warn" until the repo is clean, then flip to "error". jsx-a11y recommended
// is downgraded wholesale here; do not silently re-upgrade individual rules
// while violations exist.
const downgradeToWarn = (rules) =>
  Object.fromEntries(
    Object.entries(rules).map(([name, entry]) => [
      name,
      Array.isArray(entry) ? ['warn', ...entry.slice(1)] : 'warn',
    ]),
  );

export default tseslint.config(
  // .claude holds agent worktrees (full checkouts under .claude/worktrees/<name>/);
  // without the ignore, a top-level `eslint .` would also lint every worktree's copy.
  { ignores: ['dist', 'coverage', 'venv', 'android', '.claude'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      import: importPlugin,
      'jsx-a11y': jsxA11y,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    settings: {
      // Without this, eslint-plugin-import parses imported .ts files with
      // espree, fails silently, and import/no-cycle reports nothing.
      'import/parsers': {
        '@typescript-eslint/parser': ['.ts', '.tsx'],
      },
      'import/resolver': {
        typescript: {
          // tsconfig.json is solution-style (files: []); point the resolver
          // at the project configs that actually include source files.
          project: ['tsconfig.app.json', 'tsconfig.test.json', 'tsconfig.node.json'],
        },
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // a11y baseline (Phase 0): recommended preset, everything at warn.
      ...downgradeToWarn(jsxA11y.flatConfigs.recommended.rules),
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Worker-purity contract (C12): type-only imports must say `import type`
      // so they are erased from the runtime graph. With verbatimModuleSyntax
      // on, a plain value import is PRESERVED by the bundler — one missing
      // `type` keyword can pull zustand/yjs/stores into the TTS worker chunk
      // (see .dependency-cruiser.cjs and scripts/check-worker-chunk.mjs).
      // Error level: the repo was autofixed clean when this rule landed.
      // disallowTypeAnnotations stays off: inline `import('…')` type
      // annotations (18 sites, mostly typeof-import in tests and deliberate
      // store-type references in lib/) are type-position-only by
      // construction, always erased, and have no autofix.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { disallowTypeAnnotations: false },
      ],
      // Runtime import cycles (16 chains today, see layering-deps.md LD-2).
      // Warn until the cycles are broken in Phase 1+; the depcruise baseline
      // (.dependency-cruiser-baseline.json) is the authoritative ratchet.
      'import/no-cycle': 'warn',
      // One canonical import path per module (Phase 1 path-alias codemod,
      // scripts/codemod-aliases.mjs): a relative specifier that climbs out
      // with `../` and re-enters one of the aliased src/ roots must use the
      // alias instead (@app/, @components/, @db/, @hooks/, @lib/, @store/,
      // ~types/, @test/, @workers/ — declared in tsconfig.app.json `paths`,
      // mirrored in vite.config.ts + vitest.config.ts resolve.alias; types/
      // is ~types because TS rejects '@types/…' specifiers, TS6137).
      // Same-directory and within-subtree relative imports stay relative on
      // purpose. The repo was codemodded clean, so this lands at "error".
      // Scope notes: the rule covers static import/export declarations only
      // (the core rule does not visit dynamic import() or `new URL(...)`
      // worker URLs — the two `new Worker(new URL('../workers/…'))` sites
      // stay relative deliberately); src/layouts and src/data have no alias
      // yet (src/data is reshaped in Phase 3), so relative imports of those
      // roots remain allowed.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex:
                '^(\\.\\./)+(app|components|db|hooks|lib|store|types|test|workers)(/|$)',
              message:
                'Cross-root relative import. Use the path alias for this root instead (e.g. @lib/foo, @store/bar, ~types/baz — see tsconfig.app.json "paths"). Run `node scripts/codemod-aliases.mjs` to fix in bulk.',
            },
          ],
        },
      ],
    },
  },
);
