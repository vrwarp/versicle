# Phase 6 design — Strangler #5: reader engine + Chinese feature module

**Read at HEAD:** `fb3dcd3f09e5fb749abb42cf3359d11014cde590` (branch `claude/amazing-davinci-d7336e`).
**Caveat:** the Phase 2 implementation chain was actively committing while this was written
(tasks in flight: migrations coordinator, v6 migration, `whenHydrated()`). Phase 2 will **move
`src/store/**`** into the registry layout and `packages/` already exists
(`packages/zustand-middleware-yjs`). Every `src/store/...` path cited below must be re-resolved
against the tree at P6 execution time; the design references stores by *store name*, not path,
wherever it matters.

Inputs reconciled: `plan/overhaul/README.md` (master plan), `proposals/strangler-incremental.md`
§Phase 6, `proposals/contract-first.md` row C7 + Theme 7, `analysis/reader.md`,
`analysis/chinese.md`, `analysis/gap-third-party-licensing-provenan.md` (D5),
`prep/phase1-deletions.md` §1.23, and the actual source at HEAD.

---

## Reality check

What the analyses claim vs what HEAD shows. The analyses were written at `3b0cfcff`; Phase 0
hotfixes and Phase 1 motion have moved the tree. Every contradiction found:

1. **ReaderView is 1402 lines, not 1408** (`wc -l src/components/reader/ReaderView.tsx`).
   The popover and keyboard hotfixes shifted most cited line ranges by 4–6 lines. Corrected
   anchors at HEAD: inline `onLocationChange` history logic `ReaderView.tsx:214-317` (was
   218-321); panic save `:493-522` (was 497-526); annotation diff `:643-736` (was 647-740);
   debug highlights `:748-810` (was 755-814); `reader:chapter-nav` listener `:892-911` (was
   896-915); `scrollToText` `:913-970`; play-from-selection `:973-1018` (was 977-1016); device
   markers `:1020-1069`; `window.rendition` `:443-448`; `__reader_added_annotations_count` `:734`.
   `useEpubReader.ts` is still exactly 1006 lines and its cited anchors hold (sandbox patch
   `:24-36`, sanitize hook `:310-323`, Chinese processor `:601-699`, settings effect `:841-1003`,
   `flow()` `:915`).
2. **The keyboard-gating P0 hotfix landed and changed call sites.** `useReaderNavigation.ts` grew
   121→131 lines: it now early-returns while TTS is `playing|paused` (`:92-99`) and — new API
   surface — registers on the rendition's forwarded iframe keydown stream
   (`(rendition as any).on/off('keydown', …)`, `:118-128`). `ReaderTTSController.tsx` grew
   210→229: arrows act only when `ttsOwnsKeys` (`:189-199`), Space defers to focused interactive
   controls via `INTERACTIVE_TARGET_SELECTOR` (`:12-15`, `:200-212`), Escape defers to open Radix
   overlays via `OPEN_OVERLAY_SELECTOR` (`:20-24`, `:213-222`). The analyses' "destructive
   conflict" between the two registries is *mitigated but both registries remain* (explicitly
   interim until the Phase 8 `KeyboardShortcutService` — comments at
   `ReaderTTSController.tsx:12`, `useReaderNavigation.ts:92-95`). The ReaderEngine port must
   expose the iframe-keydown event the hotfix now depends on, and the characterization suite must
   pin the gating semantics, which did not exist when reader.md was written.
3. **Cast counts drifted.** reader.md claims "42 `as any` casts". HEAD grep of
   rendition/book-family casts in non-test `src/` finds **~53–64** depending on pattern (the
   hotfixes and `useCfiCoordinates` adds). The exact number is a ratchet baseline to re-measure
   in PR-3, not a spec.
4. **`epubjs.d.ts` deletion is not the "zero behavior change" step reader.md D1/migration-note-1
   implies.** `prep/phase1-deletions.md` §1.23 re-verified it as **load-bearing**: an ambient
   `declare module 'epubjs'` that *shadows* the package's shipped types, so deleting it changes
   the type universe of every epubjs import, with typecheck fallout including the two
   `@ts-expect-error` directives in `cfi-utils.ts:252,273` becoming *unused-directive errors*.
   Phase 1 deliberately did not delete it. This design owns the audit's "typed refactor task"
   path (§Design 8).
5. **Phase 1 motion renamed import paths the analyses cite.** Repo-wide aliases
   (`@store/ @hooks/ @lib/ @app/ ~types/`); `getAudioPlayer` now lives at
   `@app/tts/mainThreadAudioPlayer` (`ReaderView.tsx:27`), not `lib/tts.ts`;
   `contentAnalysisRepository` at `@app/repositories/ContentAnalysisRepository`
   (`ReaderView.tsx:23`); `types/db.ts` is a re-export shim over six domain modules (shim
   deletion deadline P9).
6. **Several dead-code findings are already resolved.** `src/hooks/useBookProgress.ts` (reader.md
   D12) — deleted. `src/lib/utils/script-loader.ts` (chinese.md CH-10) — deleted. Residual D12
   items still live at HEAD: the permanently-closed third `LexiconManager` (`ReaderView.tsx:845-846`
   — the setter is now dropped, `const [lexiconText] = useState('')`, but the dead instance at
   `:1377` remains), empty `STATIC_READER_STYLES` (`useEpubReader.ts:38-39`), invalid hex
   `'#0000e'` (`useEpubReader.ts:853`).
7. **The Yjs wiring under the vocabulary store changed.** `useVocabularyStore.ts` now imports the
   *vendored workspace* fork (`packages/zustand-middleware-yjs`) and `getYDoc()/getYjsOptions()`
   from `store/yjs-provider.ts`; persistence boots via the C11 bootstrap
   (`src/app/boot/yjsPersistence.ts`), and `CURRENT_SCHEMA_VERSION` is already **6**
   (`yjs-provider.ts:18`) with the `CrdtMigration` coordinator live at `src/app/migrations.ts`
   (meta.schemaVersion + `library.__schemaVersion` dual-read, atomic per-step transactions,
   checkpoint-before-migrate). chinese.md's suggestion to guard the vocab migration with a
   `__schema: 2` key predates all of this; §Design 7.5 supersedes it.
8. **Target geography in the strangler doc is stale.** Phase 6 scope there says
   `lib/reader-engine/`, `lib/cfi/`, `features/chinese/`. The adopted synthesis (README §2,
   geography migration rule) lands replacement code at final addresses:
   `src/domains/reader/engine/`, `src/kernel/cfi/`, `src/domains/chinese/`. Contract-first's
   C7 path (`src/reader/engine/`) and its phase numbering ("Phase 5 — reader engine") are
   likewise superseded by the README roadmap (reader+chinese = **P6**, gated on P5c).
9. **Window test globals were consolidated (Phase 1 task) — but not the reader's.**
   `window.__versicleTest` exists (`src/test-api.ts`, `flushPersistence` etc.), yet
   `window.rendition` (`ReaderView.tsx:443-448`), `window.__reader_added_annotations_count`
   (`:734`) and `window.__VERSICLE_SANITIZATION_DISABLED__` (`useEpubReader.ts:318`) are still
   raw globals, load-bearing in at least 6 E2E specs (`test_journey_progress_bar.spec.ts:18-20`,
   `test_journey_sync_scenarios.spec.ts:136-140,284,318`, `test_journey_visual_reading.spec.ts:117,131`,
   `test_journey_long_read.spec.ts:157`). PR-7 must migrate handle + specs atomically.
10. **The sanitization-disable bypass is reachable in prod builds.** The
    `__VERSICLE_SANITIZATION_DISABLED__` check at `useEpubReader.ts:318` is not gated on
    `DEV || VITE_E2E` (boundary rule 9 violation); the offscreen renderer has *no* bypass.
    `verification/utils.ts` sets the flag on every page (documented honesty gap in its README).
    §Design 3 closes the gate; the characterization plan runs CFI-bearing specs with
    sanitization ON.
