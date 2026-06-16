# Shared AI-Cache (Artifact Lane) — Technical Proposal

> **Status:** proposal / design. Not yet scheduled.
> **Author:** drafted 2026-06-14 via a propose → judge → synthesize workflow (5 architectures,
> adversarially scored); **v2** hardened the same day through a grounded critique → verify loop
> (38 agents, 6 dimensions; 27 findings survived verification, 3 refuted).
> **Scope:** share expensive AI-generated cache **across the user's own devices**. v1 is
> **embeddings-only**; TTS is a *future* adopter with real preconditions (§6a). Cross-*user*
> sharing is evaluated and **deferred** (§3).
> **Companion:** [semantic-search-design.md](semantic-search-design.md).

> [!IMPORTANT]
> **Implementation status (updated 2026-06-14): Artifact Lane v1 (Phases A–D) IMPLEMENTED** on branch
> `claude/objective-euclid-d1d269`, each increment gate-verified + full-suite-gated (3,296 tests green).
> Phase → commit:
> - **A** `ae4fd01e` — C3 `SyncBackend` artifact methods + Firestore/Mock impls + contract suite
> - **B** `a662e0fa` — consult/hydrate hoisted before the quota gate + atomic `putHydrated` + read-path consent
> - **C** `78b224cc` — upload publisher + blob serialize + default-OFF "Share AI caches" opt-in + disclosure
> - **D** `731f9ac9` — app-layer per-book cloud delete + persist-on-evict + TTL/quota sweeper + drift metric
>
> **Deviations from this proposal as written:**
> - **The C3 surface grew from a "method trio" (§4) to FIVE methods.** A added `head/put/getArtifact`;
>   D added `deleteArtifactHead` + `sweepArtifacts`.
> - **`embedCache` was added to `PURGE_SUBCOLLECTIONS` in Phase A** (§2.7 had scheduled it under D).
>
> **Not implemented / deferred (as this proposal recommends):** Phase E (TTS — blocked on the
> provider/format-stamped key, §6a); cross-user VEC (§3); per-blob HMAC (M-5, accept-risk); the
> real-2-device end-to-end exit test.
>
> **⚠️ CI-PENDING (cannot run locally — no emulators):** EVERY cloud round-trip — the Firestore+Storage
> emulator put/head/get/delete/sweep + HEAD-after-Storage ordering, and the security-rules suite —
> auto-skips locally. Cross-device behavior is verified against `MockBackend` only; the Artifact Lane
> is **code-complete and unit-verified but NOT yet proven end-to-end against real Firebase.**

> [!NOTE]
> **What the critique changed (v1 → v2).** The three load-bearing theses held: content-addressed
> blobs in the user's BYO backend, ~zero CRDT/format-change surface, and quota-check upstream of
> `acquire`. But v1 **overstated** "free GC", "zero new key logic", and "reuses existing machinery,"
> and shipped four merge-blockers as if solved. v2 fixes: the consult is hoisted **into the bg loop
> before the A6 gate** (§2.4/§7) or it never runs when quota is saturated; per-book cloud-delete
> moves to the **app-layer orchestrator** (`deleteBook` has no backend handle, §2.7); the Firestore
> HEAD doc needs an explicit `PURGE_SUBCOLLECTIONS` add (not "free", §2.7); the **download obeys the
> same per-book consent gate** as the embed it replaces (§2.6); evict-vs-delete is resolved to
> persist-on-evict with an upload-confirmed invariant (§2.7); and TTS is descoped from v1 because its
> cache key is **provider-blind** (§6a).

> [!NOTE]
> **Candidate ranking (scored /35):** Firestore-sharded **32** · Cloud-Storage-blob **31** ·
> manifest+blob **31** · Artifact-Lane **30** · cross-user VEC **23**. The synthesis grafts the
> winners' best parts; VEC scored top on raw savings (5/5) but was killed on privacy (2), BYO-fit (1),
> simplicity (1) — §3.

