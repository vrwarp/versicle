# Subsystem analysis: Sync, checkpoints, migration, devices

Scope: `src/lib/sync/**`, `firestore.rules`, `src/lib/device-id.ts`, `src/store/useDeviceStore.ts`,
`src/components/sync/`, `src/components/devices/`, `src/components/settings/{SyncSettingsTab,DataRecoveryView,RecoverySettingsTab,CheckpointDiffView,JsonDiffViewer}.tsx`,
`src/components/ObsoleteLockView.tsx`, plus the boot-time consumers (`src/App.tsx`, `src/components/ErrorBoundary.tsx`, `src/store/yjs-provider.ts`) and the forked
`y-cinder` / `y-idb` / `zustand-middleware-yjs` dependencies as they relate to sync.

---

## What it is

Versicle's cross-device sync layer. The Yjs CRDT doc (`src/store/yjs-provider.ts`) is the local
source of truth, persisted to IndexedDB via the `y-idb` fork. When the user pastes their own
Firebase config (BYO-Firebase model) and signs in with Google, `FirestoreSyncManager` attaches a
`y-cinder` `FireProvider` (forked `y-fire`, Firestore-only, tiered snapshot/history/updates storage
with client-side compaction and Cloud Storage snapshot blobs) to replicate the doc to
`users/{uid}/versicle/{workspaceId}`. On top of that sit:

- **Workspaces**: multiple named libraries per account, with create/switch/delete (tombstone) flows.
- **Checkpoints**: local IDB snapshots of the Yjs doc (rolling 10), created pre-sync and pre-migration; restore = wipe-IDB-and-reload.
- **Migration state machine**: a localStorage-backed state machine (`MigrationStateService`) that survives the hard reload in the middle of a workspace switch, with confirm/rollback UI and ErrorBoundary integration.
- **Schema versioning**: `CURRENT_SCHEMA_VERSION` + per-store yjs middleware `onObsolete` → full-screen `ObsoleteLockView` quarantine for stale clients; deterministic migration runner.
- **Devices**: per-device IDs (`device-id.ts`), a CRDT-synced device mesh (`useDeviceStore`) with heartbeat, rename, delete, settings-clone.
- **UI**: settings tabs (sync config, workspaces, recovery/diff/restore, devices), sync pulse indicator, cross-device progress toasts.

## File inventory

| File | Role |
|---|---|
| `src/lib/sync/FirestoreSyncManager.ts` (993) | Singleton god-object: Firebase auth lifecycle, provider connect/disconnect, clean-client first sync, workspace create/switch/delete, tombstone pre-flight, status fan-out |
| `src/lib/sync/CheckpointService.ts` (209) | Create/list/prune/restore Yjs checkpoints in IDB `checkpoints` store; `applyRemoteState()` hard-reset used by workspace switch |
| `src/lib/sync/CheckpointInspector.ts` (106) | Diff live Y.Doc vs checkpoint blob (JSON.stringify deep compare) for restore preview |
| `src/lib/sync/MigrationStateService.ts` (102) | localStorage state machine (`AWAITING_CONFIRMATION`/`RESTORING_BACKUP`/`IDLE`) bridging reloads during workspace switch |
| `src/lib/sync/firebase-config.ts` (186) | Lazy Firebase app/auth/Firestore init from user-pasted config in `useSyncStore`; config-hash reset; dev auth proxy |
| `src/lib/sync/auth-helper.ts` (94) | Google sign-in/out via `@capgo/capacitor-social-login` → Firebase credential; sign-out also disconnects Google services |
| `src/lib/sync/validators.ts` (83) | Zod schemas mirroring `types/db.ts` — **dead code** (no production consumer) |
| `src/lib/sync/semantic-tree.ts` (120) | Builds human-readable `SyncManifest` payload from 6 Zustand stores for V2 backup |
| `src/lib/sync/android-backup.ts` (54) | Writes backup manifest to filesystem for Android BackupManager — **dead code** (never invoked; no manifest wiring) |
| `src/lib/sync/support.ts` (14) | `isStorageSupported()` IndexedDB feature check |
| `src/lib/sync/drivers/MockFireProvider.ts` (257) | localStorage-backed fake FireProvider for Playwright (`__VERSICLE_MOCK_FIRESTORE__`) |
| `src/lib/sync/hooks/useSyncStore.ts` (119) | Zustand+persist store: firebase config, enabled flag, auth/conn status, activeWorkspaceId, lastSyncTime, onboarding flag |
| `src/lib/sync/hooks/useFirestoreSync.ts` (94) | React hook: initializes manager when enabled+configured, mirrors manager callbacks into useSyncStore, exposes signIn/signOut |
| `src/lib/sync/hooks/useSyncToasts.ts` (74) | Subscribes to reading-progress store; toasts on remote-device progress jumps |
| `firestore.rules` (39) | Security rules: owner-only access + (intended) tombstone write-protection |
| `src/lib/device-id.ts` (55) | Stable per-device ID in localStorage (module-cached) |
| `src/store/useDeviceStore.ts` (136) | CRDT-synced device registry: register, throttled heartbeat, rename, delete |
| `src/components/sync/SyncPulseIndicator.tsx` | Status dot in library header |
| `src/components/sync/SyncToastPropagator.tsx` | Headless mount point for `useSyncToasts` (mounted in `RootLayout.tsx:15`) |
| `src/components/sync/WorkspaceMigrationConfirmModal.tsx` | Post-reload finalize/rollback modal for workspace switch |
| `src/components/sync/CriticalMigrationFailureView.tsx` | ErrorBoundary fallback when crash occurs during `AWAITING_CONFIRMATION` |
| `src/components/ObsoleteLockView.tsx` | Full-screen non-dismissible lock when cloud schema is newer than app |
| `src/components/devices/DeviceManager.tsx` / `DeviceList.tsx` / `DeviceIcon.tsx` | Device mesh UI: list, rename, delete, clone settings |
| `src/components/settings/SyncSettingsTab.tsx` (661) | God component: device identity, Firebase config paste-parser, sign-in, workspace CRUD, Drive folder linking, Google client-ID overrides |
| `src/components/settings/RecoverySettingsTab.tsx` (163) | Checkpoint list, inspect/restore flow, raw recovery modal |
| `src/components/settings/CheckpointDiffView.tsx` (196) | Per-store added/removed/modified diff with confirm-restore |
| `src/components/settings/JsonDiffViewer.tsx` (107) | Recursive JSON diff tree renderer (uses `lib/json-diff`) |
| `src/components/settings/DataRecoveryView.tsx` (137) | Reads raw `versicle-yjs` IDB via temp doc; dump/download JSON |
| `getDeviceId_perf.md` (repo root) | Stale perf note — fix it describes is already implemented in `device-id.ts:15,29` |
| Tests | `FirestoreSyncManager.test.ts` (getters + error events only), `CheckpointService.test.ts` (good), `MigrationStateService.test.ts` (good), `CheckpointInspector.test.ts`, `validators.test.ts` + `validators.fuzz.test.ts` (318 lines testing dead code), `schema.test.ts` (ts-morph schema-exhaustion guard), `android-backup.test.ts` (tests dead code), `MockFireProvider.test.ts`; Playwright journeys in `verification/test_journey_{firestore_sync,workspace_switch,sync_scenarios}.spec.ts`, `test_workspace_deletion.spec.ts` — all against the mock |

