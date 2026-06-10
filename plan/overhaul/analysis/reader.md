# Subsystem analysis: Reader & EPUB rendering

Analyzed at commit `3b0cfcff` on branch `claude/amazing-davinci-d7336e`. All paths relative to repo root.

## What it is

The reader subsystem renders EPUB content via **epub.js 0.3.93** (an effectively unmaintained library — last 0.3.x line, the 0.4 rewrite never shipped) inside a sandboxed iframe, and layers on top of it: pagination/scrolling, theming/typography normalization, text selection → annotation, TTS sentence highlighting, reading-history capture, multi-device progress markers, in-book search, AI-enhanced TOC, and Chinese text processing (OpenCC conversion + pinyin overlay). It also owns the **offscreen renderer** used at ingestion time to extract sentence-level CFIs, table snapshots, and base font metrics, and **cfi-utils**, a homegrown CFI string-manipulation library consumed by the TTS engine and the reading-state store.

Two god files dominate: `src/components/reader/ReaderView.tsx` (1408 lines, 26 `useEffect`s, 223 commits of churn) and `src/hooks/useEpubReader.ts` (1006 lines, 40 eslint-disables, 30 `as any` casts, 67 commits).

## File inventory

| File | Role |
|---|---|
| `src/components/reader/ReaderView.tsx` (1408) | God component: route entry, header chrome, sidebar orchestration, annotation diffing onto rendition, reading-history capture, import-progress jump dialog, synthetic-TOC state, debug highlights, device markers, play-from-selection CFI matching, scroll-to-text |
| `src/hooks/useEpubReader.ts` (1006) | God hook: book load/destroy lifecycle, iframe sandbox patching (MutationObserver), XSS sanitize hook registration, theme/font/line-height normalization + injection, locations generation/caching, relocation→callback plumbing, selection listeners, Chinese text processing (OpenCC mutation + pinyin geometry), resize handling |
| `src/hooks/useReaderNavigation.ts` (121) | Wheel/touch scrolling for scrolled mode; arrow-key page turns (window + iframe) |
| `src/hooks/useCfiCoordinates.ts` (125) | Measures CFI ranges → container-relative coordinates for portal overlays; re-measures on relocate/resize |
| `src/hooks/useSmartTOC.ts` (167) | Gemini-powered TOC title generation; loads chapter text via `book.load()`, persists via `dbService.updateBookStructure` + pokes `useLibraryStore` internals |
| `src/hooks/useBookProgress.ts` (66) | **Dead code** — duplicate of `useBookProgress` in `useReadingStateStore.ts:449`; zero importers |
| `src/hooks/useSectionDuration.ts` (69) | TTS time-remaining estimate from queue char counts (CJK-aware CPM) |
| `src/lib/cfi-utils.ts` (596) | Hand-rolled CFI string parser/merger/range-generator + sentence snapping; parallel implementation to epub.js's own `EpubCFI` |
| `src/lib/offscreen-renderer.ts` (377) | Ingestion-time hidden-DOM rendition: per-chapter sentence/CFI extraction, table → webp snapshots (snapdom), dominant font-size detection |
| `src/lib/sanitizer.ts` (78) | DOMPurify config for chapter HTML + metadata strings |
| `src/lib/reader/titleResolver.ts` (67) | TOC item lookup by href with path-resilient matching; synthetic-TOC preference resolution |
| `src/components/reader/panels/TOCPanel.tsx` (158) | Chapters + History tabs, synthetic-TOC switch, AI-enhance button, device markers |
| `src/components/reader/panels/SearchPanel.tsx` (194) | Search UI; triggers worker indexing via `searchClient` |
| `src/components/reader/AnnotationList.tsx` (147) | Sidebar list of annotations, edit/delete |
| `src/components/reader/AnnotationMarkerOverlay.tsx` (65) | Portal overlay rendering note markers at measured coordinates |
| `src/components/reader/HistoryHighlighter.tsx` (43) + `useHistoryHighlights.ts` (108) | Renders "last played" gray highlight via epub.js annotations API; isolates high-frequency progress subscription |
| `src/components/reader/ReaderHighlightsStyles.tsx` (64) | Parent-document `<style>` + SVG pattern defs for highlight classes |
| `src/components/reader/ReaderControlBar.tsx` (267) | CompassPill state machine (annotation/audio/sync-alert/summary variants); mounted in `RootLayout` |
| `src/components/reader/ReaderTTSController.tsx` (210) | TTS highlight application + orphaned-SVG DOM sweeps, visibility reconciliation, TTS keyboard shortcuts |
| `src/components/reader/VisualSettings.tsx` (256) | Theme/font/layout/Chinese settings popover; per-language font profiles |
| `src/components/reader/PinyinOverlay.tsx` (85) | Portal overlay rendering pinyin above characters, vocabulary-aware filtering |
| `src/components/reader/ReadingHistoryPanel.tsx` (246) | History list; resolves labels via `rendition.book` spine/navigation |
| `src/components/reader/UnifiedAudioPanel.tsx` (231) | TTS queue + settings sheet |
| `src/components/reader/ContentAnalysisLegend.tsx` (439), `ContentAnalysisReport.tsx` (205) | GenAI debug tooling living inside reader dir |
| `src/components/reader/LexiconManager.tsx` (681) | TTS pronunciation-rule manager UI (TTS concern in reader dir) |
| `src/types/epubjs.d.ts` (136) | **Ambient module stub that shadows epubjs's own shipped types** |
| `src/types/epubjs-epubcfi.d.ts` (7) | Maps `epubjs/src/epubcfi` submodule import to the barrel type |

