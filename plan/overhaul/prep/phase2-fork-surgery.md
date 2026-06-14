# Phase 2 prep — fork surgery on `zustand-middleware-yjs`: implementation-ready design

Status: READ-ONLY prep artifact. Verified against the working tree (branch
`claude/amazing-davinci-d7336e`, post-`3b0cfcff`) and the **installed** fork at
`node_modules/zustand-middleware-yjs` (v1.3.1, github:vrwarp/zustand-middleware-yjs pinned to
`f2842963ecbd5b2bc80fc1898267c0e41b5a1834`, `package.json:76`). All `yjs.mjs` line numbers refer
to `node_modules/zustand-middleware-yjs/dist/yjs.mjs` (the only shipped form of the fork —
the installed package contains `dist/`, `license`, `package.json`, `readme.md` only; the TS
source lives in the GitHub repo and arrives with vendoring, §6).

Inputs: master plan `plan/overhaul/README.md` (§Roadmap P2, §Governance rules 4–7),
`plan/overhaul/analysis/state-stores.md` (D1–D15), `plan/overhaul/proposals/strangler-incremental.md`
§Phase 2 (lines 475–504) + risk row 2 (line 678), `plan/overhaul/judging.md` grafts 2–7,
`plan/overhaul/proposals/contract-first.md` C2/C6/C11 rows.

**Corrections to the plan discovered against the real tree** (details inline, flagged ▲):

1. ▲ The popover hotfix has **already landed**: `useAnnotationStore` no longer holds popover
   state (`src/store/useAnnotationStore.ts:17-23` documents the move to `useReaderUIStore` and
   explicitly reserves the stale `popover` Y.Map key for v6 deletion). v6's job is residual-key
   cleanup only.
2. ▲ The App.tsx boot poll is now at `src/App.tsx:283-287` (plans cite 269-273).
3. ▲ `atomicKeys` is **dead code** under `disableYText: true`: the mapping/patch branches only
   consult `atomicKeys` when `disableYText` is falsy (`yjs.mjs:345-356`, `379-390`, `446-449`).
   `useBookStore.ts:99`'s `getYjsOptions({ atomicKeys: ['__schemaVersion'] })` has been a no-op
   since v4 (commit `fb96dd97` made `disableYText: true` the global default). Delete with
   `defineSyncedStore`.
4. ▲ The fork declares `yjs: ^13.5.11` and `zustand: ^5.0.9` as **regular dependencies, not
   peers** (`node_modules/zustand-middleware-yjs/package.json` `dependencies`). Today there is no
   nested `node_modules` under the fork — single-yjs is *dedupe-by-luck*. The plan's
   "single-yjs-instance assertion" is not optional hygiene; it guards a live hazard (§6).
5. ▲ Not all "~20 defensive `|| {}` fallbacks" are hydration canaries. The five in
   `useReadingStateStore.ts:139,185,260,356,385` are **second-level** guards
   (`state.progress[bookId] || {}` — a legitimately absent book), not top-level
   hydration-delete guards. They must **stay**. True canary census in §2.6.
6. ▲ The licensing analysis's "forks pinned to moving branch refs" is stale: `package.json:70-76`
   now pins all three forks to exact SHAs.
7. ▲ Schema v4's meaning (from git archaeology, §4.1) is the `disableYText` flip — pre-v4 docs
   contain `Y.Text` values where v4+ docs contain plain strings. That is *why* v1/v2 fixtures
   matter: they are the only docs that exercise the middleware's Y.Text↔string repair path
   (`yjs.mjs:442-501`).

---

## 1. Map of the installed fork and its consumers

### 1.1 Fork internals (`node_modules/zustand-middleware-yjs/dist/yjs.mjs`, 705 lines)

Public surface (`dist/index.d.ts`): default export
`yjs(doc, name, stateCreator, options?: YjsOptions)`;
`YjsOptions = { atomicKeys?, disableYText?, yTextKeys?, onLoaded?, schemaVersion?, onObsolete? }`.
There is **no** whitelist, no merge option, no hydration promise — all four Phase 2 features are
additive.