## How it works (data & control flow)

**Boot** (`App.tsx:143-200`): a "boot interceptor" effect reads `MigrationStateService.getState()`.
`RESTORING_BACKUP` → clear state, `CheckpointService.restoreCheckpoint(backupId)` (which wipes IDB,
rewrites from blob via temp `IndexeddbPersistence`, reloads). `AWAITING_CONFIRMATION` → halt sync
init and render `WorkspaceMigrationConfirmModal` (`App.tsx:361`). Otherwise: clean up "dangling"
and 7-day-old `pre-migration` checkpoints, then `getFirestoreSyncManager().initialize()`
unconditionally.

**Auth → connect** (`FirestoreSyncManager.initialize` → `handleAuthStateChange:216-258`): on
sign-in, if no `activeWorkspaceId`, list remote workspaces; zero → auto-provision "My Library";
some → halt and force UI selection. With a workspace: `connectFireProvider` runs a tombstone
pre-flight (`validateWorkspaceIsAlive:175-211`), creates a 24h-throttled `pre-sync` checkpoint
(`:299`), then either:
- *Clean client* (zero books, `:332`): `performCleanSync` — probe Firestore for existing data, hydrate a temp `Y.Doc` via a throwaway FireProvider, `Y.applyUpdate` into the live doc, then attach the real provider; or
- *Normal*: attach `FireProvider` directly and wire `connection-error` / `sync-failure` / `save-rejected` events to status + toasts (`:503-525`).

**Workspace switch** (`switchWorkspace:669-793`): pre-flight tombstone check → `pre-migration`
checkpoint → `MigrationStateService.setAwaitingConfirmation` → set new `activeWorkspaceId` →
hydrate remote into temp doc (second copy of the temp-provider dance) →
`CheckpointService.applyRemoteState` (wipe IDB, write remote blob, reload). After reload the boot
interceptor shows the confirm modal; *Finalize* clears state + deletes backup + re-initializes;
*Roll back* sets `RESTORING_BACKUP` + reloads; a crash while awaiting confirmation is caught by
`ErrorBoundary` (`ErrorBoundary.tsx:57-65`) which renders `CriticalMigrationFailureView`.

**Delete** (`deleteWorkspace:830-905`): destroy manager → batch-delete `updates` subcollection →
plant `isDeleted` tombstone on the root doc → tombstone the metadata doc → clear
`activeWorkspaceId`.

**Schema guard**: every yjs-middleware store gets `schemaVersion`/`onObsolete`/`onLoaded` via
`getYjsOptions()` (`yjs-provider.ts:191-199`). The forked middleware stops in/outbound replication
for a map whose `__schemaVersion` exceeds the app's and calls `handleObsoleteClient`
(`yjs-provider.ts:58-73`), which flips `useUIStore.obsoleteLock` → `ObsoleteLockView`. Migrations
run via double-`queueMicrotask` after first hydration (`runMigrations:182-184`).