## How it works (data & control flow)

**Load path:** `ReaderView` (route `/read/:id`) builds an `EpubReaderOptions` object with ~8 callbacks and passes it to `useEpubReader(bookId, viewerRef, options)`. The hook runs a cancellable generator (`runCancellable`) that: fetches the EPUB ArrayBuffer from `dbService.getBookFile`, constructs `ePub()`, registers a `spine.hooks.serialize` DOMPurify hook (`useEpubReader.ts:313-323`), calls `renderTo` with `manager:'default'`, installs a MutationObserver to force `allow-scripts allow-same-origin` onto every iframe epub.js creates (`useEpubReader.ts:350-379`), registers three `hooks.content` callbacks (`injectExtras` for CSS-unit normalization + spacer, `processChineseContent` for OpenCC/pinyin, `attachListeners` for contextmenu/mouseup-selection), displays the initial CFI, then loads or generates locations (cached in IDB via `dbService.get/saveLocations`).

**Relocation path:** epub.js `relocated` → resolves percentage + section title (duplicated 30-line block, see debt) → `options.onLocationChange` → ReaderView's 100-line inline callback (`ReaderView.tsx:218-321`) which (a) maybe shows the import-jump dialog, (b) snaps the *previous* viewport range to sentence boundaries via `snapCfiToSentence` (async, uses the live Book), (c) writes an atomic `updateReadingSession` into the Yjs-backed `useReadingStateStore`, (d) updates `useReaderUIStore.setCurrentSection`. On unmount a synchronous "panic save" path writes raw (unsnapped) history (`ReaderView.tsx:497-526`).

**Overlay coordination — six independent highlight systems:**
1. **User annotations** — imperative diff of store list against an `addedAnnotations` ref Map, calling `(rendition as any).annotations.add/remove` (`ReaderView.tsx:647-740`); audio-bookmarks get a special click handler that programmatically selects text and morphs the CompassPill.
2. **TTS sentence highlight** — `ReaderTTSController` adds/removes a `tts-highlight` annotation per `activeCfi` change and performs **manual DOM sweeps** of the rendition's internal `view.pane.element` to remove orphaned `g.tts-highlight` SVG nodes that epub.js leaks (`ReaderTTSController.tsx:58-108`).
3. **Reading-history highlight** — `HistoryHighlighter`/`useHistoryHighlights` adds a gray annotation for `lastPlayedCfi`.
4. **Content-analysis debug highlights** — another annotations.add effect in ReaderView (`ReaderView.tsx:755-814`).
5. **Note markers** — geometry-based React portal: `useCfiCoordinates` measures `rendition.getRange(cfi).getClientRects()` and `AnnotationMarkerOverlay` portals buttons into `rendition.manager.container`.
6. **Pinyin** — `processChineseContent` walks text nodes in the iframe, mutates `nodeValue` for Traditional conversion (caching originals on `(textNode as any)._originalText`), measures per-character ranges, and emits positions to `PinyinOverlay`, another portal into the manager container.

Highlight *styling* is defined in two conflicting places: iframe-injected `themes.default` (`useEpubReader.ts:861-872`, fill-opacity 0.3/0.4) and parent-document `ReaderHighlightsStyles.tsx` (fill-opacity 0.8/0.4) — epub.js draws annotation SVGs in the parent document, so the parent rules win for SVG `fill` while iframe rules affect `background-color`; nobody owns this contract.

**Control inversion via store:** ReaderView registers closures into `useReaderUIStore` (`setJumpToLocation`, `setPlayFromSelection`) so distant components (CompassPill in `RootLayout`) can drive the rendition. Chapter navigation from the pill arrives via a window CustomEvent `reader:chapter-nav` (`ReaderView.tsx:896-915`).

