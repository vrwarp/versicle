# Phase 4 prep — sync strangler: implementation-ready design

> **Phase 4 status (2026-06-11): DONE** — see plan/overhaul/README.md for the banner and
> §Follow-ups at the end of this document for the deferred work and execution deltas.

Status: READ-ONLY prep artifact, authored against HEAD **`fb3dcd3f09e5fb749abb42cf3359d11014cde590`**
(branch `claude/amazing-davinci-d7336e`, 2026-06-10).

**⚠ The Phase 2 implementation chain was actively committing while this was written.** At this
HEAD, P2 tasks 26–34 (vendor `zustand-middleware-yjs`, fork surgery: `syncedKeys`,
`merge-defaults`, `scopedDiff`, `api.yjs` handle) are landed; the migration coordinator
(`src/app/migrations.ts`) exists with `CURRENT_SCHEMA_VERSION = 6` and the v5→v6 step, but P2
tasks 36–39 (v6 finalization, real `whenHydrated()` boot composition, fixture/quarantine tests)
were still in flight. **Every file:line below must be re-verified at P4 execution time**; P2
also planned `src/store/registry.ts` + `defineSyncedStore` and per-store hydration flips
(phase2-fork-surgery.md §2.5–2.6, PR P2-6…P2-10e) which will move `src/store/**` call sites
named here. P2 established `packages/` (npm workspaces) — the vendoring pattern P4 follows.

Inputs: `plan/overhaul/README.md` (§Roadmap P4, §4 program rules), `proposals/strangler-incremental.md`
§Phase 4 (lines 529–549) + seam table, `proposals/contract-first.md` rows C2/C3/C10/C11,
`analysis/sync.md` (all 16 debt items), `prep/phase2-fork-surgery.md` (vendoring mechanics §6,
quarantine residual R4, two-client E2E §5.4), and the HEAD source cited throughout.

---

## Reality check (analyses/plan vs HEAD)

The tree has moved a lot since `analysis/sync.md` (written at `3b0cfcff`). Verified deltas:

### Already fixed at HEAD (do not re-implement)

1. **Rules rewrite is DONE (P0).** `firestore.rules` (89 lines) is the full rewrite: non-overlapping
   matches, `data.get('isDeleted', false)` syntax, tombstone denial on the
   `{collectionId}` depth-1 block covering `updates`/`history`/`maintenance`/`metadata`, catch-all
   excludes `versicle`/`workspaces`. `storage.rules` + `firebase.json` (emulator ports for
   auth/firestore/storage) exist. Pinned by `src/lib/sync/security-rules.test.ts` (228 lines,
   emulator-gated, covers both rules files incl. the "catch-all does not neuter tombstones"
   regression). Analysis items 1–2 are paid **except** the honest `deleteWorkspace` purge and the
   one-time purge action (still P4 scope).
2. **Checkpoint pinning is DONE (P0).** `CheckpointService.createCheckpoint(trigger, {protected})`
   (`src/lib/sync/CheckpointService.ts:29-78`): protected flag, supersede-older-protected logic,
   prune skips protected. `switchWorkspace` creates the pre-migration checkpoint protected
   (`FirestoreSyncManager.ts:737`). `~types/sync.ts` `SyncCheckpoint.protected` documented.
3. **Keep-state-until-restore is DONE (P0).** `restoreCheckpoint` clears the migration state only
   AFTER the snapshot is fully rewritten (`CheckpointService.ts:109-152`); `switchWorkspace`
   transitions to `RESTORING_BACKUP` (not clear) when `applyRemoteState` fails
   (`FirestoreSyncManager.ts:824-838`); the boot interceptor keeps the state during rollback
   (`src/app/boot/migrationInterceptor.ts:26-48`). Analysis item 3's "rollback can silently fail"
   is substantially mitigated; the **wipe-before-write window itself remains** (still P4's
   staged swap).
4. **Permission-denied surfacing is DONE (P0).** `RULES_OUT_OF_DATE_MESSAGE` +
   `isPermissionDeniedEvent()` (`FirestoreSyncManager.ts:50-75`) wired into
   `connection-error`/`sync-failure`/`save-rejected` handlers (`:537-569`).
5. **`getYjsPersistence()` accessor exists** (`src/store/yjs-provider.ts:76-78`) — the stale-const
   half of analysis item 14 is fixed. The CheckpointService↔FirestoreSyncManager **circular import
   remains** (`CheckpointService.ts:7` ↔ `FirestoreSyncManager.ts:16`).
6. **Boot is sequenced (P1).** `App.tsx` is 98 lines; the boot interceptor, sync init, device
   registration, and heartbeat are bootstrap tasks (`src/app/bootstrap.ts` phases
   `interceptMigration → openDB → startYjsPersistence → whenHydrated → migrations → syncInit →
   deviceRegistration → backgroundTasks`; manifest `src/app/boot/registerBootTasks.ts`).
   "App.tsx:143-300 hand-orchestrates sync boot" is stale. The interceptor sets
   `ctx.syncAllowed=false` / `ctx.pendingMigration` instead of App effects; heartbeat is
   `deviceHeartbeatTask` with `ctx.addCleanup` (`src/app/boot/backgroundTasks.ts:18-26`).
7. **Dead-code cluster largely deleted (P1).** `validators.ts` + 318-line fuzz suite: gone.
   `MigrationStateService` is 79 lines — `IDLE`/`getDanglingBackupId`/`isBlocked` deleted; the
   status union is exactly `AWAITING_CONFIRMATION | RESTORING_BACKUP` (`~types/workspace.ts`).
   `android-backup.ts` (54 lines) + test **still present** — the keep-or-delete ADR the plan
   assigned ("decided in Phase 4", strangler line 384) does not exist yet (`docs/adr/` has only
   0001-i18n).
8. **Fork pins are SHAs, and one fork is already vendored.** `package.json:78-84`:
   `y-cinder#9c5c205e…`, `y-idb#e2a21f45…`, `zustand-middleware-yjs` = `file:packages/zustand-middleware-yjs`
   (workspace with LICENSE + PROVENANCE.md, src-direct exports, yjs/zustand as peers,
   `scripts/assert-single-instance.cjs` in CI). "Pinned to moving branch refs" is stale; the
   vendoring *pattern* P4 must follow is established.