## 1. Recommendation (TL;DR)

Ship a content-addressed **"Artifact Lane"** — one additive C3 `SyncBackend` method trio that mirrors
**embedding** blobs into the user's **own** BYO Cloud Storage, with a tiny Firestore HEAD-doc
directory for cheap existence probes. The background indexer consults the lane **before** the A6
quota gate; a hit hydrates ~251 KB instead of spending Gemini quota.

It wins because it is the only angle simultaneously (a) format-change-free against terminal CRDT v9 /
rule 4, (b) privacy-tractable (same uid, same BYO project), and (c) able to place the cost win
upstream of where `QuotaGovernor.acquire` debits. **v1 = embeddings only, cross-device only.** TTS is
a separate future design (§6a); cross-user (VEC) is deferred (§3).

## 2. Concrete design

### 2.1 Where data lives (two tiers, neither in the CRDT)

| Tier | Location | Why |
|---|---|---|
| **Payload** (~251 KB int8 vectors + scales) | user's BYO **Cloud Storage**, content-addressed object | Too large for the CRDT — y-cinder hard-rejects any update > 1,048,576 bytes *before* writing (`packages/y-cinder/src/provider.ts:554`). |
| **HEAD directory** (size, stamp, createdAt) | user's BYO **Firestore**, one tiny doc per artifact key | Cheap `getDoc` existence/stamp probe; no Storage `list`; keeps the synced CRDT doc untouched. (Drop `uploaderDeviceId` — no consumer; L-6.) |
| **Hot read path** (unchanged) | device-local IDB `cache_embeddings` (v27) | The lane is a cold-miss refill behind the local cache. |

**Path placement** — inside the workspace prefix so the **blob** is swept by the existing
`purgeStoragePrefix`:
```
users/{uid}/versicle/{workspaceId}/embeddings/{contentKey}.bin   ← payload (Cloud Storage)
users/{uid}/versicle/{workspaceId}/embedCache/{contentKey}       ← HEAD doc (Firestore)
```
> [!WARNING]
> **Same-active-workspace precondition (M-7):** the cross-device win requires both devices on the
> same active workspace (the common single-workspace BYO case, but `SyncOrchestrator` does not
> auto-adopt a lone existing workspace — `SyncOrchestrator.ts:143-160`). Content is workspace-agnostic
> (`bookId`-derived) but the path is workspace-scoped → the same book re-stores per workspace; at-rest
> accounting (§2.7) must reflect N-workspace multiplication.

### 2.2 Content-addressing key

```
contentKey(embeddings) = sha256( contentHash | model | dims | quant | extractionVersion )   // whole-book bundle
```
- **`contentHash`** = SHA-256 of the EPUB (`static.ts:67`) — content-stable identity (`bookId` is
  device-local). It is **optional** and on the `static_manifests` row, not the embedding row → one
  `bookId → contentHash` lookup; pre-P7 books lacking it silently degrade to per-device embedding.
- **`{model,dims,quant}`** = embedding-space stamp; a change → different key → structural miss → re-embed.
- The blob's **self-describing header** carries the per-section `sectionTextHash` list so a partially
  re-extracted book reconciles section-by-section on download. Whole-book bundle (not per-section
  objects) keeps one HEAD doc + one blob per `(book, space)` and matches `embeddingsRepo.put`.

### 2.3 Upload flow

After the indexer persists a book's row (`EmbeddingIndexer.ts:234`), a background **ArtifactPublisher**
(sibling boot task; heartbeat-active-device + idle + bg-gated): concat the row's ArrayBuffers into one
versioned-header blob → `headArtifact`; if absent, `putArtifact` (`uploadBytes` to Storage **then**
`setDoc` the HEAD doc — HEAD-after-Storage). Idempotent (`ifAbsent`, content-addressed). **Opt-in,
default-OFF**, best-effort, off the FG path, silent no-op if the BYO project has no Storage bucket.

