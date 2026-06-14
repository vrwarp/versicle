# Semantic Search via Gemini Embedding 2 — Technical Design

> **Status:** design / proposal. Not yet scheduled against the overhaul program.
> **Author:** drafted 2026-06-13. Hardened the same day through a verified critique→refine→converge
> loop: **v2** = critique vs versicle's documented expected design (41 agents, 6 dimensions, findings
> adversarially re-checked; 2 refuted); **v3** = the 4 open decisions resolved against the real code;
> **v3.1** = a convergence pass (re-verify of the 19 criticals/highs: 16 resolved + 3 partials, now
> closed; 0 unresolved/regressed) plus a new-issue sweep that caught and fixed regressions the
> resolution edits had introduced. **Loop status: converged (GO).**
> **Scope:** on-device semantic search over book text using Gemini Embedding 2, sized to stay
> within the free quota, plus a cross-provider quota governor reused by all GenAI calls.

> [!NOTE]
> **What the critique changed (v1 → v2).** The search *mechanics* (int8@768 quantization, chunk
> reuse, hybrid RRF fusion, worker/main split) survived intact. Four architectural bets were
> reworked to fit versicle's enforced boundaries: (1) the governor cannot live in `kernel/` *and*
> touch IndexedDB — persistence is now an injected port (§3); (2) throttling is enforced *inside*
> `NetworkGateway.egress`, not as a side-car each client must remember to call (§3); (3) the
> free-tier quota is **per-project, shared across the user's synced devices** — reconciled by a hybrid
> (interactive un-divided + active-device-only background + rolling spend on the synced mesh, §3.4);
> (4) background-embedding unread books is **default-denied by the consent
> gate** and needs a new explicit opt-in (§8.4). The GenAI-capability, cross-domain, and
> data-layer patterns are now spelled out to match the codebase (§5, §6).

## 0. One-paragraph summary

