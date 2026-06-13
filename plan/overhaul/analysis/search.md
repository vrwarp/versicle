# Subsystem analysis: Search engine & worker

Scope: in-book full-text search (`src/lib/search-engine.ts`, `src/lib/search.ts`, `src/workers/search.worker.ts`, `src/types/search.ts`, `src/components/reader/panels/SearchPanel.tsx`), its test sprawl, and its relationship to library/notes search UI.

## What it is

A small, self-contained in-book full-text search facility. When the user opens the search sidebar in the reader, the book's spine items are extracted to plain text and shipped to a dedicated Web Worker holding an in-memory `Map<bookId, Map<href, text>>`. Queries are case-insensitive `indexOf` scans returning up to 50 excerpt snippets; clicking a result navigates to the chapter `href` and best-effort scrolls to the first occurrence of the query. There is no persistence, no inverted index, no cross-book search. Library search ("LibrarySearchBar") is an entirely separate metadata filter and shares nothing with this engine.

History (git): FlexSearch (`008a8675` removed it) → escaped-RegExp linear scan (with ReDoS fixes `3d1781e8`, zero-width-match fix `2e2da045`) → plain `indexOf` scan (`aadb01a7` "prevent V8 GC thrashing"). Docs and several tests still describe the two previous generations.

## File inventory