11. **Licensing reality moved.** `third-party/inventory.json:49-58` now carries the CC-CEDICT
    entry with `version: UNKNOWN` and the header-stripping provenance note (gap report D5);
    `public/dict/cedict.json` is still git-tracked (15.1 MB blob), `compile-dict.cjs` still has
    the silent 11-entry mock fallback (`:48-65`) and is still absent from `package.json` scripts.
    `src/sw.ts` still has precache only — no runtime caching route for the dictionary.
12. **Chinese bugs verified intact at HEAD:** CH-1 code-unit indexing (`useEpubReader.ts:663-693`:
    `for (let i = 0; i < currentText.length; i++) … pinyinArray[i]`); CH-2 replace-not-merge
    (`:696-698`; effect deps `[isReady, forceTraditionalChinese, showPinyin, pinyinSize]` at
    `:839` — no relocate/resize/language reactivity); CH-6 displayed-script vocab keys
    (`PinyinOverlay.tsx:61` filter; `CompassPill` triage writes `popover.text` chars); CH-7
    unguarded `nodeValue` mutation (`:650-660`).
13. **Test sprawl (D13) unchanged:** duplicate `ReaderTTSController.test.tsx` exists in both
    `src/components/reader/` and `src/components/reader/tests/`; `tests/ReaderView.test.tsx`
    still mocks the retired `getDB()` path; one-bug files (`ReaderView_VersionCheck`,
    `TTSQueue_AutoScroll`) remain.
14. **Verification suite shape** (for the characterization design): 74 specs + `utils.ts`
    fixture (`getReaderFrame`, `resetApp`, `flushPersistence` waits), Docker entrypoint, no
    `toHaveScreenshot` goldens, `create_test_chinese_epub.cjs` generates the Chinese fixture —
    **without astral-plane characters** (grep confirms). The fixture generator must be extended.
15. **`HistoryHighlighter`/`useHistoryHighlights` live under `src/components/reader/`** (not
    `src/hooks/`); `useHistoryHighlights.ts` is 108 lines with its own test — matches the
    analysis inventory but worth noting since other hooks moved in P1.
16. **Search/ingestion also import epubjs** (`lib/search.ts:2` type-only `Book`;
    `lib/ingestion.ts:1` runtime `ePub`; `lib/offscreen-renderer.ts:1` runtime). The P6 exit
    criterion "only reader-engine imports epubjs" cannot be absolute until P7 — the lint flip
    needs named, deadlined exceptions (§Design 3, §Execution PR-7).

---

## Design

### 1. P5c → P6 handoff: the CFI kernel contract

P6 is gated on P5c's canonical CFI kernel. No P5 prep doc exists yet, so **this section is the
handoff contract** the P5c designer must satisfy and P6 will consume.