| Concern | Where | Mechanics |
|---|---|---|
| Middleware entry | `yjs.mjs:629-703` | `map = doc.getMap(name)` (630); returns wrapped StateCreator |
| Eager-loaded callback | `yjs.mjs:635-638` | if `map.size > 0` at store creation: `loaded = true; onLoaded()` |
| **Initial hydration** | `yjs.mjs:664-667` | if `map.size > 0`: `initialState = patchState(initialState, map.toJSON()); api.setState(initialState, true)` — replace-with-delete from creation time |
| Outbound capture | `yjs.mjs:659-663` (wrapped `set`), `668-672` (monkeypatched `api.setState`) | both capture `previousState` *before* the write and call `scheduleOutbound` |
| Outbound batching | `yjs.mjs:650-658` | one microtask per burst; `batchPreviousState` is the state before the **first** set of the batch (653-655) — correct base for delete-protection |
| Outbound flush | `yjs.mjs:642-649` | `doc.transact(() => patchSharedType(map, api.getState(), {...options, previousState}), api)` — **origin = the store api object** (echo tag) |
| **Full-tree diff (D13)** | `yjs.mjs:367-369` | `patchSharedType` starts with `sharedType.toJSON()` — entire Y.Map serialized on **every** outbound flush; `getChanges` then recurses the whole tree |
| **Delete-protection (the judges' `previousState` graft)** | `yjs.mjs:420-425` | on outbound `DELETE`, if the key was **not** in `previousState`, skip — a key inserted concurrently by a remote peer mid-batch survives. Recursion threads `childPreviousState = previousState[property]` at `yjs.mjs:438-441, 469, 498` |
| Y.Text↔string mismatch repair | `yjs.mjs:442-501` | lazily rewrites a `Y.Text` to plain string (or back) when the configured mapping disagrees with the stored type — the pre-v4 → v4 in-band migration path |
| Diff core | `yjs.mjs:74-209` | `getChanges` → `getStringChanges` (84) / `getArrayChanges` (114, 10-item lookahead) / `getRecordChanges` (187) |
| **Inbound delete emission (D2, the most-blocking finding)** | `yjs.mjs:187-193` | `getRecordChanges(a=state, b=mapJSON)` pushes `[DELETE, key]` for every non-function key of state absent from map JSON |
| Inbound apply | `yjs.mjs:624-627` | `patchStore`: `store.setState(patchState(oldState, map.toJSON()), true)` — replace=true; the deletes land via `applyChangesToObject` `delete revisedObject[property]` (584-587) |
| Inbound batching | `yjs.mjs:673-677, 696-699` | microtask-batched `processBatch`; **echo prevention #2**: `patchStore` is handed `{...api, setState: originalSetState}` (676) so the inbound write does not re-schedule outbound |
| Echo prevention #1 | `yjs.mjs:694-695` | `transaction.origin === api` → skip |
| Poison pill | `yjs.mjs:682-689` | per-transaction: `map.get('__schemaVersion') > options.schemaVersion` → `isObsolete = true; onObsolete(v); return`. Checked on the store's **own** map only — only `library` carries the key, hence D5 (eight unguarded maps). `isObsolete` also halts outbound (651-652) and inbound (680-681) |
| onLoaded (late) | `yjs.mjs:690-693` | first foreign-origin transaction flips `loaded` and fires `onLoaded` |
| State→Y mapping | `yjs.mjs:317-365` | `arrayToYArray`/`objectToYMap`; functions skipped (331, 358); `undefined` values are stored as-is (pinned by `src/store/zustand-middleware-yjs-undefined.test.ts`) |

### 1.2 Repo consumers

| Site | Role |
|---|---|
| `src/store/yjs-provider.ts:14` | `CURRENT_SCHEMA_VERSION = 5` |
| `yjs-provider.ts:17-23` | singleton `yDoc`, `window.__YJS_DOC__` test global |
| `yjs-provider.ts:28-46` | **module-scope** `IndexeddbPersistence('versicle-yjs', yDoc, {writeDebounceMs: 200, transactionRunner: runExclusiveIdbWrite})` (moves to bootstrap in P1b; P2 assumes that landed) |
| `yjs-provider.ts:58-73` | `handleObsoleteClient`: severs sync + sets UI lock via two **async dynamic imports** (the D5 corruption window) |
| `yjs-provider.ts:83-172` | `runMigrationsImpl` — current migration runner (hazards cited in §5.1) |
| `yjs-provider.ts:182-184` | nested `queueMicrotask` deferral hack |
| `yjs-provider.ts:191-199` | `getYjsOptions(extra?)` — injects `schemaVersion`, `onObsolete`, `onLoaded: runMigrations`, `disableYText: true` into all nine stores. **This is the single seam** the surgery replaces with `defineSyncedStore` |
| `yjs-provider.ts:207-230` | `waitForYjsSync(timeoutMs=5000)` — IDB-synced gate, timeout-resolves with a warning |
| Nine synced stores | `useBookStore.ts:47` (`'library'`, + vestigial atomicKeys at 99), `useReadingStateStore.ts:126` (`'progress'`), `useAnnotationStore.ts:67` (`'annotations'`), `usePreferencesStore.ts:89` (`` `preferences/${getDeviceId()}` ``), `useReadingListStore.ts:16` (`'reading-list'`), `useVocabularyStore.ts:19` (`'vocabulary'`), `useLexiconStore.ts:35` (`'lexicon'`), `useContentAnalysisStore.ts:112` (`'contentAnalysis'`), `useDeviceStore.ts:43` (`'devices'`) |
| **The poll loop `whenHydrated()` replaces** | `src/App.tsx:283-287`: `while (Object.keys(useBookStore.getState().books).length === 0 && attempts < 10) { await sleep(100); }` — runs after `await waitForYjsSync()` (App.tsx:231) because IDB-synced ≠ store-patched (the middleware's inbound microtask hasn't run yet) |
| Other `waitForYjsSync` callers | `App.tsx:231`, `src/lib/BackupService.ts:207`, `src/lib/tts/LexiconService.ts:47,153,169,174,180,185,190`, `src/lib/sync/FirestoreSyncManager.ts:363` — all should migrate to `whenHydrated()` over P2/P4 (they want "state ready", not "IDB synced") |
| Sync manager | `FirestoreSyncManager.ts:15` imports `yDoc, CURRENT_SCHEMA_VERSION, waitForYjsSync`; `:364` clean-client check reads `useBookStore...books || {}`; `:496` `Y.applyUpdate(yDoc, …)` applies cloud state with **no version check before merge** (Phase 4 fixes via the `meta` map); `:675` stamps `schemaVersion: CURRENT_SCHEMA_VERSION` into workspace metadata |
| Safe-mode surfaces | `ObsoleteLockView` driven by `useUIStore.obsoleteLock` (`src/components/ObsoleteLockView.tsx:14`, `useUIStore.ts:12-14`, rendered `App.tsx:373`); `SafeModeView` for boot/db errors (`App.tsx:337`); `CriticalMigrationFailureView` via `ErrorBoundary.tsx:61` |
| Checkpoint hook | `CheckpointService.createCheckpoint(trigger, {protected?})` at `src/lib/sync/CheckpointService.ts:29` — the pre-migration checkpoint primitive already exists |
| Existing fork tests to absorb | `src/store/zustand-middleware-yjs-undefined.test.ts` (undefined round-trip), `src/store/yjs-provider.migration-race.test.ts:13-24` (the `queueMicrotask` spy test — **deleted** with the coordinator, per exit criteria), `src/store/yjs-provider.test.ts` |

---

## 2. The four fork changes — precise design

All four are additive `YjsOptions` extensions plus one store-API augmentation, in the vendored
package (§6). New options surface:

```ts
export interface YjsOptions {
  // existing (unchanged semantics)
  atomicKeys?: string[];
  disableYText?: boolean;
  yTextKeys?: string[];
  onLoaded?: () => void;
  schemaVersion?: number;
  onObsolete?: (incomingVersion: number) => void;

  // Phase 2 additions
  /** Top-level keys replicated to the Y.Map. undefined = legacy "all non-function keys". */
  syncedKeys?: readonly string[];
  /** Inbound semantics for top-level keys absent from the map. Default 'replace' (legacy). */
  hydration?: 'replace' | 'merge-defaults';
  /** Per-top-level-key scoped diffing. Default false (legacy full-tree). */
  scopedDiff?: boolean;
  /** Bind the store to a nested Y.Map at map.get(scopeKey) instead of the top-level map. */
  scope?: { key: string };   // needed only by the preferences fold, §5.3
}
```

Store API augmentation (mirrors `zustand/persist`'s `api.persist`):

```ts
interface YjsStoreHandle {
  hasHydrated(): boolean;
  whenHydrated(): Promise<void>;
  /** Provider calls this when the doc is synced and this store's map is empty. Idempotent. */
  markHydrated(): void;
  /** Test API: synchronously drain the pending outbound microtask (P0 flushPersistence). */
  flush(): void;
  isObsolete(): boolean;
}
// api.yjs: YjsStoreHandle  — attached inside the middleware
```

### 2.1 `syncedKeys` whitelist

**Semantics.** When `syncedKeys` is provided, the replication universe for this store is exactly
that key set (top level only; nesting below a synced key replicates fully):

- **Outbound** (`flushOutbound`, `yjs.mjs:642-649`): diff `pick(state, syncedKeys)` against the
  map instead of the whole state; `previousState` filtered identically. A non-listed key can
  never be inserted, updated, or deleted in the Y.Map by this client.
- **Inbound** (`processBatch`/`patchStore`, `yjs.mjs:673-677, 624-627`): diff
  `pick(mapJSON, syncedKeys)` against `pick(state, syncedKeys)`; apply the patched subset over
  the full state (`setState({...state, ...patchedSubset}, true)` with deletes honored inside the
  subset). A foreign map key (e.g. the stale `popover` key in pre-hotfix `annotations` maps)
  is **never inserted into store state**, and a local non-listed key (transient UI flags, future
  ephemera) is never touched by remote updates.
- `__schemaVersion` is implicitly a synced key whenever `options.schemaVersion` is set (the
  poison-pill read at `yjs.mjs:683` and the dual-write depend on it); stores need not list it.
- Initial hydration (`yjs.mjs:664-667`) uses the same filtered path.

**Edge cases.**
- *Resurrection guard:* a key removed from `syncedKeys` whose value still exists in old docs is
  simply ignored both directions — it can only be removed from the doc by a migration. This is
  the loop-closer for v6's popover deletion: even before v6 runs, v6-era clients ignore the key;
  after v6 deletes it, nothing can write it back (legacy ≤v5 clients that could are quarantined
  by the version bump).
- *Functions:* already excluded (`yjs.mjs:189-191`); `syncedKeys` listing a function key is a
  dev-mode error.
- *Misconfiguration:* a `syncedKeys` entry absent from the initial state is a dev-mode error
  (loud, at store creation) — catches typos before they silently never-sync.

### 2.2 Merge-over-declared-defaults hydration (`hydration: 'merge-defaults'`)

**The bug being fixed (D2).** `getRecordChanges` emits `DELETE` for every state key absent from
map JSON (`yjs.mjs:187-193`) and `patchStore` applies with `replace=true` (`yjs.mjs:626`). Any
field added to a synced store's initial state is wiped on first hydration from an older doc —
the v4→v5 migration exists solely to re-add `fontProfiles` (`yjs-provider.ts:149-165`).

**Semantics.** The middleware captures `declaredDefaults` = the non-function keys of
`initialState` as returned by the state creator (`yjs.mjs:659`, before any patching). Under
`merge-defaults`, on every inbound patch (initial hydration at 664-667 *and* every
`processBatch`):

> A **top-level** `[DELETE, key]` change is suppressed iff `key in declaredDefaults`. Everything
> else — inserts, updates, and **all nested deletes** — applies unchanged.

Implementation: filter the change list returned by the **top-level** `getChanges` call inside
`patchState`/`patchStore` (do not touch `getRecordChanges` itself — recursion must keep emitting
nested deletes). ~10 lines plus tests.

**Why legitimate remote deletions still propagate.**
- *Nested deletions* (the only deletions that occur in normal operation — `books[id]` removed,
  an annotation deleted, a device deregistered) ride inside a `PENDING` chain under a top-level
  key that **is** present in the map. Untouched by the filter.
- *Top-level deletions* cannot be produced by normal store operation: a zustand store's top-level
  keys are its schema, fixed at creation; no `set()` removes one (and the outbound
  `previousState` guard at `yjs.mjs:420-425` already protects the concurrent-insert case). A
  top-level key disappears from a map for exactly two reasons: (1) the doc predates the field —
  the case merge-defaults exists to fix; (2) a **migration** deliberately deleted it — and a
  deliberate schema deletion must, by contract, remove the key from the store's
  `defaults`/`syncedKeys` in the same release (then nothing re-adds or retains it) **and** bump
  the schema version (so older clients that still declare it are quarantined before they can
  resurrect it). This invariant is written into the C2 contract row and pinned by suite case
  B.5/C.7 (§3).
- The outbound `previousState` delete-protection (`yjs.mjs:420-425`) is **kept verbatim** —
  strangler risk row 2 (line 678) requires it; suite case A.3 pins it.

**Nested objects.** Default-retention is *top-level-key-presence-based and shallow*, by design:
- Map key **absent** → the store keeps its current value for that key (the declared default, or
  whatever local writes produced since).
- Map key **present but "poorer" than the default** (e.g. `fontProfiles: {}` vs a two-language
  default) → the map value wins entirely, including nested deletes. Present-but-empty is an
  explicit synced value, not an absence.
- Consequence: *new nested fields inside an existing synced container still need a migration
  backfill* (the v4→v5 pattern). Merge-defaults removes the migration tax for **new top-level
  keys** only. This is the honest, predictable rule; deep-merging defaults would make "what
  wins" depend on shape and reintroduce D2-class surprises one level down. Documented in the
  store registry README.
- Per-entry optional fields inside records (e.g. a new optional field on `UserProgress`) need no
  machinery — absent JSON fields are simply `undefined`, and the types already model them as
  optional.

**Arrays.** Same top-level rule (an absent top-level array key retains its default). Nested
arrays keep `getArrayChanges` semantics (`yjs.mjs:114-185`, 10-item lookahead, identity/deep
matches) unchanged — no synced store currently has a top-level array, and per-entry arrays
(`readingSessions`, `completedRanges`, `tableAdaptations`) are always reachable under a present
top-level key.

**Interplay with outbound (decided semantics, pinned by suite C.7).** After a merged hydration,
a retained default key is *not yet in the doc*. Under `scopedDiff` it is written to the doc only
when something actually `set()`s it (reference change); under legacy full diff the next flush of
any key backfills it. Either way the doc converges to carrying the key; with `scopedDiff` the
backfill is lazier. Both are safe because v5-and-older clients hydrate-delete unknown keys
anyway and v6+ clients merge them. We pin the `scopedDiff` behavior (lazy backfill) as the
contract since both features ship together.

### 2.3 Per-key scoped diffing (`scopedDiff: true`) — the D13 fix

**The cost being fixed.** Every outbound flush serializes the *entire* Y.Map
(`sharedType.toJSON()`, `yjs.mjs:368`) and deep-diffs the entire state; every inbound batch does
`map.toJSON()` of the whole tree (`yjs.mjs:676`). For `progress` (≤500 sessions × device × book)
this is O(library × history) **per page turn** — the upstream cause of the `selectors.ts`
heroics (D9) and `selectors.perf.test.ts`.

**Outbound design.** The middleware already holds the batch-start `previousState`
(`yjs.mjs:653-655`). In `flushOutbound`:

1. `changedKeys = [...union(keys(prev), keys(curr))].filter(k => !Object.is(prev[k], curr[k]))`
   (filtered to `syncedKeys` when set). Reference equality is sound because every store mutation
   in this repo follows zustand's immutable-update convention (all 9 stores spread; verified).
2. For each changed key: if absent in `curr` → top-level delete (with the existing
   `previousState` guard); else diff **only that key's subtree**: `map.get(k)` →
   `child.toJSON()` vs `curr[k]`, reusing `patchSharedType` on the child with
   `previousState: prev[k]`. Primitives set directly.
3. If `previousState === undefined` (first-ever flush) → fall back to legacy full diff.

**Inbound design.** The `observeDeep` callback (`yjs.mjs:678`) receives the event list; collect
affected top-level keys across the microtask batch
(`event.path.length ? event.path[0] : [...event.changes.keys.keys()]`) into a `Set`. In
`processBatch`, build `partialMapJSON` for only those keys (`map.get(k)?.toJSON()`), diff against
`pick(state, keys)`, and apply with `setState({...state, ...patched}, true)`. Untouched
top-level keys keep their **object identity** — which also stabilizes the references
`selectors.ts`/`useBook` subscribe to (a free win for D9, pinned by suite D.4).

**Edge cases.**
- *Mutation without reference change* (non-idiomatic `set()`) would be invisible to the
  `Object.is` fast path where legacy full diff caught it. Mitigations: (1) dev-mode sampling
  assert — in DEV, after each scoped flush, occasionally run the full diff and assert zero
  residual changes, loud failure (the declarative-spec "loud failures" house style); (2)
  per-store opt-out (leave `scopedDiff` unset); (3) fast-check equivalence property (suite D.1)
  over randomized update sequences.
- *Top-level key added by a migration transaction* arrives inbound like any other change-set —
  scoped inbound handles inserts (key in `event.changes.keys`, absent in state).
- `Y.Text` values (pre-v4 docs): child diff path is unchanged; mismatch repair (`yjs.mjs:442-501`)
  still runs inside the per-key recursion.

### 2.4 `whenHydrated()`

**Per-store (fork):** `hydrated` flips true at the end of whichever happens first —
(a) the synchronous initial patch when the map is pre-populated at creation (`yjs.mjs:664-667`),
(b) the first applied inbound `processBatch`, or (c) `api.yjs.markHydrated()`. The promise
resolves **after** `setState` returns, so an awaiting caller always observes hydrated state —
this is the structural replacement for the nested-`queueMicrotask` ordering hack
(`yjs-provider.ts:174-184`). Note the fork alone cannot detect "doc loaded and this store's map
is legitimately empty" — that knowledge belongs to the persistence layer, hence (c).

**Provider composition (`src/store/yjs-provider.ts`, P2):**

```ts
export async function whenHydrated(timeoutMs = 8000): Promise<void> {
  await waitForYjsSync(timeoutMs);                       // IDB load complete (existing gate)
  for (const reg of storeRegistry.synced)               // empty maps: stores start from defaults
    if (yDoc.getMap(reg.mapName).size === 0) reg.store.yjs.markHydrated();
  await withTimeout(
    Promise.all(storeRegistry.synced.map(r => r.store.yjs.whenHydrated())),
    timeoutMs, () => logger.warn('whenHydrated timeout — proceeding (parity with waitForYjsSync)'));
}
```

Timeout behavior intentionally mirrors `waitForYjsSync` (`yjs-provider.ts:207-230`):
warn-and-proceed, never hang boot (risk R3, §7). Cloud data arriving after boot (the
`performCleanSync` path, `FirestoreSyncManager.ts:440-508`) is ordinary inbound traffic —
`whenHydrated` gates on local persistence only, same as today's semantics.

**Call-site changes:** App.tsx boot replaces the `waitForYjsSync()` at :231 *and* the poll loop
at :283-287 with one `await whenHydrated()`; the migration coordinator awaits it before reading
the doc (§5.2); `BackupService.ts:207` and the seven `LexiconService` call sites migrate
opportunistically (they want hydrated state, not synced IDB); `FirestoreSyncManager.ts:363-364`
migrates in Phase 4 with the decomposition.

### 2.5 `defineSyncedStore` + the store registry (the C2/C6 seam)

`getYjsOptions()` (the "single function seam" the strangler names) becomes:

```ts
// src/store/registry.ts  (new, P2)
export interface SyncedStoreDef<S> {
  name: string;                       // Y.Map name (frozen, registry is the version surface)
  syncedKeys: readonly (keyof S & string)[];
  hydration: 'replace' | 'merge-defaults';   // flipped per store, §2.6
  scopedDiff: boolean;                        // flipped per store, §2.6
  schema?: ZodType;                   // C2 inbound validation — observe-then-enforce (P2 observe)
  scope?: { key: string };
}
export function defineSyncedStore<S>(def: SyncedStoreDef<S>, creator: StateCreator<S>) {
  return yjs(yDoc, def.name, creator, {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    onObsolete: handleObsoleteClient,
    disableYText: true,
    syncedKeys: def.syncedKeys,
    hydration: def.hydration,
    scopedDiff: def.scopedDiff,
    scope: def.scope,
  });
}
```

Notes: `onLoaded: runMigrations` is **gone** (coordinator, §5); `atomicKeys` is gone
(correction ▲3). The registry module also declares the `local-persisted` and `ephemeral` tiers
(C6) and is the source for the generated README; zod `schema` runs post-merge in observe mode
(log + flight-recorder, never reject) per the observe-then-enforce graft.

Initial `syncedKeys` per store (from the state interfaces read in this prep):

| Store | map | syncedKeys |
|---|---|---|
| useBookStore | `library` | `['books']` (+implicit `__schemaVersion`) |
| useReadingStateStore | `progress` | `['progress']` |
| useAnnotationStore | `annotations` | `['annotations']` (stale doc key `popover` now structurally ignored) |
| usePreferencesStore | `preferences` (post-fold; `preferences/<id>` until then) | the 16 pref fields (`currentTheme` … `pinyinSize`, `fontProfiles`) |
| useReadingListStore | `reading-list` | `['entries']` |
| useVocabularyStore | `vocabulary` | `['knownCharacters']` |
| useLexiconStore | `lexicon` | `['rules', 'settings']` |
| useContentAnalysisStore | `contentAnalysis` | `['sections']` |
| useDeviceStore | `devices` | `['devices']` |

### 2.6 Per-store `hydration: 'merge-defaults'` flip order (lowest risk first) + canary census

Flip = set `hydration: 'merge-defaults'` (and `scopedDiff: true`) in the registry **and delete
that store's defensive fallbacks in the same PR** — the deleted fallbacks are the canaries: if
any other code path still produced `undefined` for a hydrated key, the store's existing tests
and the fixture-hydration tests fail loudly instead of being silently re-patched.

Full census of top-level hydration fallbacks (the deletable canaries), grepped this prep:

| # | Store | Canary fallbacks to delete at flip | Risk rationale for position |
|---|---|---|---|
| 1 | **useContentAnalysisStore** | `useContentAnalysisStore.ts:120, 140, 170, 187, 204, 222, 230` (`state.sections \|\| {}` ×7) | Regenerable AI cache — worst case is re-running analysis. Most canaries of any store. Lowest data criticality in the app. |
| 2 | **useVocabularyStore** | *(none — would crash today if hydration deleted `knownCharacters`; flip is strictly risk-reducing)* | Single small map, low write rate, low criticality. |
| 3 | **useDeviceStore** | *(none)* | Registry self-heals: `registerCurrentDevice` runs every boot (App.tsx:264-275). |
| 4 | **useLexiconStore** | *(none top-level; `r.order \|\| 0` at :49-51 is per-entry, stays)* | Small user data, low write rate, two keys. |
| 5 | **useReadingListStore** | `useReadingListStore.ts:23, 27, 34, 46` (`state.entries \|\| {}` ×4) + `selectors.ts:78` (`readingListEntriesRaw \|\| {}`) | Entries are re-upserted from progress updates — self-healing projection. |
| 6 | **usePreferencesStore** | *(none top-level; the v4→v5 `fontProfiles` migration at `yjs-provider.ts:149-165` is this store's fossil canary — its guard `if (!state.fontProfiles)` becomes dead under merge-defaults)* | Proves the exact historical wipe class (fontProfiles). Per-device map = blast radius of one device. Flip **before** the v6 fold so the new keyed store is born merged. |
| 7 | **useAnnotationStore** | *(none — actions assume `annotations` present)* | Real user data (highlights/notes) but a single simple key; syncedKeys already shields the stale `popover` doc key. |
| 8 | **useBookStore** | `useBookStore.ts:58, 70, 79, 93` (`state.books \|\| {}` ×4) + `selectors.ts:66` (`booksRaw \|\| {}`), `selectors.ts:108` (`books \|\| {}`) + `FirestoreSyncManager.ts:364` (`books \|\| {}` — clean-client check; runs post-`waitForYjsSync`, safe to simplify after flip) | The inventory: highest user-data criticality, and the map carrying `__schemaVersion`. Flip second-to-last, after the pattern is proven on six stores. |
| 9 | **useReadingStateStore** | `selectors.ts:75` (`progressMapRaw \|\| {}`) only. **Keep** `useReadingStateStore.ts:139, 185, 260, 356, 385` (`state.progress[bookId] \|\| {}` — second-level, legitimate; correction ▲5). | Hottest write path (every page turn) — flip last, after `scopedDiff` perf is verified against `selectors.perf.test.ts` on stores 1-8. |

Non-canaries that stay: `useLibraryStore`-related fallbacks (`selectors.ts:67, 109` guard
`staticMetadata` from the **ephemeral** `useLibraryStore` — not yjs-backed),
`useReadingStateStore` per-book guards above, `useContentAnalysisStore.ts:145`
(`existing.tableAdaptations || []` — per-entry optional field).

`scopedDiff` flips in the same per-store PRs (same order); store 9 (`progress`) is the
performance acceptance test.

---

## 3. The C2 fork contract suite (pinning suite)

Home: `packages/zustand-middleware-yjs/test/contract/*.test.ts` (fork-pure cases, run by the
root vitest workspace) + `src/store/__tests__/crdt-contract/*.test.ts` (repo-integration cases:
registry, coordinator, fixtures). Per C2's row: this suite is **the acceptance gate for any
change to the vendored fork** — a fork-behavior change without a matching suite change in the
same PR fails CI (contract rule). Tests use *real* `Y.Doc`s and two-doc replication via
`Y.encodeStateAsUpdate`/`Y.applyUpdate` (no mocks — the `zustand-middleware-yjs-undefined.test.ts`
pattern, which is absorbed here as `describe('regression: undefined values …')` per the
test-absorption ledger).

**A. Characterization (lands BEFORE any surgery — program rule 7):**
1. Outbound mirrors every non-function top-level key; functions never replicated (`yjs.mjs:189-191, 331, 358`).
2. Batching: N `set()`s in one tick → exactly one `doc.transact`; `previousState` is pre-first-set state (`yjs.mjs:650-658`).
3. **Delete-protection:** key inserted by a remote peer between batch capture and flush survives the flush (`yjs.mjs:420-425`); recursive variant through `childPreviousState` (`:438-441`).
4. Echo-loop prevention, both halves: own-origin transactions skipped (`:694-695`); inbound apply via `originalSetState` schedules no outbound (`:676`) — assert doc update count stays flat after an inbound patch.
5. **Legacy replace-with-delete hydration pinned as-is** (key in state, absent in map → deleted; `:187-193, 626`). This test is *rewritten in the same PR* that flips each store (the canary mechanism), never silently dropped.
6. Initial hydration when the map is pre-populated at creation (`:664-667`).
7. `onLoaded` timing matrix: immediate (map pre-populated, `:635-638`); first foreign transaction (`:690-693`); never on own outbound.
8. Poison pill: incoming `__schemaVersion` > local ⇒ `onObsolete(v)` fires, store state not patched, outbound and inbound permanently halted (`:682-689, 651-652, 680-681`). **Plus the D5 gap pinned as known behavior:** a map without the key never quarantines (documents what Phase 4 fixes).
9. Y.Text↔string mismatch repair both directions under `disableYText`/`yTextKeys` (`:442-501`) — exercised with a pre-v4 fixture (§4).
10. `undefined` values round-trip (absorbed test).
11. Array semantics: insert/delete/update mid-array; nested records in arrays; the >10-displacement degeneration of the lookahead window (`:118, 127-165`) pinned so a future diff rewrite is a conscious contract change.

**B. `syncedKeys`:**
1. Non-listed key never written outbound (doc stays clean across flushes).
2. Inbound foreign map key (fixture: stale `popover`) not inserted into state.
3. Remote update can neither delete nor overwrite a non-listed local key.
4. `__schemaVersion` implicitly synced when `schemaVersion` option present.
5. Resurrection guard: key dropped from `syncedKeys` while still present in the doc — no outbound delete, no inbound insert (pairs with the v6 deletion).
6. Dev-mode loud failure: `syncedKeys` entry missing from initial state.

**C. Merge-over-defaults:**
1. Top-level default key absent from map → retained; no `DELETE` emitted to the store.
2. Legitimate nested deletion (remote removes `books[id]`) still applies.
3. Present-but-empty beats rich default (`fontProfiles: {}` in map wins over two-language default).
4. The fontProfiles scenario end-to-end: v4 fixture + preferences-shaped store with `fontProfiles` default → all doc fields hydrate, `fontProfiles` = default (the v4→v5 migration becomes unnecessary for this class).
5. `hydration: 'replace'` stores are byte-identical to legacy (per-store flip independence).
6. Combined: merge-defaults + syncedKeys + old doc with junk keys.
7. Lazy backfill semantics (§2.2 interplay): retained default not written to doc until that key is set; doc converges after first write.
8. Top-level delete of a key **not** in defaults still applies (the popover deletion reaches old-state stores that no longer declare it).

**D. Per-key scoped diff:**
1. **Equivalence property (fast-check, already in the fork's devDeps):** random update sequences applied to a scoped-diff store and a full-diff store converge to identical doc JSON and store state, including two-doc concurrent merges.
2. Write scoping: a `set()` touching only key A yields a transaction whose changed paths are confined to A's subtree (assert via `observeDeep` events on a second doc).
3. `Object.is` fast path skips untouched keys; DEV sampling assert catches mutate-in-place (loud failure test).
4. Inbound referential stability: remote change to `progress` leaves `state.books` etc. reference-identical (what `selectors.ts`/`useBook` subscriptions rely on).
5. Perf budget: 200-book progress tree, one page-turn `set()` → no full-tree `toJSON` (spy on `Y.Map.prototype.toJSON`), bounded change-list size; cross-checked in-repo by `src/store/selectors.perf.test.ts`.
6. First-flush fallback (no `previousState`) produces the full-diff result.

**E. Hydration API:**
1. `whenHydrated` resolves after the synchronous initial patch (pre-populated map).
2. Resolves after first inbound batch (empty at creation, `applyUpdate` later) — and resolution strictly follows `setState` (awaiter sees hydrated state).
3. `markHydrated()` resolves the empty-doc case; idempotent; safe after real hydration.
4. `hasHydrated()` consistency; `flush()` drains the outbound microtask synchronously (test-API case).
5. Provider-level `whenHydrated()` integration: nine stores + empty-map marking + timeout-proceeds-with-warning.

**F. Quarantine + fixtures (repo-side):**
1. Old-doc matrix: each of v1/v2/v4/v5 fixtures (§4) hydrated through the surgically-modified middleware with current store defaults → zero unexpected field loss, defaults present, Y.Text repairs applied (v1/v2).
2. Two-client quarantine: v6 doc update applied to a stack configured `schemaVersion: 5` → `onObsolete(6)` before any store patch; store state untouched; outbound halted; **residual pinned:** the Y-level merge has already happened and y-idb may persist it (D5 — fixed by Phase 4's synchronous pre-merge check on `meta`).
3. Migration matrix: v1→v6, v2→v6, v4→v6, v5→v6 all terminate in canonically-equal doc JSON; re-running is a no-op (idempotence); two clients migrating concurrently converge (LWW determinism).

---

## 4. Captured-fixture strategy

### 4.1 What the schema versions actually mean (git archaeology, citable)

`CURRENT_SCHEMA_VERSION` lives at `src/store/yjs-provider.ts:14` (= 5). The migration runner
(`yjs-provider.ts:96-165`) plus history:

| Version | Introduced by | Doc-format meaning |
|---|---|---|
| v1 | initial yjs adoption (`7569f70a` "phase 1 - initial" vicinity; confirm exact introduction with `git log -S 'CURRENT_SCHEMA_VERSION'` during P2) | Strings stored as **Y.Text** (no `disableYText` yet); `progress.*.readingSessions` may contain invalid entries (non-numeric `startTime`/`endTime`) |
| v2 | v1→v2 migration: prune invalid `readingSessions` (`yjs-provider.ts:97-141`) | Same encoding as v1, sessions pruned |
| v3 | `297a450f` (2026-03-07) | **Pure bump** — coincided with the Firestore sync path change `users/{uid}/versicle/main2` → `main`; no doc-shape change |
| v4 | `fb96dd97` (2026-03-16) | **Pure bump + `disableYText: true` became the global default** (`getYjsOptions`). v4+ writes plain strings; pre-v4 docs carry Y.Text values that the mismatch-repair path (`yjs.mjs:442-501`) converts lazily on write. ▲ This is why v1/v2 fixtures are not optional: they are the only realistic input for suite cases A.9/F.1 |
| v5 | `41dbea0b` | v4→v5: initialize `preferences.fontProfiles` (`yjs-provider.ts:149-165`) — the backfill made necessary by D2 itself |
| v6 | Phase 2 (this design, §5.3) | popover key deletion, `meta` map dual-write, preferences fold |

The runner handles v3 via `currentVersion === 2 || currentVersion === 3` (`yjs-provider.ts:143`),
so the fixture matrix needs v1, v2, v4, v5 (v3 is shape-identical to v2-after-bump; include a
v3-stamped variant of the v2 fixture if cheap).

### 4.2 The capture script (design only — to be added in Phase 2)

`scripts/capture-ydoc-fixture.ts` (node, run manually; outputs are **checked in and reviewed**,
never regenerated in CI):

- **Seed dataset** (one shared constant, `src/test/fixtures/ydoc/seed.ts`): 2 books (one CJK
  title — encoding realism for the Y.Text eras), `progress` for 2 device ids including one
  **invalid session** (`{ startTime: 'corrupt' }`, v1 only — exercises the v1→v2 prune),
  `annotations` including the stale `popover` key with screen coordinates (v4/v5 fixtures —
  pre-hotfix shape; exercises v6 deletion and syncedKeys B.2), `preferences/<dev-a>` and
  `preferences/<dev-b>` (v4 variant **without** `fontProfiles` — exercises C.4 and the v4→v5
  step), `vocabulary` (3 chars), `lexicon` (2 rules + 1 settings entry), `contentAnalysis`
  (1 section with `tableAdaptations`), `devices` (2 entries), `reading-list` (1 entry),
  `library.__schemaVersion` stamped to the era's version.
- **v4/v5 mode** (`--era v4|v5`): era-writer modules build the doc with plain-string encoding
  directly via `Y.Map`/plain values (v4 writer omits `fontProfiles`, both include the popover
  key). Writers are ~50-line pure builders — no middleware needed because v4+ encoding is plain
  JSON-into-Y-types.
- **v1/v2 mode** (`--era v1|v2`, **captured-real-artifact** per the graft): documented manual
  procedure using `git worktree add /tmp/versicle-era <sha>` at the historical commit — v2-era
  = parent of `297a450f`, v1-era = the middleware-adoption commit (`7569f70a`/`a4bc5a7e`
  vicinity) — then run a tiny capture entry in that worktree's vitest/node that writes the seed
  dataset **through that era's actual stores and middleware**, so Y.Text item encodings, map
  shapes, and update structure are the real thing, and `Y.encodeStateAsUpdate(doc)` → fixture.
  (The historical lockfiles resolve the era's fork SHA; if `npm ci` in the old worktree proves
  unworkable, fallback: synthesize Y.Text-encoded docs with the *current* yjs library — lower
  fidelity, flagged in the manifest.)
- **Even better source, if discoverable:** a real old install's doc — `BackupService` export or
  a raw `versicle-yjs` IDB dump from any long-lived device (the maintainer's own devices are
  the candidate population). The script accepts `--import <backup.json|idb-dump>` and
  anonymizes (strip titles/CFIs to placeholders) before writing the fixture.
- **Output:** `src/test/fixtures/ydoc/v{1,2,4,5}.update.bin` (Y update encoding — stable,
  versionless, applied in tests via `Y.applyUpdate(new Y.Doc(), bin)`) plus
  `manifest.json` per fixture: `{ era, generatorSha, capturedAt, method: 'worktree'|'writer'|'import',
  contentChecklist }`. A CI test asserts manifest↔file hash agreement so fixtures cannot drift
  silently.

Consumers: suite F.1 (hydration), F.3 (migration matrix), F.2 (quarantine: v5 fixture migrated
to v6 by the new stack, the resulting update applied to a v5-configured stack), and the
captured-fixture program standard (master plan §3) for every future format change.

---

## 5. Migration coordinator + v6 migration

### 5.1 Hazards of the current runner (the indictment, by line)

`src/store/yjs-provider.ts`:

1. **Runs up to 9× per boot:** registered as `onLoaded` for every synced store via
   `getYjsOptions()` (:195), and `onLoaded` fires per store both eagerly (`yjs.mjs:635-638`) and
   on first inbound (`yjs.mjs:690-693`).
2. **Version read from store state, not the doc, through a cast:**
   `(bookState as unknown as Record<string, unknown>).__schemaVersion as number || 1` (:89-90).
3. **Non-atomic, temporally disordered bumps:** version bumps execute inside async `.then()`
   callbacks (:134, :144, :162) while the outer chain advances `currentVersion` synchronously
   (:140, :146, :164) — concurrent invocations can all read v1 (double-apply window), and the
   v1→v2 *transform* can commit after the v2/3→v4 *bump*.
4. **Transform and bump are separate store `setState`s** → separate middleware microtasks →
   separate Yjs transactions; a crash between them strands transformed-but-unversioned data.
5. **Ordering by undocumented fork internals:** nested `queueMicrotask` "to jump behind
   zustand-middleware-yjs's microtask" (:174-184), pinned by a spy test asserting
   `queueMicrotask` call counts (`yjs-provider.migration-race.test.ts:13-24`).
6. **Every failure swallowed:** `.catch(() => {})` / "Silently ignore" (:136-138, :163,
   :169-171) — a failed migration is indistinguishable from a successful one.
7. **Dynamic imports as dependency-cycle dodges** (:85, :98, :150) — failure modes 5 and 6 exist
   to accommodate them.
8. Quarantine is per-map and asynchronous: `handleObsoleteClient` severs sync/locks UI via two
   dynamic imports (:64-73) after the Y-level merge already happened (D5).

### 5.2 The coordinator (`src/app/migrations.ts`, per C11 boot contract)

```ts
interface CrdtMigration {
  /** Version this step migrates FROM (runs when docVersion === from). */
  from: number;
  to: number;
  /** Synchronous, deterministic, idempotent transform on Y types. NO store access. */
  migrate(doc: Y.Doc): void;
}
export const MIGRATION_ORIGIN = Symbol('versicle:migration');

export async function runCrdtMigrations(): Promise<
  { status: 'noop' | 'migrated'; from: number; to: number; checkpointId?: number } // or throws MigrationError{checkpointId}
>
```

Operating rules (each reverses a numbered hazard above):

- **Static imports, single call site:** invoked exactly once from the bootstrap sequence
  (C11: `openDB → whenHydrated() → runCrdtMigrations() → sync init → …`); a module-level
  promise guards re-entry in-tab. [vs 1, 7]
- **Reads the doc, not stores:** `version = max(meta.get('schemaVersion') ?? 0,
  library.get('__schemaVersion') ?? 0) || 1` — the `max` tolerates partial dual-writes. [vs 2]
- **Pre-migration checkpoint:** if any step will run, first
  `await CheckpointService.createCheckpoint('pre-crdt-migration-v{N}', { protected: true })`
  (`CheckpointService.ts:29`) and carry the id into the result/error. [new — master plan P2 scope]
- **One transaction per step, transform atomic with its bump:**
  `yDoc.transact(() => { step.migrate(yDoc); meta.set('schemaVersion', step.to);
  library.set('__schemaVersion', step.to); }, MIGRATION_ORIGIN)`. Steps run sequentially,
  awaited (steps are sync; the await is for checkpoint/IO seams). Transforms operate on Y types
  directly, so there is **no stale-state race and no microtask ordering to outrun** — the
  middleware receives the migration as ordinary inbound (origin ≠ any store api) and patches
  stores normally. [vs 3, 4, 5]
- **Loud failure → safe mode:** any throw aborts the run, logs with the flight recorder, and
  surfaces `MigrationError{checkpointId}` to the boot sequence, which renders
  `CriticalMigrationFailureView` (exists: `src/components/sync/CriticalMigrationFailureView`,
  wired via `ErrorBoundary.tsx:61`) with the checkpoint id and the existing
  Inspect→Diff→Confirm restore flow. No silent catch anywhere. [vs 6]
- **Cross-client safety stays determinism + LWW** (the sound idea in the current design,
  `yjs-provider.ts:76-82`): identical idempotent transforms on all clients merge safely;
  suite F.3 pins convergence.
- The v1→v2 prune and v4→v5 fontProfiles steps are **reimplemented as doc transforms** on the
  coordinator (progress map iteration; preferences map backfill); fixture matrix F.3 pins
  equivalence with the legacy runner's terminal states. `runMigrations`, the nested-microtask
  hack (:182-184), and the spy test are deleted in the same PR (exit criterion).

### 5.3 v6 migration scope (one `CrdtMigration{from: 5, to: 6}`)

Single transaction containing, in order:

1. **Popover key deletion:** `yDoc.getMap('annotations').delete('popover')` — removes the
   residual pre-hotfix key documented at `useAnnotationStore.ts:17-23` (Y.Map keys are
   deletable; only top-level shared types are not). Idempotent (`delete` of absent key is a
   no-op). syncedKeys (B.2/B.5) prevents any v6 client from re-introducing it; the version bump
   quarantines the ≤v5 clients that could.
2. **`meta` map creation + dual-write (N+1 staging, program rule 5):**
   `yDoc.getMap('meta').set('schemaVersion', 6)` **and** `library.set('__schemaVersion', 6)`.
   In the v6 *release*, nothing reads `meta` for enforcement — quarantine still keys off the
   per-map middleware check (`yjs.mjs:682-689` reading `library.__schemaVersion`), which is what
   guarantees **v5 clients lock**: their library-map check fires on the bump. Phase 4's
   synchronous pre-merge check (`FirestoreSyncManager` consulting `meta` *before*
   `Y.applyUpdate`, fixing D5) is the first reader — at least one full release later. Dual-write
   retires at v7 (P9). `meta` is also where Phase 4 moves workspace-metadata versioning
   (today stamped at `FirestoreSyncManager.ts:675`).
3. **Preferences fold:** for each top-level entry `preferences/<deviceId>` in `yDoc.share`
   (sorted by deviceId for determinism): copy its JSON into `yDoc.getMap('preferences')` as a
   nested map keyed by deviceId, **copy-if-absent** (LWW-safe under concurrent migration).
   **▲ Design decision — do NOT clear the old maps in v6.** Clearing them would let the D5
   window (per-map quarantine is async and only library-guarded) wipe a still-v5 device's live
   preferences before its UI locks. The husks stop *mattering* immediately (v6 clients read the
   keyed map) and stop *growing* once the fleet upgrades (quarantined v5 clients can't write);
   v7 clears them alongside the dual-write retirement. The folded copy means every device's
   prefs survive its own upgrade.
   Store-side: `usePreferencesStore` rebinds via `defineSyncedStore({ name: 'preferences',
   scope: { key: getDeviceId() }, … })` — the new `scope` option (§2) binds the unchanged flat
   `PreferencesState` to `preferences.<deviceId>`, so **zero consumer call sites change**.
   (Alternative considered and rejected: reshaping the store to `Record<deviceId, prefs>` —
   touches every theme/font consumer in the app. Contingency if `scope` slips: defer the fold
   to v7; popover + meta do not depend on it, and program rule 4 is still satisfied since v6
   remains the only in-flight CRDT change.)
4. New-device behavior post-fold: a device id with no entry under `preferences` starts from
   declared defaults (merge-defaults store) and lazily writes its sub-map — no legacy top-level
   map is ever created again (`getDeviceId()`-named shares die with the rebind).

### 5.4 Two-client quarantine E2E shape (program rule 6, standing)

- **Vitest integration (primary, fast):** doc A ← v5 fixture; new stack (schemaVersion 6)
  hydrates + `runCrdtMigrations()` → encode update; doc B + nine stores configured
  `schemaVersion: 5` with `onObsolete` spy ← apply update. Assert: spy fired with 6 **before**
  any store patch; B's store state unchanged; B's outbound halted (subsequent `set()` writes
  nothing to doc B); pinned residual: doc B itself merged at the Y level (D5, until P4).
- **Playwright journey (CI-permanent):** two browser contexts against the mock sync backend.
  Client B boots with `window.__versicleTest.overrideSchemaVersion(5)` (the P0/P1
  `installTestApi()` hook; the override feeds `defineSyncedStore`'s `schemaVersion`). Client A
  (real v6 build) loads the v5 fixture via the test API, migrates, syncs. Assert in B:
  `ObsoleteLockView` visible (`useUIStore.obsoleteLock`), no interaction possible, and after
  reload B remains locked (lock re-derives from the doc). This journey is the template every
  future bump reuses (rule 6 is standing, not one-time).

---

## 6. Vendoring plan (github dep → npm workspace)

**Decision: vendor `zustand-middleware-yjs` at the START of Phase 2 (PR-1), ahead of the
strangler's nominal Phase 4 fork-vendoring.** Rationale: the surgery is four behavior changes
with a pinning suite that must run in this repo's CI on every PR; iterating via remote SHA bumps
(edit fork repo → push → bump `package.json` → reinstall) makes review and bisection miserable
and leaves the contract suite testing an artifact CI didn't build. contract-first explicitly
notes vendoring "is what makes the C2 fork surgery a first-party, tested change instead of a
remote branch bump." `y-idb` and `y-cinder` stay github-SHA-pinned until their own phases
(P3 `flush()/whenSynced` surgery; P4). The P0 licensing inventory + CI gate precede P2, so the
licensing precondition is met.

Mechanics:

1. Root `package.json`: add `"workspaces": ["packages/*"]` (none exists today — verified);
   change the dep to resolve to the workspace (`"zustand-middleware-yjs": "*"` under npm
   workspaces, or `"file:packages/zustand-middleware-yjs"`).
2. Import the fork **source** (the installed artifact is dist-only) from
   `github.com/vrwarp/zustand-middleware-yjs` at the pinned SHA `f2842963` into
   `packages/zustand-middleware-yjs/` — `src/`, tests, configs, and **`LICENSE` verbatim**.
3. **Licensing/provenance** (per the gap-licensing report D8): the fork is MIT,
   © 2021 Joseph R Miles (verified: `node_modules/zustand-middleware-yjs/license`; the dist
   bundle also inlines a Microsoft tslib banner, `yjs.mjs:3-16` — tslib is 0BSD/MIT-class and
   already in the dependency census). MIT in a GPL-3.0-or-later repo is compatible; the
   obligations are notice-retention only. Add `packages/zustand-middleware-yjs/PROVENANCE.md`:
   upstream `joebobmiles/zustand-middleware-yjs`, fork point, the fork's pre-existing deltas
   (schemaVersion poison pill, disableYText/yTextKeys, microtask batching, previousState
   delete-protection, undefined handling), vendored-from SHA `f2842963`, and a running log of
   Phase 2 modifications. Ensure the package appears in the generated THIRD-PARTY-NOTICES
   (P0 artifact) — vendoring makes this repo the distributor of record.
4. **Package surgery:** delete the bogus self-dependency `"original-package-name": "file:."`;
   move `yjs` and `zustand` to **peerDependencies** (`yjs: ^13.6`, `zustand: ^5`) — fixing
   correction ▲4; verify whether `use-sync-external-store` is actually imported by the source
   and drop it if not; keep `"private": true` (blocks accidental npm publish); port the fork's
   jest tests to vitest so the package runs under the repo's single-config harness (P0 rule).
5. **Build simplification:** point the package `exports`/`types` at `src/index.ts` and let
   Vite/vitest consume TS directly (workspace-linked source; add a tsconfig project reference
   for `tsc -b` typechecking per boundary rule 10). The rollup/semantic-release/husky
   publishing apparatus is deleted — this package never publishes again. Tested code path ==
   shipped code path (kills the dist-vs-src false-confidence risk R7).
6. **Single-yjs-instance assertion** (required by the plan; now known-load-bearing):
   a. peerDependencies as above — structurally one resolver winner;
   b. CI script `scripts/assert-single-instance.cjs`: `npm ls yjs zustand --all --json` must
      show exactly one resolved copy of each (fails on nested duplicates);
   c. `vite.config.ts` `resolve.dedupe: ['yjs', 'zustand']` belt-and-braces;
   d. runtime contract test: a `Y.Map` created with the app's `yjs` import flows through the
      middleware's `instanceof Y.Map` branches (`yjs.mjs:377, 426, 442`) — duplicated yjs
      instances fail `instanceof` and this test catches it at unit speed.

---

## 7. Risk register (surgery-specific)

| # | Risk | L×I | Mitigation |
|---|---|---|---|
| R1 | **Scoped diff divergence** — `Object.is` fast path misses a mutate-in-place `set()`, doc and store drift silently | M×H | fast-check equivalence property (D.1); DEV sampling assert full-diff-vs-scoped with loud failure; `scopedDiff` is per-store — flip order §2.6 with the hot store last; characterization suite green before flip |
| R2 | **Merge-over-defaults masks a legitimate top-level deletion** (strangler risk row 2) | L×H | top-level deletes can only originate from migrations (§2.2); contract invariant "deliberate key removal ⇒ remove from defaults+syncedKeys + version bump in same release" pinned by B.5/C.8; outbound `previousState` protection (`yjs.mjs:420-425`) kept verbatim and pinned by A.3; old-doc fixtures are the acceptance gate |
| R3 | **`whenHydrated` never resolves** (corrupt IDB, persistence error swallowed at `yjs-provider.ts:41-43`) → boot hang where the poll loop used to give up after 1s | M×M | timeout-and-proceed with warning, parity with `waitForYjsSync(5000)` semantics (`yjs-provider.ts:214-220`); boot integration test covers the timeout path |
| R4 | **v6 mixed-fleet window (D5):** non-library maps aren't version-guarded, so a v5 peer can locally persist v6-shaped data before its UI locks | M×M | v6 transforms chosen to be v5-tolerable: popover delete (v5 ignores), `meta` (v5 never reads), preferences fold **without clearing** (▲ §5.3 — the deliberate down-scope that removes the only destructive interaction); quarantine still fires via the library bump; full fix is Phase 4's synchronous pre-merge `meta` check; residual pinned by F.2 |
| R5 | **Concurrent migration by two clients** double-applies or diverges | L×M | transforms deterministic + idempotent (copy-if-absent, delete-if-present, sorted iteration); one transaction per step; F.3 convergence test; LWW merges identical transforms safely (the sound core of the old design, kept) |
| R6 | **Vendoring breaks installs/builds** (npm workspaces × Vite × Capacitor/Android × CI cache) | M×M | PR-1 is *pure* vendoring (zero behavior change) and must go green on every build target before any surgery PR; `npm ls` assertion catches resolution surprises |
| R7 | **Contract suite tests source while prod ships dist** | was M | eliminated by §6.5 (consume `src/` directly; delete the build) |
| R8 | **`scope` (nested-map binding) is novel surface** for the preferences fold | M×M | own contract cases (creation timing, inbound path filtering, obsolete check unaffected); contingency: defer fold to v7 (§5.3), popover+meta unaffected |
| R9 | **Coordinator reimplementation of v1→v5 diverges from the legacy runner's outputs** | L×M | fixture matrix F.3 pins terminal doc states for every era; the overwhelmingly common fleet state (v5) requires only the v6 step |
| R10 | **N+1 rule violated** — a `meta` reader ships in the same release as the writer | L×H | enforcement is sequencing, not code: Phase 4 owns the only reader; release-checklist line item; program rule 5 cited in the v6 PR description |
| R11 | **Selector/cache behavior shifts under scoped inbound patching** (D9's module cache keyed on reference changes) | M×M | D.4 pins *improved* referential stability (strictly fewer reference changes); `selectors.test.ts` (673 ln) + `selectors.perf.test.ts` must stay green per flip; D9's rewrite stays out of P2 scope |
| R12 | **Canary deletion overreach** — deleting the per-book `progress[bookId] \|\| {}` guards (▲5) as if they were hydration canaries | M×M | census in §2.6 marks them keep; review checklist on flip PRs |

---

## 8. PR-by-PR execution order (Phase 2)

Each PR independently shippable; constitution rules 1–8 apply throughout.

| PR | Content | Exit criteria |
|---|---|---|
| **P2-1** | Vendor the fork (§6): workspace, LICENSE/PROVENANCE, peer deps, vitest port, single-instance assertions | all build targets green; `npm ls` shows one yjs/zustand; zero behavior diff (app bundle hash of middleware chunk functionally identical); THIRD-PARTY-NOTICES includes the package |
| **P2-2** | Characterization suite A.1–A.11 (absorbs `zustand-middleware-yjs-undefined.test.ts` per the ledger) | suite green against the unmodified vendored source; absorbed file deleted in same PR |
| **P2-3** | Surgery 1: `syncedKeys` + `api.yjs` hydration handle (`whenHydrated`/`hasHydrated`/`markHydrated`/`flush`) — options unused by the app yet | A unchanged; B.1–B.6 + E.1–E.4 green |
| **P2-4** | Surgery 2: `hydration: 'merge-defaults'` (default `'replace'`) | C.1–C.8 green; A.5 still pins legacy default |
| **P2-5** | Surgery 3: `scopedDiff` (default off) + `scope` option | D.1–D.6 green; fork perf budget met |
| **P2-6** | `src/store/registry.ts` + `defineSyncedStore`; all nine stores migrated off `getYjsOptions` with `syncedKeys` ON, hydration/scopedDiff still legacy; vestigial `atomicKeys` deleted (▲3); stray stores (`useSyncStore`, `useSidebarStore`, `useCostStore`) moved under `src/store/`; zod schemas in observe mode | full unit+E2E green; observe-mode telemetry visible in flight recorder; registry is the only `yjs()` call site (lint) |
| **P2-7** | Provider `whenHydrated()` composition; App.tsx poll (283-287) + redundant `waitForYjsSync` (231) replaced; migration **coordinator** lands running the existing v1→v5 chain as doc transforms; `runMigrations`/nested-microtask/`onLoaded` wiring and the spy test (`yjs-provider.migration-race.test.ts`) deleted; pre-migration checkpoint wired | boot integration tests (post-wipe boot, migration-interrupt boot) green; coordinator invariants (single-run, atomic bump, loud fail with checkpoint id) green; poll loop gone |
| **P2-8** | Fixture capture script + checked-in v1/v2/v4/v5 fixtures + manifest guard; suite F.1 hydration matrix | fixtures reviewed + hash-pinned; F.1 green on legacy semantics |
| **P2-9** | **v6 migration** (§5.3) + `CURRENT_SCHEMA_VERSION = 6`; suite F.2/F.3; two-client quarantine vitest + Playwright journey | F.2/F.3 green; quarantine journey in CI; v6 is the only in-flight format change (rule 4 checked against P0's manifest-v3 completion) |
| **P2-10a** | Flip wave 1 — contentAnalysis, vocabulary, devices (`merge-defaults` + `scopedDiff`); canaries deleted (`useContentAnalysisStore.ts:120,140,170,187,204,222,230`) | per-store fixture-hydration tests green; A.5 rewritten per store |
| **P2-10b** | Flip wave 2 — lexicon, reading-list (canaries `useReadingListStore.ts:23,27,34,46`, `selectors.ts:78`) | same |
| **P2-10c** | Flip wave 3 — preferences (incl. `scope` rebind to the folded map) | C.4 scenario green end-to-end; new device starts clean from defaults |
| **P2-10d** | Flip wave 4 — annotations, then books (canaries `useBookStore.ts:58,70,79,93`, `selectors.ts:66,108`, `FirestoreSyncManager.ts:364`) | same + clean-client detection verified |
| **P2-10e** | Flip wave 5 — progress (canary `selectors.ts:75`; per-book guards at `useReadingStateStore.ts:139,185,260,356,385` **retained**) | `selectors.perf.test.ts` green with margin; page-turn produces scoped transactions (D.5 in-repo) |
| **P2-11** | Cleanup audit: zero top-level `\|\| {}` hydration fallbacks (grep gate), `as unknown as Record` casts at old runner gone, store README regenerated from registry, deletion ledger reconciled | **Phase exit:** two-client quarantine E2E green; coordinator invariants green; fork contract suite = acceptance gate wired as CI-blocking; zero hydration fallbacks; spy test deleted; ratchet counters ≤ baseline |

Phase exit criteria (from the strangler doc, restated against this design): two-client
quarantine E2E (v5 fixture vs v6) green · migration coordinator invariant tests green (no
double-apply; failure → safe mode with checkpoint id) · fork contract suite is the acceptance
gate for the vendored package · zero `|| {}` hydration fallbacks (per the corrected census §2.6)
· `yjs-provider.migration-race.test.ts` deleted · users see only faster page turns and no
phantom-popover class of bug.

---

## 9. Follow-ups (appended at phase close, 2026-06-10)

Phase 2 landed in full (registry + all nine per-store flips in the §2.6
order; see the README status banner). Deliberately deferred work, with owners:

1. **v7 — preferences husk-clearing (§5.3 ▲ design decision).** The legacy
   top-level `preferences/<deviceId>` maps were folded copy-WITHOUT-clear in
   v6; v6+ clients rebound to the keyed `preferences` map (flip wave 3) and
   never create new husks. v7 empties the husk maps' *content* (top-level
   shared types themselves can never be removed from a Y.Doc) once the
   quarantined ≤v5 fleet is irrelevant.
2. **v7 — schema-version dual-write retirement (program rule 5, P9 horizon).**
   The coordinator dual-writes `meta.schemaVersion` + `library.__schemaVersion`
   per step. Phase 4's synchronous pre-merge check is the first `meta` reader;
   after one full release of readers, v7 retires the `library` write and the
   per-map poison pill keys off `meta` alone.
3. **`waitForYjsSync` → `whenHydrated` call-site migration (§2.4).** Boot and
   the coordinator migrated in P2. `BackupService.ts:207`, the seven
   `LexiconService` call sites, and `FirestoreSyncManager.ts:365` still gate
   on IDB-synced; they want hydrated state and migrate with the Phase 4
   decomposition (lib/ cannot import the app/boot composition today without
   regressing the lib→store/app boundary ratchets).
   **P9 settlement note (p9-fork-and-deferred): deliberately NOT migrated.**
   The FirestoreSyncManager site died with the manager (P4); the surviving
   BackupService/LexiconService callers read the **Y.Doc itself** (export
   state, lexicon maps), not store state — for doc reads, IDB-synced is the
   semantically sufficient gate and `whenHydrated` would only add the
   store-rebind wait. Revisit only if those readers move onto store
   selectors.
4. **Zod observe-mode schemas (C2, P2-6 scope-down).** The registry landed
   without the optional per-store `schema?: ZodType` observe-mode validation
   (log + flight recorder, never reject). The seam is unchanged — add the
   field to `SyncedStoreDef` and run validation post-merge in
   `defineSyncedStore` when C2 inbound validation is picked up
   (observe-then-enforce, Phase 4 sync hardening is the natural home).
5. **Registry geography note.** `defineSyncedStore`/`SyncedStoreDef` live in
   `src/store/yjs-provider.ts` rather than `registry.ts` (§2.5's sketch): the
   TTS worker's type-closure reaches the store modules, and stores importing
   any NEW src/store module regresses the `worker-no-state-typegraph` ratchet
   (20 > 19). The registry aggregates defs + the boot roster and must never be
   imported by a store module; revisit if/when the worker type-closure is cut
   (LD-7 ratchet work).

> **Program decision (2026-06-10, post-P7-prep):** CRDT **v7** is the reading-list
> `bookId` FK linking migration (last PR of Phase 7, gated on v6 + IDB v25 stability).
> The preferences husk-clearing + `library.__schemaVersion` dual-write retirement
> renumber from v7 to **v8** (Phase 9). Additive change ships before cleanup.
>
> **P9 settlement (2026-06-12, p9-crdt-v9-and-shims): items 1–2 are PAID as
> CRDT v9** (final numbering after the v7 = vocabulary / v8 = reading-list FK
> renumbers) — `{from: 8, to: 9}` in `src/app/migrations.ts`
> (`clearHusksAndRetireDualWrite`): the legacy `preferences/<deviceId>` husks
> are emptied (content only; top-level shares are permanent), the de-synced
> `activeContext` key (P8 §J) is pruned from the folded device maps, and the
> coordinator's bump writes `meta` ALONE for steps past
> `LAST_DUAL_WRITTEN_SCHEMA_VERSION = 8`. The `library.__schemaVersion` stamp
> is deliberately FROZEN at 8, not deleted: it remains the only poison-pill
> surface pre-P4-era builds possess, and deleting the key would invite
> middleware default-resurrection writes. N+1 audit (rule 5): meta's write
> shipped at v6, its first readers at P4, and every build that can pass the
> frozen library tripwire (v8-era = ≥ P7) carries the P4 doc-level meta
> layers — reasoning documented in full on the migration body. Coverage:
> captured era-8 fixture (terminal v8 shape, husks + activeContext intact),
> F.3 matrix v1–v8 → v9, and the standing F.2 v8-stack-vs-v9-doc case, which
> pins the enforcement-layer CHANGE (middleware pill silent by design; the
> `readUpdateSchemaVersion` pre-apply gate + the live ProviderConnection
> `meta` observer quarantine instead). Item 3's settlement note stands
> unchanged.
