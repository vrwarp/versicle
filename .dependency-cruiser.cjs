/**
 * Boundary-enforcement ruleset (Phase 0 of plan/overhaul/README.md).
 *
 * This encodes the master plan §2 boundary rules (the C12 layering &
 * worker-purity contract) as far as they map onto TODAY'S layout
 * (types/ lib/ db/ store/ hooks/ components/ workers/). The repo
 * currently violates most of them, so EVERY rule is severity "warn"
 * (ratchet model, master plan §4 rule 3): the current violation counts
 * are frozen in .dependency-cruiser-baseline.json and may only go down.
 *
 *   - regenerate baseline:  node scripts/depcruise-baseline.mjs
 *   - ratchet check:        node scripts/depcruise-baseline.mjs --check
 *   - human-readable run:   npm run depcruise
 *
 * Do NOT flip a rule to "error" while its baseline count is non-zero.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'warn',
      comment:
        'Circular dependencies (full graph, type imports included). ' +
        'Most chains route through types/db.ts importing lib/tts ' +
        '(see plan/overhaul/analysis/layering-deps.md LD-1/LD-2).',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-circular-runtime',
      severity: 'warn',
      comment:
        'Circular dependencies in the RUNTIME graph (cycles consisting ' +
        'only of non-type-only edges). These are the order-sensitive ones ' +
        'that force the dynamic-import hacks in store/yjs-provider.ts ' +
        '(LD-2/LD-9). Sharper ratchet than no-circular. NOTE: the ratchet ' +
        'script measures this rule via .dependency-cruiser.runtime.cjs ' +
        '(tsPreCompilationDeps: false) — on the full graph the one-cycle-' +
        'per-edge reporter undercounts runtime cycles whenever a type-only ' +
        'cycle path masks an all-runtime one (see that file for details).',
      from: {},
      to: {
        circular: true,
        viaOnly: { dependencyTypesNot: ['type-only'] },
      },
    },
    {
      name: 'types-imports-nothing',
      severity: 'warn',
      comment:
        'types/ is the L0 layer: it may not import any other internal ' +
        'module (master plan §2 rule 1 — kernel imports nothing). ' +
        'Today types/db.ts imports lib/tts (LD-1).',
      from: { path: '^src/types' },
      to: { path: '^src', pathNot: '^src/types' },
    },
    {
      name: 'kernel-imports-nothing',
      severity: 'error',
      comment:
        'src/kernel is the L0 layer (master plan §2 rule 1): admission ' +
        'requires zero internal deps and ≥2 consuming domains. Born at ' +
        'error with baseline 0 when kernel/cfi + kernel/locale joined ' +
        'kernel/diagnostics (Phase 5c). The kernel-boundary vitest suite ' +
        '(src/kernel/cfi/cfi.kernel-boundary.test.ts) covers test files, ' +
        'which this cruise excludes.',
      from: { path: '^src/kernel' },
      to: { path: '^src', pathNot: '^src/kernel' },
    },
    {
      name: 'lib-not-to-store',
      severity: 'warn',
      comment:
        'lib/ services must not reach into store/ — the service-locator ' +
        'inversion (97 getState() calls, LD-3). Ports + injected adapters ' +
        'are the destination pattern (master plan §2 rule 3).',
      from: { path: '^src/lib' },
      to: { path: '^src/store' },
    },
    {
      name: 'lib-not-to-components',
      severity: 'warn',
      comment:
        'lib/ must not import UI (components/ or layouts/): low-level ' +
        'services may not know about presentation.',
      from: { path: '^src/lib' },
      to: { path: '^src/(components|layouts)' },
    },
    // `db-not-to-store` was retired at Phase 3 exit (P3-12): src/db/** is
    // deleted (the wipe's dynamic store/sync imports — the rule's last
    // violation — became the data/wipe.ts hook registry, D9).
    {
      name: 'data-no-upward',
      severity: 'error',
      comment:
        'src/data is the storage gateway (Phase 3): it may import ~types, ' +
        '@lib/logger, idb/yjs/y-idb/zod — NEVER store/, hooks/, components/, ' +
        'app/, or lib/sync. Born at error with baseline 0 (D8); this is what ' +
        'keeps every repo importable from the TTS worker.',
      from: { path: '^src/data' },
      to: { path: '^src/(store|hooks|components|layouts|app|lib/sync)' },
    },
    {
      name: 'domains-no-store',
      severity: 'error',
      comment:
        'src/domains is the L3 vertical-module layer (Phase 4; master plan ' +
        '§2 rule 3): domain services never import state/ or UI — they ' +
        'declare ports and app/ injects store-backed adapters (the ' +
        'EngineContext pattern; see src/app/sync/createSync.ts and ' +
        'src/domains/sync/core/ports.ts). Born at error with baseline 0 ' +
        '(P4-3). ONE named carve-out: store/yjs-provider.ts — the live ' +
        'Y.Doc/persistence handles used by the relocated CheckpointService/' +
        'Inspector (a pure move per phase4-sync-strangler.md §D7); the ' +
        'staged-swap item reshapes those paths onto injected handles, after ' +
        'which the carve-out should be deleted.',
      from: { path: '^src/domains' },
      to: {
        path: '^src/(store|hooks|components|layouts|app)',
        pathNot: '^src/store/yjs-provider\\.ts$',
      },
    },
    {
      name: 'components-not-to-db',
      severity: 'warn',
      comment:
        'components/ and layouts/ must not import db/ internals — UI goes ' +
        'through stores/hooks/services. src/db/** was deleted at Phase 3 ' +
        'exit, so this is vacuously 0; the rule itself is a P9 deletion.',
      from: { path: '^src/(components|layouts)' },
      to: { path: '^src/db' },
    },
    {
      name: 'worker-no-state-typegraph',
      severity: 'warn',
      comment:
        'The worker import closure must not reach zustand, yjs, or ' +
        'src/store (master plan §2 rule 6; C12). This rule walks the FULL ' +
        'graph, type-only imports included — violations here are the "one ' +
        'import-type typo away" hazard (LD-7): the type-level closure of ' +
        'tts.worker reaches the stores. Ratchet it down by moving shared ' +
        'types into types/ (LD-1). The hard RUNTIME invariant (no zustand/ ' +
        'yjs/store code in the emitted worker chunk — a second Y.Doc in ' +
        'the worker is the data-corruption scenario BookRepository’s ' +
        'docstring warns about) cannot be expressed as a depcruise ' +
        'reachability rule (no edge-type filter on the walk); it is ' +
        'asserted post-build by `npm run check:worker-chunk`.',
      from: { path: '^src/workers' },
      to: {
        // packages/zustand-middleware-yjs and packages/y-idb are the
        // VENDORED forks (Phase 2 / Phase 3): since vendoring, they resolve
        // to packages/…/src, not node_modules — keep them inside this rule
        // (and includeOnly below) so the worker type-graph ratchet cannot
        // silently lose them. y-idb in the worker closure means a second
        // Y.Doc persistence inside the worker — the exact data-corruption
        // scenario the rule exists for.
        path: '^(src/store|packages/(zustand-middleware-yjs|y-idb)|node_modules/zustand|node_modules/yjs)',
        reachable: true,
      },
    },
  ],
  options: {
    // The vendored workspaces (zustand-middleware-yjs, y-idb) are treated
    // exactly like the external dependencies they replaced (Phase 2/3
    // vendoring): visible as boundary targets (includeOnly + the worker rule
    // above) but not cruised internally — their internal layering is each
    // package's own concern, and following them would inflate the per-module
    // violation counts the ratchet baseline froze (1 entry module ≙ the old
    // node_modules leaf).
    doNotFollow: { path: 'node_modules|^packages/(zustand-middleware-yjs|y-idb)' },
    // Only cruise production source; tests/e2e/tooling are out of scope for
    // the layering contract.
    includeOnly: {
      path: '^(src|packages/(zustand-middleware-yjs|y-idb)/src|node_modules/(zustand|yjs))',
    },
    exclude: {
      path: [
        '\\.test\\.(ts|tsx)$',
        '^src/test',
        '^src/setupTests\\.ts$',
        // the vendored fork's ported upstream specs
        '\\.spec\\.(ts|tsx)$',
      ],
    },
    // Include type-only imports in the graph: the types-layer and cycle
    // rules are specifically about `import type` poisoning (LD-1), and the
    // worker runtime rule filters them back out via viaOnly.
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.app.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