### 2.4 Download flow — the QUOTA-CHECK-BEFORE-GENERATE path (the cost win)

> [!IMPORTANT]
> **The consult must run in the bg backfill loop BEFORE the A6 gate (H-1), not inside the indexer.**
> The A6 cross-device admission gate is an early-return in the bg loop (`embeddingBackfill.ts:105-109`
> returns when `remaining<=0`), which is **upstream** of `EmbeddingIndexer.enqueue` — an
> indexer-internal consult can never precede it, so saturated-quota would skip peer-embedded zero-cost
> books (the exact case this design exists for). Hoist a batched `probeArtifact`/`hydrateFromArtifact`
> into the bg loop **before** the `remaining<=0` check: probe-hits take an unconditional quota-free
> hydrate path; only probe-miss/partial books are subject to `remaining`. Keep an indexer-internal
> consult only for the FG-reader path (`useReaderController.ts:350`, which has no A6 gate).

Per book: (1) local hit → done (unchanged); (2) batched `headArtifact` probe; (3) **hit** →
`getArtifact` → parse header → reconcile each `sectionTextHash` against the live corpus → re-derive
`contentKey` from the blob's own stamp and assert it matches (bit-rot guard) → **atomic** hydrate
(§2.8) → `embed()` never called; (4) **miss/partial** → only residual sections fall through to
`embed()`.

**Why a full hit provably spends zero quota (verified):** `QuotaGovernor.acquire` debits inside
`NetworkGateway.egress` (`NetworkGateway.ts:230`), downstream of `embeddingClient.embed()`
(`EmbeddingIndexer.ts:186`); skipping `embed` never reaches `acquire`. The `headArtifact`/`getArtifact`
calls are **firebase-SDK-owned** and by construction **cannot route through `egress()`** (it throws for
`via!=='gateway'`, `NetworkGateway.ts:200-205`) → no rateLimit lane, zero gateway accounting (L-1).
> **Partial hits still spend (L-2):** under the default single-embed path each residual section is one
> RPD debit per device. Only **full hits** are zero-cost; the partial-hit RPD win depends on the §11.3
> batch-embedding probe, independent of this proposal.

### 2.5 Consistency model

A `contentKey` maps to one logical blob; identical inputs → byte-identical content → idempotent
concurrent uploads. **Staleness impossible on the stamp dimension** (a change is a different key). The
only race is two devices embedding the same new book before either upload lands (transient cost). See
§2.7 for HEAD/object drift, which the lifecycle gaps make a *steady-state*, not just an upload-crash
window.

### 2.6 Consent on the read path (NEW — H-4, hard requirement)

The consult/hydrate persists Google-derived full-text vectors locally and is **consent-equivalent to a
freshly-embedded row** (§2.1 "indistinguishable from a self-generated row" is exactly the leak). The
`firebase` download is `consent:'oauth'`/`via:'sdk'`, so the gateway's per-book gate is structurally
unreachable (`NetworkGateway.ts:177-184` early-returns for oauth). Therefore the **consult/download
must be gated in the app layer by the SAME predicate `makeAiConsentResolver` applies to the embed it
replaces**: per-book `aiConsent` bit true, OR `preEmbedLibrary` ON (bg lane), OR an interactive
gesture (FG). Resolve "gate both" as a **hard requirement** — otherwise a bg consult on Device B
materializes the full derived index for an unopened, never-consented book while the opt-in is OFF,
inverting semantic-search §8.4's "books are never background-embedded merely by being in the library."

### 2.7 Lifecycle & GC (NEW — promoted from open questions: H-2, H-3, H-6, L-3, M-7)

