# Semantic Search — Task Breakdown

Companion to [semantic-search-design.md](semantic-search-design.md) (v3.1, loop-converged GO).
Dependency-ordered phases; each task carries its **gates** (the tests/ratchets/docs that must be
green before it merges) and the design section it implements. Format-change rule 4 is respected:
the one IDB bump (Phase B) lands *after* the reserved v27 cleanup ships.

Legend: **▸ depends on** · 🧪 test gate · 📐 ratchet/docs gate · §ref → design section.

---

## Phase A — Quota governor (foundation; standalone value before any search)

Ships value immediately by protecting the *existing* Gemini (TOC / content-filter / table) and TTS
calls. Nothing else in this plan should issue GenAI traffic until A is in place.

- **A1 — `QuotaGovernor` (kernel math).** `src/kernel/quota/`: in-memory sliding RPM/TPM windows +
  daily counter; `acquire`/`commit`/`cooldown`/`snapshot`; **limits read fresh per `acquire`** (GG-8,
  no cached config); fg-preempts-bg. Persistence behind an injected `QuotaStore` port. §3.1, §3.3
  🧪 QuotaGovernor behavioral spec (windows, midnight-PT reset via a `QuotaStore` double, preemption,
  estimate→commit, cooldown-on-429). 📐 register `src/kernel/quota/` in `KERNEL_MODULES`.
- **A2 — `quotaCounter` repo + wiring.** `src/data/repos/quotaCounter.ts` (the only IDB touch);
  `app/google/wireGoogle.ts` calls `setQuotaStore(makeQuotaStore(repo))`. §3.1
  ▸ A1. 📐 register repo in `DATA_REPOS`; `npm run docs:generate` + commit regenerated docs.
- **A3 — `NET_RATE_LIMITED` typed error.** Append-only `AppError` subclass (kernel/net) with
  `retryable: true` + `retryAfterMs` for **pre-network** governor backpressure (distinct from the
  network-429 `isResourceExhausted`). §3.3 item 4
  ▸ A1. 🧪 unit: backpressure throws `NET_RATE_LIMITED`, meters/degradation branch on `code`.
- **A4 — Gateway enforcement.** Add a `rateLimit` policy to the `gemini` (+ TTS) `EgressDestination`;
  `NetworkGateway.egress()` applies admission/backpressure via an injected scheduler (the
  `setConsentResolver` pattern) so throttling is **unbypassable**. §3.2
  ▸ A1, A3. 🧪 egress applies backpressure; `commit()` reconciliation is a client step.
- **A5 — Retrofit existing clients.** `GeminiClient` + TTS providers call `acquire`/`commit`.
  **Rotation stays in `GeminiClient.executeWithRetry`** (decision §3.6); governor only does
  rate/backoff/cooldown. §3.6
  ▸ A4. 🧪 the 6 existing rotation regression tests stay green (zero churn).
- **A6 — Multi-device reconciliation.** Additive nested `embedSpend` on the synced `DeviceInfo`;
  **fix `registerCurrentDevice` to carry `embedSpend` forward** (else self-clobber every boot);
  governor sums `embedSpend.rpd` over heartbeat-active + today-PT devices. §3.4
  ▸ A1. 🧪 regression: `embedSpend` survives a `registerCurrentDevice` call; cross-device sum math.
  📐 no CRDT bump (additive nested field — verify against the middleware whitelist semantics).
- **A7 — Config + meters.** Per-lane limits (defaults 100/30K/1K), bg-throttle %, "pause all GenAI";
  meters fed by `governor.snapshot()` through `useGenAIStore`, typed by the shared `LaneUsage`. §7, §3.5
  ▸ A1, A6. 🧪 `renderWithStores` meter test: bars/ETA derive from a **seeded** snapshot (incl. the
  project-wide cross-device sum). 📐 settings dir stays at 0 `jsx-a11y` warnings; reuse `genai` tab.

---

## Phase B — Vector store + worker (data + compute)

- **B1 — CACHE stores + migration.** `cache_embeddings` + `cache_embed_jobs`: `z.looseObject` rows in
  `rows/cache.ts` + `_schemaChecks` drift guard; binary as `ArrayBuffer` (`z.custom`); stores in
  `EpubLibraryDB` + `ensureBaselineStores`; **own additive append-only `MIGRATIONS` step after v27**
  (rule 4). §6.1, §6.2
  🧪 `migrations.test.ts` captured-fixture extension; add to `CURRENT_STORE_SET`. 📐 register repos.
- **B2 — `embeddings` repo.** Mirror `searchText`; `delete(bookId)` wired into
  `bookContent.deleteBook`'s gated transaction. §6, §8.3
  ▸ B1. 🧪 `repos/embeddings.test.ts` — packed-blob round-trip, `delete`, stamp-mismatch invalidation.
- **B3 — Worker quantize + cosine.** Extend `search.worker.ts`: int8 per-vector quantize + integer
  cosine over **transferred** typed arrays; `import type` only. §2.3, §4.4
  📐 `worker-no-state-typegraph` ≤ 16 (the real gate — `check:worker-chunk` is TTS-only).
  🧪 worker unit suite: int8 cosine ≈ reference float within tolerance; quantize round-trip.
