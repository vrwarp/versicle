# Implementation Plan: Partial-Fetch Drive Metadata & Covers

Companion documents:
- `gdrive-partial-metadata.md` — feasibility (ranged ZIP reading over Drive
  `alt=media`) and quota analysis. **Read first.**
- `gdrive-partial-metadata-ux.md` — the critiqued UX concept set (P1–P3
  prerequisites, R1–R7 features, D1 deferral, kill list).

This document turns those into an ordered, file-level implementation plan.

---

## 1. Goals / Non-Goals

**Goals**
1. Extract EPUB metadata (title, author, description, language, identifiers)
   and cover images from Drive files via HTTP Range requests (~100–500 KB per
   book instead of full downloads).
2. Point that capability at the seven UX features R1–R7, in ship order.
3. Preserve the app's invariants: silent-token policy (no popups from
   background paths), no surprise egress, no shadow-library in the CRDT,
   gateway-mediated fetches only, graceful degradation everywhere.

**Non-Goals**
- D1 (Drive-as-shelf browse mode) — explicitly deferred.
- ZIP64 support — detect and bail to "no preview".
- Syncing covers/extracted metadata through Firestore — banned (P3).
- Replacing epubjs for import — full imports keep the existing pipeline.

---

## 2. Architecture Overview

```
DriveImportDialog / ContentMissingDialog / LibraryView (ghosts)
        │  (gesture or viewport visibility)
        ▼
DriveMetadataService  ──────────────┐  one instance via holder (like
  - hydration queue (priorities:    │  DriveLibrarySync); wired in
    interactive > viewport > trickle)  app/google/wireGoogle.ts
  - cache read-through {fileId,md5} │
  - negative-cache check            │
        │ miss                      ▼
        ▼                    cache_drive_previews (IDB, device-local, LRU)
RemoteEpubReader (pure)
  - EOCD/central-directory parse
  - entry range math + local-header parse
  - inflate (DecompressionStream)
  - container.xml → OPF → cover resolution
        │ readRange(start, end)
        ▼
DriveClient.downloadFileRange(fileId, start, end)   ── egress('drive', …)
```

Key boundaries (existing rules this plan must respect):
- `domains/` never imports stores (`domains-no-store` lint): the service gets
  a `previewCache` port + `driveIndex` port injected in `wireGoogle.ts`.
- All HTTP through `NetworkGateway.egress` (raw fetch is lint-banned).
- `destinations.ts` has a NO-imports constraint (CSP generator) — the new
  rate-limit lane is a data-only edit.
- IDB changes go through the versioned migration registry in
  `src/data/schema.ts` (additive step, next version after current HEAD).
- Two `DriveFileIndex` declarations exist (`store/useDriveStore.ts` and
  `domains/google/drive/types.ts`); both gain the new fields in lockstep.

---

## 3. Phase 0 — Prerequisites & De-risking

**0.1 CORS spike (the one open feasibility assumption).**
Throwaway verification that a browser `fetch` to
`www.googleapis.com/drive/v3/files/{id}?alt=media` with `Range` +
`Authorization` headers survives preflight and returns 206, on web Chrome +
the Capacitor Android WebView. If Range fails on a platform: fall back to
full download on that platform (feature-detect once, cache the answer).
*Exit criterion: documented 206 on both platforms, or a written fallback
decision.*

**0.2 P1 — persist `md5Checksum` in the index.**
- `src/domains/google/drive/types.ts` `DriveFileIndex`: add
  `md5Checksum?: string`.
- `src/store/useDriveStore.ts`: same field; persisted via existing
  `partialize`.
- `src/domains/google/drive/DriveLibrarySync.ts` `mapToDriveFileIndex`: stop
  dropping `file.md5Checksum`.
- Old persisted indexes simply lack the field until the next scan — no
  migration needed (hydration treats missing md5 as "not hydratable yet").

**0.3 P2a — `bg` rate lane for drive.**
`src/kernel/net/destinations.ts`: add `rateLimit: { lane: 'bg' }` to the
`drive` entry. Audit existing callers: interactive imports/downloads must
pass `lane: 'fg'` via `EgressOptions` so today's flows are not throttled
behind hydration (check `DriveClient` call sites; thread an optional lane
through `DriveRequestOptions`).