- **Per-book cloud delete is an APP-LAYER concern, not `deleteBook` (H-2).**
  `bookContent.deleteBook` (`bookContent.ts:433-467`) is worker-safe, store-free, bookId-only, holds
  **no uid/workspaceId/SyncBackend**, and deletes the `static_manifests` row (carrying `contentHash`)
  in the same tx — so the key material is gone before any cloud delete could run. Re-target to the
  app-layer orchestrator (`LibraryService.remove`), resolve `bookId→contentHash` via `getManifest`
  **before** the local tx, best-effort with the `purgeWorkspace` try/catch degrade, delete blob + HEAD
  doc. Make the shared-blob delete **reference-counted / no-op** when content may still serve a sibling
  device (cross-device data-loss hazard).
- **HEAD doc is NOT swept "for free" (H-3).** `purgeStoragePrefix` is Storage-only; the Firestore
  sweep loops a hardcoded `PURGE_SUBCOLLECTIONS = ['updates','history','maintenance','metadata']`
  (`FirestoreBackend.ts:59`) — **add `'embedCache'`** (one line) + a contract case seeding/counting an
  `embedCache` residual. Only the blob is free; the HEAD doc is "near-zero work," not zero.
- **Evict-vs-delete RESOLVED → persist-on-evict (H-6).** Local IDB LRU never touches the cloud mirror;
  the at-rest sweep is a **separate boot task holding uid/workspaceId/SyncBackend** — NOT coupled to
  `embeddingsRepo.runEviction` (store-free, bookId/budget-only, `embeddings.ts:154-157`). **Invariant:
  never evict a book whose blob upload is unconfirmed** (upload is opt-in/best-effort/idle-gated and
  may never have run — evicting would destroy the only copy). The cloud-side TTL/quota sweep
  (workspace-prefix, `purgeStoragePrefix` shape) is a **required** Phase-D gate, not optional.
- **`getArtifact` error taxonomy + HEAD self-heal (L-3):** `storage/object-not-found` → definitive
  miss (re-embed + opportunistically delete the stale HEAD doc); network/transient/permission → **NOT
  a miss** (never burn quota on an offline blip). Note this is *opposite polarity* to
  `isWorkspaceAlive` (which assumes alive on error). Add a drift metric so steady-state drift is
  observable.

### 2.8 Atomic hydration write (NEW — L-4, Phase-B merge blocker)

`embeddingsRepo.put` and `putJob` are two independent single-store transactions (`embeddings.ts:95-114`)
and resume-skip reads only the **job** row (`EmbeddingIndexer.ts:174-177`). A crash between them leaves a
section marked done with absent vectors — and since the stamp matches, resume-skip `continue`s it
**forever** (silently un-searchable). Require a `putHydrated(embeddingsRow, jobRow)` doing
`write(['cache_embeddings','cache_embed_jobs'], …)` in ONE gated cross-store tx (the atomic primitive
exists at `embeddings.ts:123-130`), plus a defensive resume-skip guard (job-complete + no vectors →
miss) and a crash-between-writes contract test.

## 3. Privacy / consent / data class

- **Data class = `book-derived`** (`destinations.ts:238`) — same class the firebase destination
  declares → no new egress destination, no CSP change. Read-path consent is enforced in the app layer
  (§2.6), not the gateway (oauth lane).
- **Trust boundary: narrower than VEC, but NOT zero (M-5).** A download trusts the **writer of the
  bucket object**; with no output-fidelity checksum, anyone with bucket write-access (compromised
  device token, shared family project, leaked service-account key) can swap a content-keyed blob for
  adversarial vectors every device trusts as self-generated — and a 251 KB int8 blob is opaque, unlike
  human-readable annotations. Decision: accept the residual (requires full account compromise) **or**
  add a per-blob HMAC keyed by a device-local secret.
- **Consent additions:** a **default-OFF "Share AI caches across my devices" opt-in** (modeled on
  `preEmbedLibrary`) gating **upload AND consult** (§2.6); plus **net-new disclosure copy** meeting
  §8.4's "what leaves the device and when" bar (the current firebase purpose string mentions no AI
  cache and the payload is whole-corpus embeddings — heavier than annotation sync; this is a Phase-C
  gate deliverable, not a one-line registry edit) (L-5).

