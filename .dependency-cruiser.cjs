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
    {
      name: 'db-not-to-store',
      severity: 'warn',
      comment:
        'db/ must not import store/ — repositories depending on UI state ' +
        '(LD-4). The app-layer read-model mergers (BookRepository/' +
        'ContentAnalysisRepository) moved to src/app/repositories/ in ' +
        'Phase 1; this rule keeps db/ store-free.',
      from: { path: '^src/db' },
      to: { path: '^src/store' },
    },
    {
      name: 'components-not-to-db',
      severity: 'warn',
      comment:
        'components/ and layouts/ must not import db/ internals — UI goes ' +
        'through stores/hooks/services (problematic coupling #7 in ' +
        'layering-deps.md).',
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
        path: '^(src/store|node_modules/zustand|node_modules/yjs)',
        reachable: true,
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Only cruise production source; tests/e2e/tooling are out of scope for
    // the layering contract.
    includeOnly: { path: '^(src|node_modules/(zustand|yjs))' },
    exclude: {
      path: ['\\.test\\.(ts|tsx)$', '^src/test', '^src/setupTests\\.ts$'],
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