**0.4 P2b — 403/429 backoff in DriveClient.**
`fetchWithAuth` gains truncated exponential backoff
(`min(2^n + jitter, 32s)`, max ~4 attempts) for `429` and `403` with reason
`rateLimitExceeded`/`userRateLimitExceeded` (reuse `isInsufficientScope`-style
body sniffing; `DriveApiError` already carries `status` + `reason`). Unit
tests with a fake egress.

**0.5 P3 — `cache_drive_previews` store.**
- `src/data/schema.ts`: additive migration step (next IDB version), new store
  `cache_drive_previews`, keyPath `fileId`, index `by_lastAccessed` (mirror
  `cache_audio_blobs`' LRU pattern). Cache domain ⇒ excluded from backup,
  wiped by `data/wipe.ts` cache paths.
- Row shape (`src/data/rows/cache.ts`):
  `{ fileId, md5Checksum, fetchedAt, lastAccessedAt, status: 'ok'|'unextractable', title?, author?, description?, language?, identifiers?: string[], coverBlob?: Blob }`.
  `status: 'unextractable'` IS the negative cache (R7 requirement).
- Eviction: LRU cap (~60 MB or ~500 entries); sweep entries whose `fileId`
  left the index or whose `md5Checksum` no longer matches (orphans from
  overwrites) — run opportunistically after each scan.

*Phase 0 exit: spike result documented; index carries md5 after a scan;
gateway throttles bg drive traffic; backoff tested; empty cache store ships.*

---

## 4. Phase 1 — Core Engine

**1.1 `DriveClient.downloadFileRange(fileId, start, endInclusive, opts)`**
(`src/domains/google/drive/DriveClient.ts`) — sets `Range`, reuses
`fetchWithAuth` (401 retry + new backoff), asserts `206` (a `200` response ⇒
cancel the body reader and throw `DriveRangeUnsupportedError` so callers can
fall back), returns `ArrayBuffer`.

**1.2 `RemoteEpubReader`** (`src/domains/library/import/remoteEpub.ts` —
library domain because it's EPUB knowledge, not Drive knowledge; pure, no
imports beyond types):
- Input: `{ size: number, readRange(start, end): Promise<ArrayBuffer> }`.
- Steps: 64 KB tail → EOCD scan (reject ZIP64 via `PK\x06\x07` locator) →
  central directory map → entry fetch (local-header parse for exact data
  offset, +256 B slack) → inflate via `DecompressionStream('deflate-raw')`
  (method 8) or passthrough (method 0) → `container.xml` → OPF parse
  (DOMParser; dc:title/creator/description/language/identifier; cover via
  EPUB3 `properties="cover-image"`, EPUB2 `<meta name="cover">`, then
  heuristics) → cover entry fetch → `Blob` with manifest media-type.
- Output: `RemoteEpubPreview { title, author, description, language,
  identifiers, coverBlob? }`; throws typed `UnextractableEpubError` on any
  parse failure (callers negative-cache it).
- **Testing is the point of this shape**: unit tests run against in-memory
  fixture EPUBs (build tiny fixtures with jszip in the test, serve
  `readRange` from the buffer) — no network, no Drive. Fixture matrix:
  EPUB2/EPUB3 cover conventions, stored vs deflated entries, ZIP comment
  present, central directory straddling the 64 KB tail, missing cover,
  malformed OPF, ZIP64 (expect bail).

**1.3 `DriveMetadataService`**
(`src/domains/google/drive/DriveMetadataService.ts`, holder-exposed like
`DriveLibrarySync`, wired in `src/app/google/wireGoogle.ts`):
- Ports: `client: Pick<DriveClient,'downloadFileRange'>`, `previewCache`
  (IDB adapter), `driveIndex` (read persisted index only — NEVER triggers a
  scan), `log`.
- API: `getPreview(fileId, {priority, interactive?, signal?})` →
  read-through cache keyed `{fileId, md5}`; single in-flight dedupe per
  fileId; priority queue `interactive > viewport > trickle`; per-priority
  concurrency (interactive unlimited-ish, viewport ≤3, trickle serialized);
  viewport requests are cancellable on scroll-out (R4 requirement).
- Failure policy: `GoogleAuthRequiredError` → surface `'auth'` state to
  callers (UI shows reconnect affordance; background callers stay silent);
  offline/`NET_OFFLINE` → `'offline'` (serve cache only);
  `UnextractableEpubError` → write negative cache; Drive 404 → notify
  `driveIndex` to evict the entry.

*Phase 1 exit: `getPreview` returns real metadata/covers against fixtures and
(manually) against a real Drive folder; zero UI changes yet.*

---

## 5. Phase 2 — Trust Features (R1, R2)

**2.1 R1 — Verified cloud restore.**
`src/components/library/ContentMissingDialog.tsx`: when a `cloudMatch`
exists, call `getPreview(match.id, {priority:'interactive', interactive:true})`
and render cover + OPF title/author above the Restore button ("Restore from
this file?"). Preview failure ⇒ today's filename/size/modified UI (never
block restore on preview availability). Loading state ≤ ~2 s or fall back.

**2.2 R2 — Durable ghost↔Drive binding.**
- Model: `driveBindings` map `bookId → { fileId, md5Checksum, boundAt }` in
  synced user data (new Y.Map via the CRDT migration registry —
  `src/app/boot/crdtMigrations.ts`; bytes only, never blobs).
- Writers: R1 confirm; `DriveLibrarySync.importFile` success; the backfill
  task (below).
- Read policy: exact `{fileId}` lookup with md5 verify-on-use — on md5
  mismatch, demote to candidate (drop binding, fall back to R1 confirm
  flow). Unresolvable on this device's Drive account ⇒ render "unavailable
  on this device's Drive", not an error. Divergent writes resolve LWW
  (Yjs default map semantics).
- `findFile()` heuristic in `useDriveStore` becomes the fallback when no
  binding exists.
- **md5 backfill boot task** (`src/app/boot/backgroundTasks.ts`, alongside
  `driveAutoScanTask`): on a device holding binaries, hash local EPUBs
  (MD5 — small pure implementation or vendored routine; crypto.subtle has no
  MD5), match against index `md5Checksum`, write bindings. Zero network.
  Throttled/idle-chunked like other boot tasks; runs once per
  library+index generation.

*Phase 2 exit: restore is confirm-with-cover; bindings populate from
restores, imports, and backfill; wrong-restore path is dead.*

---

## 6. Phase 3 — Import Surfaces (R3, R4)

**3.1 R3 — Pre-import preview sheet.**
New `src/components/drive/DrivePreviewSheet.tsx` (canonical preview
component): cover, title, author, description, language (editable pre-fill
of import defaults; suggestion-only downstream), size; confirm-time dedup
line "Looks like *X*, already in your library — import anyway?" (exact
identifier or normalized title+author match against inventory; informational
only). Import button = existing `importFile` path.

**3.2 R4 — Rich Drive browser rows.**
`src/components/drive/DriveImportDialog.tsx`: rows request
`getPreview(…, {priority:'viewport'})` via IntersectionObserver; cancel on
scroll-out (AbortSignal per row); cache-first render; fallback row is
exactly today's filename+size+date; tapping a row opens R3's sheet.

*Phase 3 exit: browser shows covers/titles for hydrated rows with honest
fallbacks; import decisions go through the preview sheet.*

---

## 7. Phase 4 — Ambient Surfaces (R5, R6)

**4.1 R5 — Fresh-device cover hydration.**
Trigger: library renders ≥N ghosts that have R2 bindings and no cached
cover. Visible, cancellable banner ("Fetching covers… 40/300 ✕");
viewport-priority for on-screen tiles, trickle-priority for the rest; bound
books only (no heuristic matches — wrong cover is worse than none); token
unavailable ⇒ single reconnect affordance; ghost tiles keep the download
affordance (cover ≠ "ready to read"). Covers land in the same P3 cache (NOT
in static_manifests — that store is for imported books).

**4.2 R6 — "New on Drive" badge.**
Badge/count on the Drive entry point (`ImportSourceDialog` card and/or
library toolbar Drive button) computed from the **persisted index only**
(inline the filename-diff against library filenames; do NOT call
`checkForNewFiles`, which auto-scans when the index is empty), plus "last
scanned N days ago" stamp from `lastScanTime`.

*Phase 4 exit: fresh device shows real covers within minutes for bound
books; Drive entry point communicates novelty + staleness with zero new
egress.*

---

## 8. Phase 5 — R7 Trickle Hydration

Idle consumer inside `DriveMetadataService`:
- Batched: ~30 unhydrated index entries every ~5 min (radio-friendly), only
  while app foregrounded; picks "new on Drive" diff first, then
  most-recently-modified.
- Guards: online + silent token available + no foreground import running +
  unmetered connection (Capacitor Network plugin; on web treat unknown as
  metered and enforce a ~20 MB/session byte cap) + skip entries with
  `status:'unextractable'` at current md5 + consume persisted index only.
- Backoff: any 403/429 pauses the trickle for the session's remaining
  backoff window (don't let backoff retries eat the batch budget).
- Consent surface: disclosure line with size estimate on the folder-link
  confirmation (DriveFolderPicker flow), settings toggle under Sync/Drive
  settings ("Build Drive book previews in the background — Wi-Fi only"),
  subtle activity indicator while a batch runs. Default-on ONLY with all
  three shipped; otherwise ship opt-in.
- Egress visibility: rides the existing gateway counters (Network activity
  panel) automatically.

*Phase 5 exit: an untouched app with a linked folder converges to a fully
rich index within days of normal use, with visible/controllable spend.*

---

## 9. Testing & Verification

- **Unit (vitest):** RemoteEpubReader fixture matrix (§4 1.2); ZIP parser
  edge cases; backoff policy; queue priority/cancellation/dedupe;
  negative-cache and md5-demotion logic; badge diff (no-scan invariant).
- **Contract:** extend `src/test/harness/MockDriveService.ts` with
  `downloadFileRange` semantics (206 slicing from a fixture buffer, optional
  200-fallback mode, 403/404 injection); `DriveMetadataService` tests run
  against it. Existing `src/verification/test_drive_sync.test.ts` pattern.
- **E2E (`verification/`):** new specs following house style —
  `test_journey_drive_preview.spec.ts` (browser rows hydrate + fallback;
  preview sheet; dedup line), `test_journey_ghost_covers.spec.ts`
  (fresh-device banner, cancel, reconnect affordance),
  restore-confirm addition to the ContentMissing journey.
- **Invariants to assert in tests:** no `scanAndIndex` call from badge or
  trickle paths; no preview data in Yjs update payloads (bindings map only);
  no drive egress at boot beyond the existing auto-scan policy;
  `cache_drive_previews` excluded from backup manifest.
- **Bundle:** ZIP/OPF reader must lazy-load with the Drive UI chunk
  (`scripts/check-worker-chunk.mjs` conventions — no entry-chunk growth).

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Range/CORS fails on a platform | Phase 0.1 spike gates everything; per-platform full-download fallback |
| Garbage OPF metadata | Sanitize via existing `getSanitizedBookMetadata` path; fallback to filename UI; negative cache |
| Wrong cover on synced book | R5 binds-only rule; md5 verify-on-use |
| Rate limits under bulk use | bg lane + backoff + batching + lazy-first design (quota study) |
| Cache bloat | LRU + index-membership sweep + md5-orphan sweep |
| CRDT schema regret (bindings) | Bindings map is additive + droppable (device can always fall back to heuristics); never blobs |
| Scope creep into D1 | D1 stays out; any "binary-absent book in library" behavior is out of scope |

## 11. Sequencing & Rough Effort

| Phase | Contents | Size |
|---|---|---|
| 0 | Spike + P1/P2/P3 | S–M |
| 1 | Range client, RemoteEpubReader, MetadataService | M |
| 2 | R1 restore confirm, R2 bindings + backfill | M |
| 3 | R3 sheet, R4 rows | M |
| 4 | R5 ghost covers, R6 badge | M |
| 5 | R7 trickle + consent surfaces | S–M |

Each phase is independently shippable; value lands from Phase 2 onward. The
only hard cross-phase dependencies: everything ⇐ Phase 0/1; R5 ⇐ R2's
backfill; R7 ⇐ R4's cache being exercised (soft).

## 12. Open Questions

1. Backfill MD5 source: pure-JS MD5 (tiny) vs. skipping backfill on very
   large libraries until idle — pick during Phase 2.
2. R2 storage locus: dedicated `driveBindings` Y.Map vs. optional fields on
   `UserInventoryItem` — dedicated map preferred (inventory rows stay
   Drive-agnostic); confirm against CRDT migration conventions.
3. R7 default-on vs opt-in: decide after the consent surfaces exist; ship
   opt-in if in doubt (cheap to flip later).
4. Whether R6's badge lives on ImportSourceDialog, the library toolbar, or
   both — pick with actual UI in front of us.