**Ingestion symmetry:** `offscreen-renderer.ts` re-implements the same sandbox patch + sanitize hook, renders every chapter into a hidden container at 1000×1000, and extracts sentences with CFIs via `contents.cfiFromRange`. This exists because CFIs must be generated from the **same sanitized DOM** the live reader renders — the TTS queue's CFIs (produced at ingestion) are later resolved against the live rendition (`ReaderView.tsx:985-1007` play-from-selection; `ReaderTTSController` display calls). It is the linchpin that couples TTS data to epub.js rendering semantics.

## Technical debt

### D1. Local `epubjs.d.ts` stub shadows the library's own (better) types → 42 `as any` casts
- **Severity:** high | **Category:** type-safety
- **Evidence:** `src/types/epubjs.d.ts:1-136` declares an ambient `module 'epubjs'` with a minimal API surface. But `node_modules/epubjs/package.json` ships `"types": "types/index.d.ts"`, and upstream `types/rendition.d.ts:65-131` already types `annotations`, `flow()`, `getContents()`, `getRange()`, `views()`, `spread()`; upstream `types/epubcfi.d.ts:41` types `compare(cfiOne: string | EpubCFI, ...)`. The local stub omits all of these, forcing 42 `(rendition as any)`-style casts across src (e.g. `useEpubReader.ts:384,396,426,509`, `ReaderView.tsx:422,656,671,683`, `useCfiCoordinates.ts:27,39,48`) and even a `@ts-expect-error epubjs compare accepts EpubCFI objects despite strict string types` (`cfi-utils.ts:251,273`) **working around the project's own stub**, not the library.
- **Impact:** Every rendition/book interaction is untyped; typos and API misuse compile silently; the casts metastasize into every consumer (TTS controller, coordinate hook, panels). This is self-inflicted — the upstream types are strictly more complete.
- **Fix:** Delete `src/types/epubjs.d.ts`; use upstream types; add a small `declare module 'epubjs'` *augmentation* only for the few genuinely untyped internals (`rendition.manager`, `spine.hooks.serialize`, `contents.cfiFromRange`). Keep `epubjs-epubcfi.d.ts` (it is correct and serves a real bundle-size purpose).

### D2. `ReaderView.tsx` is a 1408-line god component (26 effects, 8 responsibilities)
- **Severity:** critical (structural — blocks safe modification) | **Category:** architecture
- **Evidence:** `ReaderView.tsx` mixes: reading-session/history capture (`:218-321`, `:497-526`), import-jump dialog state machine (`:199-243`, `:568-634`), annotation→rendition diffing with embedded audio-bookmark triage UX (`:647-740`), content-analysis debug highlights (`:755-814`), synthetic-TOC persistence races (`:816-882`), device-marker computation (`:1030-1073`), play-from-selection queue matching (`:977-1016`), DOM `scrollToText` with two fallback strategies (`:917-974`), plus all header/sidebar JSX. 223 commits have touched it. Test hooks leak globals: `window.rendition` (`:450`), `window.__reader_added_annotations_count` (`:738`).
- **Impact:** Any feature touching the reader risks regressing unrelated features; the file's effect web (26 `useEffect`s with cross-referencing refs like `panicSaveState`, `metadataRef`, `bookRef`, `addedAnnotations`, `hasPromptedForImport`) cannot be reasoned about locally. This is where the bug-fix-on-bug-fix pattern concentrates (e.g. flushSync WebKit workaround `:1151-1156`, Dragnet pause-gesture comment `:1291-1297`).
- **Fix:** Decompose into: `ReaderShell` (layout/chrome), `ReadingSessionRecorder` (history capture incl. panic save), `AnnotationLayer`, `DebugHighlightLayer`, `ImportJumpPrompt`, `TocController` (synthetic-TOC state), each subscribing to stores directly. ReaderView should be <200 lines of composition.

### D3. `useEpubReader` is a 1006-line god hook mixing lifecycle, theming math, and Chinese NLP
- **Severity:** high | **Category:** architecture
- **Evidence:** One hook contains: CSS absolute-unit→rem normalization tables (`useEpubReader.ts:52-90`), CSP-resilient style injection with three fallback strategies (`:96-157`), sandbox MutationObserver (`:350-379`), theme registration ×3 + font-size/line-height normalization math against ingested `baseFontSize` metadata (`:880-907`), forced-style CSS string building (`:923-984`), OpenCC/pinyin text-node walking (`:601-699`), and dual selection pipelines (`relocated`/`selected` listeners `:476-513` **and** a parallel `mouseup`-based pipeline in `attachListeners` `:704-744` — both invoke `onSelection`, so selections can fire the callback twice).
- **Impact:** The reader engine cannot be tested or replaced piecemeal; Chinese processing changes risk theming regressions and vice versa. The duplicate selection pipeline is a latent double-popover source.
- **Fix:** Extract modules: `epubLifecycle.ts` (load/destroy/sandbox), `epubTheming.ts` (normalization + injection), `chineseContentProcessor.ts`, `selectionBridge.ts` (single pipeline). The hook becomes a thin composition returning `{book, rendition, status}`.