### Cross-user (VEC): recommend AGAINST for now

Highest raw savings (5/5) but four verified, unmitigated blockers: (1) **no app-operated backend
exists** (`SyncBackendFactory(uid)` is per-uid → green-field infra); (2) **privacy regression** — every
existence probe is a membership/ownership oracle; (3) **poisoning has no defense** — content-addressing
proves the input, not output fidelity, and there is no verification seam; (4) **licensing** — a
cross-user store of vectors derived from copyrighted text under GPL-3.0. Leave the C3 method shape open
to back a future app-operated backend; do not build it now.

## 4. Format-change impact (respects CRDT-v9-terminal / rule 4 / BYO)

| Surface | Impact |
|---|---|
| **CRDT schema** | **ZERO.** v9 terminal; no synced store/key. Blobs never touch Yjs. |
| **Coordination metadata** | The Firestore HEAD docs **are** the directory → no synced metadata needed. **Do NOT generalize the `embedSpend` nested-field hatch to a cross-device "uploaded" directory (H-5):** that hatch is bump-free only because `registerCurrentDevice` rewrites the device's *own* record each boot; it does not hydrate onto peers (merge-defaults retention is shallow → a new nested field needs a backfill, `registry.ts:362-369`). Any reader must treat absent-on-peers as false; the cross-device directory is the HEAD docs, not the CRDT. |
| **IDB** | **None for v1.** A later "filled-from-commons" flag is a normal additive CACHE bump — **the next free version after the reserved sync_log/SW-cleanup slot (v28 if it lands first, else v29)**, sequenced via the rule-4 ledger (M-4). |
| **C3 contract** | **One additive method trio** `headArtifact`/`putArtifact`/`getArtifact`. **This is the real tax** — it ADDS `uploadBytes`+`getBytes` to `FirestoreBackend`, widening its *sole-firebase/storage-importer* surface from delete-only to read/write (M-1). It is pinned by **three** suites (the shared spec + `…mock.test.ts` + the **Firestore+Storage emulator** suite) and a `storage.rules` change trips the security-rules suite (M-2). |
| **Docs-drift gate** | Adding **methods** to existing `src/domains/sync/backend/*.ts` trips **nothing** (no new dir; pointers still resolve) (M-8). The gate fires only if a new dir (e.g. `src/data/repos/artifacts.ts`) is added — then register it in `registryDocs.ts`. |

### 4a. CI & contract obligations (NEW — M-2, M-3)

- **MockBackend has no Storage tier** (`MockBackend.ts:117-128`, `blobsDeleted:0`, "no Storage"). The
  put/get round-trip, HEAD-after-Storage ordering, and hit-but-missing fail-safe (§2.5/§2.7) are pinned
  **only** by the emulator suite, which **auto-skips when emulators are unreachable**. → The **emulator
  suite must run in CI** for artifact PRs, or §2.5's guarantees are unverified on default runs.
- Extend the existing purge contract cases to seed an `embedCache` HEAD-doc residual (pins the H-3 fix).

## 5. Existing seams reused

1. **C3 `SyncBackend` seam** — additive method trio, contract-pinned.
2. **`FirestoreBackend` as the sole `firebase/storage` importer** — the **seam** is reused (sole
   importer, `ref`/`getStorage`), but `putArtifact`/`getArtifact` **add** `uploadBytes`/`getBytes` —
   net-new read/write primitives, not "the exact machinery `purgeStoragePrefix` already uses" (M-1).
3. **`purgeStoragePrefix` + `PurgeReport.blobsDeleted`** — sweeps the **blob** on workspace delete;
   the HEAD doc needs `'embedCache'` added to `PURGE_SUBCOLLECTIONS` (§2.7).
4. **Content-addressing primitives verbatim** — `contentHash`, `{model,dims,quant}`, `sectionTextHash`.
5. **Indexer resume-skip + injected-port seam** — the consult is injected ports; FG path in the
   indexer, **bg path hoisted into the backfill loop** (§2.4).
