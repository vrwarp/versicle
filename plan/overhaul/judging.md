# Overhaul Proposal Judging — Record

Three architects produced competing comprehensive overhaul proposals from the same verified
findings digest (`digest.json`, 285 surviving debts across 21 subsystem analyses). Three judge
personas read all three full proposals, spot-checked claims against the source at `3b0cfcff`,
scored them, and named graft-worthy ideas. This file is the durable record; the synthesized
master plan is `README.md`.

## Scores (each dimension 1–10; total /40)

| Judge | modular-monolith | strangler-incremental | contract-first | Winner |
|---|---|---|---|---|
| Pragmatic staff engineer | 31 | **35** | 33 | strangler-incremental |
| Domain architect (end-state quality) | 33 | **35** | 30 | modular-monolith¹ |
| Release/data-safety engineer | 32 | **35** | 34 | strangler-incremental |

¹ Judge 2 scored strangler highest in aggregate but chose modular-monolith as winner on the
grounds that end-state quality dominates from their persona: strangler's destination is
"today's taxonomy, disciplined" while modular-monolith's vertical domain modules remove the
geometry that let the debt accumulate.

**Outcome: strangler-incremental wins the journey; the synthesis adopts modular-monolith's
destination geography and contract-first's governance.** See `README.md` for how the three are
combined.

## Key judge findings

### On strangler-incremental (winner)
- "The only plan whose sequencing is organized around never leaving user data half-migrated."
  Phase 0 hardens every recovery path *before* any schema change; v6 ships exactly once, on the
  new migration coordinator, after fork surgery is pinned by contract tests. (Judge 3)
- The Phase 2 "why state first" argument is "the sharpest sequencing insight in any proposal":
  until merge-over-defaults hydration lands in the forked zustand-middleware-yjs, adding any
  field to a synced store wipes it for existing users — so the fork surgery gates everything.
  (all three judges)
- Characterization entry gates (parity suite green on both transports before engine internals
  change; six-overlay E2E before reader work), per-phase reversibility notes, kill-mid-switch
  E2E, and deletion-of-legacy as exit criteria directly attack this codebase's documented
  failure mode of abandoned half-splits. (Judges 1, 3)
- Dings fixed in the synthesis: Phase 1 was mislabeled "pure code motion" while moving Yjs
  persistence construction out of module scope (behavior-affecting — now split 1a/1b); the
  global lint flip was deferred to Phase 9 (now per-phase warn→error flips); the end state kept
  the horizontal layer geometry (now lands in domain modules); no TS project references (now
  grafted).

### On modular-monolith
- "The only end state I would want to inherit": vertical domain modules with `ports.ts` +
  `index.ts` public APIs generalize the codebase's one proven boundary (EngineContext);
  co-locating each domain's UI inside its module "kills the CompassPill/ReaderView regrowth
  habitat structurally, not by convention"; TS project references make dependency direction a
  compile-time property. (Judge 2)
- Rejected as the journey: "the highest-churn path — moves essentially every file … months of
  merge-conflict tax" (Judge 1); its Phase 1 "hotfix" bundle runs a CRDT schema change on the
  *current* broken migration runner, and v6 is then completed by a *different* runner in Phase 3
  — "two partial schema migrations through two mechanisms means more mixed-fleet states than
  either competitor" (Judge 3).

### On contract-first
- "The C1–C12 contract inventory table is the single best artifact across all three proposals"
  (Judge 1); the contract-version-bump-requires-suite-change-in-same-PR CI rule is "the single
  best guard for the agent-maintained future of this codebase" (Judge 3); R11 (agent-driven
  development regresses the boundaries) "the most insightful line across all three documents"
  (Judge 2).
- Rejected as the journey: a dedicated freeze phase authoring all contracts with consumers
  still on old code is "a classic stall point — interfaces designed before migration pressure
  are speculative" (Judge 1); confirmed criticals wait behind contract authoring (NFKD CFI
  corruption until Phase 4, rules rewrite until Phase 3, composition root until Phase 6);
  Phase 3 stacks the two highest-data-risk workstreams into one unit, straining its own "never
  more than one in-flight format change" principle (Judge 3).

## Grafts adopted into the master plan

From **contract-first**:
1. The C1–C12 contract inventory as the program's governing artifact — authored just-in-time,
   each row landing in the phase its seam is carved (not in a freeze phase), with the CI rule
   that a contract version bump requires a matching contract-suite change in the same PR.
2. "User data is never bridged by more than one in-flight format change at a time" as a
   program-level rule, sequencing v6 CRDT / IDB v25 / tts-storage split / backup manifest v3 /
   font rename so no two overlap.
3. Observe-then-enforce mode for all new inbound validation on live sync paths, with a
   telemetry-review gate before any rejection is enabled.
4. N+1 release staging for schema relocation: the `meta` Y.Map write ships one full release
   before any client logic depends on reading it (three fleet generations interoperate).
5. Captured-artifact migration tests as the standard: real v1/v2/v4/v5 Y.Doc snapshots, a real
   tts-storage v3 localStorage blob (voice-profile/API-key survival across the store split),
   v18/v24 IDB fixtures.
6. NFKD/extractionVersion safety protocol: retain old `cache_tts_preparation` rows until the
   new extraction passes a CFI-alignment self-check; CI compares old-vs-new sentence CFIs on
   composed-accent/CJK fixtures before the version constant bumps.
7. Merge-over-defaults behind a per-store option flipped store-by-store, using each store's
   defensive `|| {}` fallback-removal tests as canaries.
8. Bootstrap phases as a registry subsystems register boot tasks into — preventing
   `app/bootstrap.ts` from becoming the next god file.
9. The agent-loop verification gate: AGENTS.md regenerated from one canonical TESTING.md and
   validated by running a live agent through the documented workflow before phase close.

From **modular-monolith**:
1. The destination geography: `kernel/ data/ state/ domains/{audio,reader,library,search,
   chinese,sync,google} ui/ app/` with per-domain `ports.ts` + `index.ts` public APIs and
   domain UI co-located in its module.
2. TypeScript project references per layer (plus `tsconfig.test.json`/`tsconfig.e2e.json` in
   `tsc -b`) — dependency direction as a compile-time property; all ~42k LOC of test code
   typechecked as a build invariant.
3. Per-phase warn→error lint flips as exit criteria, with ratchet counters (dependency-cruiser
   violations, production `as any` 138→0, eslint-disable 245→~0, vi.mock-in-engine) and named
   deletion deadlines on every temporary shim/façade.
4. The namespaced kernel flight recorder (TTS/SYNC/DB/GENAI/INGEST/UI ring buffers) with one
   Export Diagnostics panel — extracted when Phase 5b touches the recorder, adopted per domain
   as each strangler lands (not built speculatively up front).
5. The parallelization map: after the foundation phases, audio and reader/library tracks run
   concurrently (with the CFI-kernel ordering caveat).
6. Registry-generated docs: per-module READMEs, store-tier/provider/destination/settings
   tables, and AGENTS.md generated from the registries so the docs agents read cannot drift.
7. The BYO-Firebase rules-lockout mitigation in full: in-app permission-denied detection
   surfacing a "redeploy your rules" guide plus a version-gated prompt.
8. Two-client upgrade E2E (old-version doc snapshot vs new client) elevated from a one-time v6
   test to a standing rule for every future schema bump.