### D4. Duplicated 30-line title/percentage resolution in `updateProgress` vs `relocated` handler
- **Severity:** medium | **Category:** duplication
- **Evidence:** `useEpubReader.ts:423-457` (`updateProgress`) and `:476-505` (`relocated` listener) are near-identical: percentage from CFI, spine lookup, synthetic-TOC-aware `findTocItem` title resolution, `onLocationChange` invocation.
- **Impact:** Fixes applied to one branch miss the other (classic AI-agent one-off pattern).
- **Fix:** Single `resolveLocationInfo(location, book, optionsRef)` helper used by both.

### D5. Unconditional `flow()` + re-`display()` on every settings change
- **Severity:** medium | **Category:** correctness/performance
- **Evidence:** The settings effect (`useEpubReader.ts:841-1003`) runs on any of 13 deps (theme, fontSize, fontFamily, lineHeight, pinyin size…). It always calls `(r as any).flow(viewMode…)` (`:915`) and then `r.display(currentLoc)` (`:919`) even when only the theme color changed. Also re-registers the `custom` theme and full highlight palette every run.
- **Impact:** Every font-size tick triggers a full reflow + redisplay → visible flash, lost sub-page scroll position in scrolled mode, and extra `relocated` events feeding the history recorder.
- **Fix:** Split into three effects keyed on their actual inputs (theme colors / typography / flow mode); only call `flow()`+`display()` when `viewMode` changes.

### D6. Reading-history capture races and double-writes
- **Severity:** high | **Category:** correctness
- **Evidence:** `onLocationChange` fires an async `prepareUpdates()` per relocation (`ReaderView.tsx:252-312`) that awaits two `snapCfiToSentence` calls against the live `Book`, then writes `updateReadingSession`. Rapid page flips create concurrent in-flight calls whose `updateReadingSession(bookId, location.start.cfi, …)` writes can complete **out of order**, persisting a stale `currentCfi` as latest. The unmount path writes the same range again via `addCompletedRange` (`:505-523`) without snapping, so the same segment can be recorded twice with different boundaries. The "Chapter" placeholder filter is string-matched in two places (`:282`, `:516`).
- **Impact:** Cross-device progress can jump backwards after fast navigation; history list shows duplicate segments; the snapping behavior differs between normal and unmount paths.
- **Fix:** Serialize session updates through a per-book queue (or include a monotonic sequence/timestamp that `updateReadingSession` respects); extract one `recordSession({snap: boolean})` used by both paths.

### D7. Locations generation has no cancellation; writes after destroy
- **Severity:** medium | **Category:** correctness
- **Evidence:** `useEpubReader.ts:466-471`: `newBook.locations.generate(1000).then(async () => { locations.save(); await dbService.saveLocations(...); setAreLocationsReady(true); ... })` — fired and forgotten outside the cancellable generator. If the user exits the book mid-generation, `bookRef.current.destroy()` runs (`:776-779`) while generate is still chunking; the `.then` then calls `save()`/state setters on a destroyed book/unmounted hook. No `.catch` either — unhandled rejection.
- **Impact:** Console errors, occasional zombie state updates, wasted CPU on a destroyed book; on large books generation takes minutes (hence the 2-minute jump timeout at `ReaderView.tsx:624-634`).
- **Fix:** Thread the cancellable token through; check a `disposed` flag before save/setState; add `.catch`. Longer-term: generate locations once at ingestion (offscreen pass already walks every chapter) and store them with the manifest.