6. **`firebase` egress destination** — `book-derived`/`oauth`, host already on CSP (SDK boundary, L-1).
7. **`preEmbedLibrary` default-OFF opt-in + consent-resolver pattern** — template for the new opt-in.
8. **Eviction/delete-with-book lifecycle** — but the cloud mirror is app-layer (§2.7), not `deleteBook`.
9. **heartbeat-active + idle + bg-lane gating** — the ArtifactPublisher is a sibling boot task.

## 6. Generalization to other expensive AI caches

The C3 method trio is the **reusable seam**, but each adopter re-pays its own key builder, blob
header/reconcile, placement+GC, consult seam, and storage budget (M-9). So **v1 acceptance is
embeddings-only**; the altitude is justified by the embeddings win alone.

- **`contentAnalysis`** — do **NOT** use the lane: it is **already cross-device-synced**
  (`CONTENT_ANALYSIS_STORE_DEF.syncedKeys=['sections']`) and is text, not the large-binary class — no
  gap exists (M-6).
- **TTS audio** — a *future* adopter with real preconditions, **not** v1. See §6a.

### 6a. TTS adoption preconditions (NEW — C-1, H-7, M-9)

1. **The TTS key is provider-blind → silent corruption if shared as-is (CRITICAL).** `TTSCache` keys on
   `SHA-256(text|voiceId|1)` with **no provider id and no format/model stamp**, but OpenAI and LemonFox
   ship colliding voice ids (`alloy`/`echo`/`nova`) and `BaseCloudProvider` hardcodes `audio/mp3` on
   read. Mirroring as-is serves Device-B-on-LemonFox the audio Device-A-on-OpenAI uploaded. Before TTS
   can adopt: `contentKey(tts)=sha256(text|providerId|voiceId|audioFormat|synthVersion)` + a
   self-describing header re-asserted on consult. This is a **net-new key builder + provider id plumbed
   through the cache call site**, not "zero new key logic."
