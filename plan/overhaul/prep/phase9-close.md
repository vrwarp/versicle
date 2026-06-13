# Phase 9 close — ratchet completion & deletion audit (`p9-ratchets-and-audit`)

This is the program-exit audit record: the knip sweep, the lint-debt ratchet,
the §2 boundary-rule end-state table (input to the P9 docs item), and the
test-landscape reconciliation. Honest-exceptions discipline applies: anything
not enforced at error is named here with its mechanism and owner, never
implied.

## 1. knip sweep (deletion audit)

`knip.jsonc` is the committed config; `npm run knip` is a CI gate in the
quality job (zero findings at flip). Every intentional keep carries an
explicit ignore + reason in the config or a `@public` JSDoc tag at the export
(the drift-guard schema anchors in `src/data/rows/*`, the C10
`APP_ERROR_NAMESPACES` registry). Swept: ~270 dead export/type specifiers,
nine dead test-seam helpers, dead error classes never constructed
(`GoogleAuthRevokedError`/`GoogleAuthTransientError` — their C10 codes stay in
the append-only union), unused ui/ Radix subcomponents, dead `types/`
interfaces, five dependency husks (stale `@types/*`, `postinstall-postinstall`)
and five missing honest devDeps (`workbox-*`, imported directly by `sw.ts`).
Notable keep: `src/domains/sync/index.ts` — zero cross-domain consumers today,
kept as the rule-3 published surface (knip entry + reason).

## 2. Lint-debt ratchet (`as any` / `: any` / eslint-disable)

| Counter (production `src/`, tests excluded) | Phase 0 baseline | P9 entry | P9 exit |
|---|---|---|---|
| `as any` + `: any` sites | 138 | ~90 | **20** |
| eslint-disable directives | 245 | 98 | **25** |

- Mechanism: `scripts/lint-debt-ratchet.mjs` (`npm run lintdebt:check`, CI
  quality job, beside `depcruise:check`). Counts are computed on comment- and
  string-stripped source; only real disable DIRECTIVES count. Exact-match
  ratchet: counts above an entry fail (regression), below fail too until
  `--update` locks the decrease in. New entries need a hand-written reason.
- The irreducible rest lives in `lint-debt-allowlist.json`, one justified
  entry per file. Classes: the C1 IDB migration registry (`data/schema.ts` —
  legacy store names outside the current TypedDB union, by design), the C7/C8
  epubjs vendor boundary (engine + extractor files — upstream is untyped),
  the pre-schema `tts-storage` legacy envelope (fixture-pinned), and five
  judgment `react-hooks` disables with their reasons.
- Deliberate non-use is now expressed by the `_` naming convention
  (`argsIgnorePattern`/`ignoreRestSiblings` etc. in `eslint.config.js`), not
  disables — the 11 `no-unused-vars` disables died with the config.
- Vendored fork source (`packages/*/src`) is out of scope by the same
  diff-minimal policy as the eslint ignore block.

## 3. Boundary rules (master plan §2) — end-state enforcement table

Levels: **error** = CI-blocking, zero undocumented exceptions; **ratchet** =
warn-severity with a frozen baseline that may only decrease
(`depcruise:check`); **process** = review/test-enforced, no mechanical rule.

| # | Rule | Enforcement mechanism | Level | Named exceptions / residuals |
|---|---|---|---|---|
| 1 | kernel/ imports nothing internal; admission = zero deps + ≥2 consumers | depcruise `kernel-imports-nothing` **error** (0) + `types-imports-nothing` **error** (0, flipped P9); admission rule reviewed per C12 | error | `~types` is the one sanctioned dependency (in the rule itself) |
| 2 | All IDB via `data/` repos; readwrite + `idb` banned elsewhere | eslint `idb` import ban (prod AND tests) + `readwrite`-literal syntactic ban, both **error**; depcruise `data-no-upward` **error** (0); write-gate's synchronous-callback API structurally bans intra-transaction awaits | error | none — schema fixtures live inside `src/data/__fixtures__/` so the posture holds by construction |
| 3 | Domain services: kernel+data+own module+other domains' index only, never state/ | depcruise `domains-no-store` **error** (0) | error | ONE named carve-out: `store/yjs-provider.ts` for the relocated CheckpointService/Inspector live Y.Doc handles (named in the rule comment and the file headers) |
| 4 | Domain ui/ reads via published hooks; writes via services/controllers | store registry README + projection-port pattern (libraryViewStore et al.); review-enforced | process | no mechanical lint: a setter-import ban cannot distinguish reads from writes without heavy false positives; measured residual: 70 `.getState()` sites outside store/+app/ (mostly component event-handler reads + injected port handles) |
| 5 | `getState()` outside state/+app/ is a lint error | enforced STRUCTURALLY via the import graph: `domains-no-store` **error** (0), `lib-not-to-store` ratchet 54→**19** named edges; `.getState()` on an *injected* store handle is the sanctioned ports pattern, which a syntactic ban cannot distinguish from a store import | error (domains) / ratchet (lib) | the 19 baseline-frozen `lib/` edges (legacy geography: lib/tts engine context, LexiconService, BackupService…) |
| 6 | Worker import closure free of zustand/yjs/state | `check:worker-chunk` check 1 (emitted-chunk content assertion) **error** in the build gate; `consistent-type-imports` **error**; depcruise `no-circular` **error** (0 — the last type-only cycle died in P9) + `no-circular-runtime` **error** (0, flipped P9) | error (runtime invariant) | `worker-no-state-typegraph` stays a ratchet at 16 type-only closure edges (the "one `import type` typo away" hazard meter; the chunk check is the hard floor) |
| 7 | All egress via `NetworkGateway.egress()`; CSP generated from the registry | syntactic bans (fetch/globalThis.fetch/XHR/sendBeacon) **error**; CSP generated by `scripts/generate-csp.mjs`; registry==CSP pinned by `src/kernel/net/csp.test.ts` | error | ONE carve-out: `src/kernel/net/**` (the gateway itself); test files share it — the egress boundary is a production property |
| 8 | epubjs only in reader engine; synthesis SDKs only in providers; singletons only in app/; no module-scope side effects outside bootstrap | epubjs runtime ban **error** (type-only imports legal) with named carve-outs (engine dir incl. offscreen/, kernel `epubcfiShim` for the submodule, `library/import/extract.ts` per C8); piper vendored behind `PiperRuntime`; boot sequencing pinned by the C11 entry-gate tests (`App_Boot` et al.) | error (epubjs) / process (singletons, side effects) | the three named epubjs carve-outs; singleton/side-effect halves rest on the C11 boot contract + review |
| 9 | Mock seams reachable only from the composition root behind DEV/VITE_E2E | `check:worker-chunk` check 2 **error**: no MockBackend / MockFireProvider / MockGenAIClient source in ANY production chunk (emitted-artifact assertion) | error | none |
| 10 | TS project references per layer + all test code typechecked | `tsc -b` solution build: app + test + e2e + node + 3 vendored packages — every line of test/e2e code typechecks as a build invariant (CI) | partial | per-LAYER references are NOT implemented: `composite` forces declaration emit, which conflicts with the bundler-mode `noEmit` + `allowImportingTsExtensions` posture; dependency DIRECTION is enforced by the depcruise error rules instead. Documented exception — revisit only if the depcruise enforcement ever proves insufficient |