Sub-chunk the plain text Versicle already extracts into `cache_search_text`, embed each chunk with
**Gemini Embedding 2** at **768 dimensions**, store the result **int8-quantized with a per-vector
scale** (~43% of the text's own byte size), and search it with brute-force int8 cosine in the
existing search worker — fused with today's regex full-text engine. All embedding traffic, and
eventually *every* GenAI call, is paced by a new **cross-provider quota governor** whose
backpressure is enforced **at the egress chokepoint** and whose daily counter is persisted through
an **app-injected port** (kernel touches no storage). The free-tier ceiling is **per-project**, so
the governor reconciles the budget **across the user's synced device mesh** (§3.4). Indexing runs
in two priority lanes: the **book being read** (foreground, ordered outward from the reading
position) gets first claim; **loaded-but-unread books** (background) trickle on leftover budget —
but only once the user turns on an explicit, default-OFF library-wide opt-in (§8.4).

> [!IMPORTANT]
> **Batching is set aside.** Verified: the **async Batch API is paid-only** — the official
> rate-limits table's "enqueued tokens" rows for Gemini Embedding start at **Tier 1 (500K)** with
> **no Free-tier row** ([rate-limits docs](https://ai.google.dev/gemini-api/docs/rate-limits)).
> The **synchronous `batchEmbedContents`** multi-content call accepts **≤100 contents/request**
> ([community-confirmed](https://github.com/langchain-ai/langchainjs/issues/4491)), but whether N
> contents in one call debit the request counter by **1 or by N is unconfirmed in every source** (it
> draws on its *own* separately-metered request-per-minute pool, distinct from `embedContent`). The
> free path **ships** as one `embedContent` per chunk; the 1-vs-N answer is gated behind a one-off
> empirical probe + a `useBatchEmbedding` flag (§9, §11). **Partial-win caveat:** even under
> N-counting, batching collapses ~100 round-trips into 1 (RPM/latency relief) but gives **zero RPD
> relief** — and RPD is the binding constraint (§8.1) — so adopt it for throughput *only* if the probe
> confirms per-call counting.

## 0.1 Assumptions verified against primary sources (2026-06-13)

| Assumption | Verdict | Source |
|---|---|---|
| Model is GA; id `gemini-embedding-2` (preview id `gemini-embedding-2-preview` also live) | **Confirmed** — preview Mar 2026, GA ~Apr 2026 | [model page](https://ai.google.dev/gemini-api/docs/models/gemini-embedding-2-preview), [GA blog](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-embedding-2-generally-available/), [LiteLLM GA](https://docs.litellm.ai/blog/gemini_embedding_2_ga) |
| EM2 **text input is free** in the free tier (paid $0.20/1M); `-001` text free (paid $0.15/1M) | **Confirmed** — premise is valid for EM2, not just `-001` | [pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| EM2 multimodal inputs (image/audio/video) are **paid even on free tier** | **Confirmed** — only *text* is free; affects the §8.5 multimodal idea | [pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| EM2 has **no `task_type`** (prompt instructions); `-001` has `task_type` | **Confirmed** | [embeddings docs](https://ai.google.dev/gemini-api/docs/embeddings) |
| Dims 128–3072 (rec 768/1536/3072); EM2 **auto-normalizes** truncated, `-001` manual | **Confirmed** | [embeddings docs](https://ai.google.dev/gemini-api/docs/embeddings) |
| Max input: EM2 **8192**, `-001` **2048** tokens | **Confirmed** | [embeddings docs](https://ai.google.dev/gemini-api/docs/embeddings) |
| int8 ~99%+ recall / binary ~96% only with rescoring | **Confirmed** | [sbert](https://www.sbert.net/examples/sentence_transformer/applications/embedding-quantization/README.html) |
| Free-tier **30K TPM / 100 RPM / 1K RPD** | **Partially** — `-001` free = **100 RPM / 1,000 RPD** (widely cited); **TPM not in official docs**; EM2's free RPM/TPM/RPD **not published anywhere**; ceiling is **per-project, not per-device** (§3.4) | rate-limits page **defers to the AI Studio dashboard**; numbers vary by model & change over time |

> [!IMPORTANT]
> **The single most consequential finding:** Google does **not publish** per-model free-tier
> RPM/TPM/RPD in the docs — the rate-limits page sends you to the **AI Studio dashboard** as the
> source of truth, and the numbers differ per model and change over time. Third-party sources even
> contradict each other (one claims "10M TPM free" for embeddings; another the 100/1K figures).
> This **vindicates the configurable-and-tracked governor (§3)**: hard-coding any quota would be
> wrong tomorrow. Ship the 100/30K/1K values as *defaults*, let the user correct them from the
> dashboard, and let the governor's own observed-429 feedback self-correct.

---

## 1. Model facts that drive the design

`gemini-embedding-2` (GA; preview alias `gemini-embedding-2-preview`) on
`generativelanguage.googleapis.com`, the existing `gemini` egress destination. The design is
model-agnostic behind the `EmbeddingClient` contract (§5) — `gemini-embedding-001` is the simplest
confirmed-free text-only fallback (2048-token cap, `task_type` instead of prompt instructions):

| Property | Value | Design consequence |
|---|---|---|
| Output dims | 3072 default; MRL-truncatable to 1536 / **768** / 256 (down to 128) | Store 768 — Google's recommended sweet spot; 3072 is 4× bytes for marginal recall |
| Truncation normalize | **auto-normalized** (unlike `-001`, which needs manual L2) | Truncated vectors are unit-norm → cheap, calibration-free int8 (§2.3) |
| Max input | **8192 tokens** / content | One ~320-token chunk is well within limit; headroom for larger chunks |
| `task_type` | **not used** by EM2 (instructions go in the prompt; `-001` *does* use `task_type`) | Abstract behind `EmbeddingClient.embed(texts, {profile})` (§5) |
| Multimodal | text / image / audio / video / PDF into one space (image/audio/video **paid**) | Future text+image only as a paid feature (§8.5) |
| Batch API (async) | file-based, 50% cost | **Verified paid-only** (Tier 1+; no free row) → set aside (§0). |
| `batchEmbedContents` (sync) | **≤100 contents** per HTTP request | Per-request quota counting **undocumented** → set aside until confirmed (§9). |

Spaces are **incompatible across models and dimensions** — changing either invalidates the whole
index (§8.2). Every stored vector is therefore stamped with `{model, dims, quant}`.

---

## 2. Requirement 1 — embedding size relative to text

Three independent levers, applied together. The goal: the index is meaningfully *smaller* than the
text it indexes.

### 2.1 Chunking (reuse existing extraction)

`cache_search_text` already holds `{href, title, text}[]` per book — extracted "for free" by the
unified import pipeline. Sub-chunk each section into **~320-token windows, ~15% overlap**, snapped
to sentence boundaries (reuse the TTS-prep sentence segmentation). Persist each chunk's **CFI
start/end** so a search hit maps to an exact jump-to location.

- Smaller chunks → sharper retrieval but more vectors (more storage *and* more requests — which,
  with batching off, means more precious RPD). 320 tokens balances precision against request count.
- **Staleness/invalidation (resolved — was §11.4):** `extractionVersion` is a single **book-level**
  counter that piggybacks on `TTS_EXTRACTION_VERSION` — not per-section content-addressed, and a bump
  re-extracts the whole corpus. **But both bumps in project history (v1→v2, v2→v3) changed sentence
  segmentation / CFI offsets, not the section *body text* the embedding consumes**
  (`chapter.textContent`). So a per-section content hash would have skipped **100% of re-embeds on
  every bump that has ever happened.** Contract: stamp each section with a `sectionTextHash` —
  `cheapHash(new TextEncoder().encode(section.text).buffer)` (`cheapHash` takes an **`ArrayBuffer`, not
  a string**), **computed in the app/import layer at extraction time** (where `cheapHash` already lives;
  the `domains/search/` chunker must not deep-import it across the domain barrier) — keyed by the
  **stable `href`** (already the section key); on a bump or re-ingest wave, re-embed **only** sections
  whose `{href, sectionTextHash}` changed. (Name avoids collision with the manifest-level `contentHash`,
  a SHA-256 of the whole EPUB.) Whole-book
  re-embed remains the automatic fallback if a genuinely global text change alters every hash — never
  worse than book-level. (Material because RPD is the binding constraint — §8.1.)

### 2.2 Dimensions (MRL)

Store **768** (config: 256 / 768 / 1536 / 3072). 768 is the recommended quality/size knee. The
*only* layout knob that should normally change is this number — precision stays int8 (§2.3).

### 2.3 Quantization — int8 scalar, per-vector scale

Store **int8**, not float32. The subtlety is *how the ranges are computed*, because Versicle
indexes incrementally with no calibration corpus:

- **Per-vector symmetric scale (chosen).** Quantize each vector independently:
  `scale = max(|v|) / 127`, `q[i] = round(v[i] / scale)`, store the `int8[]` plus one `float32`
  scale. No calibration set, no global-range drift, fully incremental. Cost: **+4 bytes/vector**.
  Near-lossless here *because EM2 auto-normalizes* — values sit in a narrow, well-behaved band, so
  per-vector scaling captures them faithfully.
- **Rejected — global per-dimension ranges (sbert default).** Marginally higher recall, but needs
  a representative corpus up front and forces re-quantization as the library grows. Wrong fit for
  on-device incremental indexing.
- **Rejected — binary (1-bit).** 32× smaller and Hamming-fast, but discards magnitude (raw recall
  ~85–92%); competitive only *with rescoring*, which requires *also* storing int8/float — i.e. more
  total bytes than int8 alone. Its payoff is scan speed at millions of vectors, which a personal
  library never reaches. If size dominates, **lower dims** (int8@256 keeps magnitude and beats raw
  binary on recall), don't drop precision.

Cosine at rest is an **integer dot product** (`int8·int8` accumulated in `int32`), with the two
per-vector scales applied once at the end. No float vectors stored, no dequant per comparison.

**Cons accepted:** int8 is lossy and one-way — it's the *single* stored copy, so full-precision
rerank later would require re-embedding (quota cost). Recall figures are benchmark-derived; spot-
check on real book queries (the worker cosine suite, §10, asserts int8 cosine ≈ reference float
within tolerance).

### 2.4 Size budget (≈130K-token novel, ~325 chunks; text corpus ≈585 KB)

| Layout | Bytes/chunk | Per book | vs text |
|---|---|---|---|
| float32 @ 3072 (naïve) | 12,288 | 3.9 MB | 680% ❌ |
| float32 @ 768 | 3,076 | 1.0 MB | 170% |
| **int8 @ 768 + scale (default)** | **772** | **~251 KB** | **~43%** ✅ |
| int8 @ 256 + scale | 260 | ~85 KB | ~14% (size-first) |

Persist as **one packed binary blob per section** (the int8 vectors) plus a parallel scale array —
*not* one IDB row per chunk — to avoid thousands of tiny rows. Lives in the regenerable CACHE
domain alongside `cache_search_text` and `cache_audio_blobs`. (Binary storage convention: §6.)

---

## 3. Requirement 4 (build first) — cross-provider quota governor

> The throttle is generalized to **all** GenAI, not just embeddings. It has standalone value before
> any search ships (it immediately protects the existing TOC / content-filter / table-adaptation
> Gemini calls and the TTS providers).

### 3.1 Placement — kernel math, app-injected persistence

The governor is a **kernel service that callers funnel *into*** (a downward dependency, exactly like
`egress`), **not** a layer "above" the clients. `GeminiClient`, the new `EmbeddingClient`, and the
TTS providers all import `@kernel/quota`. The ≥2-consumer kernel-admission bar is satisfied (GenAI +
TTS).

> [!IMPORTANT]
> **Kernel touches no storage.** `kernel-imports-nothing` is enforced at **error/0** — kernel may
> import only `~types` and external libs. So the governor keeps **only in-memory** sliding windows +
> the RPD counter, and persists RPD through an **injected port**, wired at the composition root —
> the exact inversion the gateway already uses for consent (`setConsentResolver(makeAiConsentResolver(...))`).
>
> ```ts
> // src/kernel/quota/QuotaGovernor.ts — pure math + an injected persistence seam
> interface QuotaStore { loadDailyUsage(): Promise<DailyUsage | null>; saveDailyUsage(u: DailyUsage): void; }
> let quotaStore: QuotaStore = inMemoryFallback;           // app/ overrides at boot
> export function setQuotaStore(s: QuotaStore) { quotaStore = s; }
> ```
> `app/google/wireGoogle.ts` calls `setQuotaStore(makeQuotaStore(quotaCounterRepo))`, backed by a
> **new `src/data/repos/quotaCounter.ts`** repo (the only thing that touches IDB). This also clears
> the docs-drift gate cleanly (§6.3): a new `src/kernel/quota/` dir + new repo must be
> registered in `registryDocs.ts`.

### 3.2 Enforcement — at the egress chokepoint, not a side-car

Versicle enforces all egress policy (host allow-list, offline, **consent**, timeout) at the single
`NetworkGateway.egress()` chokepoint *by design*; a governor a caller can forget to call is one
missing `acquire()` away from an un-throttled book-content egress. So:

- **Acquire/backpressure is a gateway concern.** Add an optional `rateLimit` policy to the `gemini`
  (and TTS) `EgressDestination` records, and have `egress()` apply admission/backpressure as an
  ordered pre-flight check — it already keeps per-destination counters. The *scheduler* is injected
  the way `setConsentResolver` is, so the kernel owns the **enforcement seam** and `app/` owns the
  **policy**. This makes throttling **unbypassable**, like consent.
- **Commit/reconcile stays a client step.** The gateway returns the raw `Response` and never parses
  the body, so the post-response `commit(actualTokens)` (from the API's `usageMetadata`) is done by
  the client after it reads the response — documented, not enforced.

### 3.3 Mechanics

1. **Three windows per lane:** sliding-60s buckets for **RPM** and **TPM**, plus the **persisted
   daily counter** (RPD) that resets at **midnight Pacific** (persisted via the §3.1 port so it
   survives reload). With batching off, daily pacing is the core embedding throttle (§8.1).
2. **Priority:** `fg` leases preempt `bg`; `bg` is capped to a configurable fraction of each window
   and must leave headroom for the foreground book.
3. **Config read fresh per `acquire`** (never snapshot at construction) — mirrors `GeminiClient`
   reading `GenAIConfig` per call (the GG-8 cached-config invariant). A settings edit to per-lane
   limits then takes effect on the very next `acquire`. The governor may hold *usage counters* as
   state, but **never caches its limits**.
4. **Typed failures (no string-sniffing).** Governor/embedding errors surface as **typed errors with
   a `status`/`retryable` discriminant**. Network 429s reuse `isResourceExhausted` (`genai/errors.ts`,
   keyed to `GenAIHttpError.status === 429`). But governor **backpressure** (RPD-exhausted /
   cross-device-budget / cooldown-active) is refused **before any network call**, so
   `isResourceExhausted` does *not* match it — it therefore needs its **own committed append-only
   code** (not optional): add **`NET_RATE_LIMITED`** (kernel/net layer, since enforcement is at the
   gateway — §3.2) as an `AppError` subclass with `retryable: true` + `retryAfterMs`. Meters and
   graceful-degradation branch on type/`code`, never message substrings. A typed `status`-bearing
   error alone is insufficient for the pre-network case — hence the mandatory code.

### 3.4 Multi-device shared quota (the per-project ceiling)

> [!IMPORTANT]
> The free-tier ceiling is **per-API-key / per-Google-Cloud-project, not per device.** Versicle is
> BYO-key and explicitly multi-device (synced device mesh, heartbeat). If three installs each
> believe they own ~1,000 RPD, they collectively issue ~3,000 and hit exactly the 429s the governor
> exists to prevent — and IDB is device-local/unsynced, so naïve per-device counting cannot see the
> others.

Reconcile against the **existing synced device mesh** (`useDeviceStore`, a synced Yjs CRDT store with
per-device `DeviceInfo` records + `lastActive` heartbeats). **Resolved (was §11.1) — a hybrid that
separates interactive from background traffic:**

1. **Interactive embeds are never rate-divided.** Foreground reading embeds and query embeds draw on
   the full `projectRPD` and keep first claim (§8.1 now holds across the mesh, not just within one
   device) — they're low-volume and latency-sensitive.
2. **Background backfill runs only on *heartbeat-active* devices** — a coarse filter (`Date.now() -
   device.lastActive < 10 min`, the recency window the device UI already uses) that drops idle/closed
   siblings. It is **not** single-runner election: when more than one device is active the filter
   admits *all* of them, so the real cross-device over-spend guard is the synced `embedSpend` sum +
   429-backoff (below), **not** this gate. The *signal* exists and is readable, but **the gating
   behavior is net-new** — today every device runs every background task with no cross-device gating
   (`backgroundTasks.ts`), so adding this filter is new code with its own test (§9 step 5), not reuse
   of an existing pattern. No leader-election / lease primitive exists, and the hybrid needs none.
3. **Each device publishes its rolling daily spend** as an **additive nested field** on its existing
   synced `DeviceInfo` record — `embedSpend: { day: <PT date>, rpd: number, tpm?: number }`. The
   governor (via its app-injected `QuotaStore` wiring, **not** kernel — §3.1) reads `useDeviceStore`,
   sums `embedSpend.rpd` over devices that are heartbeat-active **and** stamped with today's PT date,
   and computes `remaining = projectRPD − Σ(spend)`; it self-throttles before issuing.

**429-backoff (§3.3) is the convergence safety net** for CRDT/heartbeat lag — a bounded transient
double-spend near the ceiling is exactly what it absorbs (not the primary mechanism).

> [!NOTE]
> **Bump-free (honors §6.2 "CRDT v9 is terminal").** `embedSpend` needs **no schema bump and no new
> synced store** because (a) it is nested *below* the `devices` synced key and `syncedKeys` is
> root-only (threaded as `undefined` into the recursion — `patching.ts`), so it is never gated; and
> (b) it ships without touching the global `CURRENT_SCHEMA_VERSION`, so it cannot trip the
> `__schemaVersion` quarantine.
>
> **Hard prerequisite (not just a footgun — the v8 lesson).** `registerCurrentDevice` runs every boot
> and *rebuilds* the device record from a fresh literal (it does **not** `...existing`-spread), which
> traces to a `DELETE embedSpend` on the device's own synced map — i.e. it **will wipe this device's
> spend every boot** unless patched first. So shipping `embedSpend` is gated on: (i) `registerCurrentDevice`
> carrying `embedSpend` forward, (ii) the spend writer using an immutable `...existing` spread (as
> `touchDevice`/`renameDevice` already do), and (iii) a regression test asserting `embedSpend` survives
> a `registerCurrentDevice` call. Each device writes only its *own* record, so there is no
> cross-device clobbering — only this self-clobber.
>
> **Rejected:** divide-the-budget (wastes the binding RPD — the reading device gets `projectRPD/N`
> while idle siblings spend nothing) and elect-a-lead (needs an election/lease/failover surface that
> doesn't exist and that existing background tasks deliberately avoid).

### 3.5 Observability

`snapshot(): Record<lane, LaneUsage>` is exposed through `useGenAIStore` (mirroring the existing
GenAI activity-log selector). `LaneUsage` is the **single shared shape** consumed by both the
governor and the settings meters, so a meter can't drift from the counter (§7).

### 3.6 What is reused vs net-new (so reviewers can tell)

- **Reused, already tested — rotation stays in `GeminiClient` (OPEN DECISION 2, decided).**
  Model-rotation-on-429 stays in `GeminiClient.executeWithRetry`; the governor **never** owns
  rotation. Why: (a) rotation is text-generation-only — it shuffles `gemini-2.5-flash-lite ↔
  gemini-2.5-flash` (`GENAI_ROTATION_MODELS`) and is reached only by `generateText`/`generateStructured`;
  (b) **embeddings must not rotate** (EM2 vs `-001` are incompatible spaces, §1; no embedding-lite
  variant), so keeping rotation here makes the no-rotate guarantee *structural*, not a fragile governor
  carve-out; (c) TTS providers don't rotate at all. The governor (in `kernel/quota/` under
  `kernel-imports-nothing`) couldn't import the rotation model-list anyway. **Zero test churn** — the
  six existing rotation regression tests stay valid.
- **Net-new (no equivalent today):** the RPM/TPM token buckets, jittered exponential backoff, and
  `Retry-After` honoring. These get their own tests (§10).

> On a 429, two layers act on *different* concerns: `GeminiClient` performs its intra-request model
> swap (text-gen only) while the governor records the 429 to drive cooldown/backoff/`Retry-After`
> across all clients. Orthogonal, both intended — not duplication.

---

## 4. Requirements 2 & 3 — foreground vs background indexing

One `EmbeddingIndexer` (`src/domains/search/`), two priority lanes, throttled at the gateway (§3.2).

```
              app/ wires ports ▼ (no store/ or sibling-domain import inside the domain)
                       ┌── reader controller → searchSession.enqueueEmbedding(bookId, currentCfi)  [FG]
EmbeddingIndexer ──────┤
                       └── injected LibraryBacklogSource (idle backfill, gated by §8.4 opt-in)      [BG]
        │
        ├─ chunk            (main thread — from cache_search_text via repo, §2.1)
        ├─ embed            (injected EmbeddingClient port; egress throttled + consent-gated)
        ├─ quantize int8    (worker — pure compute, §2.3)
        └─ persist          (embeddings repo, packed blob)
```

### 4.1 Boundary seams (this is where v1 was under-specified)

A `src/domains/search` module **may not import `store/`** (`domains-no-store`, error/0; sole
carve-out is `store/yjs-provider.ts`) and **may not deep-import a sibling domain** (cross-domain
only via the published `index.ts` barrel). So:

- **FG trigger** flows from the **app-layer reader controller**, which reads the current book/CFI
  from the store and calls `searchSession.enqueueEmbedding(bookId, currentCfi)` — `bookId`/CFI are
  **passed as arguments**, never read from a store *inside* the domain (exactly like `index(bookId,…)`
  today).
- **BG backfill** takes a new **app-injected `LibraryBacklogSource` port** (loaded book ids +
  last-read ordering), analogous to the existing injected `SearchTextSource`/`engineFactory` on
  `SearchSession`. The app layer wires it from the store; the domain stays store-free.
- **Embedding client** is an **injected `EmbeddingClient` port** wired from the `@domains/google`
  barrel (`getEmbeddingClient` / `makeLazyEmbeddingClient` — §5/§6), so `search/` carries **no
  concrete `google/` dependency** and the GenAI impl stays out of the entry chunk.

### 4.2 Foreground (book being read)

On reading-session open, enqueue at high priority and order chunks **outward from the current CFI** —
embed where the reader *is* first, so search works for the current chapter within a minute (a ~20–40
chunk chapter is well inside the daily budget), then fan out. **Resumable:** persist per-section
"embedded through chunk N @ extractionVersion"; an interrupted session resumes instead of restarting.

### 4.3 Background (loaded-but-unread books)

Runs only when (i) the user has enabled the explicit library-wide opt-in (§8.4), (ii) the FG queue
is empty, and (iii) the app is idle (`requestIdleCallback`), consuming **leftover daily budget**
under the governor's bg cap and the device-mesh reconciliation (§3.4). With batching off this is a
**multi-day trickle** for a large library — acceptable for "low priority," and it always yields to a
newly-opened book (FG preempts BG mid-flight). **Every background egress passes
`consent: { bookId, interactive: false }`** — the `interactive: true` bypass is reserved strictly
for foreground calls a real user gesture drove (§8.4).

### 4.4 Worker boundary

The **worker** does int8 quantization and cosine over **transferred typed arrays** (pure compute);
**all IDB I/O (corpus reads, vector persistence) happens on the main thread** via `data/` repos and
crosses to the worker as Comlink transferables. All new worker-side types are imported `import type`
only, with zero edge to `store`/`zustand`/`yjs`. The structural guard for the **search** worker is
the `worker-no-state-typegraph` depcruise ratchet (warn, baseline **16**) — note `check:worker-chunk`
is **TTS-only** today (`WORKER_ENTRY_RE = /^tts\.worker/`) and does *not* cover the search worker, so
"keep `worker-no-state-typegraph` ≤ 16" is the real acceptance criterion (optionally extend the
chunk check's regex to the search worker for an emitted-artifact gate — §9).

---

## 5. Search path (hybrid) + the EmbeddingClient capability

### 5.1 EmbeddingClient — the four-part GenAI pattern

Adding a GenAI capability is a fixed pattern in this codebase; v1's bare class skipped it. Mirror
`GeminiClient` exactly:

1. **Contract** — `domains/google/genai/embedding/contract.ts`: `EmbeddingClient` interface with
   `embed(texts, { profile })`, `isConfigured()`, and a per-call config provider (no mutable
   singletons; config read per call).
2. **Impl** — `GeminiEmbeddingClient.ts` + `MockEmbeddingClient.ts` (the test seam).
3. **Holder** — `embedding/holder.ts` with `get/setEmbeddingClient` and an inline **NOT-CONFIGURED**
   default whose `isConfigured() === false` (throws a typed `GENAI_*`/`status` error if called).
4. **Wire** — `app/google/wireGoogle.ts` installs it (config from `useGenAIStore`, redacted `onLog`);
   `src/domains/google/index.ts` exports only `getEmbeddingClient` + `makeLazyEmbeddingClient` (the
   **lazy facade**, never the impl — static re-export would drag GenAI into the entry chunk, which
   `check-worker-chunk.mjs` check 4 forbids).

The impl threads consent and redacts its own logs (it does *not* inherit `GeminiClient`'s for free —
§8.4): every embed call passes `consent: { bookId, interactive }` into `egress('gemini')` and runs
`redactPayload` before the ring-buffer sink.

### 5.2 Query path

- **Query:** embed once with the *query* profile, **cache it** — repeated queries must not burn the
  shared daily budget (§8.1). One tiny request, threaded with the reading-session `bookId`.
- **Rank:** int8 cosine in `search.worker.ts` over the book's packed vectors; map top hits back to
  CFI for jump-to-location.
- **Hybrid fusion:** combine semantic scores with the existing regex `SearchEngine` via
  reciprocal-rank fusion — keeps exact-match wins (names, quotes) while adding "find the passage
  about X."
- **Default, not just fallback:** when semantic search is off / unconfigured / quota-exhausted /
  the book isn't embedded yet, **regex full-text is the default path** (graceful, and the privacy
  default — §8.4). Extending `SearchSession` with the semantic path must **preserve the
  `SearchEngineFactory` in-process test seam** (real worker in prod, in-process in tests).
- **Profile abstraction:** EM2 has no `task_type`; `-001` does. The contract's `{ profile:
  'document' | 'query' }` either sets `task_type` (`-001`) or prepends the instruction (EM2).
  **Doc and query must use matching profiles** (asserted in the client suite, §10).

---

## 6. Data model & code layout

All embedding artifacts are **regenerable CACHE** — never synced, evictable under storage pressure
(joins the LRU story with `cache_audio_blobs`; recently-read books are stickiest).

| Concern | Location | Notes |
|---|---|---|
| Quota math | `src/kernel/quota/` (new) | in-memory windows; **no IDB** — persistence via injected `QuotaStore` (§3.1) |
| Quota persistence | `src/data/repos/quotaCounter.ts` (new) | the only IDB touch; wired into the governor by `app/` |
| Embedding capability | `src/domains/google/genai/embedding/` (contract/impl/holder) + barrel export | four-part pattern (§5.1); lazy facade only in `index.ts` |
| Worker quantize + cosine | extend `src/workers/search.worker.ts` | pure compute over transferables; `worker-no-state-typegraph` ≤ 16 |
| Vector store | `cache_embeddings` (new CACHE store) | packed blob + scales per section; stamped `{model, dims, quant, extractionVersion}` |
| Job state | `cache_embed_jobs` (new CACHE store) | resumable per-section progress |
| Repo | `src/data/repos/embeddings.ts` | mirrors `searchText.ts`; `delete(bookId)` wired into `bookContent.deleteBook`'s gated txn |
| Indexer | `src/domains/search/EmbeddingIndexer.ts` | injected ports only (§4.1); no store/sibling-domain import |
| Background hook | `src/app/boot/backgroundTasks.ts` (the `backgroundTasks` boot phase) | BG backfill registration (gated by §8.4 opt-in) |
| Reading-session hook | `src/domains/search/SearchSession.ts` | FG enqueue + semantic ranking (preserve factory seam) |
| Config + meters | `useGenAIStore` + existing `genai` settings tab | dims, limits, opt-ins, `snapshot()`-fed meters |

### 6.1 Adding the CACHE stores — the full data-layer checklist

v1 gave a TS type only; the `rows/` directory exists precisely to enforce more than that. Per the
`searchText` reference:

1. **Zod row** in `rows/cache.ts` (`z.looseObject`), plus the compile-time `_EmbeddingsSchemaMatches`
   drift guard in the `_schemaChecks` tuple.
2. **Store creation** added to `EpubLibraryDB` + `ensureBaselineStores`.
3. **Append-only migration step** guarded by a `contains()` check (the `migrateToV26` pattern), in
   its **own additive bump** — see §6.2.
4. **`migrations.test.ts`** captured-fixture extension (additive store creation) + add the new stores
   to `CURRENT_STORE_SET`.
5. **Deletion wiring:** `embeddings.delete(bookId)` invoked from `bookContent.deleteBook`'s gated
   transaction so vectors don't leak when a book is removed.

**Binary storage:** persist the int8 vectors and scales as **`ArrayBuffer`** validated by a
`z.custom<ArrayBuffer>` guard (re-wrap as `Int8Array`/`Float32Array` on read) — the dominant blob
convention. (A typed-array *view* also round-trips through structured clone — the `checkpoints` store
already persists a raw `Uint8Array` via `z.custom` — so this is convention, not a correctness risk;
v1's "WebKit corruption" framing was overstated and is dropped.)

```ts
type CacheEmbeddingsRow = {
  bookId: string;
  model: string;            // 'gemini-embedding-2' (GA)
  dims: number;             // 768
  quant: 'int8-pervec';
  extractionVersion: number;
  sections: {
    href: string;           // stable key (not positional) — see §2.1
    sectionTextHash: string; // cheapHash(TextEncoder.encode(section.text).buffer), computed at import time — re-embed only when it changes (§2.1, §11)
    chunks: { cfiStart: string; cfiEnd: string; tokenCount: number }[];
    vectors: ArrayBuffer;   // packed int8: chunks.length * dims, row-major
    scales: ArrayBuffer;    // packed float32: length = chunks.length
  }[];
};
```

### 6.2 Format-change governance (don't fold into v27)

v27 is reserved for **retiring old surface** (the `sync_log` drop + the SW legacy-cover fallback),
not adding new stores. The two embedding stores are purely additive/rebuildable, so they get their
**own** additive append-only `MIGRATIONS` step (the next free slot **after** v27's cleanup ships),
guarded by `contains()`. Sequenced per **rule 4** (never more than one format change in flight):
v27's retirements ship and their straggler path is verified — and **CRDT v9 (declared terminal)** is
confirmed not to need a new synced store for any of this (embeddings are device-local CACHE; the only
cross-device state, quota usage, rides the *existing* synced device mesh, §3.4) — **before** the
embedding-store bump lands.

### 6.3 Docs-drift obligation

`docs.test.ts` asserts set-equality between `KERNEL_MODULES`/`DATA_REPOS` in `registryDocs.ts` and
disk on every `npm test`. The new `src/kernel/quota/` dir and the new `quotaCounter.ts` +
`embeddings.ts` repos **must** be registered there, then `npm run docs:generate` run and the
regenerated `architecture.md` + kernel/data READMEs committed in the **same PR**. (New files *inside*
the existing `src/domains/search/` dir do **not** trip the gate.)

---

## 7. Config & observability surface

Extend `useGenAIStore` (persisted allowlist) + the **existing `genai` settings tab** (do **not**
register a new `search` tab):

- **Semantic search:** on/off (default **off** — privacy default); embedding model; `dims`
  (256/768/1536/3072).
- **Background pre-embedding:** the default-**OFF** library-wide opt-in that gates the BG lane (§8.4),
  with disclosure copy (§8.4).
- **Quota governor:** editable per-lane limits (defaults `gemini` = 100 RPM / 30K TPM / 1K RPD);
  background-throttle %, foreground headroom; multi-device strategy (§3.4); master "pause all GenAI".
- **Live meters:** RPM / TPM / RPD used-vs-limit bars per lane, today's spend, and ETAs — fed by
  `governor.snapshot()` through the store, typed by the shared `LaneUsage` shape (§3.5). The
  **project-wide** total sums the synced `embedSpend` across active devices (§3.4), so the meter shows
  shared-quota reality, not just this device.
- **A11y:** new controls keep the `app/settings/` directory at **zero `jsx-a11y` warnings**
  (error-level there). Inline prose is allowed in panels per ADR-0001.

---

## 8. Failure modes, migration, privacy

### 8.1 Throughput reality (batching off)

One `embedContent` per chunk. Against the *assumed* free limits (100 RPM / 30K TPM / 1K RPD —
dashboard-dependent, §0.1, **per-project** §3.4), at ~320 tokens/chunk the **per-minute** ceiling is
whichever of TPM (~93/min) or RPM (100/min) you hit first (≈90–100 chunks/min), and the **per-day**
ceiling is **RPD (~1,000 chunks/day ≈ 3 novels) for the whole project across all the user's
devices**. So: daily budget caps the *total*, RPM/TPM cap the *burst* rate — the daily budget can be
spent in ~10 min, then exhausts until midnight PT. Query embeddings draw on the **same** budget →
**query caching is budget protection, not polish.** Foreground gets first claim; unread books trickle
over days. (If EM2's real free RPD differs from `-001`'s 1,000, the governor adapts — the *shape* of
the conclusion holds, not the exact number.)

### 8.2 Model / dimension migration

Spaces are incompatible across `{model, dims}`. A stamp mismatch on read **invalidates and
re-embeds**; never convert vectors. (Re-embedding is quota-gated, so an upgrade is a background,
multi-day event — surface it in the meters.)

### 8.3 Eviction

`cache_embeddings` participates in CACHE LRU pressure; recently-read books' vectors evict last.
Re-derivable from `cache_search_text` + the API at any time. Deletion is also wired into
`bookContent.deleteBook` (§6.1).

### 8.4 Consent model for embedding (rewritten — the big privacy fix)

The `gemini` destination is `data-class: book-content`, `consent: per-book`. The resolver
**default-denies** a per-book call with no consent bit; the **only** grant affordance today is the
TTS-play prompt (`aiConsentPrompt`), which fires when a user plays a book — **never for an unopened
book**. So v1's plan to background-embed unread books "under the existing per-book consent" is
**dead on arrival**: the entire target population is blocked. Three distinct egress kinds, each with
its own gate:

| Egress kind | When | Consent gate |
|---|---|---|
| **Foreground, opened book** | user is reading it | existing per-book consent (the TTS-play prompt path); `interactive: true` on a real gesture |
| **Background, unread library** | idle backfill | a **NEW default-OFF library-wide opt-in** ("Pre-embed my library for semantic search", §7), **wired into the consent resolver** (§8.4.1): when on, the resolver grants background (`bookId`-carrying, `interactive: false`) calls. Until on, the BG lane is inert *and* the resolver default-denies. The per-book bit independently grants foreground |
| **Query embedding** | user runs a search | gated by the semantic-search opt-in; user intent leaving the device — disclose in the panel; threads `bookId` |

> [!IMPORTANT]
> - **Books are never background-embedded merely by being in the library.** The BG lane is inert until
>   the explicit library-wide opt-in is on; turning it on **is** the consent the resolver honors for
>   background calls (§8.4.1). A per-book `aiConsent` bit independently grants foreground.
> - **Never set `interactive: true` to bypass the gate** from a `requestIdleCallback`-driven call.
>   A regression test asserts `NET_CONSENT_REQUIRED` for a background book when the opt-in is **off**.
> - **New disclosure copy required.** The existing TTS consent copy ("short excerpts to improve
>   audio narration") does **not** cover bulk full-text embedding or sending search terms to Google —
>   write new copy that says what leaves the device and when.
> - **Local-only is the default.** With semantic search off, regex full-text is the search path and
>   nothing leaves the device.

#### 8.4.1 Wiring the opt-in into the resolver (closes the grant path)

The library-wide opt-in must feed the consent **resolver**, not just gate the lane — otherwise every
unopened book still hits the resolver's per-book default-deny (`aiConsent.ts`) and background embedding
has **no path to ever be granted** (the original priv-1 dead-end). Add the opt-in as a new
`AiConsentDeps` input: the resolver treats a **background, `bookId`-carrying, `interactive: false`**
call as **granted when the opt-in is on** (the opt-in itself is the user's consent for bulk
embedding), while foreground calls keep using the per-book bit. That is the end-to-end grant path —
without it, the §8.4 redesign blocks its own target population.

### 8.5 Multimodal (future, paid)

EM2 maps images into the *same* space — a follow-on for "search by illustration." Note image/audio/
video inputs are **paid even on the free tier** (§0.1), so this is a paid feature, not a free one.
No schema change beyond a `modality` tag per chunk.

---

## 9. Build order (with per-step gates)

1. **Quota governor** (kernel math + injected `QuotaStore` port + `quotaCounter` repo + gateway
   `rateLimit` enforcement) + retrofit `GeminiClient`/TTS + meters. *Standalone value before search.*
   → **gates:** `QuotaGovernor` behavioral spec (§10); register kernel dir + repo in `registryDocs.ts`
   and `docs:generate` (§6.3); coverage ≥ baseline.
2. **CACHE stores + repo** (`cache_embeddings`, `cache_embed_jobs`) per the §6.1 checklist, in their
   **own additive bump after v27** (§6.2) + worker quantize/cosine.
   → **gates:** zod row + drift guard; `migrations.test.ts` fixture + `CURRENT_STORE_SET`; worker
   cosine/quantization unit suite; `worker-no-state-typegraph` ≤ 16.
3. **EmbeddingClient** (four-part, §5.1) + **foreground** indexer wired via app-injected ports (§4.1),
   CFI-outward, resumable.
   → **gates:** `EmbeddingClient` suite + `MockEmbeddingClient` (egress routing, profile mapping,
   consent threading, redaction); barrel export only of the lazy facade.
4. **Hybrid query path** in `SearchSession` (RRF fusion + query cache), preserving the factory seam.
   → **gates:** semantic-path test through the in-process seam; regex-is-default-when-off test.
5. **Background backfill** (idle, leftover-budget trickle) registered in the `backgroundTasks` boot
   phase, **gated by the §8.4 opt-in**, reconciled across the device mesh (§3.4). The active-device
   filter is **net-new** behavior (no existing background task gates on device-mesh state).
   → **gates:** regression test — background never bypasses consent (`NET_CONSENT_REQUIRED`); test the
   active-device filter; test `embedSpend` survives `registerCurrentDevice` (§3.4).
6. **Config polish, migration stamps, eviction wiring** (incl. `deleteBook` deletion hook).

**#1 future optimization — gated behind a probe, not assumed.** The synchronous `batchEmbedContents`
(≠ async Batch API; **≤100 contents/call**) *may* count as **one** request, but this is **unconfirmed
by docs and community**, so resolve it empirically before adopting (probe in §11). The swap is a
`useBatchEmbedding` flag on `GenAIConfig` whose swap-point is the already-injected
`EmbeddingClient.embed(texts, {profile})` port: `false` → fan out N×`embedContent` (default, proven);
`true` → pack ≤100 texts into one `batchEmbedContents` `requests[]` call. The governor's commit/
reconcile (§3.2) then debits RPD by **1** (flag on) vs **N** (off). If the probe shows per-call
counting, packing ~100 chunks/request lifts the binding constraint off RPD onto TPM (~93 contents/min
becomes the new ceiling) — a ~50–100× indexing unlock with no other architectural change. Adopt for
RPD relief **only** if the probe confirms per-call counting. (Async Batch API stays out of scope:
verified paid-only, §0.1.)

---

## 10. Contract & test plan

Per the "one behavioral spec, N implementations" convention (every C-row names a `pinnedBy` suite),
co-located:

1. **`QuotaGovernor` behavioral spec** — sliding-window RPM/TPM; persisted-RPD reset at midnight PT
   via an injected `QuotaStore` double; fg-preempts-bg; estimate→commit reconcile; cooldown-on-429;
   limits read fresh per `acquire` (GG-8).
2. **`EmbeddingClient` suite** mirroring `GeminiClient.test.ts` + a `MockEmbeddingClient` — egress
   routing, `profile`→`task_type`/instruction mapping for EM2 vs `-001`, the matching doc/query
   profile invariant, consent threading, redacted logging.
3. **`repos/embeddings.test.ts`** on the data harness — round-trip of packed blobs, `delete(bookId)`,
   stamp-mismatch invalidation.
4. **Worker cosine/quantization unit suite** — int8 dot-product ≈ reference float cosine within
   recall tolerance; quantize/dequantize round-trip.
5. **Regression tests** — background embedding never bypasses consent (H5); embedding egress carries
   a `bookId` + emits a redacted log entry (H6).
6. **Migration + coverage** — `migrations.test.ts` captured-fixture extension; totals ≥
   `coverage-baseline.json` (the governor/client/indexer/worker/**settings panel** are the bulk of new
   untested code).
7. **Settings-panel / meters test** — `renderWithStores` asserting the meter bars + ETA derive from a
   *seeded* `governor.snapshot()` (proves displayed numbers reflect real counter state, not fabricated
   values — closes the §3.5/§7 "meter can't drift" guarantee with an executable check, not just the
   shared-type).

If a new contract row (e.g. `C13` for the embedding/quota seam) is declared, name each suite as its
`pinnedBy`.

---

## 11. Decisions resolved (was: open decisions)

Three of four are **resolved in-doc**, grounded in the codebase via a verified investigation; one
remains a *bounded* deferral (an empirical probe with a hard decision rule — the chosen default ships
regardless).

- **1. Multi-device quota strategy (§3.4): RESOLVED — hybrid.** Interactive embeds (foreground +
  query) are not rate-divided; background backfill runs only on heartbeat-active devices (a coarse
  filter, **not** single-runner election — the synced-spend sum + 429-backoff is the over-spend guard);
  each device publishes rolling daily spend into the existing synced `DeviceInfo` record (additive
  nested field, no CRDT format change) so any device computes `remaining = projectRPD − Σ(active
  spend)`. Chosen over divide-the-budget (wastes the binding RPD on idle devices) and elect-a-lead
  (needs an election/lease primitive that doesn't exist). Net-new: the active-device gate + the
  `registerCurrentDevice` `embedSpend`-carry-forward fix (§3.4).
- **2. 429 rotation home (§3.6): RESOLVED — keep in `GeminiClient`.** Governor owns only
  rate-buckets/backoff/cooldown/`Retry-After`, fed by typed 429s from all clients. Embeddings must not
  rotate (would corrupt the index); TTS doesn't rotate. Zero test churn.
- **4. Re-embed granularity (§2.1): RESOLVED — per-section content hash keyed by stable `href`.** Both
  historical `extractionVersion` bumps were segmenter/CFI changes that left section body text
  untouched, so a hash saves ~100% of re-embeds in every observed case; whole-book re-embed is the
  graceful fallback.

**Still open (bounded):**

- **3. `batchEmbedContents` counting (§9): one-off empirical probe.** The 1-vs-N request-counting rule
  is unconfirmed in all sources. **Probe** (real free-tier key, default project): (a) calibrate — send
  5 single `embedContent` calls, confirm the daily REQUEST counter rises by 5 (AI Studio embedding
  counters are known to lag/under-report); (b) POST one `batchEmbedContents` with 50 distinct contents,
  confirm HTTP 200 + 50 vectors; (c) re-read the counter. **Rule:** delta == 1 → `useBatchEmbedding =
  true` (~50–100× RPD unlock); delta ≈ 50 → keep `false`. Ambiguous / dashboard-zero → behavioral
  fallback: loop 50-content batches to the first 429 (~1000 successful calls ⇒ per-call; ~20 ⇒
  per-item). Record result + date + model id in §0.

---

## Verdict (from the verified critique loop)

The design is **fundamentally sound in its core technical bets** — int8@768 quantization, chunk
reuse, hybrid RRF fusion, a generalized quota governor, and the worker/main split are well-reasoned
and verified against primary sources. The v2 revision **reworked four load-bearing items** the
critique flagged: the kernel governor's IDB persistence (→ injected port), throttle placement (→
gateway-enforced), the per-project multi-device quota (→ device-mesh reconciliation), and the
consent model for background indexing (→ explicit default-OFF opt-in; v1's plan was blocked by the
consent gate). The four §11 decisions are resolved bar **one bounded empirical probe** (the
`batchEmbedContents` counting question, §11.3) whose default ships either way. The convergence pass
(v3.1) re-verified the 19 criticals/highs — **16 resolved, 3 partials since closed, 0 unresolved, 0
regressed** — and its sweep caught two regressions the resolution edits had introduced (a `cheapHash`
type misuse and a "single active device" overstatement), now fixed. **The loop has converged: GO** —
the remaining work is implementation, not redesign.

---

## Sources (verified 2026-06-13)

**Official (primary):**
- Embeddings docs (dims, task_type, normalize, token limits) — <https://ai.google.dev/gemini-api/docs/embeddings>
- Model page `gemini-embedding-2-preview` (id, 8192 tokens, status) — <https://ai.google.dev/gemini-api/docs/models/gemini-embedding-2-preview>
- Pricing (text "Free of charge"; EM2 $0.20/1M, `-001` $0.15/1M; multimodal paid) — <https://ai.google.dev/gemini-api/docs/pricing>
- Rate limits (defers to AI Studio dashboard; Batch API enqueued-tokens Tier 1+ only) — <https://ai.google.dev/gemini-api/docs/rate-limits>
- GA announcement — <https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-embedding-2-generally-available/>
- Preview announcement — <https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-embedding-2/>

**Secondary / community:**
- LiteLLM GA (model id `gemini/gemini-embedding-2`) — <https://docs.litellm.ai/blog/gemini_embedding_2_ga>
- `batchEmbedContents` ≤100 contents/request — <https://github.com/langchain-ai/langchainjs/issues/4491>
- "What you need to know about the Gemini Embedding 2 model" — <https://medium.com/google-cloud/what-you-need-to-know-about-the-gemini-embedding-2-model-c7721a89a067>
- Embedding quantization (int8 / binary / rescoring) — <https://www.sbert.net/examples/sentence_transformer/applications/embedding-quantization/README.html>

**Codebase yardstick:** the v2 refinements were verified against versicle's own docs — the
dependency-cruiser rules (`kernel-imports-nothing`, `data-no-upward`, `domains-no-store`,
`worker-no-state-typegraph`), the consent-resolver inversion (`NetworkGateway` + `wireGoogle.ts`),
the GenAI four-part pattern (`GeminiClient`/holder/barrel), the data-layer pattern (`rows/`,
`migrations.test.ts`, `registryDocs.ts`/`docs.test.ts`), and the format-change governance in
`plan/overhaul/README.md`.