9. **The C3 contract-suite skeleton exists (P0, task #12).** `src/lib/sync/syncBackendContract.ts`
   (213 lines): `describeSyncBackendContract({backendName, capabilities, makeHarness})` with
   connect/CRUD/tombstone cases, `capabilities.connect` and `.serverSideTombstoneEnforcement`
   switches, and an explicit todo for P4's delete-purge. Runners:
   `syncBackendContract.mock.test.ts` (MockFireProvider + localStorage-directory harness
   mirroring the manager's mock branches) and `syncBackendContract.emulator.test.ts`
   (`@firebase/rules-unit-testing`, node env, auto-skip when no emulator, `connect` registered
   as todo pending P4). **P4 builds on this — it does not write a new skeleton.**
10. **Mock flags are centralized.** `src/test-flags.ts` is the single reader of
    `window.__VERSICLE_MOCK_FIRESTORE__`/`__VERSICLE_MOCK_USER_ID__`/`__VERSICLE_MOCK_SYNC_DELAY__`/
    `__VERSICLE_FIRESTORE_DEBOUNCE_MS__`. Production code no longer touches window globals
    directly — but the *branches* remain (below).
11. **Hooks moved (P1).** `useSyncStore` → `src/store/useSyncStore.ts`; `useSyncToasts` →
    `src/hooks/useSyncToasts.ts` (aliased `useBookStore`-from-`useLibraryStore` import and the
    whole-map `JSON.stringify` are still there, `useSyncToasts.ts:5,20`). Only
    `useFirestoreSync.ts` remains in `src/lib/sync/hooks/`.
12. **v6 + the `meta` map are landing NOW (P2, mid-flight).** `CURRENT_SCHEMA_VERSION = 6`
    (`src/store/yjs-provider.ts:18`); `src/app/migrations.ts` dual-writes
    `meta.schemaVersion` + `library.__schemaVersion` inside every step transaction (`:320-325`)
    and `readDocSchemaVersion = max(meta, library) || 1` (`:96-107`). Per program rule 5,
    **nothing reads `meta` for enforcement in the v6 release — P4 is the designed first reader.**

### Still true at HEAD (P4's actual scope)

13. **`FirestoreSyncManager.ts` is now 1046 lines** (was 993; P0 hotfixes grew it). Re-measured.
14. **Mock-mode branches: ~12 `isMockFirestoreEnabled()` sites, not 8** — `initialize` (:159),
    `validateWorkspaceIsAlive` (:213), `connectFireProvider` (:346), `performCleanSync`
    (param + :384/:406/:464), `connectFireProviderNormal` (param + :526), `createWorkspace`
    (:680), `switchWorkspace` (:750,:796), `listWorkspaces` (:859), `deleteWorkspace` (:890),
    `getCurrentUser` (:1010). `MockFireProvider` is still statically imported (:31) and ships in
    the prod bundle. The real clean-sync path still probes the mock-only `snapshotBase64` field
    on real Firestore docs (:394).
15. **Toast/UX copy still in the transport.** `useToastStore` imports in `lib/sync`:
    `FirestoreSyncManager.ts:40` (13 `showToast` sites: :191, :315, :381→{:426,:501,:509},
    :542, :551, :553, :563, :565, :567, :723→{:728,:748,:835,:847}) and
    `firebase-config.ts:19` (:126). The analysis said "8 places"; count it as 2 module imports /
    ~14 call sites at HEAD.
16. **Temp-doc hydration dance ×2 in the manager** (`performCleanSync:428-495`,
    `switchWorkspace:758-820`, both with `(tempDoc as any)._tempProvider`), plus the third in
    `DataRecoveryView.tsx`. Misnamed `stateVector` at :497.
17. **Unawaited throw path persists**: `handleAuthStateChange:285` calls
    `this.connectFireProvider(user.uid)` without await; `:317` throws `WorkspaceDeletedError`
    (now a typed `AppError` with code `SYNC_WORKSPACE_DELETED`, `~types/errors.ts`).
18. **`deleteWorkspace` real/mock divergence persists, half-fixed**: the mock branch severs
    `activeWorkspaceId` conditionally (:911-915) but the real branch still calls full
    `this.destroy()` (:925) and unconditionally severs (:957); purge still covers only the
    `updates` subcollection (:929-946) — `history`, `maintenance`, `metadata` docs and Cloud
    Storage blobs (`snapshot_vN.bin`, `large_updates/*.bin` — both named in `storage.rules`)
    survive. The rules and emulator suite now exist; the client purge does not.
19. **Quarantine is still label-only.** `handleObsoleteClient` (`yjs-provider.ts:85-100`) sets
    `firestoreStatus='disconnected'` + `obsoleteLock` via two dynamic imports; it never destroys
    the provider; the heartbeat keeps firing (now from `deviceHeartbeatTask`). The middleware
    poison pill still only guards maps carrying `__schemaVersion` (= `library`).
    `performCleanSync` still `Y.applyUpdate(getYDoc(), …)` with **no version check** (:498).
    Workspace metadata `schemaVersion` is still written only at creation (:677).
20. **Fragmented init persists**: `initialize()` called from `src/app/boot/syncInit.ts:23`
    (ignores `firebaseEnabled` — the gate is only `isFirebaseConfigured()`),
    `useFirestoreSync.ts:64` (gated on `firebaseEnabled && isConfigured`), and
    `WorkspaceMigrationConfirmModal.tsx:44`. Status reaches `useSyncStore` twice
    (`setStatus:968` direct + `useFirestoreSync:51-56` mirror, which also stamps `lastSyncTime`
    on the *connected transition*, not on flushes).
21. **MockFireProvider drift persists**: its event map is `sync | synced | connection-error`
    (`drivers/MockFireProvider.ts:43-46`); the real y-cinder provider emits
    `connection-error | sync-failure | save-rejected | corrupted-document`
    (`node_modules/y-cinder/dist/provider.js:122,417,451,480,496` + `:294` corrupted-document).
    Neither emits a save-success event — **`lastSyncTime`-from-flush needs a fork delta** (§D6).
22. **`getRedirectResult` dead web-redirect flow** still at `FirestoreSyncManager.ts:186-197`;
    `types/workspace.ts:7` still documents the wrong path (`versicle_meta/workspaces` vs actual
    `users/{uid}/workspaces`); `SyncSettingsTab.tsx` still 661 lines; `semantic-tree.ts` still
    reads six stores.

### Plan-vs-plan contradictions resolved here

- **Geography**: contract-first's C3 row names `src/lib/sync/core/...`; the master plan's
  synthesis (§2 + geography migration rule) says replacement code lands at
  **`src/domains/sync/`**. The master plan wins ("this document is the authoritative synthesis
  where the three differ"). New code lands under `src/domains/sync/`; legacy `src/lib/sync/**`
  dies in place.
- **Fork vendoring split**: P2 prep §6 already vendored `zustand-middleware-yjs` and assigned
  y-idb's `flush()/whenSynced` surgery to **P3**. P4 vendors **y-cinder** (and inherits y-idb
  vendoring only if P3 did not do it — check `packages/` at execution).
- **"8 inline branches" / "993 lines" / "8 toast imports"**: superseded by items 13–15 above; the
  exit criteria are restated against HEAD counts in §Execution order.

---

## Design

Target layout (final addresses, master-plan geography; alias `@domains/*` to be added to
tsconfig/vite/vitest like the existing `@lib`/`@store`/`~types`):

```
packages/
  y-cinder/                      # vendored P4 (PROVENANCE.md, LICENSE verbatim, peer yjs, src-direct)
  y-idb/                         # vendored by P3 (else P4-1 picks it up)
  zustand-middleware-yjs/        # vendored by P2 (pattern to copy)
src/domains/sync/
  backend/
    SyncBackend.ts               # the C3 interface (below) + WorkspaceMetadata zod schema
    FirestoreBackend.ts          # ALL firebase/firestore + firebase/storage imports for sync live here
    MockBackend.ts               # localStorage directory + MockFireProvider; E2E/dev only
  core/
    SyncOrchestrator.ts          # lifecycle owner; the only initialize(); boot task body
    AuthSession.ts               # firebase-config init + onAuthStateChanged + signIn/signOut
    ProviderConnection.ts        # attach/detach, event normalization → SyncEvents, quarantine
    downloadWorkspaceState.ts    # THE one temp-doc hydration utility
    quarantine.ts                # readDocVersionOfUpdate(), enforceObsolete()
  workspaces/
    WorkspaceService.ts          # create/switch/delete/list over SyncBackend
    stagedSwap.ts                # staging IDB write/verify/apply; resumable
    MigrationStateService.ts     # moved; + 'STAGED' status
  checkpoints/                   # CheckpointService + Inspector move here (P3 repo underneath)
  events.ts                      # typed SyncEvent bus
  index.ts                       # the domain's published surface
src/app/sync/
  createSync.ts                  # composition root: backend choice, orchestrator construction
  wireSyncEvents.ts              # the ONE subscriber: events → useSyncStore + toasts + heartbeat stop
```

### D1. `SyncBackend` (C3) — grown from the existing contract harness

The P0 skeleton's `SyncBackendContractHarness` (`syncBackendContract.ts:33-54`) is the embryo;
the production interface extends it with the operations the inline branches actually implement:

```ts
// src/domains/sync/backend/SyncBackend.ts
export interface SyncConnectionEvents {
  synced(): void;                                   // initial handshake done
  saved(at: number): void;                          // FORK DELTA §D6 — drives lastSyncTime
  'connection-error'(e: SyncTransportError): void;
  'sync-failure'(e: SyncTransportError): void;
  'save-rejected'(e: SaveRejectedEvent): void;      // {code: 'permission-denied'|'document-too-large'|'max-retries-exceeded', sizeBytes?}
  'corrupted-document'(e: { docId: string }): void;
}
export interface SyncConnection {
  on/off<E extends keyof SyncConnectionEvents>(...): void;
  destroy(): Promise<void>;                         // flush + detach; doc durable afterwards
}
export interface SyncBackend {
  readonly uid: string;                             // bound at construction, post-auth
  createWorkspace(meta: WorkspaceMetadata): Promise<void>;
  listWorkspaces(opts?: { includeDeleted?: boolean }): Promise<WorkspaceMetadata[]>;
  updateWorkspaceMetadata(id: string, patch: Partial<WorkspaceMetadata>): Promise<void>; // post-migration version stamp
  isWorkspaceAlive(id: string): Promise<boolean>;   // tombstone pre-flight (validateWorkspaceIsAlive:212-247)
  probeHasData(id: string): Promise<boolean>;       // clean-sync probe (performCleanSync:384-423); real impl drops the snapshotBase64 mock leak
  tombstoneWorkspace(id: string): Promise<void>;    // root isDeleted + metadata deletedAt (idempotent — rules allow re-assert)
  purgeWorkspace(id: string): Promise<PurgeReport>; // updates+history+maintenance+metadata batches + Storage prefix delete
  connect(doc: Y.Doc, id: string, opts: { maxWaitTimeMs: number; maxUpdatesThreshold: number }): SyncConnection;
}
```

Semantics, grounded in current code:

- `WorkspaceMetadata` zod-validated on every read (C3 row), schema next to the interface;
  `types/workspace.ts:7`'s stale path comment fixed when the schema lands.
- `FirestoreBackend` absorbs the real branches verbatim (paths `users/{uid}/workspaces/{id}`,
  `users/{uid}/versicle/{id}` + subcollections); it is the **only** sync module importing
  `firebase/firestore` and gains the only `firebase/storage` import (purge). `firebase-config.ts`
  stays its private helper (its one toast at `:126` becomes a `SyncEvent`).
- `MockBackend` absorbs the localStorage directory exactly as the mock contract harness already
  documents (`syncBackendContract.mock.test.ts:1-9` says "when P4 extracts MockBackend, this
  harness collapses to `new MockBackend(...)`"), and wraps `MockFireProvider` for `connect`.
- `purgeWorkspace` order: tombstone first (rules then deny new writes), then delete
  subcollection docs in ≤500 batches (the existing `:929-946` loop, generalized over
  `updates|history|maintenance|metadata`), then `listAll`+`deleteObject` under the Storage
  prefix `users/{uid}/versicle/{id}/`. Idempotent; returns `PurgeReport{docsDeleted, blobsDeleted}`.
- **Prod-bundle exclusion (boundary rule 9):** `src/app/sync/createSync.ts` selects the backend:
  `if (import.meta.env.DEV || import.meta.env.VITE_E2E)` + `isMockFirestoreEnabled()` →
  `await import('@domains/sync/backend/MockBackend')`. The dynamic import in a dead branch lets
  Rollup drop the chunk from prod builds; a build-time chunk-content check (same pattern as
  `scripts/check-worker-chunk.mjs`) asserts no `MockFireProvider`/`MockBackend` string in
  production chunks — that's the *gate*, not the convention. `test-flags.ts` itself stays
  importable from prod (side-effect-free, returns inert defaults — its design doc says so).

### D2. Decomposition of the 1046-line manager

| New module | Absorbs (HEAD lines) | Notes |
|---|---|---|
| `AuthSession` | `initialize` auth half (:157-206), `handleAuthStateChange` sign-out half (:287-293), `signIn/signOut` (:600-635), `getCurrentUser` (:1006-1029) | Emits `auth` events; the `getRedirectResult` block (:186-197) is **deleted** after one manual web-sign-in verification (SocialLogin flow, `auth-helper.ts:34-58`, is the live path). Mock user synthesis (:159-165, :1010-1015) moves to `MockBackend`/composition root. |
| `WorkspaceService` | `createWorkspace` (:667-706), `switchWorkspace` (:712-850), `listWorkspaces` (:855-880), `deleteWorkspace` (:886-960), auto-provision/halt routing (:266-281) | Over `SyncBackend`; owns MigrationStateService + staged swap (§D4); `deleteWorkspace` fix: disconnect-scoped-not-destroy, conditional sever (parity with the mock branch :911-915), reconnect after deleting a non-active workspace, then `purgeWorkspace`. |
| `ProviderConnection` | `connectFireProviderNormal` (:513-579), `disconnectFireProvider` (:584-595), event wiring (:537-569) | Attaches exactly one `SyncConnection` to the live doc; translates connection events → typed `SyncEvent`s (no toasts); owns the quarantine observer (§D5). |
| `downloadWorkspaceState(backend, workspaceId, {timeoutMs=15000, maxWaitTimeMs})` | the two temp-doc dances (:428-495, :758-820) | `Promise<Uint8Array>`; temp provider always destroyed; timeout resolves with whatever synced (current behavior :446-453, :778-785 preserved — pinned by characterization first); also replaces `DataRecoveryView`'s third copy in P4-7. |
| `SyncOrchestrator` | `connectFireProvider` (:299-377) sequencing, status fan-out (:964-994), singleton plumbing (:114-151, :1041-1046) | `start()`/`stop()`; single gate `(firebaseEnabled && isConfigured) || mockEnabled` — fixes the boot path ignoring the flag (reality item 20); pre-sync checkpoint (:331-344) kept; clean-client check (:366 `useBookStore… || {}`) becomes an injected `isCleanClient()` port (store read stays in `app/`), simplified after P2's flip wave 10d removes the `|| {}`. |

`getInstance(config?)` → **`createSyncOrchestrator(deps)`** constructed once in the `syncInit`
boot task (`src/app/sync/createSync.ts`); a module-level accessor `getSyncOrchestrator()` in
`app/sync` serves the UI (SyncSettingsTab :128-174, SyncPulseIndicator,
WorkspaceMigrationConfirmModal :44, `db/wipe.ts:92-93` which uses `resetInstance()` today —
replaced by `stopSyncForWipe()` exported from app/sync). `FirestoreSyncManager.ts` becomes a
delegating façade for at most two PRs, then is **deleted** (exit criterion).

`deps` (all injected, no store imports inside `domains/sync/core`):
`{ backendFactory, doc: () => Y.Doc, events: SyncEventBus, checkpoints, migrationState,
syncState: SyncStatePort /* read/write useSyncStore */, isCleanClient: () => boolean,
debounceOverrideMs?: number }`. This kills the manager's direct `useSyncStore`/`useBookStore`
imports (:19, :41) and pays the lib→store ratchet.

### D3. Typed `SyncEvent` bus — UX copy out of the transport

```ts
// src/domains/sync/events.ts
export type SyncEvent =
  | { type: 'status'; status: FirestoreSyncStatus }                 // ~types/sync.ts union, unchanged
  | { type: 'auth'; status: FirebaseAuthStatus; email: string | null }
  | { type: 'flushed'; at: number }                                 // from 'saved' (§D6) → lastSyncTime
  | { type: 'clean-sync'; phase: 'started' | 'applied' | 'failed' }
  | { type: 'switch'; phase: 'downloading' | 'verifying' | 'staged' | 'applying' | 'failed-rolling-back' }
  | { type: 'save-rejected'; code: 'permission-denied' | 'document-too-large' | 'max-retries-exceeded'; sizeBytes?: number }
  | { type: 'connection-error'; permissionDenied: boolean }
  | { type: 'sync-failure'; permissionDenied: boolean }
  | { type: 'workspace-tombstoned'; workspaceId: string }
  | { type: 'workspace-purged'; report: PurgeReport }
  | { type: 'obsolete'; incomingVersion: number };
export interface SyncEventBus { emit(e: SyncEvent): void; on(fn: (e: SyncEvent) => void): () => void; }
```

- `src/app/sync/wireSyncEvents.ts` is the **single** subscriber that owns presentation:
  maps events → `useToastStore` copy (all 14 current strings move here verbatim, including
  `RULES_OUT_OF_DATE_MESSAGE` keyed off `permissionDenied`), writes
  `useSyncStore.setFirestoreStatus/AuthStatus/UserEmail/LastSyncTime` in exactly one place, and
  stops the heartbeat on `obsolete` (§D5). Registered by the `syncInit` boot task with
  `ctx.addCleanup`.
- `lastSyncTime` is driven by `flushed`, fixing the "pulse tooltip reports connection time"
  lie (`useFirestoreSync.ts:51-56`); the `useFirestoreSync` status mirror is deleted — the hook
  shrinks to `{signIn, signOut, isConfigured}` over the orchestrator or is deleted with its
  call sites retargeted.
- Exit grep: zero `useToastStore` imports under `src/domains/sync/**` and `src/lib/sync/**`
  (lint: `no-restricted-imports` on `@store/useToastStore` for those paths — flip warn→error in
  the PR that deletes the façade).

### D4. Staged-swap workspace switch (the data-loss window closes)

IndexedDB has no atomic database rename, so "atomic swap" is implemented as a **crash-resumable
apply from durable local staging**, gated by the existing localStorage state machine
(`__VERSICLE_MIGRATION_STATE__` key preserved; `MigrationStatus` union gains `'STAGED'` —
additive, old clients mid-switch during an app update still resolve because
`AWAITING_CONFIRMATION`/`RESTORING_BACKUP` semantics are untouched).

New flow (`WorkspaceService.switchWorkspace` + `stagedSwap.ts`):

1. Pre-flight `backend.isWorkspaceAlive(target)` (unchanged, :726-730).
2. Protected pre-migration checkpoint (unchanged, :737).
3. `blob = await downloadWorkspaceState(backend, target)` — **pure read; no state machine, no
   `activeWorkspaceId` write yet.** (Today AWAITING_CONFIRMATION + the ID flip happen *before*
   the download, :741-744 — a crash during download currently leaves a dangling state; the new
   ordering shrinks the pre-commit window to zero.)
4. **Verify** on a scratch doc: `Y.applyUpdate(scratch, blob)` must not throw;
   `readDocSchemaVersion(scratch) <= CURRENT_SCHEMA_VERSION` else abort with the obsolete UX
   (§D5 — this is the synchronous pre-merge check for the switch path); emit `switch:verifying`.
5. **Stage**: `await clearDocument('versicle-yjs-staging')` (y-idb export), write blob via temp
   doc + `new IndexeddbPersistence('versicle-yjs-staging', tempDoc, {writeDebounceMs: 200,
   transactionRunner: runExclusiveIdbWrite})` → `whenSynced` → destroy. (Fixes the analysis
   item-3 footnote: today's temp persistence omits these options, `CheckpointService.ts:141,212`.)
6. **Commit point**: `MigrationStateService.setStaged(target, backupId)` +
   `setActiveWorkspaceId(target)` in this order, then reload.
7. **Apply (boot interceptor, new `STAGED` arm)** under `navigator.locks.request('versicle-yjs-swap',
   {mode:'exclusive'})` (P3's write-gate if landed; raw Web Locks otherwise — both span tabs):
   wipe main persistence + rewrite from the staging DB (the existing
   `applyRemoteState` mechanics, source = staging not network), transition to
   `AWAITING_CONFIRMATION`, reload into the existing confirm modal. **Idempotent**: a crash
   anywhere in apply re-enters the `STAGED` arm and re-runs it — staging is intact until
   finalize.
8. Finalize (existing modal, `WorkspaceMigrationConfirmModal.tsx:29-51`): clear state, delete
   backup checkpoint, `clearDocument('versicle-yjs-staging')`, `orchestrator.start()`.
   Roll back: `setRestoringBackup()` + reload (existing path, untouched).

Failure analysis (the kill-mid-switch E2E asserts each row):

| Crash point | State on next boot | Outcome |
|---|---|---|
| during download/verify/stage (1–5) | no migration state; old `activeWorkspaceId` | old workspace boots untouched (staging is junk, cleared on next switch) |
| after STAGED, before/during apply (6–7) | `STAGED` | apply re-runs from staging; switch completes |
| after apply, before user confirms | `AWAITING_CONFIRMATION` | existing confirm modal (P0 semantics) |
| user rolls back / apply throws | `RESTORING_BACKUP` | existing pinned-checkpoint restore (P0 semantics) |

`CheckpointService.applyRemoteState` loses its network-facing caller and is reduced to the
staging-apply primitive (or absorbed into `stagedSwap.ts`); `restoreCheckpoint` gains the same
`navigator.locks` guard and persistence options.

### D5. Doc-level quarantine enforcement (the D5/item-4 fix; first `meta` reader)

Three layers, because y-cinder applies remote updates to the doc internally (there is no
app-side `Y.applyUpdate` to guard on the live path):

1. **Pre-attach gate (synchronous, before any remote bytes touch the live doc):** both paths
   that today apply downloaded state blindly get the scratch-doc check from §D4 step 4 —
   `performCleanSync`'s `Y.applyUpdate(getYDoc(), …)` (:498) and `switchWorkspace`. Cheap
   reconnect probe: `backend.listWorkspaces()` metadata `schemaVersion` (now maintained, see 3)
   checked in `SyncOrchestrator.start()` before `connect` — a client that was offline during a
   fleet migration is locked **before** attach, closing the analysis item-4 window for the
   reconnect case.
2. **Live observer:** `ProviderConnection.attach()` registers
   `doc.getMap('meta').observe(...)` — fires synchronously on transaction commit; on
   `schemaVersion > CURRENT_SCHEMA_VERSION`: `connection.destroy()` (real provider detach —
   today's handler only flips a status label), `events.emit({type:'obsolete'})`, UI lock. The
   local Y-merge of that one transaction has happened (accepted residual, pinned by P2's F.2
   test as "until P4" — P4's pin updates it to "merge happened, zero further outbound, provider
   destroyed"); the middleware halts store patching via its own poison pill.
   `handleObsoleteClient` (`yjs-provider.ts:85-100`) keeps the UI-lock half but delegates
   severing to the orchestrator via the event bus (no more dynamic-import severing).
3. **Heartbeat stop + metadata maintenance:** `wireSyncEvents` clears the heartbeat interval on
   `obsolete` (it owns the handle; today `deviceHeartbeatTask` keeps writing from behind the
   lock screen). After a successful local migration, the orchestrator stamps
   `backend.updateWorkspaceMetadata(id, {schemaVersion: CURRENT_SCHEMA_VERSION})` — fixing the
   workspace-list stale-gate (`SyncSettingsTab.tsx:389`-era check compares creation-time
   versions forever; only writer today is `createWorkspace:677`).

The middleware per-map pill stays as defense-in-depth (dual-write retires at v7/P9, not here).

### D6. y-cinder + y-idb vendoring; fork deltas

Follow `packages/zustand-middleware-yjs` exactly (P2 prep §6 mechanics): import source at the
pinned SHA (`y-cinder#9c5c205e`, `y-idb#e2a21f45`) into `packages/`, LICENSE verbatim +
`PROVENANCE.md` (upstream, fork point, delta log), `private: true`, `yjs`/`firebase` as peers,
`exports` → `src/` directly, tests ported to vitest under the root workspace,
`assert-single-instance.cjs` extended to `firebase` SDK copies, THIRD-PARTY-NOTICES regenerated.
y-idb is vendored by P3 (its `flush()/whenSynced` surgery) — verify at execution; pick up if not.

y-cinder fork deltas (each lands behind a contract test written first, same-PR rule):

1. **`saved` event** emitted after a successful Firestore commit of pending updates (the
   debounced save path, `provider.js` `_debouncedSave`) — powers `flushed`/`lastSyncTime`. The
   provider already emits all failure modes; success is the missing half.
2. **MockFireProvider parity**: extend its event map with `sync-failure`, `save-rejected`,
   `corrupted-document`, `saved` + static test hooks to trigger them; the C3 contract suite
   grows event-surface cases run against both backends so drift becomes a red CI, permanently.
3. *(No pre-apply hook.)* Considered and rejected: intercepting y-cinder's internal apply to
   scratch-check every incremental update is O(update) overhead and replicates what the §D5
   layers already cover; the live-observer + pre-attach design needs no fork change beyond
   `saved`.

### D7. CheckpointService circular-import inversion

`CheckpointService.ts:7` imports the manager only to `destroy()` before destructive ops
(:121, :193). Inversion: `restoreCheckpoint(id, opts?: { pauseSync?: () => Promise<void> })`
and the staging-apply primitive take an injected handle; callers that have the orchestrator
(boot interceptor via app, WorkspaceService) pass it; the import is deleted. `db/wipe.ts`'s
dynamic `resetInstance()` (:92-93) is replaced by the same exported handle from `app/sync`.
CheckpointService/Inspector relocate to `domains/sync/checkpoints/` in the same PR (pure move;
P3's `checkpoints` repo stays the storage layer underneath).

### D8. Kill-mid-switch E2E + emulator-vs-mock split

- **Kill-mid-switch (Playwright, CI-permanent journey, mock backend):** extends
  `verification/test_journey_workspace_switch.spec.ts`. Determinism via a test-API pause hook
  (`window.__versicleTest.pauseAt('swap:staged' | 'swap:before-apply' | 'swap:mid-apply')`,
  added to `src/test-api.ts` behind the existing install gate) + `__VERSICLE_MOCK_SYNC_DELAY__`.
  Kill = `page.close()` at each pause point (the browser context survives, so IndexedDB +
  localStorage survive — same-context reopen models process death), then reopen and assert the
  failure-table row: library non-empty, correct workspace, state machine resolved. One
  WebKit-lane run (IDB semantics differ; the P0 probe discipline applies).
- **Two-client obsolete E2E (mock):** P2 prep §5.4's journey is the template; P4 strengthens the
  assertion from "B locks" to "B locks **and** B's provider is destroyed and heartbeat stopped —
  zero outbound writes after lock" (observable via mock storage write counters).
- **Emulator-gated (vitest, node env, auto-skip — the lanes already exist):**
  `syncBackendContract.emulator.test.ts` flips `capabilities.connect = true` using the vendored
  y-cinder against auth+firestore+storage emulators (the file's header already names this as the
  P4 step); the delete-purge todo (`syncBackendContract.ts:208-210`) becomes a real case
  (create → write updates/history + Storage blob → delete → assert all gone + tombstone
  survives); `security-rules.test.ts` is untouched. CI: emulator job stays the
  nightly/labeled lane established in P0; mock contract + unit suites run per-PR.
- **What is NOT emulator-tested:** compaction internals under load, multi-tab provider races —
  pinned in the fork's own vendored test suite, not in app E2E.

---

## Execution order (PR-by-PR; each independently shippable, full suite green)

| PR | Content | Exit criteria / gates |
|---|---|---|
| **P4-0 entry gates** (characterization FIRST, program rule 7) | Unit tests for `switchWorkspace`/`createWorkspace`/`deleteWorkspace`/`performCleanSync`/auto-provisioning against the mock path **at current behavior** (the flows analysis item 16 says change blind); MockFireProvider event-surface parity + C3 event cases; `pauseAt` test-API hook; kill-mid-switch E2E written against the CURRENT switch (documents today's failure rows — expected-fail entries allowed for the data-loss window) | new suites green; `FirestoreSyncManager.test.ts` absorbed/extended, not duplicated; E2E lane includes the new journey |
| **P4-1 vendor y-cinder** (+ y-idb if P3 didn't) | `packages/y-cinder` per §D6; pure vendoring, zero behavior change; `saved` event + contract test in a follow-up commit in the same PR (test first) | all build targets green; `assert-single-instance` green; license gate green; THIRD-PARTY-NOTICES updated; lockfile no longer references `github:vrwarp/y-cinder` |
| **P4-2 SyncBackend extraction** | `backend/` trio; all ~12 `isMockFirestoreEnabled()` branches deleted from manager code (composition root only); contract harnesses collapse to `new MockBackend()` / `new FirestoreBackend(emulator)` per the skeleton's plan; mock-only `snapshotBase64` probe leaves the real path; prod-bundle chunk check for Mock* | `grep -r __VERSICLE_MOCK_FIRESTORE__ src/` hits only `test-flags.ts`; `grep isMockFirestoreEnabled src/domains/sync/` = 0 (composition root + test-flags only); bundle check green; both contract runners green |
| **P4-3 decomposition + events** | `AuthSession`/`ProviderConnection`/`WorkspaceService`/`SyncOrchestrator`/`downloadWorkspaceState`; `events.ts` + `wireSyncEvents.ts`; `createSyncOrchestrator` owned by `syncInit` boot task (single init gate honoring `firebaseEnabled`); `useFirestoreSync` mirror deleted; CheckpointService inversion (§D7) + move; manager becomes delegating façade | zero `useToastStore`/`useBookStore`/`useSyncStore` imports under `domains/sync/` (cruiser edge ratchet drops); P4-0 characterization still green; `lastSyncTime` test pins flush-driven semantics; boot tests green (App_Boot pins "initialize not awaited") |
| **P4-4 quarantine enforcement** | §D5 layers 1–3; `handleObsoleteClient` delegation; post-migration metadata stamp; two-client obsolete E2E (vitest + Playwright) upgraded to assert destroy+heartbeat-stop | two-client E2E green; P2's F.2 residual pin updated in same PR; emulator metadata-stamp case green |
| **P4-5 staged swap** | §D4 flow; `STAGED` status; boot-interceptor STAGED arm; `navigator.locks`; kill-mid-switch expected-fails flip to asserts | kill-mid-switch green at every pause point incl. WebKit lane; state-machine unit table covers all four failure rows; `test_journey_workspace_switch` green unchanged (user-visible flow identical) |
| **P4-6 honest delete + purge action** | `deleteWorkspace`: tombstone → purge (subcollections + Storage) → conditional sever → reconnect; "Purge deleted workspaces" maintenance action (walks `listWorkspaces({includeDeleted:true})`, purges residuals of past deletions); `workspace-purged` event UX | emulator delete-purge case (the skeleton's todo) real and green; `test_workspace_deletion.spec.ts` green; deleting a non-active workspace keeps the active one connected (new unit + journey assertion) |
| **P4-7 deletion + ratchets** | `FirestoreSyncManager.ts` façade **deleted**; `DataRecoveryView` retargeted to `downloadWorkspaceState`-style util; `getRedirectResult` block deleted (after manual web-auth verification); android-backup ADR decided (keep-or-delete, strangler line 384) and executed; `useSyncToasts` selector-based rewrite + import normalization; `types/workspace.ts:7` comment fixed; toast-import lint flips to error; `SyncSettingsTab` call sites retargeted (full split stays P8) | `src/lib/sync/` contains no production module except what explicitly remains (`semantic-tree` until P7 backup work, `support.ts`); cruiser lib→store ratchet ≤ baseline−(sync edges); knip clean; AGENTS/TESTING regenerated sections |

Program rule 4 check: P4 changes **no persisted user-data format** (STAGED is a localStorage
status; staging DB is transient) — safe to overlap the v6 straggler window, but confirm v6
shipped one release earlier before P4-4 (the first `meta` reader; program rule 5 / R10 of the
P2 prep).

## Test plan

- **Existing suites that pin behavior (must stay green throughout):**
  `syncBackendContract.{mock,emulator}.test.ts` + `security-rules.test.ts` (C3 + rules),
  `CheckpointService.test.ts` (403 lines — protected/supersede/prune semantics),
  `MigrationStateService.test.ts`, `FirestoreSyncManager.test.ts` (getters/events/permission-denied —
  absorbed into per-module suites in P4-3 with named `describe('regression: …')` blocks per the
  ledger), boot entry-gate tests (`App_Boot` — interceptor arms, sync-not-awaited), P2's
  crdt-contract suites (poison pill, F.2 quarantine residual), E2E:
  `test_journey_firestore_sync`, `test_journey_workspace_switch`, `test_journey_sync_scenarios`,
  `test_workspace_deletion`, `test_journey_recovery`.
- **New tests that come FIRST (entry gates):** P4-0's workspace-flow characterization (the
  current behavior, mock path); MockFireProvider event-parity contract cases; kill-mid-switch
  journey with documented expected-fails. Rationale: these are the suites that make every later
  PR mechanically verifiable; analysis item 16's "riskiest state machine changes blind" is the
  debt being paid.
- **New contract/unit per PR:** backend contract growth (purge case, event surface,
  metadata-stamp), staged-swap state table (every crash row), quarantine layer tests
  (pre-attach reject on v7 doc; observer destroy; heartbeat stop), `saved`-event fork contract.
- **Fixture needs:** P2's committed v5/v6 Y.Doc update fixtures (reuse); a synthesized
  **v7-stamped doc** (`meta.schemaVersion = 7`) for obsolete tests — synthesize via the P2
  fixture writers, do not hand-roll; a mock-storage snapshot fixture for kill-mid-switch
  (workspace with 2 books); emulator suites self-seed (no fixtures).
- **Lanes:** per-PR = unit + mock contract + Playwright mock journeys; emulator lane (already
  CI-wired, auto-skip) = rules + backend contract incl. connect/purge — required on P4-2, P4-4,
  P4-6 merges; WebKit lane for P4-5.

## Risks

| # | Risk | L×I | Mitigation |
|---|---|---|---|
| R1 | **Staged-swap rewrite of the single most dangerous user flow** regresses in an unanticipated crash window | M×H | failure-table design (§D4) with one E2E assert per row; STAGED is additive — AWAITING_CONFIRMATION/RESTORING_BACKUP semantics byte-identical (pinned by P0 tests); protected checkpoint always exists before any destructive step; apply is idempotent/re-runnable; the staging write reuses the exact persistence options of the main provider |
| R2 | **P2/P3 churn under P4** — store registry moves `src/store/**`, P3 rewrites CheckpointService storage + write-gate; line numbers here rot | H×M | this doc's §Reality-check re-verification rule; P4-0 characterization is written against *behavior*, not lines; CheckpointService inversion (P4-3) lands as interface-only change so P3's repo swap underneath is invisible; coordinate: P4 must not start P4-3 until P3's checkpoints repo merges or explicitly slips |
| R3 | **Backend extraction silently changes real-path behavior** (the mock branches were load-bearing in tests; the real branch was the untested one) | M×H | P4-0 pins both paths first; emulator contract runs the REAL branch semantics before and after extraction (the harness mirrors the real branches today, header says so); `snapshotBase64` probe removal gets an explicit clean-sync emulator case |
| R4 | **Obsolete enforcement bricks legitimate clients** (false-positive version reads on partially-synced docs) | L×H | `readDocSchemaVersion` uses `max(meta, library)` with `|| 1` (coordinator's exact function, reused); pre-attach gate only *aborts attach* (recoverable, re-probed next start) — it never wipes; the lock UI is the existing ObsoleteLockView with its existing escape hatches (DataRecoveryView) |
| R5 | **y-cinder vendoring drift** — vendored source ≠ the dist the app ran for months | M×M | pure-vendoring PR ships zero behavior change and must go green on all targets before any delta (P2's R6 pattern); the fork's own test suite ports into CI; `saved` is additive |
| R6 | **Heartbeat/cleanup ownership confusion** between boot tasks and orchestrator | M×L | ownership rule written into `wireSyncEvents.ts` header: app owns intervals + presentation, domain owns transport + events; cruiser rule keeps `domains/sync` store-import-free so the compiler enforces the direction |
| R7 | **Prod bundle still contains mock code** despite the dynamic-import pattern (Rollup inlining surprise) | L×M | the chunk-content check is the gate (not the import shape); runs in CI on every PR like `check:worker-chunk` |
| R8 | **Purge deletes wrong data** (Storage prefix listing on a BYO project with unrelated files) | L×H | purge scoped to exactly `users/{uid}/versicle/{workspaceId}/`; emulator case asserts sibling workspace blobs survive; tombstone precedes purge so a crash mid-purge leaves a re-runnable tombstoned husk (the maintenance action cleans it) |

## Dependencies

- **From P2 (verify merged before P4-0):** `meta` map dual-write + `CURRENT_SCHEMA_VERSION = 6`
  shipped at least one release before P4-4 (program rule 5; P2 prep R10); `syncedKeys` on all
  stores (annotations `popover` ignore); `api.yjs` handles + `whenHydrated` boot phase (the
  manager's `waitForYjsSync` call at :365 migrates to it during P4-3); v5/v6 fixtures + capture
  writers; the vendoring pattern (`packages/`, PROVENANCE, single-instance script).
- **From P3:** `navigator.locks` write-gate (P4-5 uses it; fallback = raw Web Locks in
  `stagedSwap.ts`, swapped later); `checkpoints` repo under CheckpointService; y-idb vendored +
  `flush()/whenSynced` (staging write quality-of-life; P4 works on the pinned SHA if P3 slips);
  data/ zod rows (WorkspaceMetadata schema can live in sync regardless).
- **From P0 (all landed, verified at HEAD):** rules + emulator lanes, contract skeleton,
  protected checkpoints, permission-denied surfacing, licensing gate (blocks P4-1), test API.
- **What later phases need from P4:** P5/P6/P7 — the `SyncEvent` bus pattern and
  ports-injection precedent; P7 (google) — `AuthSession` is where the `auth-helper ↔
  googleIntegrationManager` bidirectional coupling gets cut (P4 keeps the coupling, contained in
  AuthSession, documented); P8 — `SyncSettingsTab` split consumes the orchestrator accessor and
  `WorkspaceService` directly; P9 — deletes the `library.__schemaVersion` dual-write (v7), the
  middleware per-map pill demotion, and any P4 transition shims; the one-time purge action's
  telemetry informs whether v7 also clears preference husks (P2 prep §5.3).

---

## Follow-ups (appended at phase close, 2026-06-11)

Phase 4 closed with P4-0/2/3a/3/4/5/6 landed (the manager is deleted; staged swap + honest
delete are live). Deferred work and execution deltas, in priority order:

1. **P4-1 y-cinder vendoring + the `saved` fork delta (§D6) did NOT land.** `package.json`
   still pins `github:vrwarp/y-cinder#9c5c205e…`. Consequences, all explicitly designed for:
   - `lastSyncTime` keeps the transitional connected-transition floor in
     `wireSyncEvents.ts` (its header documents the retirement condition); `flushed` events
     flow only from the mock transport today.
   - The emulator contract runner still mirrors FirestoreBackend over the compat SDK with
     `capabilities.connect = false` / `savedEvent = false` (its header names the vendoring
     item as the unlock); `FirestoreBackend.connect` forward-wires the `saved` listener so
     the delta lights up without touching the adapter.
   - MockFireProvider event-surface parity + the C3 event cases landed ahead (P4-0), so the
     fork delta ships against a waiting contract. Vendor following `packages/y-idb`
     (PROVENANCE, peers, src-direct, single-instance check extended to `firebase`).
2. **`getRedirectResult` legacy flow still in `AuthSession` (:92).** Named legacy in its
   header; deletion still gated on one manual web-sign-in verification of the SocialLogin
   path (`auth-helper.ts`). The `signed-in-via-redirect` SyncEvent dies with it.
3. **`DataRecoveryView` still hand-rolls the third temp-doc dance** (temp
   `IndexeddbPersistence('versicle-yjs', …)` read). Retarget to a read primitive
   (`readSnapshot` from `@data/snapshot/YjsSnapshotService` now exists and is the natural
   fit — the P4-7 plan predates it).
4. **android-backup keep-or-delete ADR** (strangler line 384) still not authored;
   `src/lib/sync/android-backup.ts` + test remain.
5. **`useSyncToasts` selector-based rewrite** (whole-map `JSON.stringify` subscription +
   the aliased `useBookStore`-from-`useLibraryStore` import) untouched — it is app-side
   presentation, not transport, so the §D3 exit greps pass regardless. P8 settles it with
   the shell/settings work, alongside the `SyncSettingsTab` split (661 lines today, grew
   the purge maintenance button).
6. **Residual `src/lib/sync/` production modules**: `firebase-config.ts` (the backend's
   private helper, per design), `auth-helper.ts` (P7 cuts the google coupling),
   `semantic-tree.ts` (P7 backup work), `support.ts`, `android-backup.ts` (item 4), plus
   the C3 contract suite files. `schema.test.ts`/`security-rules.test.ts` stay as the
   rules pins.
7. **Execution deltas vs this doc worth knowing** (all strictly safer than designed):
   - The staged swap's staging write uses the P3 `YjsSnapshotService.applySnapshot`
     (commit-awaited `writeSnapshot`) instead of §D4 step 5's temp-provider dance — the
     doc predates the P3 primitives; a `readSnapshot` fork surgery (Y.11) was added for
     the boot-time staging read.
   - `SyncMigrationState` gained `previousWorkspaceId` (additive): the legacy
     modal-rollback restored the data but left `activeWorkspaceId` on the switch TARGET
     (verified at fb3dcd3f) — old data would have synced into the new workspace's cloud
     doc on the next connect. The RESTORING_BACKUP boot arm now reverts the tie; legacy
     states without the field keep legacy behavior.
   - `CheckpointService.restoreCheckpoint`'s hard path now also runs at boot with no live
     persistence binding (deleting the database directly). Pre-P4-5, a boot-time rollback
     fell into the in-memory soft path — a P1b regression where nothing persisted, the
     state machine cleared anyway, and the next reload silently booted the target
     workspace. Pinned in CheckpointService.test.ts ("boot-time rollback" block).
   - The kill-mid-switch pause hooks ride `window.__VERSICLE_SWAP_PAUSE__` through
     `src/test-flags.ts` (the pre-boot input-flag channel) rather than a
     `window.__versicleTest.pauseAt()` function — the apply runs at boot, before any test
     API call could land.
   - The Storage-blob half of the purge is pinned by `FirestoreBackend.purge.test.ts`
     (mocked SDK: listAll recursion, ≤500 batching, R8 prefix scoping, no-bucket
     degradation); the emulator lane runs Firestore-residual purge under the real rules
     but has no Storage emulator wired. Wiring storage into the emulator lane rides the
     y-cinder vendoring item (auth+firestore+storage trio).
8. **Ratchets at close:** no-circular 29, no-circular-runtime 8, lib-not-to-store 28,
   worker-no-state-typegraph 19, everything else 0 — baseline regenerated, no regressions.
   The P4 items' decreases (P4-3's 34→28 lib→store drop, runtime cycles 9→8) were locked
   when they landed.
