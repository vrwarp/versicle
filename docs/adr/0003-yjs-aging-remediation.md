# ADR 0003: Yjs document aging — provider remediation and the epoch contract

- **Status:** Accepted (2026-08-20)
- **Deciders:** vrwarp (library + app owner)
- **Artifacts decided over:** `y-cinder` and `y-idb` dependency pins
  (package.json), the sync transport event surface
  (`src/domains/sync/backend/SyncBackend.ts`,
  `backend/FirestoreBackend.ts`, `core/ProviderConnection.ts`,
  `src/domains/sync/events.ts`), the toast catalog
  (`src/kernel/locale/messages.ts`), `src/app/sync/wireSyncEvents.ts`

## Context

Versicle keeps ONE Yjs document alive for the whole app, writes to it on
every page turn / TTS sentence / heartbeat, and constructs a fresh
`Y.Doc` — hence a fresh random `clientID` — on every launch. A
versicle-shaped aging harness now lives in both forks (`y-cinder
benchmarks/versicle-aging*.bench.ts`, `y-idb benchmarks/aging.mjs`,
sharing one workload model) and measured what years of that use do:

- **y-idb hydration** (every boot, main thread, gates `whenHydrated`):
  37 ms → 1,004 ms across 240 simulated sessions.
- **y-idb trim**: full-document re-encode every 500 updates drove write
  amplification to 9× and climbing.
- **y-cinder compaction**: downloaded + re-merged + re-uploaded the whole
  snapshot every ~50 updates (631 ms CPU and ~6.6 MB transfer per cycle
  at 14.4k events, unbounded).
- **Reconnect paths** encoded/decoded O(document-churn) diffs per boot,
  and the delete-set fingerprint died permanently past 700 KB (every
  boot then wrote a spurious update document).
- The floor itself — dead structs from same-key overwrites, delete-set
  ranges, one state-vector entry per session ever — grows forever;
  garbage-collected compaction cannot reclaim it (CRDT convergence needs
  it).

## Decision

1. **Adopt the remediated forks** (pins bumped in package.json):
   - y-idb `b8b3271`: tiered trim — the common trim folds the fresh tail
     into one delta row (O(new updates)); the full re-encode is budgeted
     (write amplification 9× → 2.6× bounded; trim latency flat).
   - y-cinder `9317531`: delta compaction (`historyFoldThreshold`,
     default 8 — steady-state cycle 631 ms → 0.6 ms and ~6.6 MB → ~6 KB
     transfer), storage-offloaded delete-set fingerprints, an encode-free
     reconnect push guard, a version-gated snapshot listener, a
     `parseUpdateMeta` fix restoring update-metadata correctness, and
     opt-in **epoch squash** (`provider.squash()`).
2. **Normalize the epoch events now** (this change): both y-cinder
   events (`epoch-changed` on bystander clients, `squashed` on the
   squasher) surface as one `SyncEvent` `{ type: 'epoch-changed', epoch,
   previousEpoch, self }`; the connection reports `disconnected` and the
   user is told to reload. This is the mandatory safety floor: if any
   device ever squashes, other devices must not silently ignore the
   fence.
3. **Do not auto-squash and do not auto-rebuild yet.** Nothing in
   versicle calls `squash()`; the toast-only reaction is sufficient
   while that is true.

## The epoch contract (what a squash means for versicle)

`squash()` rebuilds document CONTENT into a fresh Yjs id space (epoch
N+1): state vector back to 1 client, zero tombstones, empty delete-set.
The provider carries the epoch inside the doc (`__ycinder.epoch`), so
IndexedDB copies, checkpoints, and backups know their epoch. Old-epoch
and new-epoch histories cannot merge; y-cinder fences them (listeners
ignore foreign-epoch data; compaction deletes it; a fenced provider
stops syncing and reports the event with the full local state).

For versicle's single-user / multi-device shape the boundary risk is
small: data synced before the squash is inside the new snapshot; only
edits made while offline across the boundary need semantic
re-application (the `epoch-changed` payload carries the old-epoch local
state for exactly that).

## Adoption path (future work, in order)

1. **Rebuild flow**: on `epoch-changed`, run the existing staged-swap
   machinery — `downloadWorkspaceState` (temp doc + temp provider on the
   new epoch) → `applySnapshot` into `versicle-yjs-staging` → reload —
   instead of the toast-only reaction. All pieces exist
   (`src/domains/sync/core/stagedSwap.ts`,
   `src/data/snapshot/YjsSnapshotService.ts`).
2. **Squash scheduling**: call `syncService`-level squash on an explicit
   maintenance action first (Settings → Data Management), then consider
   an automatic policy (e.g. snapshot bloat ratio or every N months)
   once the rebuild flow has soaked.
3. **Old-epoch conflict handling**: materialize `localState` from the
   event and re-apply versicle-semantic winners (progress: newest
   `lastRead` per book×device; annotations: union by id) before
   discarding the old doc.

## Consequences

- All vendor-contract suites pass against the new pins; no versicle
  behavior changes until someone calls `squash()`.
- The hydration floor (the remaining unbounded curve) resets only when
  squashing is adopted; until then it grows as before, just with flat
  per-cycle sync costs.
- `docs/comprehensive/66-vendored-forks.md` still describes the forks as
  vendored `packages/` workspaces; the real consumption is git pins
  (pre-existing drift, out of scope here).
