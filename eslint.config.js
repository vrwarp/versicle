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

// Shared by the base no-restricted-imports rule and the store-registry
// override below (flat-config rule entries replace, never merge — the
// override must restate the cross-root pattern or it would silently vanish
// for the files it matches).
const crossRootRelativeImportPattern = {
  regex:
    '^(\\.\\./)+(app|components|data|domains|hooks|lib|store|types|test|workers)(/|$)',
  message:
    'Cross-root relative import. Use the path alias for this root instead (e.g. @lib/foo, @data/bar, ~types/baz — see tsconfig.app.json "paths"). Run `node scripts/codemod-aliases.mjs` to fix in bulk.',
};

// Storage-gateway boundary (Phase 3 D8, C12): raw `idb` access is the data
// layer's exclusive privilege — everything else goes through the src/data
// repos (which serialize every readwrite transaction through the
// cross-context write gate; concurrent readwrite transactions are the proven
// WebKit IndexedDB hang trigger). Error level: the repo was migrated clean
// when this rule flipped (P3-12).
const idbImportBan = {
  name: 'idb',
  message:
    'Raw IndexedDB access is the data layer’s job. Use the src/data repos ' +
    '(@data/repos/*) or, inside src/data, the connection/write-gate modules.',
};

export default tseslint.config(
  // .claude holds agent worktrees (full checkouts under .claude/worktrees/<name>/);
  // without the ignore, a top-level `eslint .` would also lint every worktree's copy.
  // packages/*/src is VENDORED fork source (zustand-middleware-yjs incl. its
  // ported upstream specs; y-idb's upstream JS + hand-maintained d.ts): it
  // predates this repo's lint discipline and stays diff-minimal against
  // upstream by design (each package's PROVENANCE.md), so it is exempt.
  // The first-party contract suites in packages/*/test ARE linted.
  // dist-types*/ are tsc -b declaration outputs (gitignored).
  {
    ignores: [
      'dist',
      'coverage',
      'venv',
      'android',
      '.claude',
      'packages/zustand-middleware-yjs/src',
      'packages/y-idb/src',
      'packages/*/dist-types',
      'packages/*/dist-types-test',
    ],
  },
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
      // alias instead (@app/, @components/, @data/, @hooks/, @lib/,
      // @store/, ~types/, @test/, @workers/ — declared in tsconfig.app.json
      // `paths`, mirrored in vite.config.ts + vitest.config.ts
      // resolve.alias; types/ is ~types because TS rejects '@types/…'
      // specifiers, TS6137).
      // Same-directory and within-subtree relative imports stay relative on
      // purpose. The repo was codemodded clean, so this lands at "error".
      // Scope notes: the rule covers static import/export declarations only
      // (the core rule does not visit dynamic import() or `new URL(...)`
      // worker URLs — the two `new Worker(new URL('../workers/…'))` sites
      // stay relative deliberately); src/layouts has no alias yet, so
      // relative imports of it remain allowed. @data landed in Phase 3
      // (P3-3/P3-4) when src/data/ became the storage layer.
      'no-restricted-imports': [
        'error',
        {
          patterns: [crossRootRelativeImportPattern],
        },
      ],
    },
  },
  // Store-registry seam (Phase 2, phase2-fork-surgery.md §2.5): synced stores
  // are wired exclusively through defineSyncedStore in
  // src/store/yjs-provider.ts — that module is the only production `yjs()`
  // call site (the def aggregation lives in src/store/registry.ts, which
  // stores must never import — see its module docs). Banning the
  // middleware's default import everywhere else makes the seam structural.
  // Named (type) imports — YjsOptions, YjsStoreHandle, getYjsStoreHandle —
  // stay allowed, as do tests (contract/fixture suites bind mirror stores).
  // Since Phase 3 (P3-12) this block also carries the production `idb`
  // import ban (src/data is excluded — raw idb is its exclusive privilege;
  // flat-config rule entries replace, so the cross-root pattern and the
  // zustand ban are restated wherever this rule is re-declared).
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/data/**', 'src/store/yjs-provider.ts', 'src/**/*.test.{ts,tsx}', 'src/test/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [crossRootRelativeImportPattern],
          paths: [
            {
              name: 'zustand-middleware-yjs',
              importNames: ['default'],
              message:
                'Create synced stores via defineSyncedStore (src/store/registry.ts) — the registry is the only production yjs() middleware call site.',
            },
            idbImportBan,
          ],
        },
      ],
    },
  },
  // Sync transport owns no UX copy (Phase 4 §D3, master plan rule 3): the
  // toast store is banned for production sync modules — transports emit
  // typed SyncEvents (src/domains/sync/events.ts) and the ONE subscriber,
  // src/app/sync/wireSyncEvents.ts, maps them to user-facing strings.
  // Error level: the repo was migrated clean when this landed (P4-3a).
  // Tests stay exempt (they spy on the toast store to pin the mapping).
  // Flat-config rule entries replace, so the cross-root pattern and the
  // zustand/idb bans are restated here.
  {
    files: ['src/lib/sync/**/*.{ts,tsx}', 'src/domains/sync/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [crossRootRelativeImportPattern],
          paths: [
            {
              name: 'zustand-middleware-yjs',
              importNames: ['default'],
              message:
                'Create synced stores via defineSyncedStore (src/store/registry.ts) — the registry is the only production yjs() middleware call site.',
            },
            idbImportBan,
            {
              name: '@store/useToastStore',
              message:
                'Sync transport must not own UX copy. Emit a typed SyncEvent ' +
                '(src/domains/sync/events.ts); the single subscriber ' +
                '(src/app/sync/wireSyncEvents.ts) owns the toast mapping.',
            },
          ],
        },
      ],
    },
  },
  // The `idb` ban extends to TEST files outside src/data (Phase 3 exit:
  // zero exceptions — seed through the repos, the connection module, or
  // one-shot db.get/put/clear helpers obtained from @data/connection).
  // The zustand default-import ban deliberately does NOT apply here
  // (contract/fixture suites bind mirror stores).
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    ignores: ['src/data/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [crossRootRelativeImportPattern],
          paths: [idbImportBan],
        },
      ],
    },
  },
  // Readwrite-transaction ban outside the data layer (Phase 3 D8, C12):
  // depcruise cannot see string arguments, so the ban is syntactic. A
  // readwrite transaction opened outside the write gate can overlap a Yjs
  // flush — the proven cross-context WebKit hang pair (write-gate.ts docs).
  // Reads (readonly transactions, one-shot db.get/getAll) stay free.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/data/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='transaction'] > Literal[value='readwrite']",
          message:
            'readwrite transactions are banned outside src/data — route the ' +
            'write through a @data/repos/* method (every repo writer holds ' +
            'the cross-context IDB write gate).',
        },
      ],
    },
  },
  // Engine-dir vi.mock allowlist (Phase 5 entry gate; phase5-tts-strangler.md
  // N3 + §vi.mock policy, README §4 rule 3 ratchet "vi.mock in
  // engine/provider/data dirs → 0"): the engine parity/unit suites drive the
  // engine through injected fakes (FakeEngineContext, FakePlaybackBackend),
  // but AudioPlayerService still imports the src/data repos directly and the
  // pipeline reaches LexiconService/PlatformIntegration, so exactly these
  // module mocks remain allowed inside src/lib/tts/engine/. The allowlist is
  // FROZEN here (rewired post-P3: the doc's `@db/DBService` entry became the
  // two repos that replaced it when src/db was deleted — see
  // plan/overhaul/prep/phase5-absorption-ledger.md §allowlist):
  //  - @data/repos/bookContent, @data/repos/playbackCache, ../LexiconService,
  //    ../PlatformIntegration → shrink to ZERO at 5b-PR5
  //    (SessionStore/lexicon ports replace the direct imports);
  //  - @app/tts/createWorkerEngineClient (WorkerEngineHandle.test.ts only) is
  //    the N1 inverted lib→app edge — it leaves this directory (and this
  //    allowlist) at 5b-PR1 when WorkerEngineHandle moves to src/app/tts/.
  // At 5b-PR5 the :not() clauses are deleted and every vi.mock/vi.doMock in
  // the directory becomes a lint error.
  //
  // Placement + the repeated readwrite selector are load-bearing: flat config
  // resolves same-named rules last-wins (options replace, never merge), so
  // this block must sit AFTER the Phase 3 readwrite-transaction ban above and
  // restate that selector — otherwise one of the two rules would silently
  // stop applying to src/lib/tts/engine/.
  {
    files: ['src/lib/tts/engine/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='transaction'] > Literal[value='readwrite']",
          message:
            'readwrite transactions are banned outside src/data — route the ' +
            'write through a @data/repos/* method (every repo writer holds ' +
            'the cross-context IDB write gate).',
        },
        {
          selector:
            "CallExpression[callee.object.name='vi'][callee.property.name=/^(mock|doMock)$/] > Literal" +
            ":not([value='@data/repos/bookContent'])" +
            ":not([value='@data/repos/playbackCache'])" +
            ":not([value='../LexiconService'])" +
            ":not([value='../PlatformIntegration'])" +
            ":not([value='@app/tts/createWorkerEngineClient'])",
          message:
            'vi.mock in src/lib/tts/engine/ is frozen to the allowlist ' +
            '{@data/repos/bookContent, @data/repos/playbackCache, ../LexiconService, ' +
            '../PlatformIntegration, @app/tts/createWorkerEngineClient} ' +
            '(phase5-tts-strangler.md N3; shrinks to ' +
            'ZERO at 5b-PR5). Drive the engine through injected fakes ' +
            '(FakeEngineContext/FakePlaybackBackend) instead.',
        },
        {
          selector:
            "CallExpression[callee.object.name='vi'][callee.property.name=/^(mock|doMock)$/][arguments.0.type!='Literal']",
          message:
            'vi.mock in src/lib/tts/engine/ must name its module as a plain string literal ' +
            'so the allowlist rule above can see it (phase5-tts-strangler.md N3).',
        },
      ],
    },
  },
);