**Home:** `src/kernel/cfi/` (README §2: kernel owns "canonical CFI algebra"; the strangler doc's
`lib/cfi/` is stale). **Import carve-out:** boundary rule 8 ("only `domains/reader/engine/`
imports epubjs") gets an explicit second sanctioned specifier: `kernel/cfi/**` may import
**only** `epubjs/src/epubcfi` (the worker-safe submodule — rationale comment at
`cfi-utils.ts:1-3`; the worker-chunk gate already proves no DOM-heavy epubjs reaches the TTS
worker). Full `epubjs` stays banned outside the reader engine.

Surface, derived from today's `cfi-utils.ts` exports (`:8-463`) and its three live consumer
groups (reader: `ReaderView.tsx:29`, `ReadingHistoryPanel.tsx:3`; store:
`useReadingStateStore.ts:9`; TTS: `AudioPlayerService`/`TextSegmenter`/`AudioContentPipeline`/
`TableAdaptationProcessor`):

```ts
// src/kernel/cfi/index.ts  (P5c lands this; P6 adopts it)
export interface CfiRangeData { parent: string; start: string; end: string;
  rawStart: string; rawEnd: string; fullStart: string; fullEnd: string }
export interface PreprocessedRoot { original: string; clean: string }

export function parseCfiRange(range: string): CfiRangeData | null
export function generateCfiRange(start: string, end: string): string
export function mergeCfiRanges(ranges: string[], newRange?: string): string[]
export function getParentCfi(cfi: string, knownBlockRoots?: string[] | PreprocessedRoot[]): string
export function preprocessBlockRoots(roots: string[]): PreprocessedRoot[]
export function compareCfi(a: string, b: string): number   // parsed-component canonical path
export function generateEpubCfi(range: Range, baseCfi: string): string

// Sentence snapping, decoupled from epubjs Book and from the hardcoded 'en'
// (today: snapCfiToSentence(book, cfi) at cfi-utils.ts:393, segmenter 'en' at :418):
export interface CfiRangeResolver { getRange(cfi: string): Promise<Range | null> }
export function snapCfiToSentence(resolver: CfiRangeResolver, cfi: string, locale: string): Promise<string>
```

P5c obligations (already in its scope per README/strangler): property-based equivalence tests
gating every string fast path (`tryFastMergeCfi`, the `mergeCfiRanges` fast path) against the
parsed-component reference, on composed-accent/CJK fixtures; **`segmenter-cache` moves from
`lib/tts/segmenter-cache.ts` into `kernel/`** (kills the cfi-utils→TTS import at
`cfi-utils.ts:6`, reader.md coupling #2); locale parameter threaded.

P6 obligations: `ReaderEngine` implements `CfiRangeResolver`; reader + `useReadingStateStore`
swap `@lib/cfi-utils` for `@kernel/cfi`; `lib/cfi-utils.ts` becomes a pure re-export shim whose
deletion is a P6 exit criterion (TTS consumers will already be on the kernel from P5c).
**Locale-aware snapping is a behavior change** for non-English books: it ships behind the same
characterization discipline as everything else — the session-recording characterization is
captured with `'en'` behavior first, and the locale flip is its own commit with a
Chinese-fixture assertion (sentence boundaries at `。`).

Slip plan: if P5c hasn't landed when P6 starts (tracks A/B parallelism), PRs 0–5 below have no
kernel dependency; PR-6+ block on it. Do **not** bridge with cfi-utils — that would migrate the
recorder twice.

### 2. ReaderEngine port (contract C7)

#### 2a. The actual epubjs surface at HEAD (what the port must cover)

Every rendition/book API touched by live code (file:line at HEAD; `(as any)` = untyped under the
current stub):

| API | Call sites |
|---|---|
| `rendition.display(target?)` | ReaderView 459, 571, 606, 675, 1292, 1302, 1342, 1356, 1389; ReaderTTSController 64, 135; ContentAnalysisLegend 168 |
| `rendition.next()/prev()` | ReaderView 883, 888 |
| `rendition.on/off('relocated'│'selected'│'click')` | useEpubReader 476, 507, 515; useCfiCoordinates 90, 93; ContentAnalysisLegend 152, 156 |
| `rendition.on/off('keydown')` *(new — P0 hotfix)* | useReaderNavigation 120, 127 |
| `rendition.annotations.add/remove` | ReaderView 652, 667, 705, 759, 789; ReaderTTSController 89, 105, 141, 157; useHistoryHighlights 78, 99 |
| `rendition.getRange(cfi)` | useEpubReader 509; ReaderView 679, 981, 991; useCfiCoordinates 48; ContentAnalysisLegend 143, 173 |
| `rendition.getContents()` | useEpubReader 755, 836, 978; ContentAnalysisLegend 188 |
| `rendition.manager.container` | ReaderView 418; useCfiCoordinates 39, 100, 110; PinyinOverlay/AnnotationMarkerOverlay portal targets |
| `rendition.manager.getContents()[0].window` | ReaderView 681 (audio-bookmark select) |
| `rendition.views()[].pane.element` | ReaderTTSController 72, 109, 145 (orphan SVG sweeps) |
| `rendition.themes.{register,select,fontSize,font,default}` | useEpubReader 396-411, 848-907 |
| `rendition.flow(mode)` / `rendition.spread('none')` / `rendition.resize(w,h)` | useEpubReader 915 / 384 / 815 |
| `rendition.location` | useEpubReader 426, 912 |
| `rendition.hooks.content.register` | useEpubReader 747-751 |
| `book.spine.hooks.serialize.register` | useEpubReader 313-315; offscreen-renderer 194-200 |
| `book.spine.get(target)` | useEpubReader 437, 486; ReaderView 775, 1050 |
| `book.locations.{generate,save,load,percentageFromCfi,cfiFromPercentage,length}` | useEpubReader 431, 459-472, 480; ReaderView 569, 604; ReadingHistoryPanel 89-101 (via `(rendition as any).book`) |
| `book.loaded.navigation` / `book.navigation` | useEpubReader 387; ReadingHistoryPanel 52-61 |
| `book.load(url)` | useSmartTOC (chapter text for Gemini) |
| `book.ready` / `book.destroy()` / `ePub()` / `book.renderTo` | useEpubReader 473, 305, 308, 332; offscreen-renderer 189, 206 |
| `contents.cfiFromRange(range)` | useEpubReader 738; offscreen-renderer (sentence extraction) |
| `EpubCFI` (submodule) | cfi-utils 4; AudioContentPipeline 5; TableAdaptationProcessor 2 |

#### 2b. The port

```ts
// src/domains/reader/engine/ReaderEngine.ts        (C7 version surface)
export interface EngineLocation {
  startCfi: string; endCfi: string; sectionHref: string; percentage: number;
  atStart: boolean; atEnd: boolean; displayed?: { page: number; total: number };
}
export interface ContentView {                       // wraps epub.js Contents
  sectionHref: string; document: Document; window: Window;
  iframeOffset: { top: number; left: number };       // scrolled-doc stacking (useEpubReader 631-634)
  cfiFromRange(range: Range): string;
}
export type ReaderEngineEvent =
  | { type: 'relocated'; location: EngineLocation }
  | { type: 'selected'; cfiRange: string; range: Range; view: ContentView }
  | { type: 'click'; event: MouseEvent }
  | { type: 'keydown'; event: KeyboardEvent }        // forwarded iframe keydown (hotfix path)
  | { type: 'contentRendered'; view: ContentView }   // per-section; chinese + overlays subscribe
  | { type: 'contentDestroyed'; sectionHref: string }
  | { type: 'resized' };

export type HighlightLayerId = 'annotation' | 'tts' | 'history' | 'debug' | 'search'; // 'search' reserved for P7

export interface ReaderEngine extends CfiRangeResolver {
  // lifecycle (engine owns runCancellable, sandbox patching, sanitize hook, locations cache)
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  destroy(): void;
  // navigation & position
  display(target: string): Promise<void>;
  next(): Promise<void>;  prev(): Promise<void>;
  currentLocation(): EngineLocation | null;
  // events
  subscribe(listener: (e: ReaderEngineEvent) => void): () => void;
  // geometry (MeasuredOverlay primitive; replaces manager.container/getRange reach-ins)
  getRange(cfi: string): Promise<Range | null>;       // CfiRangeResolver (kernel snapping)
  getRangeRects(cfi: string): { rects: DOMRectList; iframeOffset: {top:number,left:number} } | null;
  getOverlayContainer(): Element | null;
  getContentViews(): ContentView[];
  // highlights — the ONLY path to epub.js annotations (see §4)
  highlights: HighlightLayerManager;
  // structure
  getToc(): NavigationItem[];
  resolveSection(cfiOrHref: string): { href: string; index: number; label?: string } | null;
  loadSectionText(href: string): Promise<string>;     // useSmartTOC + (P7) search indexing
  // locations registry
  locations: {
    readonly ready: boolean;
    whenReady(): Promise<void>;
    percentageFromCfi(cfi: string): number;
    cfiFromPercentage(p: number): string;
  };
  // presentation (wraps themes.* + flow + forced-style injection; see semantics below)
  applyTheme(spec: ReaderThemeSpec): void;
  setFlow(mode: 'paginated' | 'scrolled'): void;
  // selection utilities (audio-bookmark triage path, ReaderView 674-685)
  selectRange(cfiRange: string): void;
  clearSelection(): void;
}
```

`EpubJsEngine.ts` is the sole runtime importer of `epubjs` (boundary rule 8; lint per §3). It
absorbs, verbatim-first: the cancellable load generator (`useEpubReader.ts:281-794`), the
sandbox MutationObserver (`:350-379`), `spread('none')`, the theme registry, the IDB locations
cache (`dbService.get/saveLocations`) **with cancellation + `.catch` added** (D7 — the
`locations.generate` promise at `:466-472` currently writes after destroy), and the resize
observer (`:797-827`). `FakeReaderEngine` (in-memory sections, deterministic geometry)
ships alongside for the conformance suite and jsdom shell tests (the contract-first
"renderer-swap smoke": the shell boots on `FakeReaderEngine` — that is the C7 acceptance test).

**Selection semantics:** today selections can fire twice — epub.js `selected`
(`useEpubReader.ts:507-513`) *and* the parallel `mouseup` pipeline (`:720-743`) both call
`onSelection` (reader.md D3). The engine emits **one** `selected` event: the mouseup pipeline
(which exists for WebKit reliability) is the source; the epub.js `selected` listener is dropped
after a characterization test pins single-fire per gesture.

**Theming semantics:** `applyTheme` takes the whole spec (theme id, custom colors, font family,
fontSize %, lineHeight, forceFont, baseFontSize/baseLineHeight normalization inputs, pinyin
min-leading flag) and internally splits into the three effects reader.md D5 prescribes — colors,
typography, flow — calling `flow()+display()` **only when the mode actually changed**. The
current always-reflow behavior is pinned by characterization first; the split is an explicit
follow-up commit (it changes relocation-event frequency, which feeds the session recorder).

**Test seam:** `window.rendition` and `__reader_added_annotations_count` move behind
`window.__versicleTest.reader` (installed by the existing `installTestApi()`):
`{ isReady, locationsTotal(), currentCfi(), highlightCount(layer), hasManager() }` — the exact
predicates the six E2E call sites poll today, as named APIs instead of epubjs internals.

### 3. `epubSecurity.ts` — one security module for both render paths

Both duplication sites at HEAD: live reader `useEpubReader.ts:24-36` (patchIframeSandbox) +
`:310-323` (sanitize hook, **with** the unconditioned `__VERSICLE_SANITIZATION_DISABLED__`
bypass) + `:350-379` (observer wiring); offscreen ingestion `offscreen-renderer.ts:15-27`
(verbatim copy) + `:194-200` (sanitize hook, **no** bypass) + its own observer.

```ts
// src/domains/reader/engine/epubSecurity.ts
export function registerSanitizeHook(book: EpubJsBookLike,
  opts: { allowTestBypass: boolean }): void   // bypass honored ONLY when
                                              // (import.meta.env.DEV || VITE_E2E) && opts.allowTestBypass
export function observeAndPatchSandbox(root: HTMLElement): () => void  // returns disconnect()
```

Live engine passes `allowTestBypass: true`; offscreen passes `false` (current behavior).
This **closes the prod-reachable bypass** (Reality #10) — a deliberate, tiny behavior change in
prod builds only, asserted by a unit test that the flag is ignored when both env gates are off.
The CFI-agreement invariant (ingested sentence CFIs must resolve against the live DOM —
reader.md's "linchpin") now has a structural guarantee: one sanitize/sandbox implementation.
`offscreen-renderer.ts` moves to `src/domains/reader/engine/offscreen/` in P6 (it is an epubjs
importer and rule 8 must account for it); its *callers* (ingestion) stay where they are until P7.

**Lint flip at P6 exit** (per-phase warn→error): `no-restricted-imports`/depcruise rule —
runtime `epubjs` allowed only in `src/domains/reader/engine/**`; `epubjs/src/epubcfi` allowed
additionally in `src/kernel/cfi/**` and (until P5c absorption completes) the two TTS pipeline
files; **named exceptions with deletion deadline P7**: `src/lib/ingestion.ts` (runtime) and
`src/lib/search.ts` (type-only `Book` — replaced in P6 PR-7 when SearchPanel moves to the
engine port, so this exception should be empty by exit; keep it listed defensively).

### 4. HighlightLayerManager + ReaderOverlay

The six overlay systems at HEAD (entry-gate characterization targets, §Test plan):

1. **User annotations** — diff effect `ReaderView.tsx:643-736`, `addedAnnotations` ref Map,
   audio-bookmark click→programmatic-select→CompassPill morph (`:665-696`).
2. **TTS sentence highlight** — `ReaderTTSController.tsx:58-121` + visibility reconciliation
   `:124-163`; orphaned-SVG DOM sweeps in **three** places (`:69-81`, `:107-118`, `:143-154`).
3. **Reading-history highlight** — `useHistoryHighlights.ts:68-107` (gray, fillOpacity 0.1) via
   `HistoryHighlighter.tsx`.
4. **Content-analysis debug highlights** — `ReaderView.tsx:748-810` (+`ContentAnalysisLegend.tsx`
   own `getRange`/`selected` wiring at `:143-188`).
5. **Note markers** — geometry portal: `useCfiCoordinates.ts` + `AnnotationMarkerOverlay.tsx`
   into `manager.container` (`ReaderView.tsx:418, 1315-1331`).
6. **Pinyin** — `processChineseContent` geometry (`useEpubReader.ts:662-693`) +
   `PinyinOverlay.tsx` portal.

Styling today comes from **three conflicting sources**: iframe `themes.default`
(`useEpubReader.ts:861-872`, fill-opacity 0.3 light/0.4 dark), parent-document
`ReaderHighlightsStyles.tsx` (`opacity = isDark ? 0.4 : 0.8` + the striped SVG pattern defs),
and inline style objects (`useHistoryHighlights.ts:84`, debug at `ReaderView.tsx:789-794`).
epub.js draws annotation SVGs in the parent document, so parent rules win for `fill` — the
**effective** rendering is what the characterization goldens capture before consolidation.

Design:

- **`HighlightLayerManager`** (engine-internal; `engine.highlights`): per-layer
  `Map<cfi, Handle>`; `add(layer, cfi, onClick?)` idempotent; `remove(layer, cfi)`;
  `clear(layer)`; `count(layer)` (feeds the test handle). It is the **only** caller of
  `rendition.annotations.*`. The orphaned-SVG sweep is implemented **once**, inside the
  manager's add/remove for layers marked `sweepOrphans: true` (only `tts` today) — semantics
  copied verbatim from `ReaderTTSController.tsx:69-81`, then the three duplicate sweeps die.
- **`highlightStyles.ts`**: one table `{ layer/class → { fill, parentFillOpacity,
  iframeBackground, blendMode(theme) } }` that *emits both* the iframe CSS (via
  `themes.default`) and the parent-doc `<style>` + SVG `<defs>` (replacing
  `ReaderHighlightsStyles.tsx`). Consolidation pins the current effective values (parent 0.8/0.4
  for SVG fills, iframe backgrounds as-is) — visual goldens prove no pixel change.
- **`ReaderOverlay`** (the C7 decorative-vs-interactive contract): a wrapper for geometry
  portals. `decorative` → `aria-hidden="true"` + `pointer-events: none` (PinyinOverlay already
  conforms — `PinyinOverlay.tsx:60-61`); `interactive` → never inside an aria-hidden container,
  required `label`, focusable children allowed (fixes the app-shell finding "focusable buttons
  inside aria-hidden overlay" for note markers). The reader iframe gets a `title` attribute set
  by the engine at content render (SR contract). `MeasuredOverlay` generalizes
  `useCfiCoordinates` (engine `getRangeRects` + relocate/resize re-measure) as the shared
  primitive for markers and pinyin.

### 5. ReaderShell decomposition map (1402 → <200 lines)

Each extraction names its HEAD source range; each is mechanical and individually shippable:

| New module (final address `src/domains/reader/ui|session/`) | Moves from (HEAD) |
|---|---|
| `ReadingSessionRecorder` (§6) | `ReaderView.tsx:214-317` (inline onLocationChange), `:493-522` (panic save), `previousLocation` ref `:68`, `historyTick` `:191` |
| `ImportJumpPrompt` | `:194-199` state, `:564-630` handlers/effects, `:1092-1111` dialog JSX |
| `AnnotationLayer` (on `engine.highlights`) | `:632-736` incl. audio-bookmark triage handler (uses `engine.selectRange`) |
| `DebugHighlightLayer` | `:748-810`; `ContentAnalysisLegend` switches to engine port |
| `TocController` | `:812-878` synthetic-TOC state machine + `useSmartTOC` wiring `:837-843` + `activeTocId` `:819-835` |
| `DeviceMarkers` (TOCPanel-local) | `:1020-1069` (uses `engine.resolveSection`) |
| `ReaderChrome` | header `:1132-1264`, sidebar mounts `:1267-1363` |
| `ReaderCommands` provider (§5a) | `handlePrev/Next` `:881-889`; chapter-nav CustomEvent effect `:892-911` (deleted); `jumpToLocation` registration `:450-466` (deleted); `playFromSelection` `:973-1018`; `scrollToText` `:913-970` (kept as command until P7 SearchSession) |
| `useEpubReader` dissolves into engine modules | lifecycle `:281-794` → `EpubJsEngine`; theming `:52-157`, `:841-1003` → `epubTheming.ts`; Chinese `:599-699` → `domains/chinese` (§7); selection `:507-513`+`:704-744` → `selectionBridge` (single pipeline); locations `:459-472` → `locations.ts`; title/percentage duplication `:423-457` vs `:476-505` → one `resolveLocationInfo` (D4) |

`ReaderShell.tsx` ends as composition: route param → engine construction (via an `app/`
controller), providers (engine context, commands), chrome, viewer mount, overlay mounts.
`useTTS()` stays at shell level. `ReaderTTSController` and `HistoryHighlighter` survive as
render-isolation components (keeper per reader.md) consuming the engine port.

#### 5a. ReaderCommands context (kills CustomEvents + callbacks-in-store)

Dead paths being replaced (cite): store-held closures `useReaderUIStore.ts:43-46` (fields),
`:53-54, 87-88` (setters), registered at `ReaderView.tsx:455-466` (jump) and `:1015-1018`
(play); window CustomEvent `reader:chapter-nav` dispatched at `CompassPill.tsx:322`, consumed
at `ReaderView.tsx:892-911`; dead `rendition` prop chain `ReaderControlBar.tsx:19,255` →
`CompassPill.tsx:38` (`rendition?: any`) — never supplied (`RootLayout.tsx:21` mounts
`<ReaderControlBar />` bare), so the audio-triage selection-refinement branch is unreachable
(reader.md D11).

```ts
// src/domains/reader/ui/ReaderCommands.tsx
export interface ReaderCommands {
  jumpTo(cfi: string): void;
  nextChapter(): void;          // TTS-aware: routes to skipToNext/PreviousSection while TTS
  prevChapter(): void;          // active, else engine.next/prev (logic from ReaderView 893-907)
  playFromSelection(cfiRange: string): void;   // queue matching via engine.getRange (973-1012)
  scrollToText(text: string): void;            // interim; dies with P7 SearchSession
  refineSelection(): { cfiRange: string; text: string } | null;  // current iframe selection
}
export const ReaderCommandsProvider: React.FC<{ engine: ReaderEngine }>
export function useReaderCommands(): ReaderCommands           // throws outside provider
export const readerCommandsRegistry: { get(): ReaderCommands | null }  // for out-of-tree mounts
```

CompassPill (mounted in `RootLayout`, outside the reader tree) consumes
`readerCommandsRegistry.get()` — registered/unregistered by the provider on mount/unmount; null
when no reader is open (pill already handles absence today via the optional callbacks). D11
resolution: the unreachable selection-refinement path becomes **reachable** via
`commands.refineSelection()` (one method, replaces the never-passed rendition prop); if the
audio-triage E2E (`test_journey_audio_bookmarking.spec.ts`) shows no UX need, delete it in
PR-14 instead — decided by the characterization run, recorded in the PR.

`useReaderUIStore` keeps only data state (toc, section, immersive, compass variant, popover);
the two callback fields and their setters are deleted — that store will have moved/registered
under P2's registry as `ephemeral` by then.

### 6. ReadingSessionRecorder (serialized)

Current bugs to preserve-then-fix (reader.md D6, verified at HEAD): per-relocation async
`prepareUpdates()` (`ReaderView.tsx:248-308`) awaits two `snapCfiToSentence` calls then writes
`updateReadingSession` — concurrent in-flight calls can commit out of order; the unmount panic
save (`:493-522`) writes the same segment *unsnapped* via `addCompletedRange`; the `'Chapter'`
placeholder filter is string-matched twice (`:278`, `:512`).

```ts
// src/domains/reader/session/ReadingSessionRecorder.ts
export interface SessionEvent { location: EngineLocation; title: string | null; viewMode: 'paginated'|'scrolled'; at: number }
export class ReadingSessionRecorder {
  constructor(deps: { bookId: string; resolver: CfiRangeResolver; locale: string;
    store: Pick<ReadingStateActions, 'updateReadingSession' | 'addCompletedRange'> })
  onRelocated(e: SessionEvent): void;   // enqueue; never concurrent
  flushSync(): void;                     // unmount panic save: drains queue, snap=false, sync
  dispose(): void;
}
```

Semantics: a per-book FIFO promise chain with a monotonic sequence number; a write whose seq is
stale when it completes is dropped (fixes out-of-order `currentCfi`). One `recordSession({snap})`
implements both paths; the placeholder filter lives once. **PR discipline:** extraction first
with byte-identical write behavior (characterization green), then the serialization fix as its
own commit with an interleaving unit test (delayed-resolver fixture: resolve relocation N after
N+1; assert final `currentCfi` is N+1's). Snapping calls kernel
`snapCfiToSentence(engine, cfi, locale)` — `'en'` first, locale flip per §1.

### 7. `domains/chinese/` extraction

```
src/domains/chinese/
  index.ts                    // registerChineseReading(engine, book) — the ONLY reader-facing entry
  engine/
    PinyinGeometryEngine.ts   // pure: (ContentView, prefs) → PinyinPosition[]; code-point safe
    TraditionalConverter.ts   // mutate/restore + length guard + run cancellation
    ChineseContentProcessor.ts// subscribes engine events; Map<sectionHref, PinyinPosition[]>
  dictionary/
    DictionaryService.ts      // IDB-backed; status surface; SW cache fallback
    compoundLookup.ts         // getCompoundWord moved from CompassPill.tsx:42-61 (pure)
  vocabulary/
    canonicalize.ts           // canonicalizeChar + generated trad→simp single-char table
    useVocabularyStore.ts     // moved (post-P2 registry address), canonical keys
    VocabularyVault.tsx       // minimal: list/search/remove/count (closes CH-10 orphan hole)
  ui/
    PinyinOverlay.tsx         // on MeasuredOverlay/ReaderOverlay(decorative)
    VocabTriageCard.tsx       // from CompassPill vocab-triage variant + VocabTile (64-159, ~671-755)
    ChineseReadingSettings.tsx// from VisualSettings.tsx:81-174
  types.ts                    // PinyinPosition (today defined in PinyinOverlay.tsx:9-16), DictEntry
```

Reader core ends with **zero** imports from `domains/chinese` (today the dependency is inverted:
`useEpubReader.ts:11-16` imports `ChineseTextProcessor`). The engine exposes a content-processor
hook (`subscribe` on `contentRendered`); `app/` composition calls
`registerChineseReading(engine, book)` only when `getBookBaseLanguage(book) === 'zh'`
(`getBookBaseLanguage` is the CH-8 interim helper — full store-boundary normalization +
inventory migration is **P7's** `updateBook` territory; P6 ships and uses the helper so the
exact-match bug at `useEpubReader.ts:606-608` dies).

**7.1 PinyinGeometryEngine (CH-1 fix).** Iterate code points with a parallel code-unit offset:

```ts
let unit = 0;
const cps = Array.from(text);                  // 1 entry per code point, matches pinyin-pro array
for (let cp = 0; cp < cps.length; cp++) {
  const ch = cps[cp];
  if (HAN_RE.test(ch) && pinyinArray[cp]) {    // index by CODE POINT
    range.setStart(node, unit); range.setEnd(node, unit + ch.length);  // offsets in CODE UNITS
    …
  }
  unit += ch.length;
}
```
The Han regex must also widen to cover Ext-B+ (`/\p{Script=Han}/u`) or pinyin for Ext-B chars
stays invisible even when alignment is fixed — pinned by the astral fixture (𠀀 U+20000 + emoji
+ BMP mix). Note `getPinyin`'s `pinyin-pro` typing (currently `any`,
`ChineseTextProcessor.ts:1-4`) gets real types (CH-11).

**7.2 ChineseContentProcessor (CH-2 fix).** Positions keyed `Map<sectionHref, PinyinPosition[]>`,
merged for the overlay; recompute/invalidate on engine `contentRendered`, `contentDestroyed`,
`relocated`, `resized`, prefs change, and book-language change (today's effect deps at
`useEpubReader.ts:839` miss all event-driven cases; activation-by-font-profile-side-effect dies).
Per-run cancellation token shared with TraditionalConverter (CH-7's interleaving hazard).

**7.3 TraditionalConverter (CH-7 guard).** Keep nodeValue mutation + `_originalText` cache
(keeper per analysis) but assert `translated.length === original.length`, skip + log via
flight-recorder on violation; pin opencc-js version; add a length-preservation test over the
full single-char table.

**7.4 DictionaryService (CH-5).** A **separate IDB database** `versicle-dict` (v1), registered
through the P3 `data/` gateway (connection registry + included in `wipeAllData()` enumeration) —
deliberately *not* a new object store in the main DB, so no main-schema version bump and no
collision with the IDB v25 migration registry; the dictionary is rebuildable static content,
not user data. Stores: `entries` (key=headword, value `[pinyin, defs]`), `meta` (source release
date, entry count, sha256 — from the §7.6 sidecar). Import: streamed chunked `bulkPut` from
`/dict/cedict.json` on first use, with progress + error surface
(`status: 'empty'|'importing'|'ready'|'error'` — fixes CH-13's silent failure). Lookup API is
async (`getEntry(word)`, `getCompound(window)`) — `VocabTriageCard` consumes it; the 80 MB
in-memory map and the any-CJK-selection fetch trigger (`CompassPill.tsx:201-202`) die; the
fetch is gated on triage-open or zh book. `src/sw.ts` gains one runtime route: CacheFirst for
`/dict/*` (the only SW change in P6; the full runtime-caching pass is P8).

**7.5 Vocabulary simplified-key canonicalization (CH-6) + its migration.**
`canonicalizeChar(ch)` backed by a generated **static single-char trad→simp table** (built by
the §7.6 pipeline; vocabulary keys are single characters by construction of the triage UI, so
the full async OpenCC converter is unnecessary at the store boundary). Three layers, all
permanent: write-path canonicalization in store actions; read-path canonicalization in the
overlay filter (`PinyinOverlay.tsx:61`) and `VocabTile.isKnown`; an idempotent **hydration sweep**
that, whenever non-canonical keys exist in `knownCharacters`, rewrites them
(`simplified: min(timestamps)`, delete traditional) inside one transaction after
`whenHydrated()` (P2 boot primitive).

*Not* a CRDT `schemaVersion` bump: old clients remain fully compatible (their traditional-key
writes are re-canonicalized by any newer client's next sweep, and suppressed correctly by the
canonical read path meanwhile), so quarantining the fleet via v7 would be gratuitous — and v7
is already earmarked for the dual-write retirement in P9. **One-in-flight format rule
(program rule 4) still applies**: this is a synced-user-data keyspace rewrite. The program's
format-change queue gains an entry: … → tts-storage split (**P5b**) → **vocabulary
simplified-key canonicalization (P6, this item)** → reading-list bookId linking (**P7**) →
font-preference rename (P8). PR-13 carries an explicit gate: P5b's straggler path verified
before merge; P7's linking migration must not start until this one is verified (if Track B
runs ahead, the two leads swap the queue order explicitly in the program log — the rule is
serialization, not a fixed owner). Per program rule 6, a two-client upgrade E2E ships with it
(§Test plan).

**7.6 cedict out of git: CI build + provenance** (licensing gap D5 + inventory entry).
`scripts/compile-dict.cjs` repaired: parse and **retain** the CC-CEDICT `#` header → emit
`public/dict/cedict.meta.json` `{sourceUrl, license: 'CC-BY-SA-4.0', releaseDate, entryCount,
compilerVersion, sha256}`; **delete the mock fallback to the production path** (`:48-65`) —
failure is fatal; `--mock` writes only to a test-fixture path; replace system `unzip` (`:70`)
with a JS lib (`fflate`); add `npm run compile-dict`; emit the §7.5 trad→simp single-char table
in the same run (same provenance). CI: a build step downloads a **pinned MDBG release** verified
by checksum, with the artifact cached (actions/cache keyed on release tag) so flaky networks
fail the step rather than degrade the artifact. `public/dict/cedict.json` leaves the git index
(`.gitignore` + build-time generation; dev bootstrap = `npm run compile-dict`); history rewrite
to reclaim the 15 MB blob is **out of scope** (program-level decision, touches every clone).
`third-party/inventory.json` CC-CEDICT entry updated (version now knowable from the sidecar);
`licenses:check` keeps passing; the credits surfaces read the release date from the sidecar in
P8's settings pass (P6 only guarantees the data exists).

### 8. `epubjs.d.ts` stub retirement (the audit's typecheck-fallout path)

Per `prep/phase1-deletions.md` §1.23 (ALIVE; refactor, not deletion). One PR, ordered **before**
engine extraction so the engine is written against honest types:

1. Add `src/domains/reader/engine/epubjs-augment.d.ts`: a *module augmentation* (not an ambient
   shadow) over upstream `node_modules/epubjs/types/*`, typing only the genuinely untyped
   internals in §2a's table: `rendition.manager` (container, getContents),
   `rendition.views()[].pane.element`, `rendition.location`, `rendition.flow/spread/resize`,
   `rendition.on('keydown', …)`, `rendition.hooks.content.register`,
   `book.spine.hooks.serialize.register`, `contents.cfiFromRange`, spine item `label`,
   annotations' style/class arguments.
2. Delete `src/types/epubjs.d.ts` in the same commit. Keep `src/types/epubjs-epubcfi.d.ts`
   (7 lines, correct, bundle-purpose — analysis and audit concur).
3. Fix fallout mechanically: upstream `types/rendition.d.ts` already types `annotations`,
   `flow()`, `getContents()`, `getRange()`, `views()`, `spread()`, and
   `types/epubcfi.d.ts` types `compare(string | EpubCFI, …)` — so most of the ~53 casts and
   **both** `@ts-expect-error` directives in `cfi-utils.ts:252,273` come *out* (tsc will flag
   them as unused — they must be removed in this PR or the build fails).
4. Casts in files this phase later deletes (`useEpubReader`, panels) are reduced
   opportunistically, not exhaustively — the `as any` ratchet (re-baselined in this PR) only
   forbids regression; the deletions in PRs 7–9 finish the count.
5. Fallback if upstream 0.3.93 types prove unsound at runtime call sites (budget: 1 day of
   fallout): keep a *thin* stub that `export *`s upstream types and overrides only the broken
   declarations, still deleting the full shadow. Decision recorded in the PR either way.

---

## Execution order

Each PR independently shippable (program rule 1); legacy paths die in the PR that replaces them
(rule 2). "Gates" = which CI/suites prove the exit.

| PR | Content | Exit criteria | Gates |
|---|---|---|---|
| **PR-0 (entry gate)** | Six-overlay + session + keyboard characterization suite (§Test plan): new E2E specs, extended Chinese fixture (astral chars), `__versicleTest` seeding helpers (`seedContentAnalysis`, GenAI debug toggle), sanitization-ON fixture variant | All characterization green against **current** implementation (astral-alignment spec annotated `test.fail()`); no production code changed | full vitest, `run_verification.sh` (new specs), tsc, depcruise |
| **PR-1** | CH-1 fix in place (`useEpubReader.ts:663-693` → code-point loop + `\p{Script=Han}`), flip astral spec to passing | Astral fixture green; no other characterization moved | pinyin characterization E2E + new unit test |
| **PR-2** | `epubSecurity.ts`; both call sites consume it; bypass env-gated | Zero duplicated sandbox/sanitize code (grep); prod-bypass unit test green | vitest, sanitization-ON E2E specs |
| **PR-3** | epubjs.d.ts retirement per §8; `as any` ratchet re-baselined | Stub deleted; `tsc -b` clean incl. test configs; both cfi-utils `@ts-expect-error` removed | tsc -b, full vitest, ratchet counters |
| **PR-4** | Pure extractions from `useEpubReader`: `epubTheming` (split-by-input effects per D5, flow change only on mode change), `locations.ts` (cancellation + catch, D7), `selectionBridge` (single pipeline, D3), `resolveLocationInfo` (D4); hook public API unchanged | Behavior pinned: selection single-fire test; theme-change-no-reflow test; D5/D7 fixes as separate commits after extraction commit | characterization E2E (visual reading, selection), reader vitest |
| **PR-5** | `HighlightLayerManager` + `highlightStyles` + `ReaderOverlay`, cut over one layer at a time (tts → history → annotation → debug); titled iframe | Zero `annotations.add/remove` outside the manager (grep gate); overlay characterization green; orphan-sweep implemented once | overlay E2E, manager unit suite, axe scan (reader surface), visual goldens |
| **PR-6** | `ReadingSessionRecorder` (extraction commit = identical writes; serialization-fix commit; locale-snapping commit) — **first kernel consumer** | Session characterization green; interleaving test green; `'Chapter'` filter single-sourced | session E2E, recorder unit suite |
| **PR-7** | `EpubJsEngine` + port under the existing shell; panels/controllers (TOCPanel, ReadingHistoryPanel, SearchPanel, ContentAnalysisLegend, ReaderTTSController, HistoryHighlighter, useCfiCoordinates→MeasuredOverlay) switch to the port; `FakeReaderEngine` + conformance suite; `window.rendition`/`__reader_added_annotations_count` → `__versicleTest.reader` **with the 6 dependent specs updated in the same PR**; epubjs lint rule → error (named P7 exceptions); `lib/search.ts` Book type replaced by `loadSectionText` | No component imports epubjs or touches Rendition/Book (depcruise error); conformance suite green on both engines; renderer-swap smoke (shell boots on Fake engine in jsdom) | full E2E (esp. progress_bar/sync_scenarios/visual_reading/long_read), conformance suite, depcruise error mode |
| **PR-8** | `ReaderCommands` + registry; store callbacks (`useReaderUIStore.ts:43-46,53-54,87-88`) and `reader:chapter-nav` (`CompassPill.tsx:322`, `ReaderView.tsx:892-911`) deleted; dead rendition prop chain deleted; `refineSelection` decision executed (D11) | grep-zero: `reader:chapter-nav`, `playFromSelection`/`jumpToLocation` in any store; CompassPill works from RootLayout via registry | compass-pill E2E ×2, audio-bookmarking E2E, scrubber spec |
| **PR-9** | ReaderShell decomposition (§5 table); ReaderView file replaced by `ReaderShell.tsx` | ReaderShell <200 lines (`wc -l` gate in CI script); all extracted units have owning suites | full reading-journey E2E, axe, vitest |
| **PR-10** | `domains/chinese` engine extraction (§7.1–7.3): geometry engine, converter, processor with per-section maps + event-driven invalidation; reader-core→chinese import direction inverted | CH-2 cases green (relocate/resize/multi-section/language-change — characterization *extended* here, deliberate behavior improvement, documented); chinese unit suite (alignment, filtering, round-trip, merging) green; `useEpubReader` Chinese imports gone | pinyin E2E (incl. new scrolled-mode case), chinese vitest |
| **PR-11** | `DictionaryService` on `versicle-dict` DB via data/ gateway + SW `/dict/*` route + triage-gated fetch; `compoundLookup` moved + tested; VocabTriageCard extracted from CompassPill | Old module-global fetch path deleted; offline dictionary E2E green; wipeAllData includes versicle-dict (unit) | chinese journey E2E + offline variant, data-layer unit, vitest |
| **PR-12** | cedict CI pipeline (§7.6): repaired compiler, meta sidecar, trad→simp table artifact, pinned download + checksum, blob out of git index | `compile-dict` fails hard on network error (test with `--mock` only for fixtures); `cedict.meta.json` in dist; repo index no longer tracks the JSON; inventory updated | `licenses:check`, CI build job, full E2E (dict still served) |
| **PR-13** | Vocabulary canonicalization (§7.5): canonicalize at write/read, hydration sweep, minimal VocabularyVault; **format-queue gate: P5b verified, P7 linking not started** | Two-client upgrade E2E green (old-doc trad keys vs new client → merged simplified, suppression works both scripts); sweep idempotence unit (run twice = same doc) | two-client E2E, vocab unit suite, chinese journey |
| **PR-14** | Exit audit: dead code (third LexiconManager + `lexiconText` state, `STATIC_READER_STYLES`, `'#0000e'` fix), test consolidation (D13: merge `reader/*.test.tsx` into `tests/`, dedupe the two `ReaderTTSController` suites via absorption ledger, replace `getDB()` mocks with store fixtures), `lib/cfi-utils.ts` shim deleted, reader README regenerated, ratchet flips verified | All Phase 6 exit criteria (below) green | everything; ratchet counters; agent-loop doc verification (program rule 10) |

**Phase exit criteria** (= strangler doc, re-anchored): only `domains/reader/engine/` imports
runtime epubjs (lint **error**; P7-deadlined exceptions for `lib/ingestion.ts` only); overlay
characterization green on the new manager; ReaderShell <200 lines; axe scans of reader+TTS
surface pass; Chinese engine unit suite green; `cfi-utils.ts` shim gone; cedict.json untracked;
vocabulary canonicalization verified (format-queue slot released to P7).

---

## Test plan

### Entry gates (land FIRST, PR-0)

**E2E characterization** (new permanent journeys under `verification/`, using the existing
`utils.ts` fixture; geometry assertions run on the `desktop` project only, smoke on `mobile`):

- `test_characterization_overlays.spec.ts` —
  1. *Annotation add/remove*: select in `getReaderFrame`, highlight via popover →
     `g.highlight-yellow` present in parent doc + count via test handle; delete from
     AnnotationList → gone (extends what `test_journey_long_read.spec.ts:157` already polls).
  2. *TTS highlight follow*: play via `tts-polyfill.js`; assert exactly **one**
     `g.tts-highlight` across sentence advance, pause/resume, and a visibilitychange round-trip
     (pins the orphan-sweep semantics of `ReaderTTSController.tsx:69-81,107-118,143-154`).
  3. *History highlight*: play, stop, page-turn → `reading-history-highlight` on lastPlayedCfi.
  4. *Note markers*: add note → portal marker button rendered in overlay container at the
     range's last rect (±4 px); click → popover + compass morph.
  5. *Debug layer*: seed analysis via new `__versicleTest.seedContentAnalysis(bookId, href,
     payload)` (extends `src/test-api.ts`), enable debug via the GenAI settings UI
     (`useGenAIStore.setDebugModeEnabled`) → `debug-analysis-highlight` present; disable → gone.
- `test_characterization_pinyin.spec.ts` — fixture from **extended**
  `create_test_chinese_epub.cjs` (adds U+20000 𠀀, an emoji, mixed lines): per-char alignment
  (overlay span center within char rect ±2 px, computed via `evaluate` over iframe + overlay);
  the astral case is `test.fail()` until PR-1; vocabulary toggle hides pinyin without geometry
  recompute; Traditional toggle round-trips text (`_originalText` restore); known-character
  suppression in both scripts (becomes the CH-6 acceptance after PR-13).
- `test_characterization_reading_session.spec.ts` — page flips append history entries with
  snapped ranges; navigate-away panic save appends the final segment; rapid-flip asserts only
  the *final* `currentCfi` (deliberately loose: the out-of-order bug is NOT pinned; PR-6
  tightens to strict ordering).
- Keyboard gating (vitest, not E2E): characterize `ReaderTTSController` + `useReaderNavigation`
  hotfix semantics — arrows page-turn when stopped / sentence-jump when playing (and **not**
  both), Space ignored on focused buttons, Escape closes overlay without stopping playback.
- Sanitization honesty: the overlay + pinyin specs run with sanitization **ON** (new opt-out of
  the `utils.ts` global disable), since CFIs are computed post-sanitize in both pipelines and
  the engine must reproduce that. Existing suites keep their current config.

**Vitest characterization:** `normalizeAbsoluteToRem` + font-scale math (pins `epubTheming`
extraction); selection single-fire (jsdom dispatch through both current pipelines); jsdom
overlay fixtures for HighlightLayerManager parity.

### Contract suites (with their PRs)

- `describeReaderEngineContract(makeEngine)` — run against `EpubJsEngine` (jsdom + fixture
  EPUB) and `FakeReaderEngine` (PR-7): display/relocate event shape, getRange/getRangeRects
  agreement, highlight layer isolation (add to `tts` never disturbs `annotation`), event
  unsubscribe, destroy idempotence, `CfiRangeResolver` conformance.
- **Offscreen/live CFI agreement** (the invariant reader.md names as never-break): integration
  test — ingest fixture EPUB through the offscreen path, open in `EpubJsEngine`, assert every
  extracted sentence CFI resolves (`getRange !== null`). Runs in CI from PR-2 (shared
  epubSecurity) onward.
- Chinese unit suites (PR-10/11/13): code-point alignment (emoji/Ext-B), per-section merge +
  invalidation matrix, traditional length-guard + round-trip, compound lookup, canonicalization
  (write/read/sweep idempotence), DictionaryService import/error/status.
- Two-client upgrade E2E (PR-13, program rule 6): captured old-format Y.Doc snapshot with
  traditional `knownCharacters` (reuse the P2 fixture-capture script pattern) vs new client.

### Existing suites that pin behavior (do not break, absorb where D13 says)

`src/components/reader/tests/*` + the 6 stray `reader/*.test.tsx` (merged in PR-14 with the
absorption ledger; the duplicate `ReaderTTSController` suites reconciled there);
`useHistoryHighlights.test.ts`; E2E: `test_journey_visual_reading`, `test_journey_chinese`
(both tests), `test_journey_audio_bookmarking` + `test_bug_audio_bookmark_dismissal`,
`test_compass_pill` ×2, `test_event_history`, `test_journey_long_read`,
`test_journey_progress_bar`, `test_journey_sync_scenarios` (the `window.rendition` pollers —
updated atomically in PR-7), `test_a11y_axe`.

### Fixture needs

Extended Chinese EPUB (astral) via `create_test_chinese_epub.cjs`; `alice.epub` for engine
conformance; seeded content-analysis payload (test-api helper); captured trad-keys Y.Doc
snapshot; `--mock` dictionary fixture (test path only); visual goldens for highlight styling
(first `toHaveScreenshot` uses — the suite currently has none; budget flake-tuning time).

---

## Risks

| Risk | Mitigation |
|---|---|
| **Upstream epubjs 0.3.93 types unsound** → PR-3 fallout exceeds budget or, worse, type-checks but lies at runtime | 1-day fallout budget with the §8.5 thin-stub fallback; engine conformance suite exercises every §2a API against the real library in jsdom, so lying types surface as test failures, not field bugs |
| **WebKit workarounds are load-bearing** (sandbox MutationObserver, `flushSync` navigation `ReaderView.tsx:1145-1151`, sidebar-store rationale, iframe keydown forwarding, mouseup selection pipeline) | Each preserved verbatim in its new home with an inline provenance comment + targeted regression test *before* the code moves (PR-4/7); the webkit Playwright project runs on PR-7 and PR-9 |
| **Orphan-sweep centralization changes TTS-highlight timing** (flicker/double-highlight regressions — the scar tissue exists for a reason) | Characterization #2 pins single-node invariant across pause/visibility cycles before PR-5; sweep logic copied byte-equivalent first, layer-gated |
| **E2E fleet breaks mid-migration on `window.rendition`** | PR-7 ships handle + all 6 dependent specs in one commit; `__versicleTest.reader` exposes the exact predicates currently polled |
| **Session-recorder serialization changes cross-device progress semantics** (out-of-order writes today can *mask* other bugs) | Extraction commit is write-identical; the ordering fix is isolated with interleaving tests; sync_scenarios E2E runs on PR-6 |
| **Locale-aware snapping shifts history ranges for zh books** | Separate commit; Chinese-fixture boundary assertion; old ranges remain valid CFIs (display-only effect) |
| **Dictionary re-platform on Android WebView** (quota, 198k-row import jank) | Chunked `bulkPut` with progress UI + yield; network-fetch fallback retained one release; SW CacheFirst as belt-and-braces; import deferred to first triage open |
| **CI cedict download flakiness silently degrades the artifact** (the historical failure mode) | Mock fallback deleted; pinned release + sha256; cached artifact; build fails hard |
| **Format-queue collision with Track B (P7)** — vocab canonicalization and reading-list linking both touch synced user data | PR-13 carries an explicit sequencing gate; the program format queue (rule 4) is amended in this doc; serialization is the rule, owner order is negotiable and logged |
| **Old clients keep writing traditional vocab keys post-sweep** | By design: read-path canonicalization makes them correct immediately; any newer client's hydration sweep compacts them; idempotence unit-tested |
| **Pinyin pixel assertions flake cross-platform** | ±2 px tolerance, desktop-project-only geometry, mobile smoke; assertions on relative alignment not absolute coordinates |
| **P5c kernel slips (parallel-track schedule risk)** | PRs 0–5 are kernel-free; the doc forbids bridging the recorder through cfi-utils (no double migration); if the slip exceeds the PR-5 horizon, P6 pauses rather than forks the CFI surface |
| **Characterization-then-improve whiplash in Chinese overlay lifecycle** (PR-10 deliberately *changes* pinned CH-2 behavior) | The improved cases (relocate/resize/multi-section) are *added* as new assertions in PR-10 itself, never silently edited; PR description enumerates every characterization delta (rule 7's spirit) |

Biggest risk overall: **PR-7** — the engine cutover touches every reader consumer plus six E2E
specs in one PR; it is kept survivable by the conformance suite, the under-the-shell adapter
strategy (engine wraps the live rendition before consumers move), and the rule that each panel
migration is a separate commit within the PR.

---

## Dependencies

**Needs from earlier phases (all verified at HEAD or named):**
- **P0:** typed harness + `installTestApi` (`src/test-api.ts` — extended in PR-0), axe
  infrastructure, license gate (`licenses:check`), keyboard/popover hotfix semantics (now part
  of the characterization surface).
- **P1:** path aliases; `app/` composition layer (engine construction + `registerChineseReading`
  live there); bootstrap registry (engine/dictionary boot tasks register, no module-scope
  side effects).
- **P2 (in flight now):** store registry — `useReaderUIStore` (ephemeral) and
  `useVocabularyStore` (synced) will have moved; PR-8/13 target the registry addresses;
  `whenHydrated()` is the vocab-sweep trigger; the CrdtMigration coordinator exists but is
  deliberately **not** used (no schema bump, §7.5).
- **P3:** `data/` gateway — `versicle-dict` DB registration + `wipeAllData()` coverage (PR-11
  cannot land before P3's connection registry exists).
- **P5b:** tts-storage split **verified** — releases the format-queue slot PR-13 occupies.
- **P5c:** `kernel/cfi` per §1 (PR-6+ hard dependency); segmenter relocation; property-test
  harness P6 reuses for any reader-side CFI fast path.

**Provides to later phases:**
- **P7:** `ReaderEngine` port + reserved `'search'` highlight layer (SearchSession's
  navigate-to-match with temporary highlight); `loadSectionText` (search indexing without
  re-unzipping); `epubSecurity.ts` for the ingestion rewrite; `getBookBaseLanguage` helper +
  the CH-8 store-boundary normalization handoff (P7 owns `updateBook` normalization + inventory
  migration); the released format-queue slot after PR-13 verification; `scrollToText` command
  deletion once SearchSession lands.
- **P8:** both keyboard registries documented + event-driven (engine `keydown` events) for the
  `KeyboardShortcutService` swap; `ChineseReadingSettings` extracted for the settings registry;
  `cedict.meta.json` for generated credits; `ReaderOverlay` as the decorative/interactive
  pattern for remaining surfaces; SW `/dict/*` route folds into the P8 runtime-caching pass.
- **P9:** `~types/db` shim deletion (reader types consumed via domain modules by then);
  ratchet completion (`as any` → 0 needs PRs 3/7/9 deltas); the absorption ledger entries from
  PR-14's test consolidation.

---

## Status — p6-shell-decomposition (2026-06-12)

The second cluster (PR-3/4/6/8/9 of §Execution + the §8 stub item) is DONE
on this branch. Reconciliations against the doc, recorded per program rules:

1. **§8 stub retirement took the §8.5 fallback** — deliberately. Upstream
   epubjs 0.3.93 declares every surface as `export default class`, and TS
   cannot declaration-merge members into a default export via module
   augmentation (under `skipLibCheck` the attempt fails silently; verified
   with a probe). The §2a untyped internals are typed in
   `src/domains/reader/engine/epubjsInternals.ts` (intersection types over
   upstream, engine-dir only); the ambient shadow IS deleted. Fallout was
   ONE import fix (`TOCPanel.test.tsx` used the stub's invented
   `NavigationItem` export) — well under the predicted scale, because the
   kernel/cfi adoption had already deleted `cfi-utils.ts` and its two
   `@ts-expect-error` directives.
2. **§5a provider shape**: `ReaderCommandsProvider` does not build the
   commands itself — TTS-aware chapter routing needs `app/tts` + the
   playback store, which `domains/reader/ui` must not import
   (domains-no-store). The shell-side controller assembles the object; the
   provider owns context + registry lifecycle. `nextPage`/`prevPage` are
   additions over the sketch so the keyboard path keeps its byte-identical
   P0 gating (raw page turns, never chapter-routed). D11 decision: made
   `refineSelection()` REACHABLE via the registry (delete-instead remains
   PR-14's option if the Docker audio-bookmarking journey shows no need).
3. **§5 geography**: domain-pure code landed at final addresses
   (`domains/reader/session/ReadingSessionRecorder`, `domains/reader/ui/
   ReaderCommands`, engine modules, `domains/chinese/engine` seam +
   `types.ts`). The React shell pieces (`ReaderShell`, `shell/*`) stay
   under `src/components/reader/` and the controller under `src/app/
   reader/` — `domains/reader/ui` cannot hold store-coupled components
   under domains-no-store; the move to the doc's `domains/reader/ui`
   address is P8/P9 territory once rule-4 read/write split lands.
4. **§6 recorder**: extraction commit write-identical, serialization fix
   isolated with the doc's delayed-resolver interleaving test. `flushSync`
   drains queued AND in-flight recordings unsnapped before the legacy
   panic segment; the in-flight pass's late async completion drops via the
   seq guard (the doc's "stale write dropped"). Dead `lexiconText`/third
   LexiconManager mount were NOT carried into the shell (PR-14 dead code,
   deleted with the file).
5. **Test seam (§2b)**: `window.rendition` / `__reader_added_annotations_
   count` → `__versicleTest.reader` + the 6 dependent specs had ALREADY
   landed with the engine-port item; verified, no action.
6. **A11y**: engine-titled iframes + ReaderOverlay note markers + the new
   `<main>` landmark in ReaderShell; `test_a11y_axe.spec.ts` gains a
   per-rule ratchet (`expectAbsentRules: ['frame-title',
   'aria-hidden-focus']` on the reader surface, always-on). `region` stays
   un-asserted until P8 dissolves the RootLayout CompassPill mount.
   EXECUTION NOTE: the Playwright specs are typechecked here (tsc -b e2e
   project); the Docker lane (`./run_verification.sh`) must run the
   reading/sync/compass/audio-bookmarking journeys + `@a11y` before the
   phase closes.
7. **D5 lands**: theme-only changes no longer flow()+display() — the
   relocation-event-frequency change the doc predicted is pinned by
   useEpubReader_Theming.test.tsx (hook tier) + epubTheming.test.ts
   (module tier). D3 single selection pipeline pinned by
   useEpubReader_Selection.test.tsx.

Remaining Phase 6 items (other work packages): PR-1 CH-1 fix, PR-10–13
(chinese engine/dictionary/cedict/vocab canonicalization — vocab is CRDT
v7 per the program decision), PR-14 exit audit (incl. D13 test
consolidation + the duplicate ReaderTTSController suites).