**Devices**: `App.tsx:203-300` registers the current device (UA-parsed name + settings profile)
into `useDeviceStore` after Yjs sync and heartbeats `touchDevice` every 5 min (store-side throttle
5 min). The devices map replicates through the same Yjs doc.

**Status plumbing**: manager `setStatus` writes `useSyncStore` directly (`:913`) *and* fans out to
callbacks; `useFirestoreSync` also subscribes to the same callbacks and writes the same store,
plus stamps `lastSyncTime` on transition to `connected`.

**y-cinder storage model** (fork at `github:vrwarp/y-cinder#main`): per-doc tiered storage —
`updates` subcollection (live), `history` segments, and a compacted snapshot uploaded to **Firebase
Cloud Storage** (`{path}/snapshot_vN.bin`, `dist/compaction.js:188-195`) with pointer + state
vector on the main doc; client-side compaction guarded by a Firestore lock doc
(`metadata/lock_compaction`, `dist/types.js:25-29`) and a candidate-validation `Y.decodeUpdate`
check before commit.

---

## Technical debt

### 1. `firestore.rules` catch-all silently neuters all tombstone protection — and the specific rule is syntactically broken
- **Severity:** critical | **Category:** security
- **Evidence:**
  - `firestore.rules:35-37` — `match /users/{userId}/{document=**} { allow read, write: if request.auth.uid == userId }`. Firestore grants access if *any* matching rule allows. This recursive wildcard also matches `users/{uid}/versicle/{ws}` and `…/updates/*`, so the carefully written tombstone denials at lines 16-17 and 21-23 can never deny anything.
  - `firestore.rules:17` — `!resource.exists` is not valid rules syntax (`resource` has no `exists` member; the idiom is `resource == null` or the `exists()` function). Likewise `resource.data.isDeleted != true` errors when the field is absent (must use `'isDeleted' in resource.data` or `resource.data.get(...)`). Both errors evaluate falsy — masked today only because the catch-all allows everything.
  - y-cinder additionally writes `history`, `maintenance` and `metadata/lock_compaction` subcollections (`y-cinder/dist/types.js:25-29`) that have **no** tombstone rule even in the intended design.