2. **No `bookId` → no free workspace-prefix GC (H-7).** `cache_audio_blobs` is `text|voiceId`-keyed
   with no bookId and no per-book purge; `deleteBook` never touches it. TTS blobs need an
   **account-global prefix** (`users/{uid}/aiCache/tts/{contentKey}.bin`) with a **dedicated, required
   TTL/quota sweeper** (neither `purgeWorkspace` nor `deleteBook` can collect them) and its own storage
   budget (audio LRU is up to 512 MiB vs embeddings' ~256 KB/book).

## 7. Phased rollout

| Phase | Scope | Gate |
|---|---|---|
| **A — C3 seam** | `headArtifact`/`putArtifact`/`getArtifact` (+`uploadBytes`/`getBytes` in FirestoreBackend); MockBackend behavioral stub; **emulator** put/get/ordering cases; `embedCache` purge case. | All three contract suites green incl. emulator **in CI**; `storage.rules` security-suite green. |
| **B — Download/consult (read-only)** | Hoist batched `probeArtifact`/`hydrateFromArtifact` into the bg loop **before** the A6 gate (§2.4); FG consult in the indexer; **atomic `putHydrated`** (§2.8); read-path consent gate (§2.6); `getArtifact` error taxonomy (§2.7). Seed blobs manually. | A full hit provably skips `embed()` (no `embedSpend`); consult denied when opt-in OFF + no per-book bit; crash-between-writes never yields skip-but-empty. |
| **C — Upload (opt-in)** | ArtifactPublisher (bg/idle/heartbeat); default-OFF opt-in gating upload+consult; disclosure copy + purpose-string substance; `ifAbsent` dedup. | Two real devices: book embedded on A → zero-Gemini hydrate on B. |
| **D — Lifecycle (required, not optional)** | App-layer per-book cloud delete (reference-counted); `embedCache` in `PURGE_SUBCOLLECTIONS`; persist-on-evict + never-evict-unconfirmed-upload; **required** workspace-prefix cloud TTL/quota sweeper; drift metric. | No orphaned blobs/HEAD docs after book/workspace delete; bucket bounded; steady-state drift observable. |
| **E — TTS (separate design)** | Only after §6a preconditions: provider/format-stamped key + header; account-global prefix + dedicated sweeper; separate opt-in + budget. | No cross-provider voice-id collision; audio budget respected. |

## 8. Open questions / residual risks

1. **`contentHash` optionality:** pre-P7 books silently get no benefit (degrade to status quo).
2. **First-of-fleet / single-device users** get only the eviction-recovery upside until a 2nd device
   exists; the batched probe keeps the per-open overhead bounded (still N `getDoc` reads at cold scale — L/sync-6).
3. **Per-blob fidelity (M-5):** ship without an HMAC and accept the bucket-write-access risk, or add one?
4. **BYO Firestore-only projects** (no Storage bucket): zero benefit until they provision Storage +
   deploy `storage.rules`; degrade silently with a diagnostic log.
5. **N-workspace blob multiplication (M-7):** same content re-stored per workspace; at-rest accounting
   and the sweeper must enumerate by resolvable workspace prefix.

*(Resolved out of "open questions" in v2: read-path consent → §2.6; per-book delete seam → §2.7;
evict-vs-delete → §2.7; HEAD-doc GC → §2.7; atomic hydration → §2.8.)*

## Why not the alternatives

- **Cloud-Storage-blob + synced manifest:** the synced availability manifest competes for the 1 MB CRDT
  doc budget — the winner makes the Firestore HEAD docs the directory instead.
- **Per-section Firestore docs:** finer grain multiplies docs (read cost + GC) for marginal reuse;
  whole-book bundling with an in-blob section-hash header gives partial reuse without N objects.
- **Original Artifact Lane (`versicle-artifacts/` sibling):** right thesis, but the sibling prefix
  broke free reuse of `purgeWorkspace`; the winner keeps artifacts inside the workspace prefix.
- **VEC cross-user commons:** highest raw savings but green-field infra + membership-oracle + poisoning
  + GPL-3.0 redistribution. Deferred; C3 shape left open.

## Verdict (from the critique loop)

**Fundamentally sound — refine, not rethink.** The three structural theses (content-addressed BYO
blobs, zero CRDT/format change, quota-check upstream of `acquire`) hold against the real code. v1
shipped four merge-blockers as solved/optional — consult wired downstream of the A6 gate, per-book
delete impossible at `deleteBook`, HEAD doc not swept "for free," download bypassing the per-book
consent gate — plus a critical TTS key-collision footgun and an unmade evict-vs-delete decision. All
have concrete in-repo fixes at known seams (now in §2.4/§2.6/§2.7/§2.8/§6a); none invalidate the
architecture. Apply the Critical/High items as preconditions to scheduling.

## Key files

`src/domains/sync/backend/SyncBackend.ts` (C3 seam) · `FirestoreBackend.ts:33-39,59,195-253`
(storage imports + purge allow-list) · `MockBackend.ts:117-128` (no Storage tier) ·
`src/domains/search/EmbeddingIndexer.ts:174-186` (consult/resume seam) ·
`src/app/boot/embeddingBackfill.ts:105-120` (A6 gate — consult must precede) ·
`src/kernel/net/NetworkGateway.ts:200-230` (egress via-gateway-only + where quota debits) ·
`src/data/repos/embeddings.ts:95-130,154-157` (put/putJob/atomic write/runEviction) ·
`src/data/repos/bookContent.ts:433-467` (deleteBook — no backend handle) ·
`src/app/google/aiConsent.ts:45-62` (consent predicate) · `src/data/rows/static.ts:67` (contentHash) ·
`src/lib/tts/TTSCache.ts:28` + the providers (provider-blind key) · `src/store/yjs-provider.ts:38`
(terminal v9) · `packages/y-cinder/src/provider.ts:554` (1 MB limit).
