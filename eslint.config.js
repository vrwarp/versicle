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
    '^(\\.\\./)+(app|components|data|domains|hooks|kernel|lib|store|types|test|workers)(/|$)',
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

// TTS engine access goes through the command facade (Phase 5b-PR1;
// phase5-tts-strangler.md §5b.4): components use the useAudioCommands()
// hook, non-component app code uses getTtsController() — both in
// src/app/tts/. getAudioPlayer() is the engine composition root and is
// private to that directory (an override below re-grants it there).
const audioPlayerImportBan = {
  name: '@app/tts/mainThreadAudioPlayer',
  message:
    'Engine commands live on the TtsController facade (Phase 5b): use ' +
    'useAudioCommands() in components or getTtsController() in app code ' +
    '(src/app/tts/). getAudioPlayer() is private to src/app/tts/.',
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
            audioPlayerImportBan,
          ],
        },
      ],
    },
  },
  // The TTS engine composition root is private to src/app/tts/ (Phase 5b-PR1;
  // phase5-tts-strangler.md §5b.4): production code talks to the engine
  // through the TtsController command facade (useAudioCommands in components,
  // getTtsController elsewhere in app/), never through getAudioPlayer()
  // directly. This override re-grants the import inside src/app/tts/ itself —
  // flat-config rule entries replace, so the cross-root pattern and the
  // zustand/idb bans are restated.
  {
    files: ['src/app/tts/**/*.{ts,tsx}'],
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
            audioPlayerImportBan,
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
  //
  // Since Phase 7 (§I) this block ALSO carries the raw-egress ban (C9/C12
  // rule 7): all network egress goes through
  // `NetworkGateway.egress(destinationId, …)` and same-origin/blob fetches
  // through `localFetch` (both src/kernel/net) — raw fetch/XMLHttpRequest/
  // navigator.sendBeacon are banned everywhere else, at ERROR (the repo was
  // migrated clean when this landed). Exemptions, each restating ONLY the
  // selectors that still apply (flat-config same-named rules are last-wins):
  //  - src/kernel/net/** (the gateway itself) — carve-out block below;
  //  - src/lib/tts/engine/** and src/lib/tts/providers/** — their dedicated
  //    no-restricted-syntax blocks below intentionally omit the fetch
  //    selectors: the provider fetch sites (GoogleTTSProvider, PiperProvider,
  //    PiperRuntime, BaseCloudProvider) are owned by the parallel Phase 5b/5c
  //    chain and migrate onto egress() when it merges (their destinations
  //    are already declared in kernel/net/destinations.ts).
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
        {
          selector: "CallExpression[callee.name='fetch']",
          message:
            'Raw fetch is banned outside src/kernel/net (Phase 7 egress ' +
            'boundary). Remote hosts: NetworkGateway.egress(destinationId, …) ' +
            'with a kernel/net/destinations.ts registry entry (CSP is ' +
            'generated from it). Same-origin/blob URLs: localFetch().',
        },
        {
          selector:
            "CallExpression[callee.object.name='globalThis'][callee.property.name='fetch'], " +
            "CallExpression[callee.object.name='window'][callee.property.name='fetch'], " +
            "CallExpression[callee.object.name='self'][callee.property.name='fetch']",
          message:
            'Raw fetch (via globalThis/window/self) is banned outside ' +
            'src/kernel/net — use NetworkGateway.egress() or localFetch().',
        },
        {
          selector: "NewExpression[callee.name='XMLHttpRequest']",
          message:
            'XMLHttpRequest is banned (Phase 7 egress boundary) — use ' +
            'NetworkGateway.egress() / localFetch() from src/kernel/net.',
        },
        {
          selector: "CallExpression[callee.property.name='sendBeacon']",
          message:
            'navigator.sendBeacon is banned (Phase 7 egress boundary) — use ' +
            'NetworkGateway.egress() from src/kernel/net.',
        },
      ],
    },
  },
  // kernel/net carve-out: the gateway is the ONE place raw fetch is legal.
  // The readwrite-transaction selector is restated (flat-config same-named
  // rules replace, never merge). Test files share the carve-out: the egress
  // boundary is a PRODUCTION property (tests stub fetch via vi.stubGlobal and
  // the emulator suites fetch localhost REST endpoints); the engine/providers
  // blocks below still win for their own directories.
  {
    files: [
      'src/kernel/net/**/*.{ts,tsx}',
      'src/**/*.test.{ts,tsx}',
      'src/test/**/*.{ts,tsx}',
    ],
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
  // Engine-dir vi.mock ban (Phase 5; phase5-tts-strangler.md N3 + §vi.mock
  // policy, README §4 rule 3 ratchet "vi.mock in engine/provider/data dirs →
  // 0"): the allowlist reached ZERO at 5b-PR4. The entry-gate freeze held
  // four modules ({@data/repos/bookContent, @data/repos/playbackCache,
  // ../LexiconService, ../PlatformIntegration} — the post-P3 rewrite of the
  // doc's `@db/DBService` entry); the decomposition replaced every direct
  // import with EngineContext ports (BookContentPort + SessionStore), so the
  // suites now inject in-memory fakes (FakeEngineContext, FakePlaybackBackend,
  // parityHostDb port factories, WorkerTtsEngine constructor ports) and
  // every vi.mock/vi.doMock in the directory is a lint error.
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
            "CallExpression[callee.object.name='vi'][callee.property.name=/^(mock|doMock)$/]",
          message:
            'vi.mock in src/lib/tts/engine/ is banned (allowlist reached ZERO at ' +
            '5b-PR4; phase5-tts-strangler.md N3). Drive the engine through injected ' +
            'fakes instead: FakeEngineContext/FakePlaybackBackend, the parityHostDb ' +
            'port factories, or the WorkerTtsEngine constructor ports.',
        },
      ],
    },
  },
  // Provider-dir vi.mock ban (Phase 5a-PR2; phase5-tts-strangler.md §vi.mock
  // policy, README §4 rule 3 ratchet "vi.mock in engine/provider/data dirs →
  // 0"): provider suites drive providers through injected fakes (FakeAudioSink,
  // InMemoryTTSCache, FakePiperRuntime, stubbed fetch/speechSynthesis,
  // constructor-injected caches). Exactly ONE module mock remains allowed:
  //  - '@capacitor-community/text-to-speech' — a registered NATIVE plugin with
  //    no injection seam (the providers-dir analogue of the engine-dir
  //    PlatformIntegration entry; permanent until a Capacitor port exists).
  // The './piper-utils' entry died at 5a-PR3 with the module itself (the
  // injectable PiperRuntime replaced it).
  // Same flat-config caveat as the engine block above: same-named rules are
  // last-wins, so the readwrite selector is restated here.
  {
    files: ['src/lib/tts/providers/**/*.{ts,tsx}'],
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
            ":not([value='@capacitor-community/text-to-speech'])",
          message:
            'vi.mock in src/lib/tts/providers/ is banned (5a-PR2) except for ' +
            '@capacitor-community/text-to-speech (native plugin, no injection seam). ' +
            'Inject fakes instead: FakeAudioSink + InMemoryTTSCache + FakePiperRuntime ' +
            'via the provider constructors, vi.stubGlobal for fetch/speechSynthesis.',
        },
        {
          selector:
            "CallExpression[callee.object.name='vi'][callee.property.name=/^(mock|doMock)$/][arguments.0.type!='Literal']",
          message:
            'vi.mock in src/lib/tts/providers/ must name its module as a plain string ' +
            'literal so the allowlist rule above can see it.',
        },
      ],
    },
  },
);