### D8. `cfi-utils.ts` re-implements CFI algebra with raw string surgery
- **Severity:** high | **Category:** architecture/correctness
- **Evidence:** `generateCfiRange` computes common prefixes by character comparison with delimiter backtracking (`cfi-utils.ts:188-230`); `tryFastMergeCfi` is ~130 lines of index arithmetic with mid-function design uncertainty in comments ("Wait, we need 'epubcfi(PARENT,' part." `:548`); `snapCfiToSentence` hardcodes the `'en'` segmenter (`:418`) — wrong sentence boundaries for the app's flagship Chinese books; assertion-tested fallbacks (`mergeCfiSlow`) exist *because* the fast paths are not trusted.
- **Impact:** CFI strings are the **primary key of all user data** (progress, annotations, history, TTS queue, vocabulary). String-level merging that disagrees with epub.js's grammar (assertions, ID brackets `[chap01]`, indirection steps) silently corrupts ranges; bugs here are data-corruption bugs synced via Firestore to every device.
- **Fix:** Build the canonical implementation on parsed `EpubCFI` components (epubjs's class is already imported); keep the string fast-paths only with property-based tests proving equivalence to the parsed path (some equivalence testing exists — extend it and gate the fast path behind it). Pass the book language to the segmenter.

### D9. Rendition/Book instances leak across the whole app; store holds rendition closures
- **Severity:** high | **Category:** architecture (leaky abstraction)
- **Evidence:** `rendition`/`book` are passed into `TOCPanel` (`panels/TOCPanel.tsx:33`), `ReadingHistoryPanel` (reaches into `(rendition as any).book.spine/navigation/locations`, `ReadingHistoryPanel.tsx:89-101`), `SearchPanel` (book), `ContentAnalysisLegend`, `ReaderTTSController` (sweeps `view.pane.element` internals), `CompassPill` via `rendition?: any` prop (`CompassPill.tsx:38`). `useReaderUIStore` stores function refs `jumpToLocation`/`playFromSelection` (`useReaderUIStore.ts:19-22`), and chapter nav is a window CustomEvent (`ReaderView.tsx:896-915`). `(rendition as any).manager.container` is touched in 3 files.
- **Impact:** epub.js's private API surface (manager, pane, views) is load-bearing in 8+ components — upgrading or replacing the renderer requires touching everything; lifecycle bugs (component holding a destroyed rendition) are easy to create.
- **Fix:** Introduce a `ReaderEngine` facade (interface: `display(target)`, `next/prev`, `getRangeRect(cfi)`, `addHighlight/removeHighlight(layer, cfi, style)`, `onRelocated`, `resolveSection(cfi)`, `search index source`) provided via context. Components depend on the interface; only the engine module imports epubjs. This also makes a future renderer swap (e.g. foliate-js) feasible.

### D10. Six overlay systems, three styling sources, no layer manager
- **Severity:** high | **Category:** architecture
- **Evidence:** Annotations diff (`ReaderView.tsx:647-740`), TTS highlight with manual `g.tts-highlight` DOM sweeps in **three places** (`ReaderTTSController.tsx:64-69, 96-107, 132-143` — acknowledged workaround for epub.js orphaning nested SVG annotations), history highlight (`useHistoryHighlights.ts:68-107`), debug highlights (`ReaderView.tsx:755-814`), marker portal, pinyin portal. Class styling duplicated with **conflicting opacities**: `useEpubReader.ts:861-872` (0.3/0.4) vs `ReaderHighlightsStyles.tsx:9` (0.8/0.4). Audio-bookmark highlight pattern defined in a third place (SVG `<defs>` in parent doc).
- **Impact:** Highlight z-fighting/orphaning bugs recur (the DOM sweeps are scar tissue); a theme change requires editing two files; each new overlay re-invents add/remove bookkeeping.
- **Fix:** One `HighlightLayerManager` owning all epub.js annotation calls (layers: `annotation`, `tts`, `history`, `debug`), with a single style registry that emits both iframe CSS and parent-doc SVG CSS; geometry overlays (`pinyin`, markers) share one measured-portal primitive built on `useCfiCoordinates`.

### D11. CompassPill triage's rendition-dependent path is dead — prop never supplied
- **Severity:** medium | **Category:** dead-code/correctness
- **Evidence:** `ReaderControlBar` is mounted only in `RootLayout.tsx:21` as `<ReaderControlBar />` — its `rendition?: unknown` prop is never passed, so `CompassPill.tsx:257-271` ("if the user adjusted the selection, use the new bounds") can never execute; audio-bookmark triage always falls back to the original dragnet range.
- **Impact:** A shipped feature (refining audio bookmarks by adjusting selection) silently doesn't work; the fallback masks it.
- **Fix:** Either route the engine facade through context so the pill can use it, or delete the adjustment path and its prop plumbing.

### D12. Dead code & doc drift inside the subsystem
- **Severity:** medium | **Category:** dead-code/hygiene
- **Evidence:** `src/hooks/useBookProgress.ts` has zero importers (the live one is `useReadingStateStore.ts:449`) and contains a stray AI artifact comment ("Actually, looking at the project, I don't see react-query…" `:5`). ReaderView's `lexiconOpen/lexiconText` state is never set (`ReaderView.tsx:849-850`) → a permanently-closed third `LexiconManager` instance (others mounted by `ReaderControlBar` and `UnifiedAudioPanel`). `STATIC_READER_STYLES` is an empty string still injected per chapter (`useEpubReader.ts:38-39`, `:585`). `src/components/reader/README.md:20-21` documents `AnnotationPopover.tsx` and `GestureOverlay.tsx` which do not exist. `index.ts` is an empty stub. Custom-theme link color fallback is invalid 5-digit hex `'#0000e'` (`useEpubReader.ts:853`). Duplicate selector for `setJumpToLocation` (selected but unused at `ReaderView.tsx:119`, re-subscribed at `:455-457`).
- **Impact:** Noise misleads both humans and the AI agents that maintain this codebase; the duplicate hook invites importing the wrong (non-Yjs-aware) implementation.
- **Fix:** Delete dead hook/state/empty constants; regenerate README; fix the hex literal.

### D13. Test sprawl: split locations, duplicated suites, DB-layer mocks of a retired path
- **Severity:** medium | **Category:** testing
- **Evidence:** Tests live in both `src/components/reader/*.test.tsx` (7 files) and `src/components/reader/tests/` (10 files); `ReaderTTSController.test.tsx` exists in **both** with different mock strategies (diff confirms divergence). Single-bug regression files (`ReaderView_VersionCheck.test.tsx`, `TTSQueue_AutoScroll.test.tsx`). `tests/ReaderView.test.tsx:15-60` mocks the legacy `db/db` `getDB()` shape inline (~60 lines) even though ReaderView now reads metadata from stores ("Phase 2"), so tests pass against a data path production no longer uses.
- **Impact:** Duplicated suites drift; mocks of retired layers give false confidence; god-component tests are brittle (must mock epubjs + router + 4 stores to render anything).
- **Fix:** Consolidate under `tests/`, kill duplicates, replace `getDB` mocks with store fixtures; after decomposition (D2) test the extracted units (session recorder, annotation layer) without epubjs mocks.

### D14. Sanitizer config contains no-op directives; sandbox patch neutralizes iframe sandbox
- **Severity:** medium | **Category:** security
- **Evidence:** `sanitizer.ts:52`: `FORBID_ATTR: ['on*', 'javascript:', 'data:', 'formaction']` — DOMPurify matches exact attribute names; `'on*'`, `'javascript:'`, `'data:'` are not attribute names and do nothing (event handlers are stripped by DOMPurify defaults, so this is masked, not broken). Meanwhile `patchIframeSandbox` (`useEpubReader.ts:24-36`, duplicated at `offscreen-renderer.ts:15-27`) adds `allow-scripts` **and** `allow-same-origin` to every content iframe — that combination makes the sandbox attribute security-equivalent to no sandbox for same-origin content, so the entire XSS posture rests on DOMPurify alone.
- **Impact:** Cargo-cult config invites false security assumptions; a DOMPurify bypass = full app compromise (IndexedDB user data, OAuth tokens in scope).
- **Fix:** Clean the config to express real intent; document that sanitization is the sole boundary; consider keeping `allow-same-origin` only (epub.js needs same-origin for CFI/selection; verify whether `allow-scripts` is actually required now that content is sanitized — the comment claims it is for WebKit event handling, worth a targeted test).

### D15. Pinyin/Chinese processing is wired through the rendering hook with per-character Range measurement
- **Severity:** medium | **Category:** performance/architecture
- **Evidence:** `processChineseContent` (`useEpubReader.ts:601-699`) creates a `Range` and calls `getBoundingClientRect()` **per CJK character** on every content load and every pinyin/Traditional toggle; caches originals on expando props (`(textNode as any)._originalText`, `:643-648`); re-runs over all loaded contents on any of `forceTraditionalChinese|showPinyin|pinyinSize` (`:831-839`). The callback type is `positions: any[]` (`:204`).
- **Impact:** Long Chinese chapters in scrolled mode measure thousands of ranges synchronously inside the content hook → jank on chapter load; expando caching breaks if epub.js re-serializes nodes; positions don't refresh on within-chapter pagination changes triggered by relocation alone.
- **Fix:** Move into the extracted `chineseContentProcessor` module (D3); batch measurement with `IntersectionObserver`/visible-range limiting or measure per text-node once and derive per-char offsets; type the positions.

### D16. Offscreen renderer: necessary workaround, but main-thread, duplicated, and unbatched
- **Severity:** medium | **Category:** architecture/performance
- **Evidence:** `offscreen-renderer.ts:165-377` renders every chapter sequentially in a hidden div on the **main thread** (epub.js needs real DOM — comment + design), duplicating the sandbox observer and sanitize-hook registration from `useEpubReader` verbatim (`:15-27`, `:192-200` vs `useEpubReader.ts:24-36`, `:310-323`). Table snapshots run snapdom per `<table>` inline in the same loop (`:310-331`). Yield strategy is hand-tuned (`:347-350`).
- **Impact:** Importing a large book locks up the UI in bursts; any change to sanitize/sandbox logic must be made twice or live-reader CFIs diverge from ingested TTS CFIs (the exact failure class the offscreen renderer exists to prevent).
- **Fix:** Extract shared `epubSecurity.ts` (sanitize hook + sandbox patch) used by both; keep the offscreen pass (it is the right call given epub.js) but consider moving it into a dedicated iframe/window or chunking with `scheduler.postTask`; emit locations (D7) during the same pass.

### D17. `useEpubReader` subscribes to the entire preferences store
- **Severity:** low | **Category:** performance
- **Evidence:** `useEpubReader.ts:263`: `const { forceTraditionalChinese, showPinyin, pinyinSize } = usePreferencesStore();` — no selector, so the hook (and thus ReaderView's subtree) re-renders on **any** preference change app-wide.
- **Impact:** Unnecessary reader re-renders on unrelated settings toggles.
- **Fix:** `useShallow` selector, matching the pattern used everywhere else.

## Problematic couplings (this subsystem ↔ others)

- **Reader → TTS engine, directly:** `ReaderView.tsx:27,485,903-905,1011,1297` calls `getAudioPlayer()` (singleton) for `setBookId`, `skipToNext/PreviousSection`, `jumpTo`, `clearPauseGesture`. Play-from-selection does CFI-vs-queue Range comparisons inline (`:977-1016`). The reader knows TTS pause-gesture semantics ("Dragnet") — comments at `:1291-1297`.
- **cfi-utils → TTS:** `cfi-utils.ts:6` imports `getCachedSegmenter` from `lib/tts/segmenter-cache` — a reader-neutral CFI library depending on the TTS package.
- **TTS + store → cfi-utils:** `AudioPlayerService.ts:13`, `TextSegmenter.ts:1`, `AudioContentPipeline.ts:7`, `TableAdaptationProcessor.ts:3`, and `useReadingStateStore.ts:9` all import cfi-utils — CFI algebra is the de-facto shared kernel but lives as a loose util file.
- **Reader → content-analysis/GenAI:** `ReaderView.tsx:23,38-39` imports `contentAnalysisRepository` and `TYPE_COLORS`; debug tooling (`ContentAnalysisLegend`, 439 lines) lives in the reader directory and calls `reprocessBook` from ingestion.
- **useSmartTOC → library store internals:** `useSmartTOC.ts:72-81` does `useLibraryStore.setState(...)` surgery on `staticMetadata` from a reader hook.
- **Store-held closures + window events:** `useReaderUIStore` carries `jumpToLocation`/`playFromSelection` callbacks (`useReaderUIStore.ts:19-22`); `CompassPill → ReaderView` chapter nav uses window CustomEvent `reader:chapter-nav`.
- **Reader internals → global window:** `window.rendition`, `window.__reader_added_annotations_count`, `window.__VERSICLE_SANITIZATION_DISABLED__` (`useEpubReader.ts:318`) as E2E hooks.
- **ReadingHistoryPanel → epub.js private internals:** reaches `(rendition as any).book.locations.length()`/`navigation.forEach` (`ReadingHistoryPanel.tsx:89-101, 52-61`).

## What's good (keep)

- **Sanitize-at-serialize XSS boundary** (`spine.hooks.serialize` + DOMPurify) — the right interception point; CFIs are computed post-sanitization in both live and offscreen paths, keeping addressing consistent. Keep the architecture, clean the config (D14).
- **Geometry-overlay pattern** (`useCfiCoordinates` + portals into `manager.container` for pinyin/markers) — preserves EPUB DOM integrity (selection, CFIs, TTS) while giving React full control of ephemeral UI; scrolls in lockstep natively. This is the correct alternative to DOM injection and should become the standard overlay primitive.
- **OpenCC in-place `nodeValue` mutation with original caching** — avoids structural DOM changes that would break CFI mapping; sound concept (move it, don't redesign it).
- **Cancellable generator pattern** (`runCancellable` in the load path) for async lifecycle with cleanup — extend it to locations generation rather than replacing it.
- **Render-isolation components** — `ReaderTTSController` and `HistoryHighlighter` deliberately fence high-frequency TTS/progress updates away from ReaderView's render. The instinct is right; the facade should formalize it.
- **Locations IDB cache** (`dbService.get/saveLocations`) — avoids minutes of regeneration per open.
- **`titleResolver.findTocItem`** two-pass exact/path-resilient matching — small, tested, correct.
- **Offscreen extraction concept** — pixel-faithful sentence CFIs + dominant-font detection + table snapshots at ingestion is genuinely clever and required for TTS↔reader CFI agreement; only its packaging/duplication needs work.
- **Sidebar state via Zustand instead of router state** (`useSidebarState.ts` with documented WebKit rationale) — keep.
- **Font-size normalization** against ingested `baseFontSize/baseLineHeight` — solves real EPUB inconsistency; keep the math, extract the module.

## Target design

```
src/reader/
  engine/
    ReaderEngine.ts          // interface: display, next/prev, onRelocated, resolveSection,
                             // getRangeRect(cfi), highlight layers API, content event stream
    EpubJsEngine.ts          // ONLY file importing 'epubjs' runtime; lifecycle via runCancellable;
                             // owns sandbox patch + sanitize hook (shared epubSecurity.ts)
    epubSecurity.ts          // sanitize hook registration + sandbox patching (shared w/ ingestion)
    epubTheming.ts           // theme registry, unit normalization, font-scale math, style injection
    locations.ts             // load-from-IDB / generate-with-cancellation (or ingest-time)
  cfi/
    index.ts                 // canonical CFI algebra on parsed EpubCFI; fast paths gated by
                             // property-based equivalence tests; locale-aware sentence snapping
  overlays/
    HighlightLayerManager.ts // single owner of annotations.add/remove; layers: annotation|tts|history|debug
    highlightStyles.ts       // one source of truth → emits iframe CSS + parent SVG CSS
    MeasuredOverlay.tsx      // generic portal overlay (markers, pinyin) on useCfiCoordinates
  chinese/
    chineseContentProcessor.ts // OpenCC mutation + batched pinyin measurement
  session/
    ReadingSessionRecorder.ts  // serialized history/progress writes; one snap policy; panic save
  ui/
    ReaderShell.tsx          // <200-line composition: header, sidebars, viewer mount
    panels/…                 // TOCPanel, SearchPanel, AnnotationList, HistoryPanel (engine-facade props)
    ImportJumpPrompt.tsx, TocController.tsx
```

Key decisions:
1. **Engine facade as the epub.js firewall.** Components and stores never see `Book`/`Rendition`; they see `ReaderEngine` from context. `useReaderUIStore` stops holding closures — the engine instance registers itself with a `ReaderEngineRegistry` (or the store holds only an engine id), and CompassPill/window-event hacks become facade calls.
2. **Delete the local epubjs type stub**; rely on upstream types + a minimal augmentation inside `engine/` only.
3. **All highlights through `HighlightLayerManager`** with the orphan-sweep workaround implemented once, and one style registry.
4. **CFI algebra as a first-class `cfi/` package** (it is the data model's key format): parsed-component canonical path, fuzz/property tests, locale-aware snapping; TTS and stores import from here.
5. **Session recording is its own unit** with serialized writes (fixes D6) and a single snap policy.
6. **Ingestion reuses engine modules** (`epubSecurity`, theming probes) so live/offscreen behavior cannot diverge; locations generated at ingestion.
7. epub.js stays for now (replacement is out of scope), but after this refactor a swap to foliate-js or a custom renderer is a one-module change — that is the test of the boundary.

## Migration notes

No user-data migrations are required for the core refactor — CFI formats, IDB schemas, and Yjs structures are untouched. Order of operations:

1. **Types first (zero behavior change):** delete `src/types/epubjs.d.ts`, fix fallout with upstream types + small augmentation; remove the now-unneeded `@ts-expect-error`s in cfi-utils. This immediately shrinks the `as any` count and makes later steps safer.
2. **Extract pure modules out of `useEpubReader`** (theming math, security hooks, CSS normalization, Chinese processor) with characterization tests; the hook shrinks but its API (`{book, rendition, isReady…}`) stays stable so ReaderView is untouched.
3. **Introduce `HighlightLayerManager`** behind the existing call sites one layer at a time (TTS layer first — it has the worst workarounds), verifying with the existing TTS-highlight regression tests.
4. **Carve ReaderView**: move history capture into `ReadingSessionRecorder` (keep the exact write semantics first, then fix D6 ordering with a per-book write queue — verify with a new interleaving test), then ImportJumpPrompt, then annotation layer, then debug layer. Each extraction is mechanical and individually shippable.
5. **Introduce the engine facade** last (it touches the most consumers): implement `EpubJsEngine` wrapping the existing hook, switch panels/CompassPill/ReaderTTSController to it, remove store closures and the `reader:chapter-nav` window event. E2E hooks (`window.rendition`) move behind a `__VERSICLE_TEST__` engine handle so Playwright tests keep working.
6. **Ingestion-time locations** (D7 long-term fix) does need a data migration: add `locations` to the ingestion output and backfill lazily — on first open, if no stored locations exist, fall back to current background generation. No version bump needed since `dbService.getLocations` already handles absence.
7. **Test consolidation** (D13) can proceed in parallel: merge `reader/*.test.tsx` into `reader/tests/`, delete the divergent duplicate `ReaderTTSController` suite after porting any unique assertions, and replace `getDB()` mocks with store fixtures.

Risks to watch: WebKit-specific workarounds are load-bearing and mostly documented inline (sandbox patching, `flushSync` navigation, sidebar-store rationale) — preserve each with a targeted regression test before moving the code it lives in. The offscreen/live CFI agreement is the invariant that must never break: add an integration test that ingests a fixture EPUB and asserts the live engine can resolve every extracted sentence CFI.
