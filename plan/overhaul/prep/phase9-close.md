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

## 6. Registry-generated docs + the agent-loop gate (`p9-docs-and-close`)

The rule-10 payoff. `src/app/docs/registryDocs.ts` renders `architecture.md`,
`AGENTS.md`, and the kernel/data/domains READMEs from the LIVE registries
(egress destinations, provider descriptors, settings panels, store tiers,
boot phases, both migration registries, the committed ratchet baselines);
`src/app/docs/docs.test.ts` is the drift gate inside the normal `npm test`
run — authored module maps must equal the filesystem, every C1–C12 and
boundary-rule file pointer must exist, generated files must byte-equal the
rendering, and AGENTS.md must contain every TESTING.md gate command
verbatim plus the Jules README preamble rule as a frozen constant.
`npm run docs:generate` regenerates (the store README keeps its own
REGEN_STORE_DOCS gate). The architecture stale banner is dead.

**What lied (found while regenerating; all fixed at the source):**

1. `architecture.md` — the entire document described the pre-overhaul
   architecture (banner said so; replaced wholesale by the generated one).
2. `AGENTS.md` — named `src/db/db.ts` (deleted in P3) as the schema home,
   "currently 24" as the DB version (26), and an alias list missing
   `@data/ @domains/ @kernel/`; its PR-gate list omitted the
   lintdebt/knip/single-instance gates entirely.
3. The five E2E spec sites it governed (`test_maintenance`,
   `test_journey_reprocessing`) still opened `EpubLibraryDB` at hardcoded
   version 24 — a latent `VersionError` against the v26 database; the
   hand-update instruction had rotted at BOTH the v25 and v26 bumps. Fixed
   by opening without an explicit version; the instruction class is
   retired from the generated AGENTS.md.
4. `TESTING.md` — claimed all depcruise rules were warn (eight are error
   at 0), jsx-a11y warn wholesale (error for the P8 dirs), suite state
   258 files/1,905 tests (307/3,103), the Phase-0 coverage numbers as the
   floor (re-pinned ~10 pts higher), and that every E2E page runs
   sanitization-off unconditionally (per-spec fixture since P6).
5. `tsconfig.e2e.json` — the "keep the two in sync" alias map had drifted
   from `tsconfig.app.json` (three aliases missing); now asserted equal by
   the gate instead of trusted to a comment.
6. `src/README.md` / `src/lib/README.md` — pre-P1 fossils (`src/db/`,
   `lib/search.ts`, FlexSearch, `tts.ts`); rewritten.
7. The master plan's P7 banner cited a `prep/phase7-library-google.md`
   §Follow-ups section that never existed — a reconciliation section was
   appended so the deferred-work ledger has no dangling references.

**Agent-loop verification (rule 10):** in a fresh `env -i` shell (HOME +
node PATH only), the eleven documented gate commands from the regenerated
AGENTS.md were executed in order, exactly as written: `npm run lint`,
`npx tsc -b`, `npm test`, `npm run build`, `npm run depcruise:check`,
`npm run lintdebt:check`, `npm run knip`, `npm run check:worker-chunk`,
`npm run check:single-instance`, `npm run licenses:check`,
`npm run coverage` — **all eleven exit 0**; coverage
75.60/74.42/70.15/65.59 ≥ the committed floor on every metric. No command
required knowledge outside the documents.

## 7. Final acceptance (program close, 2026-06-12)

- `npm ci` from a deleted `node_modules` — clean; `check:single-instance`
  and `licenses:check` green on the fresh tree.
- FULL vitest from the clean install: 307 files (305 passed + 2
  emulator-skipped), 3,103 tests (3,063 passed / 37 skipped / 3 todo).
- Named suites individually: backup round-trip
  (`src/lib/BackupService.roundtrip.test.ts`) green; boot entry gates
  (`App_Boot`, `App_MigrationFailure`, `App_SW_Wait`, `App_Capacitor` — 21
  tests) green; engine parity both transports (61 tests) green; migration
  fixtures (`crdt-contract/` v1–v8 eras + quarantine, `data/migrations`
  IDB v18/v24→v26, tts-storage blobs, reading-list linker — 103 tests)
  green.
- §5 flake update: the scoped-diff tripwire surfaced TWICE consecutively
  on the first full runs after `npm ci` (cold vitest cache shifts worker
  timing), then green; isolated runs are always green. Signal for the
  owning spun-off task: the repro likes a cold cache.
- Out-of-environment items are the master plan close-out banner's hand-off
  list (Docker E2E lane, on-device QA, BYO-Firebase live checks,
  release-window aftercare).
- Emulator-gated suites re-verified LIVE at the close (firebase-tools
  15.20.0, emulators:exec per the TESTING.md command): security-rules +
  syncBackendContract.emulator — 2 files, 37 passed + 1 todo. First
  attempt hit a cold-start emulator gRPC hiccup (RESOURCE_EXHAUSTED on a
  Listen stream → one "client is offline" failure); clean on retry — the
  signature is documented in TESTING.md.