P9 flips/fixes in this audit: `types-imports-nothing`, `no-circular`,
`no-circular-runtime`, `lib-not-to-components` warn→**error** (all at 0); the
last full-graph cycle (PlaybackBackend ⇄ TTSProviderManager, type-only) killed
by moving `TTSProviderEvents` to its consumer side; the vacuous
`components-not-to-db` rule DELETED (src/db died in P3; the rule comment named
it a P9 deletion); baseline regenerated (counts only decrease).

## 4. Test landscape

- **Vitest files: 306** (304 passed + 2 skipped; 3,047 tests) vs the plan's
  "~110 (from 246)" sketch — reconciled as follows. The 246 baseline files
  included ~50 one-off bug files; the absorption ledgers
  (`phase5-absorption-ledger.md` rows 1–19 ✅ + row 20 keeper;
  `phase7-absorption-ledger.md` rows 1–15 ✅) deleted or rewrote all of them —
  the ledgers are CLOSED, re-verified this item. Growth since is exclusively
  sanctioned categories: the contract tier (fork suites B/C/D/E + Y.1–Y.11 +
  F.1–F.7, `describeProviderContract` ×6, SyncBackend contract on mock +
  emulator, repo contracts, crdt-contract store flips, ReaderEngine
  conformance, engine parity ×2 transports), captured-fixture suites (v1–v9
  Y.Doc eras, tts-storage blobs, IDB v18/v24, era-8), seeded
  fuzz/perf/property companions (`*.fuzz`/`*.perf`/`.trace`), and per-module
  unit suites born from the strangler decompositions. The ~110 number assumed
  consolidation without the contract tier's growth; the COUNT was never a
  CI-enforced ratchet — the enforced rules (ledger discipline, no new one-off
  files) all hold.
- **Path-convention check**: zero one-off bug files crept back — the only
  `repro|race|fix` matches are the vendored fork's ported upstream specs
  (exempt) and name false-positives (ReprocessingInterstitial,
  LexiconEngine.trace, ttsStorageFixtures, MockFireProvider).
- **Playwright journeys: 78 spec files** (~40 target; includes the
  characterization pins and per-phase journeys; Docker-lane execution remains
  the standing out-of-environment item).
- **Open absorption candidate** (explicitly NOT a ledger row):
  `App_SW_Wait.test.tsx` → `App_Boot` fold-in (P8 hand-off note). Left open;
  the suite is live behavior coverage either way.
- **Coverage** (npm run coverage, denominator = ALL src; the floor never
  decreases): re-baselined UPWARD in `coverage-baseline.json`. Phase 0 floor →
  P9 end state: lines 65.30 → **75.49** (+10.19), statements 64.04 → **74.29**
  (+10.25), functions 58.65 → **69.89** (+11.24), branches 56.08 → **65.50**
  (+9.42). (Against the plan's quoted 65.72/64.49/59.35/56.18 anchors the
  deltas are +9.77/+9.80/+10.54/+9.32 — every metric ~10 points up, never
  below the floor at any phase.)

## 5. Known flake (pre-existing, spun off)

The fork contract test "two-doc concurrent merges … converge identically"
intermittently fails `vitest run` with an unhandled scopedDiff-tripwire error
from a post-test microtask flush (recorded at the P8 close as pre-existing;
file untouched since P2). It surfaced once during this item's gate runs and
passed on re-run; the existing spun-off task owns the root cause.