- **Impact:** "Tombstoned workspaces cannot be resurrected" is enforced client-side only. Any other client (older app version, a buggy provider retry, a different tool using the same creds) can keep writing updates/history into a deleted workspace, recreating storage costs and zombie data. The rules give a false sense of a server-side invariant; tests can't catch it because the mock has no rules at all.
- **Fix:** Rewrite rules with non-overlapping matches: scope the catch-all to explicitly exclude `versicle/**`, fix `resource == null` / `'isDeleted' in resource.data` syntax, add tombstone checks for `history`/`maintenance`/`metadata`, and add a rules unit-test suite against the Firestore emulator (y-cinder's repo already runs emulators; this repo runs none).

### 2. No Cloud Storage rules or deployment story, although snapshots live in Cloud Storage; deletion doesn't actually delete data
- **Severity:** critical | **Category:** security
- **Evidence:**
  - y-cinder compaction always uploads the snapshot blob to Cloud Storage (`y-cinder/dist/compaction.js:188-195`, path `users/{uid}/versicle/{ws}/snapshot_vN.bin`) and reads it on sync (`dist/sync.js:183-193`). The repo contains `firestore.rules` but **no `storage.rules` and no `firebase.json`** (verified: only `firestore.rules` at root; README/architecture.md never mention storage rules).
  - `deleteWorkspace` (`FirestoreSyncManager.ts:872-899`) purges only the `updates` subcollection; `history` docs and all Cloud Storage `snapshot_vN.bin` blobs survive deletion.
- **Impact:** (a) BYO-Firebase users who deploy only the provided `firestore.rules` get default-deny Storage → every compaction fails → unbounded `updates` growth, degraded sync, rising cost; users who leave "test mode" on get permissive storage. (b) "Delete workspace … permanently reclaim cloud storage" (`SyncSettingsTab.tsx:165`) is false — the full library snapshot remains in Storage and history: a privacy and cost bug.
- **Fix:** Ship `storage.rules` (owner-only on `users/{uid}/**`) + `firebase.json` + documented `firebase deploy` flow; extend `deleteWorkspace` to purge `history`, `maintenance`, `metadata` and Storage snapshots (list via the main doc's `snapshotStoragePath` and version counter); add an emulator-backed integration test for delete.

### 3. Workspace switch has a real data-loss window and a rollback that can silently fail
- **Severity:** critical | **Category:** correctness
- **Evidence:**
  - `CheckpointService.applyRemoteState` (`CheckpointService.ts:156-176`) wipes local persistence (`clearData()`) *before* writing the remote blob. If the temp-persistence write fails (IDB quota, crash), the `catch` in `switchWorkspace` (`FirestoreSyncManager.ts:784-792`) clears the migration state and reverts the workspace ID with the comment "*(local IDB untouched)*" — which is wrong once `clearData()` ran. Next boot sees no migration state → loads an empty doc; the user's only path back is manually finding the `pre-migration` checkpoint in the Recovery tab.
  - The rolling prune keeps only 10 checkpoints (`CheckpointService.ts:10,38-49`) and does not protect the checkpoint referenced by an in-flight migration; an unlucky sequence of pre-sync checkpoints can delete the rollback target. Restore then throws `'Checkpoint corrupted'` (`CheckpointService.ts:83`), but the boot interceptor already cleared the migration state before calling restore (`App.tsx:150-152`), so the failed rollback just… boots into the new workspace.
  - Same wipe-before-write pattern in `restoreCheckpoint` (`CheckpointService.ts:93-116`). The temp `IndexeddbPersistence` used for the rewrite omits the `writeDebounceMs`/`runExclusiveIdbWrite` options the main provider uses (`CheckpointService.ts:106` vs `yjs-provider.ts:30-33`), so a second open tab can interleave writes mid-restore.
- **Impact:** The single most dangerous user flow (switching workspaces) can leave a user with an empty library and no automatic recovery; multi-tab restores can corrupt the rewritten doc.
- **Fix:** Make the swap transactional: write the new state to a *staging* IDB database, verify, then atomically swap names (or write a "pending state blob" record consumed at next boot before any wipe). Pin the migration's checkpoint (e.g., `protected: true` field excluded from pruning) until the state machine resolves. Acquire a `navigator.locks` exclusive lock (or reuse `runExclusiveIdbWrite`) around restore. Keep the migration state set until restore *succeeds*.

### 4. Obsolete-client quarantine only covers one of ~10 synced maps and never disconnects the provider
- **Severity:** high | **Category:** correctness
- **Evidence:**
  - Only `useBookStore` carries `__schemaVersion` (`useBookStore.ts:51,99`). The middleware's obsolete check reads each store's *own* map (`zustand-middleware-yjs/dist/yjs.mjs:680-688`), so `devices`, `readingState`, `preferences`, `annotations`, `readingList`, `lexicon`, `vocabulary`, `contentAnalysis` maps never trip it and keep replicating both directions against a newer-schema cloud doc.
  - `handleObsoleteClient` (`yjs-provider.ts:58-73`) claims to "sever the cloud connection" but only sets `useSyncStore.firestoreStatus='disconnected'` (a label) and the UI lock — it never calls `getFirestoreSyncManager().destroy()`. The FireProvider stays attached; the 5-minute device heartbeat (`App.tsx:287-290`) keeps generating outbound updates from behind the lock screen.
  - Stale-version gate in the workspace list uses workspace *metadata* `schemaVersion` (`SyncSettingsTab.tsx:389`), but nothing updates that metadata when `runMigrations` bumps the in-doc version — the gate compares against the creation-time value forever (`FirestoreSyncManager.ts:629-634` is the only writer).
- **Impact:** The whole point of the quarantine — "a stale client must not write old-schema data into migrated cloud state" — holds for the library map only. Concurrent old/new clients can corrupt every other store, the exact failure mode this machinery was built to stop.
- **Fix:** Move the version stamp to a single dedicated `meta` map checked once per doc (not per store); on obsolete, actually `destroy()` the provider and stop the heartbeat; update workspace metadata `schemaVersion` after successful migration; add a two-client e2e (old schema vs new) that asserts zero outbound writes from the locked client.

### 5. `deleteWorkspace` kills the whole manager and severs the active workspace even when deleting a different one
- **Severity:** high | **Category:** correctness
- **Evidence:** `FirestoreSyncManager.ts:870` calls `this.destroy()` (drops the auth listener and all callbacks, not just the provider); `:902` unconditionally `setActiveWorkspaceId(null)` — note the mock branch does it *conditionally* (`:857-860`), so the real path diverges from the tested path. Nothing re-initializes the manager afterwards.
- **Impact:** Deleting any secondary workspace from settings silently disconnects sync for the active one and de-selects it; user sees the "Action Required: Select a Library" banner and must reconnect manually. Auth-state changes are no longer observed until full reload.
- **Fix:** Only clear `activeWorkspaceId` when the deleted workspace is active; replace `destroy()` with `disconnectFireProvider()` scoped to the deleted path; reconnect after deletion; align mock and real branches (see item 7 — best fixed by removing the duplicated branches entirely).

### 6. `FirestoreSyncManager` is a 993-line god object with three copies of the "temp doc hydration" dance
- **Severity:** high | **Category:** architecture
- **Evidence:** One class owns auth lifecycle, provider lifecycle, clean-sync bootstrap, workspace CRUD, tombstone validation, status fan-out, and toast UX. The throwaway-provider download is implemented twice nearly identically (`performCleanSync:394-461` and `switchWorkspace:719-777`), both stashing the provider on the doc via `(tempDoc as any)._tempProvider` (`:449,:761`); a third temp-doc pattern lives in `DataRecoveryView.tsx:22-35`. `connectFireProvider` throws `WorkspaceDeletedError` (`:281`) but its main caller doesn't await it (`handleAuthStateChange:249`) → unhandled promise rejection that only the global handler logs. The misnamed `stateVector` at `:463` is actually a full state update.
- **Impact:** Every workspace/auth feature change requires reasoning about the whole file; the duplicated hydration blocks have already drifted (different timeout handling, different error paths); unawaited throws make failures invisible.
- **Fix:** Decompose into `AuthSession` (auth + redirect), `WorkspaceDirectory` (Firestore metadata CRUD + tombstones), `ProviderConnection` (attach/detach + events), and one shared `downloadWorkspaceState(path, {timeoutMs}): Promise<Uint8Array>` utility; make all async paths awaited with explicit error surfaces.

### 7. Playwright mock mode is interleaved through production code, and the mock has drifted from the real provider
- **Severity:** high | **Category:** testing
- **Evidence:** 8 `__VERSICLE_MOCK_FIRESTORE__` branches inside `FirestoreSyncManager.ts` alone (e.g. `:122,:177,:311,:637,:706,:803,:835,:956`), each re-implementing workspace metadata/tombstones over raw `localStorage`. The *real* clean-sync path even checks the mock-only field `snapshotBase64` on Firestore docs (`:357-361`). `MockFireProvider`'s event map lacks `sync-failure` and `save-rejected` (`MockFireProvider.ts:41-45`) which the manager wires for the real provider (`FirestoreSyncManager.ts:509-525`), and its storage model (single base64 snapshot in localStorage) shares nothing with y-cinder's tiered updates/history/snapshot+Storage model. All sync e2e journeys (`verification/test_journey_*` ) run against this fake; the real provider/rules are never integration-tested in this repo.
- **Impact:** The branches *are* the bug farm (see item 5's mock/real divergence); e2e green tells you little about real Firestore behavior (compaction, rules, doc-size limits, multi-tab).
- **Fix:** Introduce a `SyncBackend` interface (real `FirestoreBackend` vs `MockBackend`) injected once at construction; delete every inline `isMock` branch; extend the mock to the full event surface; add a small emulator-based integration suite (firebase emulators + the real y-cinder) for connect, compact, tombstone, delete, rules.

### 8. Forked sync stack pinned to moving branch refs; whole durability story rides on single-maintainer AI-generated forks
- **Severity:** high | **Category:** architecture
- **Evidence:** `package.json:67-73` — `"y-cinder": "github:vrwarp/y-cinder#main"`, `"y-idb": "github:vrwarp/y-idb#master"`, `"zustand-middleware-yjs": "github:vrwarp/zustand-middleware-yjs#master"`. Branch refs, not commit SHAs or tags; `npm install` on different days produces different sync engines. y-cinder's README states it is "mostly written with Google Antigravity"; it implements distributed locking, transactional compaction, and Cloud Storage GC — the highest-risk code in the whole product — and Versicle has zero tests exercising it.
- **Impact:** Non-reproducible builds; an upstream force-push or regression lands silently in every fresh install; correctness of all user data depends on code outside this repo's CI.
- **Fix:** Pin to commit SHAs (or publish tagged versions); add the emulator integration suite from item 7 as a contract test for the fork; document the fork-update procedure (bump SHA + run contract tests).

### 9. Schema migration runner races its own version bumps
- **Severity:** high | **Category:** correctness
- **Evidence:** `yjs-provider.ts:97-165` — the v1→v2 step schedules `import('./useReadingStateStore').then(...)` which sets `__schemaVersion: 2` (`:134`) *asynchronously*, while the outer function synchronously proceeds: the v2/v3 branch sets `__schemaVersion: 4` immediately (`:144`), and the v4 branch schedules another import that sets `:5` (`:162`). Final stored version depends on dynamic-import resolution order; the late v1-handler can regress 5→2. All `.catch(() => {})` swallow failures silently (`:136-138,:163,:169-171`).
- **Impact:** Version stamp can regress, re-running migrations on every boot (extra CRDT churn replicated to all devices) and undermining the obsolete-client gate that compares against this value; swallowed errors mean a failed migration looks like success.
- **Fix:** Make the runner strictly sequential `async/await` with static imports (the stores are all in the same chunk anyway), bump the version exactly once at the end inside a single Yjs transaction, and surface failures (toast + flight recorder) instead of empty catches.

### 10. Fragmented initialization and duplicated status plumbing
- **Severity:** medium | **Category:** architecture
- **Evidence:** `manager.initialize()` is invoked from three places with different gating: `App.tsx:198` (unconditional — ignores the `firebaseEnabled` flag), `useFirestoreSync.ts:40-70` (gated on `firebaseEnabled && isConfigured`, i.e. only when the settings dialog mounts the hook), and `WorkspaceMigrationConfirmModal.tsx:44`. Status reaches `useSyncStore` twice: `setStatus` writes it directly (`FirestoreSyncManager.ts:913`) *and* `useFirestoreSync:51-56` mirrors the same callback into the same store, where it also stamps `lastSyncTime` — but only on the `connected` *transition*, so the pulse tooltip "Synced (Last: …)" (`SyncPulseIndicator.tsx:59`) reports connection time, not last successful flush. `getRedirectResult` handling (`FirestoreSyncManager.ts:149-160`) belongs to the abandoned web-redirect flow (sign-in now goes through `SocialLogin` → `signInWithCredential`, `auth-helper.ts:34-58`) and is likely dead.
- **Impact:** Lifecycle is impossible to reason about (who initializes, when, under which flag); the enabled toggle is decorative on the boot path; UI lies about sync recency.
- **Fix:** One composition-root initialization (boot interceptor) honoring one gate; manager publishes to the store in exactly one place; have the provider's save/sync events update `lastSyncTime`; delete the redirect-result block after confirming the SocialLogin flow on web.

### 11. Dead code cluster: validators, android-backup, IDLE/dangling machinery, `isBlocked`, stale root doc
- **Severity:** medium | **Category:** dead-code
- **Evidence:**
  - `validators.ts` schemas + `validateYjsUpdate` have **zero** production consumers (grep: only `validators.test.ts` and the 318-line `validators.fuzz.test.ts`).
  - `AndroidBackupService` is never called from production (grep: only its own test); `android/app/src/main/AndroidManifest.xml:13` has plain `allowBackup="true"` with no `fullBackupContent`/`dataExtractionRules` referencing `backup_payload.json`.
  - `MigrationStateService` status `'IDLE'` is never written anywhere (grep: only the type and the check), so `getDanglingBackupId()` (`MigrationStateService.ts:94-101`) always returns null and App.tsx's "dangling backup cleanup" (`App.tsx:174-181`) is unreachable; `isBlocked()` (`:55-59`) has no callers outside tests (architecture.md:309 still documents it as the boot gate).
  - `resetDeviceId` (`device-id.ts:49-55`) unused; `getDeviceId_perf.md` at repo root describes an optimization that already exists (`device-id.ts:15,29-44`); `types/workspace.ts:7` documents a path (`versicle_meta/workspaces`) that doesn't match the code (`users/{uid}/workspaces`, `FirestoreSyncManager.ts:649,815`).
- **Impact:** Future maintainers (human or agent) keep these alive, write tests for them, and trust wrong docs; the fuzz suite burns CI time validating nothing.
- **Fix:** Delete validators*, android-backup* (or actually wire it into the Android manifest if native backup is desired), `IDLE`/dangling/`isBlocked` paths, `resetDeviceId`, `getDeviceId_perf.md`; fix the `types/workspace.ts` comment; reconcile architecture.md.

### 12. `useSyncToasts` serializes the entire progress map on every store update
- **Severity:** medium | **Category:** performance
- **Evidence:** `useSyncToasts.ts:17-24` — `JSON.stringify(state.progress)` + `JSON.parse` of the previous snapshot on *every* `useReadingStateStore` change; progress updates fire continuously during reading/TTS. It also imports `useBookStore` from `'../../../store/useLibraryStore'` (`:5`) while the rest of the subsystem imports `'../../store/useBookStore'` — same store, two module paths.
- **Impact:** O(books × devices) stringify on a hot path; the aliased import invites circular-dependency surprises and confuses dependency analysis.
- **Fix:** Use the store's subscribe-with-selector + shallow per-book comparison, or have the manager emit explicit "remote progress" events keyed by transaction origin; normalize the import path.

### 13. `SyncSettingsTab` is a 661-line god component with a duplicated config type and mixed data-access styles
- **Severity:** medium | **Category:** architecture
- **Evidence:** One component renders device identity, a regex-based Firebase config paste-parser (`SyncSettingsTab.tsx:65-97`), sign-in state machine, workspace CRUD (`:135-182`), Drive folder linking + scanning (`:184-230`), and Google client-ID overrides (`:575-641`). It declares its own `FirebaseConfig` interface (`:8-16`) duplicating `FirebaseConfigSettings` (`useSyncStore.ts:8-16`). It receives 13 props from `GlobalSettingsDialog` (`GlobalSettingsDialog.tsx:595-640`) yet *also* reaches directly into `getFirestoreSyncManager()`, `useSyncStore`, `useDriveStore`, `useGoogleServicesStore` — half lifted-state, half singleton access. The redundant `firebaseAuthStatus === 'signed-in'` re-check at `:359` inside an already-signed-in branch is a tell of patch-accretion.
- **Impact:** Any sync-settings change risks the Drive/Google sections and vice versa; the prop interface gives a false impression of testable purity.
- **Fix:** Split into `DeviceIdentitySection`, `FirebaseConnectionSection`, `WorkspaceSection` (sync subsystem) and move Drive/Google sections to the google subsystem's settings; consume `useSyncStore`/hooks directly and drop the prop tunnel; delete the duplicate interface.

### 14. Circular module dependency between `CheckpointService` and `FirestoreSyncManager`
- **Severity:** medium | **Category:** architecture
- **Evidence:** `CheckpointService.ts:7` imports `getFirestoreSyncManager`; `FirestoreSyncManager.ts:16` imports `CheckpointService`. Works today only because both use the import lazily at call time. Related: `yjs-provider.ts:64-72` resorts to dynamic `import()` of `useSyncStore`/`useUIStore` to dodge other cycles, and `disconnectYjs` nulls the internal `persistence` while the exported `yjsPersistence` const (`yjs-provider.ts:51`) keeps pointing at the destroyed instance consumed by `CheckpointService.ts:93,156`.
- **Impact:** Module-init ordering is fragile; a refactor that touches imports can turn lazy cycles into `undefined` crashes; stale `yjsPersistence` would misbehave on any second restore without reload.
- **Fix:** Invert with a tiny event/callback: `CheckpointService` accepts a `pauseSync()` handle instead of importing the manager; export a `getYjsPersistence()` accessor instead of a const snapshot.

### 15. Recovery/diff UI duplications and rough edges
- **Severity:** low | **Category:** duplication
- **Evidence:** Three device-icon implementations: `components/devices/DeviceIcon.tsx`, `components/reader/DeviceIcon.tsx` (files differ), and inline `getIcon` in `DeviceList.tsx:66-71`. Two diff renderers with different semantics: `CheckpointDiffView`'s flat sections vs `JsonDiffViewer`'s tree (`computeDiff` in `lib/json-diff`), while `CheckpointInspector.deepDiff` does its own `JSON.stringify` comparison (`CheckpointInspector.ts:98`). Restore triggers two reloads (`CheckpointService.ts:116` and `RecoverySettingsTab.tsx:51-53`). `DataRecoveryView.tsx:48` hardcodes a `knownKeys` store list that will drift as stores are added. The native `confirm()` dialogs in `SyncSettingsTab.tsx:165`, `DeviceManager.tsx:17,47` bypass the app's modal system.
- **Impact:** Cosmetic drift, duplicated maintenance, double-reload flicker.
- **Fix:** Single `DeviceIcon`; single diff engine feeding both views; remove the redundant reload; derive `knownKeys` from a store registry; use the app modal.

### 16. Sync unit tests cover the trivial 20%, not the dangerous 80%
- **Severity:** medium | **Category:** testing
- **Evidence:** `FirestoreSyncManager.test.ts` tests getters, callback registration, and the three provider error events; there are **no unit tests** for `switchWorkspace`, `createWorkspace`, `deleteWorkspace`, `performCleanSync`, `validateWorkspaceIsAlive`, or the auto-provisioning logic — the flows where every critical bug above lives. The Playwright journeys exercise them only through the divergent mock (item 7). Meanwhile 318 lines of fuzz tests guard dead zod schemas (item 11), a hallmark of test sprawl.
- **Impact:** The riskiest state machine in the app changes blind.
- **Fix:** After the decomposition (item 6) and backend injection (item 7), write unit tests per flow against `MockBackend`, plus the emulator contract suite for the real one; delete dead-code tests.

## Problematic couplings

- `FirestoreSyncManager.ts:19,332` reaches into `useBookStore` to define "clean client" (zero books) — sync layer depends on a domain store's shape; an empty-library user with annotations is misclassified.
- `FirestoreSyncManager` imports `useToastStore` in 8 places — transport layer owns UX copy; should emit events the UI translates.
- `yjs-provider.ts:64-72` (store layer) lazily imports sync hooks and UI store to break cycles — the store layer knows about sync and UI.
- `auth-helper.ts:11-12,75-84` — Firebase sign-out reaches into `googleIntegrationManager` and `useGoogleServicesStore` (google subsystem); conversely `GoogleIntegrationManager.ts:5,36` imports `useSyncStore` to read the Firebase email for login hints. Bidirectional sync↔google coupling.
- `semantic-tree.ts:1-9` reads six Zustand stores directly; any store rename breaks backup payloads silently (partially guarded by `schema.test.ts`).
- `SyncSettingsTab.tsx:18,41-43` embeds Drive picker/scanner and Google client-ID configuration — google-subsystem UI inside the sync tab.
- `CheckpointService.ts:7` ↔ `FirestoreSyncManager.ts:16` circular import (item 14).
- `App.tsx:143-300` hand-orchestrates the boot interceptor, device registration, heartbeat, and zombie-checkpoint GC inline — sync boot logic lives in the app shell rather than the subsystem.

## What's good (keep)

- **The migration state machine concept**: localStorage state bridging reloads, explicit `AWAITING_CONFIRMATION` confirm/rollback UX, ErrorBoundary integration rendering `CriticalMigrationFailureView` on crash (`ErrorBoundary.tsx:57-65`) — defensive design rarely seen; keep the design, fix the holes (item 3).
- **Checkpoint-before-danger discipline**: throttled `pre-sync` checkpoints (`FirestoreSyncManager.ts:299`) and `pre-migration` backups, with rotation and the 7-day zombie GC. The Inspect→Diff→Confirm restore flow (`RecoverySettingsTab` → `CheckpointDiffView`) is excellent recovery UX.
- **DataRecoveryView raw extraction** via an isolated temp doc — a genuine last-resort escape hatch, also reachable from the ErrorBoundary.
- **Tombstone pattern intent** (pre-flight `validateWorkspaceIsAlive`, halting auto-connect for unassigned clients, "Action Required" banner) — right shape, needs server-side enforcement.
- **Schema-version quarantine concept** (`ObsoleteLockView`, middleware `onObsolete` halting in/outbound per map) — right idea; needs doc-level scope (item 4).
- **`schema.test.ts` ts-morph exhaustion tests** forcing every DB store/field to declare a sync strategy — a clever, durable guard-rail worth extending to the Yjs maps themselves.
- **`useSyncStore` partialize discipline** — transient status never persisted (`useSyncStore.ts:102-115`).
- **y-cinder internals show real care** (candidate `Y.decodeUpdate` validation before snapshot commit, lock kill-switch inside the transaction, storage GC of old snapshots) — the fork is worth keeping, but pinned and contract-tested.
- **Device mesh** (`useDeviceStore`): throttled heartbeat, UA-derived names, settings-clone profile — small, synced, useful.
- **`firebase-config.ts`** config-hash reinit and dev auth-domain proxying — tidy.

## Target design

```
src/lib/sync/
  core/
    SyncOrchestrator.ts      // single lifecycle owner: boot gate, auth session, provider attach
    AuthSession.ts           // sign-in/out (SocialLogin→Firebase), auth state events
    ProviderConnection.ts    // FireProvider attach/detach, event normalization → SyncEvents
    backend/
      SyncBackend.ts         // interface: workspace metadata CRUD, tombstones, doc probes
      FirestoreBackend.ts    // real impl (all firebase/firestore imports live here)
      MockBackend.ts         // test impl (replaces all inline isMock branches)
    downloadWorkspaceState.ts// the one temp-doc hydration utility
  workspaces/
    WorkspaceService.ts      // create/switch/delete on top of SyncBackend
    MigrationStateMachine.ts // typed states incl. staging-swap; checkpoint pinning
  checkpoints/
    CheckpointService.ts     // + protected flag, navigator.locks around restore
    CheckpointInspector.ts
  events.ts                  // typed SyncEvent bus; UI subscribes for toasts/status
  hooks/ (useSyncStore, useSyncStatus, useSyncToasts)
```

Key properties:
1. **One composition root**: `SyncOrchestrator.boot()` called once from App; it runs the migration interceptor, honors a single `syncEnabled` gate, and owns the heartbeat. No other call sites of `initialize()`.
2. **Backend injection** kills every `__VERSICLE_MOCK_FIRESTORE__` branch; Playwright selects `MockBackend` via one flag at the composition root.
3. **Events, not toasts**: the manager emits `SyncEvent`s (`connected`, `flushed`, `save-rejected{code}`, `workspace-tombstoned`, `obsolete{version}`); `useSyncToasts`/indicator translate to UX. `lastSyncTime` driven by `flushed`.
4. **Doc-level schema guard**: one `meta` Y.Map holds `schemaVersion`; obsolete ⇒ `ProviderConnection.detach()` + heartbeat stop + UI lock. Workspace metadata version updated post-migration.
5. **Transactional workspace swap**: download → staging IDB → verify decode → swap → reload; migration checkpoint pinned until resolution; rules + storage rules enforce tombstones server-side, validated by an emulator contract suite that also pins the y-cinder fork (SHA) behavior.
6. **Migrations**: sequential awaited runner, single version bump in one transaction, loud failure.

## Migration notes (getting there without breaking users)

1. **Non-breaking first wave (no data shape changes):** delete dead code (item 11), pin fork SHAs (item 8), fix `deleteWorkspace` conditional sever + reconnect (item 5), fix unawaited `connectFireProvider` (item 6), normalize imports. None of this touches stored data.
2. **Rules rollout:** new `firestore.rules` + `storage.rules` + `firebase.json` are deploy-time artifacts for the user's own project; ship a "Rules out of date" doc + an in-app probe (attempt a canary write to a tombstoned-path simulation is overkill — instead surface compaction `save-rejected` errors with a "check your rules" hint). Because rules were effectively allow-all for owners, tightening them cannot break legitimate clients as long as `history`/`maintenance`/`metadata` and Storage paths are explicitly allowed for the owner.
3. **Backend extraction:** mechanical; keep `FirestoreSyncManager` as a thin façade re-exporting the new orchestrator during the transition so `App.tsx`/settings keep compiling, then update call sites and delete the façade.
4. **Schema-guard move to doc-level `meta` map:** additive — write the new `meta.schemaVersion` alongside the existing `library.__schemaVersion` for one release; readers check `max(meta, library)`; after one version, drop the per-store stamp. The middleware change happens in the fork (bump = new pinned SHA + contract tests).
5. **Migration-runner rewrite:** behavior-equivalent for users already at v5 (`currentVersion >= CURRENT` early return). Add a one-time repair: if stored version < 5 but v5 artifacts exist (e.g., `fontProfiles` present), stamp 5 without re-running.
6. **Transactional switch (staging swap):** changes only local mechanics; the localStorage state machine keys (`__VERSICLE_MIGRATION_STATE__`) stay, with new statuses added (`STAGED`); old clients mid-migration during an app update still resolve because `AWAITING_CONFIRMATION`/`RESTORING_BACKUP` semantics are preserved.
7. **Checkpoint pinning:** add optional `protected` field to the `checkpoints` IDB store (idb is schemaless per record — no DB version bump needed); pruning skips it.
8. **Storage cleanup for past deletions:** offer a one-time "purge deleted workspaces" maintenance action that walks tombstoned metadata and deletes residual `history`/Storage blobs, since old deletions left them behind.