| File | Lines | Role |
|---|---|---|
| `src/lib/search-engine.ts` | 147 | `SearchEngine` class: per-book text store, `indexOf` scan, excerpt generation, optional worker-side XML→text parsing. Runs in the worker (and directly in tests). |
| `src/workers/search.worker.ts` | 5 | Worker entry: `Comlink.expose(new SearchEngine())`. |
| `src/lib/search.ts` | 213 | `SearchClient` singleton (main thread): lazy worker creation, epubjs text extraction, batching, concurrent-index dedup, progress broadcast, `terminate()`. |
| `src/types/search.ts` | 36 | `SearchResult` (href, excerpt, **unused** `cfi?`) and `SearchSection` (id, href, text?, xml?). |
| `src/components/reader/panels/SearchPanel.tsx` | 194 | Sidebar UI: triggers indexing on mount, Enter-to-search, stale-request guard, progress bar, result list. |
| `src/components/reader/ReaderView.tsx` (touchpoints) | — | Imports `searchClient` (l.24), `terminate()` on unmount (l.531), renders `SearchPanel` (l.1357), navigation handler `display(href)` + `setTimeout(scrollToText(query), 500)` (l.1360–1366), `scrollToText` (l.917–974). |
| `src/components/library/LibrarySearchBar.tsx` | 68 | Debounced controlled input; filtering itself lives in `LibraryView.tsx:316–345` (title/author `includes`). Unrelated to the engine. |
| `src/components/notes/NotesSearchBar.tsx` | 41 | Third hand-rolled search input (annotations filter). Unrelated to the engine. |
| Tests | | |
| `src/lib/search-engine.test.ts` | 180 | Core engine behavior + a now-vacuous zero-width-RegExp test (l.152–179). |
| `src/lib/search-engine.comprehensive.test.ts` | 71 | Overlapping edge cases; has the Turkish-İ case (l.46–56) but with an assertion too weak to catch the real bug. |
| `src/lib/search-engine.fuzz.test.ts` | 236 | Seeded fuzzing (regex chars, Unicode, malformed XML). Good infra. |
| `src/lib/search-engine.perf.test.ts` | 47 | "Perf test" that only logs a duration; asserts nothing about timing. |
| `src/lib/search-engine.xml.test.ts` | 59 | Worker-side XML parsing tests; only meaningful in JSDOM (see Debt #2). |
| `src/lib/search.test.ts` | 170 | SearchClient behavior with module-level comlink mock. |
| `src/lib/search.repro.test.ts` | 57 | Single-bug repro (concurrent searches), duplicate comlink mock scaffold. |
| `src/test/search-client.repro.test.ts` | 58 | Single-bug repro (progress broadcast), lives outside `src/lib`, spies on private `getEngine` via casts. |
| `src/components/reader/panels/SearchPanel.test.tsx` | 205 | Solid component coverage. |
| `src/components/library/LibrarySearchBar.test.tsx`, `LibraryView_Search.test.tsx` | 131/159 | Library filter UI tests (separate feature). |

## How it works (data & control flow)

1. **Trigger**: `SearchPanel` mounts (user opens the search sidebar) → `useEffect` (`SearchPanel.tsx:36–65`) checks `searchClient.isIndexed(bookId)` and calls `searchClient.indexBook(book, bookId, onProgress)`.
2. **Single-flight**: `SearchClient.indexBook` (`search.ts:51–78`) dedups concurrent callers via `pendingIndexes` and broadcasts progress to all registered callbacks (`notifyProgress`, `search.ts:80–87`).
3. **Extraction** (`indexBookInternal`, `search.ts:96–184`): awaits `book.ready`, calls `engine.initIndex(bookId)`, asks the worker `supportsXmlParsing()`, then iterates spine items in batches of 5:
   - Attempt 1: `book.archive.getBlob(href)` → raw XHTML string; if the worker "can offload", send the raw `xml`; otherwise parse on the main thread with a cached `DOMParser` and send `text`.
   - Attempt 2 (fallback): `book.load(href)` → `innerText`.
   - After each batch: `await engine.addDocuments(...)`, progress callback, `setTimeout(0)` yield.
4. **Worker storage** (`search-engine.ts:35–68`): `Map<bookId, Map<href, text>>`; if a section arrives as `xml`, parse with `DOMParser` *in the worker* (see Debt #2 — this never happens in production).
5. **Query**: `SearchPanel.handleSearch` → `searchClient.search(query, bookId)` → worker `engine.search` (`search-engine.ts:89–121`): per-section `text.toLowerCase()`, repeated `indexOf`, excerpt = ±40 chars from the **original** string, capped at 50 results, ordered by insertion (spine) order.
6. **Navigation**: result click → `onNavigate(href, activeQuery)` (`SearchPanel.tsx:177`) → `rendition.display(href)`; after a fixed 500 ms, `scrollToText(query)` (`ReaderView.tsx:1360–1366`) hunts inside the epubjs iframe with non-standard `window.find()` then a TreeWalker fallback (`ReaderView.tsx:917–974`).
7. **Teardown**: `ReaderView` unmount → `searchClient.terminate()` (`ReaderView.tsx:529–537`) kills the worker and clears the client caches. Index lifetime = one reader session; nothing is persisted; "invalidation" is simply worker death (books are immutable, so this is at least never *wrong*, just wasteful).

Worker transport: **Comlink on both sides**, identical to the TTS worker (`src/workers/tts.worker.ts:9` even says "Mirrors src/workers/search.worker.ts"). There is no hand-rolled postMessage protocol here; the TTS subsystem layers a far more elaborate harness on the same transport, but the patterns are consistent.

## Technical debt

### 1. Worker-side XML parsing path is dead in production browsers
- **Severity**: high — **Category**: dead-code / architecture
- **Evidence**: `SearchEngine.supportsXmlParsing()` returns `typeof DOMParser !== 'undefined'` (`search-engine.ts:25–27`). `DOMParser` is a `Window`-only API; it does not exist in dedicated Web Workers in Chrome, Firefox, or Safari. So in production `canOffload` (`search.ts:103`) is always `false`, the `xml` branch of `SearchSection` (`types/search.ts:35`), the worker-side parse (`search-engine.ts:52–62`), and the whole capability negotiation never activate. They only "work" under JSDOM, where the worker engine is instantiated in a DOM-bearing test environment — `search-engine.xml.test.ts:55–58` literally asserts "supportsXmlParsing as true **in JSDOM**". `architecture.md:410` claims "XML parsing is offloaded to the Web Worker", which is false.
- **Impact**: The optimization the feature was built for (commit `5c3f70e6 feat(perf): offload search XML parsing to worker`) never happens; main thread pays full parse cost for every chapter every session. Maintains two parallel DOMParser-caching implementations (`search.ts:89–94` and `search-engine.ts:141–146`). Misleads anyone reading the code or architecture doc. If the flag were ever wrong in the other direction, `xml` sections would be silently dropped (text never stored → chapter silently unsearchable).
- **Fix**: Delete `supportsXmlParsing`, the `xml` field, and the worker-side parse. Either (a) accept main-thread parsing as the design and say so, or (b) actually offload by shipping raw bytes to the worker and using a worker-compatible extractor (a small streaming tag-stripper is sufficient for search text; no full DOM needed). Option (b) pairs naturally with Debt #5's persistent text cache.

### 2. Result navigation cannot target a specific match; `cfi` field is dead; 500 ms magic timeout
- **Severity**: high — **Category**: correctness / architecture
- **Evidence**: `SearchResult.cfi` is declared (`types/search.ts:20`) but never produced anywhere (grep: no assignment in the repo). Results carry only `href` + excerpt. Navigation is `rendition.display(href)` then `setTimeout(() => scrollToText(query), 500)` (`ReaderView.tsx:1360–1366`). `scrollToText` uses non-standard `(iframe.contentWindow as any).find(...)` (`ReaderView.tsx:926`) with a TreeWalker fallback that only matches text within a *single* text node (`ReaderView.tsx:941–953`).
- **Impact**: All N results within a chapter navigate to occurrence #1 — "Result 7" is unreachable. If the chapter takes >500 ms to render, scrolling silently does nothing. `window.find` behavior differs across engines (and is absent from some). Query strings spanning element boundaries are missed by the fallback. No persistent highlight of the match.
- **Fix**: Compute precise locations at index time. The extractor already walks each spine document; record per-occurrence character offsets, and resolve offset→CFI either at index time (epub.js `section.cfiFromRange`) or lazily on click. Navigate with `rendition.display(cfi)` and apply a temporary `annotations.highlight`, removing `scrollToText` and the timeout. This also fixes "Result N" labels (can show chapter title + occurrence).

### 3. Excerpt index misalignment when lowercasing changes string length
- **Severity**: medium — **Category**: correctness
- **Evidence**: `search()` finds the match index in `lowerText = text.toLowerCase()` but slices the excerpt from the **original** `text` at that index (`search-engine.ts:100–116`, `getExcerpt` `:131–136`). `'İ'.toLowerCase()` is `'i̇'` (1 code unit → 2), so indices diverge by one per such character preceding the match; Turkish/Lithuanian/Greek texts produce shifted excerpts. The ±40 window slice can also split surrogate pairs at its edges, yielding lone surrogates (renders as �). `search-engine.comprehensive.test.ts:46–56` tests exactly the İ scenario but only asserts `excerpt.toContain('matching')`, which passes despite the misalignment — a test written for the bug that doesn't catch the bug.
- **Impact**: Garbled/offset excerpts (and, after Debt #2's fix, potentially offset CFI anchors) for non-ASCII-cased scripts. Low frequency for English libraries, embarrassing for the locales it hits — and this app explicitly targets Chinese-language readers with mixed-script content.
- **Fix**: Find matches against the original string: escape the query and use `new RegExp(escaped, 'giu')` (history shows fear of regex from the ReDoS era, but an *escaped-literal* regex cannot backtrack pathologically), or normalize once and keep an offset map. Strengthen the comprehensive test to assert exact excerpt boundaries.

### 4. Stale identity: docs and tests describe two previous engine generations
- **Severity**: medium — **Category**: hygiene / dead-code
- **Evidence**: Class doc says "simple RegExp scan" (`search-engine.ts:4`) and "linear RegExp scan" (`:83`) — the engine uses `indexOf` (since `aadb01a7`). `src/workers/README.md:7` says the worker "initializes the `SearchEngine` (**wrapping FlexSearch**)" — FlexSearch was removed in `008a8675`, two generations ago. `architecture.md:19` and `:406–410` describe "RegExp scanning" and the (dead, see #1) XML offload. `search-engine.test.ts:152–179` mocks `global.RegExp` to verify a zero-width-match infinite-loop safeguard; the engine constructs no RegExp, so the test passes vacuously and protects nothing.
- **Impact**: Anyone (human or agent) reading docs first will design against an engine that doesn't exist; the vacuous test gives false confidence and survives any regression.
- **Fix**: Rewrite the three doc locations; delete the zero-width test (or convert it to an indexOf-progress property test); add a one-line "engine = lowercase indexOf scan" statement in the class doc.

### 5. Index is rebuilt from the zip on every reader session; nothing persisted
- **Severity**: medium — **Category**: performance / architecture
- **Evidence**: Index exists only in worker memory (`search-engine.ts:8–9`); built lazily on first `SearchPanel` mount (`SearchPanel.tsx:36–65`); destroyed unconditionally on `ReaderView` unmount (`ReaderView.tsx:529–537`). Re-opening the same book re-extracts every spine item: unzip (`book.archive.getBlob`, `search.ts:122`) + main-thread DOMParser parse (`:128–133`) per chapter. `architecture.md:23` acknowledges "Large books may take seconds to index".
- **Impact**: Repeated multi-second indexing and main-thread parse jank on every session for large books; battery cost on Android (Capacitor). Books are immutable after import, so this work is 100% cacheable. The absence of a text cache also forecloses library-wide full-text search (see #10).
- **Fix**: Persist extracted plain text (per `bookId`, keyed/validated by import version or content hash) in IndexedDB via `DBService` alongside the existing binary stores. Index load becomes "read text rows, post to worker". Invalidate on book delete/re-import (delete the rows in the same transaction as the EPUB blob).

### 6. No worker failure handling; client cache can diverge from worker state; terminate() leaks in-flight work
- **Severity**: medium — **Category**: correctness
- **Evidence**: `SearchClient.indexedBooks` (`search.ts:16`) is a main-thread mirror of worker memory with no `worker.onerror`/`onmessageerror` handler anywhere in `search.ts`. If the worker crashes or is OOM-killed (realistic on Android WebView with a 10M-char book), `isIndexed()` keeps returning `true` and every search silently resolves `[]` (or hangs, if the worker died mid-call — Comlink promises for a dead worker never settle). `terminate()` (`search.ts:201–209`) during an in-flight index kills the worker, so the pending `await engine.addDocuments(...)` inside `indexBookInternal` (`search.ts:176`) never resolves: the `finally` in `indexBook` (`:75–77`) never runs for awaiters of the *internal* task, the closure pins the epubjs `Book`, and any concurrent caller awaiting `pending.task` hangs forever. Also, `terminate()` only clears state inside `if (this.worker)` — a client whose engine was injected/mocked (exactly what `src/test/search-client.repro.test.ts:37–41` does) keeps `indexedBooks` across `terminate()` calls.
- **Impact**: Silent empty search results after a worker crash; leaked Book objects and hung promises on book close during indexing; test-only state bleed that has already forced awkward test scaffolding.
- **Fix**: Attach `onerror` → reset client state and surface a toast; make `terminate()` settle in-flight operations (track pending index promises and reject them, or guard each loop iteration with a generation/AbortSignal check); clear caches unconditionally.

### 7. Module-level singleton with split-brain lifecycle ownership
- **Severity**: medium — **Category**: architecture
- **Evidence**: `export const searchClient = new SearchClient()` (`search.ts:213`). `SearchPanel` owns *creation* of the index (`SearchPanel.tsx:42–60`) while `ReaderView` owns *destruction* (`ReaderView.tsx:24, 531`) — two components must coordinate through a global. Tests pay the price: module-level `vi.mock('comlink', ...)` duplicated in `search.test.ts:21–25` and `search.repro.test.ts:24–28`, and a private-method spy via `searchClient as unknown as { getEngine: () => unknown }` in `search-client.repro.test.ts:37`.
- **Impact**: Lifecycle bugs are invisible at the type level (nothing stops a future component calling `indexBook` after `terminate`); the singleton makes parallel test isolation depend on a conditional `terminate()` (see #6); adding a second consumer (e.g., library-wide search) would fight over the same worker lifecycle.
- **Fix**: A reader-session-scoped `SearchSession` created by the reader container and provided via context/prop; constructor-inject the worker (or a `() => Comlink.Remote<SearchEngine>` factory) so tests use a real engine over a `MessageChannel` — the exact pattern already proven in `src/lib/tts/engine/WorkerTtsEngine.test.ts:42–44`.

### 8. Test sprawl: 8 files, ~990 lines, overlapping and partially vacuous, for ~370 lines of source
- **Severity**: medium — **Category**: testing / hygiene
- **Evidence**: Regex-special-character handling is tested three times (`search-engine.test.ts:58–83`, `search-engine.comprehensive.test.ts:11–27`, `search-engine.fuzz.test.ts:10–43`). The "perf" test logs a duration and asserts only `results.length === 0` (`search-engine.perf.test.ts:36–45`) — it can never fail for a perf regression. The zero-width RegExp test is vacuous (#4). Two single-bug repro files (`search.repro.test.ts`, `src/test/search-client.repro.test.ts`) duplicate the comlink-mock scaffold of `search.test.ts`, and one lives in the wrong directory.
- **Impact**: Slower CI, higher maintenance surface, and a misleading sense of coverage — none of these files catches the real bugs documented above (#2, #3, #6).
- **Fix**: Consolidate to `search-engine.test.ts` (behavior + fuzz, keep `fuzz-utils` seeding) and `search-client.test.ts` (lifecycle, concurrency, failure modes) using a shared real-engine-over-MessageChannel harness; fold repro cases in as named regression tests; delete the perf file or give it a budget assertion in a dedicated benchmark lane.

### 9. Epubjs access is untyped and inlined in the client
- **Severity**: medium — **Category**: type-safety
- **Evidence**: `(book.spine as any).items || (book.spine as any).spineItems` (`search.ts:106`), `batch.map(async (item: any)` (`:115`), `const d = doc as any` (`:145`). The repo pins a forked/overridden epubjs (`package.json:118`), so these shapes are stable but invisible to the compiler.
- **Impact**: Spine-shape drift in the epubjs fork breaks search at runtime only; the same `as any` spine-poking pattern is repeated in other subsystems (TTS content extraction), multiplying the blast radius of an epubjs upgrade.
- **Fix**: One typed adapter module for the epubjs fork (spine items, archive access, section load) shared by search and TTS extraction; delete the casts here.

### 10. Three hand-rolled search inputs; library/notes/in-book search share nothing
- **Severity**: low — **Category**: duplication
- **Evidence**: Near-identical "icon + `<Input type=search>` + absolute-positioned clear button" markup in `LibrarySearchBar.tsx:35–56`, `SearchPanel.tsx:106–132`, and `NotesSearchBar.tsx:14–39` (same classNames, same X-button geometry). Library filtering itself is an inline `useMemo` over title/author in `LibraryView.tsx:316–345`; notes filtering is separate again. No library-wide full-text search exists at all.
- **Impact**: Tripled UI maintenance (the three already drifted: debounce in one, Enter-to-submit in another, controlled-by-parent in the third); no path to "search across all books", which the persistent text cache (#5) would make cheap.
- **Fix**: Extract a shared `SearchInput` component; keep library metadata filtering as-is (it is fine), but note that #5 unlocks an optional cross-library search feature on the same engine.

### 11. UX/robustness paper-cuts in engine and panel
- **Severity**: low — **Category**: hygiene
- **Evidence**: 50-result cap silently truncates with no "more results" indication (`search-engine.ts:97, 112–114`); result list keyed by array index (`SearchPanel.tsx:172`); results labeled generically "Result N" with no chapter title (`:179`); excerpt whitespace not normalized (raw `textContent` of pretty-printed XHTML contains newline runs); indexing failure is logged but never surfaced to the user (`SearchPanel.tsx:51–52` — compare search failure, which toasts at `:93`); `LARGE_INDEX_THRESHOLD` warning (`search-engine.ts:43–46`) only console-warns in the worker where nobody looks.
- **Impact**: Confusing truncated results; mediocre result list ergonomics; silent indexing failures look like "no results found".
- **Fix**: Return `{ results, truncated }`; key by `href+matchIndex`; include section title (TOC lookup) in results; collapse whitespace in excerpts; toast on indexing failure.

## Problematic couplings

- **ReaderView ⇄ SearchClient lifecycle split-brain**: `ReaderView.tsx:24,531` terminates the global singleton that `SearchPanel.tsx:46` populates; neither owns the whole lifecycle (Debt #7).
- **Search navigation reaches into epubjs rendition internals**: `ReaderView.tsx:917–974` (`scrollToText`) queries the iframe, uses non-standard `window.find`, and is glued to results by a 500 ms timer (`:1363`) — the search subsystem's correctness depends on reader-internal DOM details (Debt #2).
- **SearchClient depends on untyped epubjs fork internals**: spine/archive/load shapes accessed via `any` (`search.ts:106,115,145`); the same pattern exists in TTS content extraction — a shared typed adapter is missing (Debt #9).
- **SearchPanel → `useToastStore`** (`SearchPanel.tsx:8,34`): acceptable, but it is the only store coupling; keep it that way.
- **Docs**: `architecture.md:19,406–410` and `src/workers/README.md:7` describe this subsystem incorrectly (FlexSearch / RegExp / worker XML offload) — doc-to-code coupling is broken (Debt #4).

## What's good (keep)

- **Comlink on both workers** — the search worker (`search.worker.ts:1–5`) and TTS worker use the same transport; `tts.worker.ts:9` explicitly mirrors search. No hand-rolled postMessage protocol anywhere in this subsystem. Keep this uniformity.
- **Engine as a plain class, worker entry as 5 lines** — `SearchEngine` is environment-agnostic and trivially testable; the worker file is pure wiring. This is the right shape; the overhaul should preserve it.
- **Lazy, deferred indexing** (`f875a183`): cost is only paid when the user opens search (`SearchPanel.tsx:36–65`).
- **Single-flight concurrent indexing with progress broadcast** (`search.ts:51–87`, commit `b2919d1f`): correct dedup pattern; the repro test proves intermediate progress reaches all callers.
- **Batched extraction with main-thread yields** (`search.ts:108–183`): batches of 5, awaited worker acks, `setTimeout(0)` yield — keeps the UI responsive during indexing.
- **`indexOf` over lowercased text** is the right algorithm at this scale: per-book scope, ~10M chars scanned in tens of ms (perf test logs confirm), zero ReDoS surface (the project already fought and lost against query-as-regex twice — `3d1781e8`, `2e2da045`). Do not reintroduce FlexSearch or query-derived regexes; an inverted index is unjustified for single-book scope.
- **Two-tier extraction** (archive direct read with rendering fallback, `search.ts:119–152`): robust against odd EPUBs.
- **SearchPanel hygiene**: stale-request counter (`SearchPanel.tsx:67–97`) and mounted-flag pattern (`:40–64`) are correct; a11y (progressbar attributes, `aria-live`) is genuinely good.
- **Seeded fuzz infrastructure** (`src/test/fuzz-utils.ts`, used by `search-engine.fuzz.test.ts`): deterministic, reusable — keep and reuse in the consolidated suite.

## Target design

1. **`BookTextExtractor`** (new, shared): the single place that turns an epubjs Book into `ExtractedSection[] { href, title, text, occurrencesIndexable: charOffsets }` via a typed epubjs adapter. Runs once per book *import* (or first search), result persisted in IndexedDB (`DBService`, new `bookText` store keyed by bookId; deleted with the book). TTS content extraction is a candidate second consumer.
2. **`SearchEngine`** (worker, mostly as-is): keep the indexOf scan; fix case-fold alignment by matching against the original string with an escaped-literal Unicode regex; return `{ results, truncated }`, each result carrying `href`, `sectionTitle`, `excerpt`, `charOffset`, and (resolved lazily or eagerly) `cfi`.
3. **`SearchSession`** (replaces the singleton): created when the reader mounts, disposed on unmount; owns the worker, exposes `index()/search()/dispose()`, handles `worker.onerror` by resetting state and notifying; injectable worker factory for tests (real engine over `MessageChannel`, per the `WorkerTtsEngine.test.ts` pattern). Provided to `SearchPanel` via context/prop.
4. **Navigation by CFI**: results navigate with `rendition.display(cfi)` + temporary highlight annotation; delete `scrollToText` and the 500 ms timer.
5. **UI**: shared `SearchInput` component used by SearchPanel, LibrarySearchBar, NotesSearchBar; SearchPanel shows chapter titles, occurrence numbers, truncation notice, and toasts on indexing failure.
6. **Tests**: two consolidated suites (engine behavior+fuzz; session lifecycle+failure modes) plus the existing component test; delete the perf/xml/vacuous-regex/duplicate-repro files.
7. **Docs**: correct `architecture.md` and `src/workers/README.md` as part of the same change.

Explicit non-goals: no inverted index, no FlexSearch revival, no query-as-regex. Optional follow-on (cheap once text is persisted): library-wide search over the `bookText` store.

## Migration notes

- **No user-data migration required.** The current index is ephemeral worker memory; nothing persisted today means nothing to migrate.
- **Additive IDB change**: new `bookText` object store (DB version bump in `DBService`); populated lazily on first search of each book (or backfilled at import). Absence of a row simply triggers extraction — old installs degrade to current behavior.
- **Type compatibility**: `SearchResult` gains fields; `cfi` goes from never-set to set — existing consumers (only SearchPanel) are updated in the same PR. `SearchSection.xml` removal touches only the engine, client, and the xml test (all in-subsystem).
- **Order of operations**: (1) kill dead XML path + fix docs/tests (pure deletion, zero behavior change in production); (2) fix excerpt case-fold bug + add truncation flag (engine-only); (3) introduce `SearchSession` + worker error handling (replaces singleton; ReaderView/SearchPanel wiring); (4) extraction service + IDB persistence (DB version bump); (5) CFI navigation + UI polish (removes `scrollToText`). Each step ships independently; users see no regression at any intermediate point — worst case at each step is the current behavior.
- **Android/Capacitor**: verify worker creation path (`new URL(..., import.meta.url)`) and IDB quota behavior on WebView when adding the text store; the text cache roughly doubles per-book storage of text-heavy EPUBs (plain text is small relative to images, typically <10% of EPUB size).