- **B4 — Chunker.** Sub-chunk `cache_search_text` (~320 tok, ~15% overlap, sentence-snapped, CFI
  offsets); compute `sectionTextHash = cheapHash(TextEncoder.encode(text).buffer)` **at import time**
  (no cross-domain `cheapHash` import from `search/`). §2.1
  ▸ B1.

---

## Phase C — EmbeddingClient + foreground indexer

- **C1 — EmbeddingClient (four-part).** `domains/google/genai/embedding/`: `contract.ts` (interface +
  `isConfigured` + per-call config), `GeminiEmbeddingClient` + `MockEmbeddingClient`, `holder.ts`
  (NOT-CONFIGURED default throwing a typed code), `makeLazyEmbeddingClient`; barrel exports the lazy
  facade only; wired in `wireGoogle.ts`. Threads `consent:{bookId,interactive}` + runs `redactPayload`.
  Profile → `task_type` (-001) / instruction (EM2). §5.1
  ▸ A4. 🧪 EmbeddingClient suite (egress routing, profile mapping, matched doc/query profiles, consent
  threading, redacted log) + `MockEmbeddingClient`. 📐 barrel must not static-export the impl (chunk
  check 4).
- **C2 — Foreground indexer.** `domains/search/EmbeddingIndexer.ts`, FG lane: injected ports only (no
  `store/`, no sibling-domain deep import); app reader controller calls
  `searchSession.enqueueEmbedding(bookId, currentCfi)`; CFI-outward ordering; resumable per-section
  (`{href, sectionTextHash}` skip). §4.1, §4.2
  ▸ B2, B3, B4, C1. 🧪 regression: embedding egress carries a `bookId` + emits a redacted log entry.

---

## Phase D — Hybrid search path

- **D1 — Semantic ranking in `SearchSession`.** Add the semantic path **preserving the
  `SearchEngineFactory` in-process test seam**; query embed (query profile) + **cache**; RRF fusion
  with the regex engine; **regex full-text is the default** when off/unconfigured/quota-exhausted/
  not-yet-embedded. §5.2
  ▸ C1, C2. 🧪 semantic path through the in-process seam; regex-is-default-when-off.

---

## Phase E — Background backfill + consent (the privacy-critical phase)

- **E1 — Resolver wiring (do this before E2).** Add the library-wide opt-in as a new `AiConsentDeps`
  input; the resolver **grants** background (`bookId`-carrying, `interactive:false`) calls when the
  opt-in is on (foreground keeps the per-book bit). This is the end-to-end grant path. §8.4.1
  🧪 with opt-in **off**, a background book → `NET_CONSENT_REQUIRED`; with it **on**, granted.
- **E2 — Background lane.** Idle (`requestIdleCallback`), leftover-budget trickle, FG-preemptible;
  **active-device filter is net-new** (no existing task gates on mesh state); always `interactive:false`.
  Registered in the `backgroundTasks` boot phase. §4.3, §3.4
  ▸ A6, C2, E1. 🧪 active-device filter; never `interactive:true` from idle callback.
- **E3 — Settings + disclosure.** Default-OFF "Pre-embed my library" opt-in; **new disclosure copy**
  (the TTS copy doesn't cover bulk embedding or sending query terms). §7, §8.4
  ▸ E1.

---

## Phase F — Polish + the deferred probe

- **F1 — Eviction + migration stamps.** `cache_embeddings` in CACHE LRU; `{model,dims,quant}` mismatch
  → invalidate + re-embed (background, metered). §8.2, §8.3
- **F2 — `batchEmbedContents` probe + flag.** The one deferred decision (§11.3). Run the one-off probe
  (5 singles to calibrate → one 50-content batch → read RPD delta); add `useBatchEmbedding` on
  `GenAIConfig` whose swap-point is the injected `EmbeddingClient.embed`. Adopt only if delta == 1.
  §9, §11.3
  ▸ C1.

---

## Dependency graph (critical path)

```
A1─┬─A2─┐
   ├─A3─┼─A4─┬─A5
   └────┴─A6─┴─A7                 (Phase A: governor — must land first)
                 │
   B1─┬─B2 ──────┤
      ├─B3 ──────┼── C1 ── C2 ── D1
      └─B4 ──────┘                 │
                        E1 ────────┼── E2 ── E3
                                   └── F1, F2
```

**Sequencing notes**
- **A before everything** — no GenAI traffic until the governor + gateway enforcement exist.
- **B's IDB bump waits for v27** to ship and verify its straggler path (rule 4: one format change in
  flight). B1's migration is the next free slot *after* v27.
- **E1 (resolver wiring) gates E2** — without it the background lane can never be granted; build/test
  the consent path before the lane that depends on it.
- Each phase is independently shippable behind the §7 master switch (semantic search default-off).

## Per-phase exit gates (program conventions)

Every phase, before merge: contract/behavioral tests green (§10), coverage ≥ `coverage-baseline.json`,
depcruise at error/0 for the touched rules (+ `worker-no-state-typegraph` ≤ 16), and — for A2/B1 —
`docs:generate` run with regenerated `architecture.md`/READMEs committed (docs-drift gate).
