# TTS Content Pipeline (segmentation, lexicon, adaptation) — Debt Analysis

Subsystem key: `tts-content`
Scope: `src/lib/tts/AudioContentPipeline.ts`, `TextSegmenter.ts`, `LexiconService.ts`, `LexiconApplier.ts`, `lexiconSample.ts`, `TextScanningTrie.ts`, `TableAdaptationProcessor.ts`, `CostEstimator.ts`, `TTSCache.ts`, `CsvUtils.ts`, `earcons.ts`, `segmenter-cache.ts`, `processors/` (Sanitizer, RegexPatterns), `src/lib/tts.ts`, `src/data/bible-lexicon.ts`, BibleLexiconRules tests.

All paths relative to repo root. Line numbers verified against the working tree at analysis time.

---

## What it is

The content half of the TTS system: everything between "EPUB XHTML in IndexedDB" and "a string handed to a synthesis provider." It has two halves operating at different times:

1. **Ingestion-time extraction** (`src/lib/tts.ts` + `src/lib/offscreen-renderer.ts`): renders each spine item in a hidden epubjs rendition, walks the DOM, suppresses citation markers (capturing rich `CitationMarker` metadata), segments text into sentences via `Intl.Segmenter`, sanitizes each segment, maps segments back to DOM Ranges to generate CFIs, and persists `{sentences, citationMarkers}` per section plus webp snapshots of `<table>` elements.

2. **Playback-time pipeline** (`src/lib/tts/AudioContentPipeline.ts` and friends): loads persisted sentences, re-refines them against current user settings (abbreviation merging, min-length merging), builds the `TTSQueueItem[]` queue, fires background GenAI analyses (reference-section skip masks, table → narrative adaptations), and — at speak time in `AudioPlayerService` — applies the pronunciation lexicon (user rules + 403 built-in Bible rules) via `LexiconApplier` before synthesis. Cloud providers cache synthesized audio in IndexedDB keyed by SHA-256 of the *processed* text (`TTSCache`).

---

## File inventory

| File | LOC | Role |
|---|---|---|
| `src/lib/tts.ts` | 344 | **Ingestion extractor** (not a legacy layer — see Debt #7): DOM traversal, citation-marker detection/suppression, segment→Range/CFI mapping, first `refineSegments` pass. Also home of the shared `SentenceNode` type. |
| `src/lib/tts/AudioContentPipeline.ts` | 891 | God class: section loading, title resolution, queue building, preroll, abbreviation merge memo, background-analysis orchestration, reference-section detection (deterministic + Gemini), retry state machine, CFI grouping, marker attribution, ~125 lines of telemetry feature engineering. |
| `src/lib/tts/TextSegmenter.ts` | 412 | `Intl.Segmenter` wrapper (NFKD-normalizes input), regex fallback, static trie-cached `refineSegments` (abbreviation merge) and `mergeByLength`. |
| `src/lib/tts/TextScanningTrie.ts` | 342 | Allocation-free forward/reverse trie with ASCII case-fold fast path, boundary verification, lookup-table whitespace/punctuation classifiers. |
| `src/lib/tts/LexiconService.ts` | 215 | Main-thread singleton: rule CRUD against yjs-backed `useLexiconStore`, rule assembly/ordering (book-priority + global + Bible), memo cache, `getRulesHash` (dead). |
| `src/lib/tts/LexiconApplier.ts` | 152 | Pure, worker-safe rule application: regex compilation with WeakMap + keyed caches; `processInitialisms`. |
| `src/lib/tts/TableAdaptationProcessor.ts` | 295 | Cached/Gemini table-image → narrative adaptation, sentence→table-CFI mapping, `preprocessTableRoots` (buggy duplicate of `cfi-utils.preprocessBlockRoots`). |
| `src/lib/tts/TTSCache.ts` | 51 | SHA-256 keyed audio cache facade over `dbService`. |
| `src/lib/tts/CostEstimator.ts` | 85 | Session character counter (Zustand store + singleton wrapper) and hardcoded 2-provider price table. |
| `src/lib/tts/CsvUtils.ts` | 123 | `LexiconCSV` (papaparse import/export of rules) + `SimpleListCSV` (newline lists). |
| `src/lib/tts/lexiconSample.ts` | 5 | Sample CSV string for the lexicon import UI. |
| `src/lib/tts/earcons.ts` | 61 | Web Audio oscillator chimes for bookmark capture feedback. |
| `src/lib/tts/segmenter-cache.ts` | 37 | Per-locale `Intl.Segmenter` instance cache. |
| `src/lib/tts/processors/Sanitizer.ts` | 82 | Per-segment text scrubbing: page numbers, URLs→domain, bracket/author-year citations, separators, whitespace. |
| `src/lib/tts/processors/RegexPatterns.ts` | 29 | The regexes used by Sanitizer. |
| `src/data/bible-lexicon.ts` | 2899 | Data-in-code: `BIBLE_ABBREVIATIONS` (~280 strings) + `BIBLE_LEXICON_RULES` (403 regex rules). |
| `src/lib/tts/BibleLexiconRules.test.ts` | 45 | Verse-suffix pronunciation checks against the full Bible ruleset. |

Adjacent (consumers, for boundary context): `src/lib/tts/AudioPlayerService.ts` (sole consumer of `AudioContentPipeline`), `src/lib/tts/engine/EngineContext.ts` (the port boundary), `src/lib/tts/providers/BaseCloudProvider.ts` (TTSCache/CostEstimator consumer), `src/lib/offscreen-renderer.ts` + `src/lib/ingestion.ts` (extraction consumers), `src/components/reader/LexiconManager.tsx` (lexicon CRUD/trace UI), `src/store/useTTSStore.ts` (pushes the global Bible flag into LexiconService).

---

## How it works (data & control flow)

### Ingestion (once per book import)
1. `ingestion.ts:113/308` → `extractContentOffscreen(file, {locale})` (`offscreen-renderer.ts:165`). Hidden epubjs rendition displays each spine item; HTML is sanitized via a serialize hook (XSS).
2. For each chapter body: `extractSentencesFromNode` (`tts.ts:182`):
   - DOM traversal; `SUP/SUB/A/SPAN` elements matching `CITATION_TEXT_RE` are classified by `detectCitationMarkerElement` (`tts.ts:73`) — suppressed from spoken text, captured as `CitationMarker` (cfi, markerText, super, numeric, glued, leading, targetHref).
   - Text nodes accumulate into a block buffer; on block boundaries `flushBuffer` segments the buffer with `TextSegmenter.segment` (which NFKD-normalizes internally), sanitizes each segment (`Sanitizer.sanitize`), and maps segment offsets back onto the raw text nodes to build a Range → CFI via `contents.cfiFromRange`.
   - Raw sentences get `sourceIndices=[i]`, then a **first** `TextSegmenter.refineSegments` pass runs with `abbreviations: []` and default merge lists (`tts.ts:337-343`).
3. `<table>` elements are snapshotted to webp via snapdom with `cfiFromNode` CFIs (`offscreen-renderer.ts:310-331`).
4. Results persist via `dbService` as TTS content (sentences + citationMarkers) and tableImages.

### Playback (per section)
1. `AudioPlayerService.loadSectionInternal` (`AudioPlayerService.ts:1127`) → `AudioContentPipeline.loadSection` (`AudioContentPipeline.ts:53`):
   - Fetch `ttsContent` from DB; resolve title (AI analysis > synthetic/stored TOC > spine arg > `Section N`); **push title into the reader UI store** (`:104`).
   - Merge custom + Bible abbreviations (memoized, `:255-272`), then a **second** `TextSegmenter.refineSegments` with user settings (`:133-140`), optional preroll item, build `TTSQueueItem[]`.
   - Fire-and-forget `triggerAnalysis` (`:202`): (a) `detectContentSkipMask` → CFI-grouping (`groupSentencesByRoot` `:816`) → `getOrDetectContentTypes` (`:421`) which consults persisted analysis, a retry/timeout state machine, then either the deterministic enumerator detector (`:570`) or Gemini via `ctx.genAI.detectContentTypes` (with deterministic shadow run + telemetry `:688-810`); skipped raw indices flow back through `onMaskFound`. (b) `TableAdaptationProcessor.processTableAdaptations` — cached adaptations from analysis store, else Gemini vision on table snapshots; sentence indices mapped per table via `mapSentencesToAdaptations` (`TableAdaptationProcessor.ts:148`).
   - `AudioPlayerService` overlays masks/adaptations onto the queue via `PlaybackStateManager`; it also reactively re-applies adaptations when the analysis store changes (`AudioPlayerService.ts:1085`).
2. At speak time (`AudioPlayerService.ts:770-794`): rules fetched once per play-session via `ctx.lexicon.getRules(bookId, lang)` → `lexiconApplier.applyLexicon(text, rules)` (`processInitialisms` + NFKD + N sequential regex replaces) → provider. Cloud providers compute the cache key from the **processed** text (`BaseCloudProvider.ts:75`) and store audio via `TTSCache`.

The `EngineContext` port (`engine/EngineContext.ts`) is the single boundary to Zustand/Capacitor; `dbService` and GenAI fetches are deliberately direct imports (worker-safe). This boundary is real and enforced: `AudioContentPipeline` and `TableAdaptationProcessor` take `ctx` in their constructors and never import stores.

---

## Technical debt

### D1. NFKD normalization happens after offset bookkeeping → CFIs drift on non-ASCII text
- **Severity:** critical | **Category:** correctness
- **Evidence:** `TextSegmenter.segment` normalizes its input and returns indices **into the normalized string**: `src/lib/tts/TextSegmenter.ts:118-131` (`const normalizedText = text.normalize('NFKD'); … map(s => ({ index: s.index … }))`). `extractSentencesFromNode` then maps those indices onto the **raw** DOM text nodes: `src/lib/tts.ts:230-265` (`const start = segment.index; … for (const { node, length } of textNodes)` where `length` is the un-normalized `node.textContent.length`, captured at `tts.ts:319-324`).
- **Impact:** NFKD changes string length for NFC-composed characters (`é` 1 unit → `e`+`U+0301` 2 units), ligatures (`ﬁ`→`fi`), etc. Every such character before a sentence start shifts the computed Range — and therefore the persisted CFI — to the right by the cumulative drift. In French/Spanish/German/Chinese-pinyin books, sentence CFIs (used for highlight sync, progress ranges, skip-mask grouping, adaptation mapping) are progressively wrong within each block. ASCII-only English books are unaffected, which is why it survives the test suite (`Normalization.test.ts` only tests nbsp, which is length-preserving). The corrupt CFIs are **persisted at ingestion**, so fixing the code requires re-extraction of affected books.
- **Fix:** Segment the *raw* buffer (Intl.Segmenter does not require normalized input) and normalize only the output `text` of each segment; or normalize each text node's content **as it is appended** to the buffer and keep a per-node raw↔normalized offset map for Range construction. Add a regression test with composed accents and a ligature asserting Range offsets land on the correct characters. Ship with a content-version stamp + background re-ingestion (see Migration).

### D2. `preprocessTableRoots` has an escaped template literal — emits the literal string `epubcfi(${range.parent})`
- **Severity:** high | **Category:** correctness
- **Evidence:** `src/lib/tts/TableAdaptationProcessor.ts:282`: ``original: `epubcfi(\${range.parent})`,`` — the `\$` suppresses interpolation (byte-verified). Every range-CFI table maps to the *same constant junk string* as its `original`. `getParentCfi` returns that `original` on match (`src/lib/cfi-utils.ts:120-129`), and `groupSentencesByRoot` uses it as the group key/prefix base (`AudioContentPipeline.ts:842-877`).
- **Impact:** All range-CFI tables in a section share one bogus parent identity, so *distinct adjacent tables merge into a single classification group*, and prefix ancestry checks against the junk string are meaningless. Blast radius is limited to grouping quality for reference detection (the final `rootCfi` is recomputed from segment CFIs in `finalizeGroup` `:823-838`), which is why nothing crashes — a classic silent-wrong-answer bug. Not covered by `AudioContentPipeline_TableCfi.test.ts` (tests `mapSentencesToAdaptations` only).
- **Fix:** Delete `TableAdaptationProcessor.preprocessTableRoots` entirely and use the already-correct `preprocessBlockRoots` in `src/lib/cfi-utils.ts:29-42` (same shape, same sort). Add a unit test asserting `original` round-trips a range CFI.

### D3. `AudioContentPipeline` is a god class spanning six concerns, including a UI-store write
- **Severity:** high | **Category:** architecture
- **Evidence:** 891 lines containing: title resolution (`:66-101`), reader-UI mutation (`:104` `this.ctx.readerUI.setCurrentSection(...)` — a content pipeline pushing into a UI store as a side effect of loading audio), queue building + preroll + randomized empty-chapter filler (`:106-186`), abbreviation merge memoization (`:255-272`), background-analysis orchestration with two different invocation paths (`:202-248`, `:296-354`), the persisted retry/timeout state machine (`:437-459`), deterministic detection (`:570-594`), marker attribution CFI math (`:630-680`), and ~125 lines of telemetry feature engineering (`emitReferenceDetectionTelemetry` `:688-810` — body/tail marker-set overlap analysis, per-group/per-marker dumps) embedded in the playback path. The group shape `{ rootCfi; segments; fullText }` is re-declared inline in four signatures (`:421`, `:691`, `:816-818`).
- **Impact:** Any change to detection, titles, telemetry, or queue shape risks the others; the class can only be tested through 7 separate scenario test files; the telemetry block alone is 14% of the file and irrelevant to playing audio.
- **Fix:** Split into `SectionQueueBuilder` (pure: sentences+settings → queue), `ReferenceSectionDetector` (deterministic + GenAI strategies behind one interface, owning the retry state machine), `CfiGrouper` (move `groupSentencesByRoot`/`attributeMarkersToGroups` next to cfi-utils with named types), and `ReferenceDetectionTelemetry` (optional listener, injected). Title resolution moves wholly into `lib/reader/titleResolver` (it already half-lives there); the `readerUI.setCurrentSection` call moves to `AudioPlayerService`/host, not the pipeline.

### D4. Citation markers are dropped on the *primary* analysis path — results are path-dependent
- **Severity:** high | **Category:** correctness
- **Evidence:** `detectContentSkipMask` only loads `citationMarkers` when `sentences` is **not** supplied: `src/lib/tts/AudioContentPipeline.ts:369-375` (`let citationMarkers … if (!targetSentences) { … citationMarkers = ttsContent?.citationMarkers; }`). But the main path always supplies sentences: `loadSection` → `triggerAnalysis(bookId, sectionId, workingSentences, …)` (`:168-174`) → `detectContentSkipMask(bookId, sectionId, skipTypes, sentences)` (`:216`). Meanwhile the pre-warm path `triggerNextChapterAnalysis` *does* pass `ttsContent.citationMarkers` (`:331`).
- **Impact:** The Gemini classification prompt loses its strongest signal (`leadsWithMarker`, `markerDropoffIndex` — both computed from markers, `:485-501`) on the most common path. Because results are persisted and request-deduplicated, *which path runs first determines the stored classification* — nondeterministic quality for the reference-skipping feature, and the telemetry (built to tune this exact detector) records `markerCount: 0` for sections analyzed via the primary path, poisoning the offline tuning data.
- **Fix:** Make `detectContentSkipMask` accept `{sentences, citationMarkers}` together (or always fetch markers when absent regardless of sentences). One-line behavior, plus a test asserting marker hints are present when invoked from `loadSection`.

### D5. Lexicon rule assembly: memo cache never populated for books; 403 rule objects rebuilt per call
- **Severity:** high | **Category:** performance
- **Evidence:** `LexiconService.getRules` early-returns from the `bookId` branch at `src/lib/tts/LexiconService.ts:114` — *before* the `cachedGetRulesResult.set(...)` at `:141-146`. The cache is written only on the global/no-book path, but the hot caller is book-scoped (`AudioPlayerService.ts:775`). Every cache miss re-runs `Object.values`, three filter/sort passes, and re-maps all 403 `BIBLE_LEXICON_RULES` into fresh objects (`:94-108`). The fresh array also guarantees a `LexiconApplier.compiledRulesCache` WeakMap miss (`LexiconApplier.ts:72`), falling back to the per-rule string-keyed cache. At apply time every queue item runs the full sequential regex chain — 400+ `.replace` calls per sentence with the Bible lexicon on (default: `globalBibleLexiconEnabled = true`, `LexiconService.ts:18`). Additionally, `activeLexiconRules` is only invalidated on stop/pause/book/language change (`AudioPlayerService.ts:210,297,340,1011`) — never when the user edits rules, so mid-playback edits don't apply.
- **Impact:** Wasted main-thread work on every play-session start; an "optimization" cache that has never worked for its main consumer; rule edits silently ignored until pause; 400 regexes × every sentence is the dominant per-utterance CPU cost.
- **Fix:** Move the early-return below the cache write (or restructure into a single assembly function + memo decorator). Compile the Bible ruleset **once** into a module-level frozen array (stable reference → WeakMap hit). Longer term: a `CompiledLexicon` value object (rules + hash + ordering) built per (bookId, language, store-version), invalidated by a `useLexiconStore.subscribe` hook that nulls `activeLexiconRules`.

### D6. Bible-lexicon feature is hardwired across three layers with three sources of truth for one flag
- **Severity:** medium | **Category:** architecture
- **Evidence:** The effective "Bible lexicon on?" decision is computed independently in two places with different inputs: `AudioContentPipeline.ts:128-129` (`biblePref === 'on' || (biblePref === 'default' && settings.isBibleLexiconEnabled)` — reads the TTS settings snapshot) and `LexiconService.ts:91` (`… && this.globalBibleLexiconEnabled` — a private field imperatively pushed from the store at `useTTSStore.ts:365` and `:523`). The 403-rule injection block is duplicated verbatim inside `getRules` (`LexiconService.ts:94-108` and `:125-137`). `BIBLE_ABBREVIATIONS` and `BIBLE_LEXICON_RULES` are parallel datasets covering the same book names (`src/data/bible-lexicon.ts:3-71` vs `:74+`). The 2899-line data file is statically imported by `AudioContentPipeline.ts:12` and `LexiconService.ts:3`, so it ships in the main bundle for every user.
- **Impact:** A future worker-side `getRules` (the engine already routes through `LexiconPort`) would silently miss the imperative `setGlobalBibleLexiconEnabled` push and diverge from the pipeline's own computation. Duplicated injection blocks invite drift (they already differ in which preference variable they consult). Domain data bloats the bundle for non-Bible readers.
- **Fix:** One `resolveBiblePreference(perBook, globalSetting)` function used by both sites; delete the singleton's pushed boolean and read the setting through the port. Extract Bible data to a lazily-imported JSON asset behind a `SystemLexiconProvider` interface (which also makes other domain lexicons pluggable — the extensibility ask).

### D7. `src/lib/tts.ts` is not legacy — but it's a mislocated grab-bag that the engine reverse-imports
- **Severity:** medium | **Category:** architecture
- **Evidence:** The file is the live ingestion extractor (sole runtime consumer: `offscreen-renderer.ts:3,303`), yet it also owns the `SentenceNode` type that three engine modules type-import *upward* out of the `tts/` directory (`TextSegmenter.ts:2`, `TableAdaptationProcessor.ts:4`, `AudioContentPipeline.ts:11` — all `import type { SentenceNode } from '../tts'`). It bundles four concerns in 344 lines: shared types, DOM block traversal, citation-marker heuristics (`:53-156`), and segmentation glue. Its name collides with the `src/lib/tts/` directory (imports `'./tts'` vs `'./tts/...'` are easy to confuse). It also runs a **first** `refineSegments` pass at ingestion with `abbreviations: []` and default merge lists (`tts.ts:337-343`; `ingestion.ts:113` passes only `{locale}`), permanently baking some merge decisions into persisted sentences before the playback-time refinement (`AudioContentPipeline.ts:133-140`) re-merges with real settings.
- **Impact:** Layering confusion (engine ↔ ingestion circular-by-type); the double-refinement means stored data already reflects one settings regime, so "dynamic refinement" can never split below the ingest-time merges without re-ingesting; new contributors reliably open the wrong `tts` module.
- **Fix:** Move `SentenceNode`/`ExtractionResult`/`CitationMarker` consumption types to `src/lib/tts/types.ts` (or `types/tts-content.ts`); move the extractor to `src/lib/ingestion/sentenceExtractor.ts` with `detectCitationMarkerElement` as its own module; store **raw** (unrefined) sentences at ingestion and run refinement exclusively at playback.

### D8. GenAI plumbing duplicated between pipeline and table processor (incl. a prod test seam and a stale model fallback)
- **Severity:** medium | **Category:** duplication
- **Evidence:** Identical `canUseGenAI` expression including a `localStorage.getItem('mockGenAIResponse')` test hook compiled into production: `AudioContentPipeline.ts:473` and `TableAdaptationProcessor.ts:77`. Identical hardcoded fallback `configure(apiKey, 'gemini-1.5-flash')` (a long-deprecated model id): `AudioContentPipeline.ts:506` and `TableAdaptationProcessor.ts:82`. The 15-line section-title TOC walk is copy-pasted: `AudioContentPipeline.ts:512-526` and `TableAdaptationProcessor.ts:93-107` — and it re-fetches `getBookStructure` per analysis despite `loadSection` having just resolved a title through a *different* mechanism (`titleResolver`).
- **Impact:** Three copies of "is GenAI usable / configure it / what section is this" that drift independently; a mock hook reachable by any page script in production; model-name rot in two places.
- **Fix:** A single `ensureGenAIReady(ctx)` helper plus `resolveSectionTitle(structure, sectionId)` in one module; gate the mock seam behind `import.meta.env.DEV`; source the fallback model from one constant (or remove the fallback — `configure` is the host's job per the port contract).

### D9. Three divergent CFI prefix-boundary rules for the same operation
- **Severity:** medium | **Category:** duplication
- **Evidence:** "Is CFI A inside subtree B" via string prefix + separator check exists three times with **different separator sets**: `cfi-utils.ts:127` `['/', '!', '[', ',', ':']`; `TableAdaptationProcessor.ts:224` `['/', '!', '[', ':', ',']`; `AudioContentPipeline.ts:855-859` `['/', '!', ':']` — the pipeline's copy is missing `[` and `,`, so a child path that continues with an assertion bracket (`/4/2[chap1]`) or a range comma fails the descendant test and falsely splits a group. Ad-hoc `epubcfi(`/`)` wrapper stripping is re-implemented in at least five spots (`TableAdaptationProcessor.ts:186-196,209-214`, `AudioContentPipeline.ts:847-850,869`, `cfi-utils.ts:115-118`).
- **Impact:** Subtle, divergent containment semantics in the exact code paths (grouping, masking, adaptation mapping) where a wrong answer silently mis-skips or mis-adapts content; every new feature re-derives CFI string mechanics.
- **Fix:** One `cfiContains(parent, child)` / `stripCfiWrapper` pair in `cfi-utils` with the canonical separator set and exhaustive tests; replace all three inline versions.

### D10. Dead lexicon-hash machinery on the audio cache key
- **Severity:** medium | **Category:** dead-code
- **Evidence:** `TTSCache.generateKey(…, lexiconHash = '')` (`TTSCache.ts:21`) is only ever called with `''` (`BaseCloudProvider.ts:75`); `LexiconService.getRulesHash` (`LexiconService.ts:205-214`) has zero production callers (only test mocks reference it). The cache key is computed from the already-lexicon-processed text, so the parameter is conceptually obsolete — and `getRulesHash` is also *wrong* if ever revived (it ignores `matchType` and application order, both of which change output). Same SHA-256-hex boilerplate duplicated in both files.
- **Impact:** Misleads readers into believing cache invalidation depends on rule hashing; a wrong implementation lying in wait; copy-pasted crypto code.
- **Fix:** Delete `getRulesHash` and the `lexiconHash` parameter; extract one `sha256Hex(data)` util. Document that key-on-processed-text is the invalidation strategy.

### D11. Test sprawl with embedded agent monologue
- **Severity:** medium | **Category:** testing
- **Evidence:** 61 test files under `src/lib/tts/` for ~30 source files; one-bug-one-file pattern: `AudioContentPipeline_{Bible,Grouping,MarkerAttribution,StructuralAnomaly,TableCfi,TriggerAnalysis}.test.ts`, `LexiconService{Sort,Initialisms,Bible,.trace,.fuzz,.perf}.test.ts`, 9 `TextSegmenter.*.test.ts`, `TableAdaptationProcessor_Dedup.test.ts`. `Normalization.test.ts:73-99` contains ~30 lines of verbatim AI deliberation ("I should probably skip this test or fix LexiconService to normalize?… If it fails, I'll update…") as comments around a live assertion. `AudioContentPipeline_TableCfi.test.ts:8` constructs the production `createZustandEngineContext()` inside a unit test instead of `FakeEngineContext`.
- **Impact:** Refactoring any class means triaging 6-9 scattered files of overlapping setup; the suite encodes *incidents*, not *contracts*; production-context tests couple unit tests to store initialization order.
- **Fix:** Consolidate per module (one behavioral spec per class, fuzz/perf kept separate by suffix convention); port assertions, delete shells; strip narration comments; standardize on `FakeEngineContext`.

### D12. Two overlapping citation-removal mechanisms + unconditional opinionated text transforms
- **Severity:** medium | **Category:** architecture
- **Evidence:** Citations are removed structurally at the DOM level (`tts.ts:296-304` suppresses `<sup>/<a>/<span>` markers) *and* textually per segment (`Sanitizer.ts:57-65` strips `[1]`/`(Author, 2020)` patterns; `RegexPatterns.ts:17-22`). `processInitialisms` runs on **every** utterance even with zero lexicon rules and no off switch (`LexiconApplier.ts:123,140` — both apply paths call it unconditionally), silently rewriting e.g. "A. W. Tozer"→"Eigh W Tozer", "U.S.A."→"U S A.". `Sanitizer` silently deletes whole segments (page numbers `:27-29`, separators `:69-72`) with only a global `sanitizationEnabled` flag at ingest (`tts.ts:193`) — decisions baked into persisted sentences.
- **Impact:** Two mechanisms doing one job means a fix to either leaves the other's false positives (e.g. legitimate bracketed text in body prose); the unconditional initialism rewrite is invisible to users debugging pronunciation and contradicts the lexicon trace UI (it's not in the trace); ingest-time destructive sanitization can't be revisited without re-import.
- **Fix:** Make Sanitizer's citation regexes redundant (DOM suppression is strictly better-informed) and remove them after verifying with the citation-skipping integration test; fold `processInitialisms` into the rule pipeline as a visible, toggleable system rule that appears in `applyLexiconWithTrace`; run destructive sanitization at playback (on the queue copy) instead of ingest, or keep both raw and sanitized text.

### D13. Misc hygiene cluster
- **Severity:** low | **Category:** hygiene
- **Evidence:** (a) `console.error/warn` throughout `AudioContentPipeline.ts` (`:188,222,244,351,409,456,547`) and `TableAdaptationProcessor.ts` while sibling code uses `createLogger` (`tts.ts:6`, `AudioPlayerService`); (b) broken indentation of the entire try-body in `TableAdaptationProcessor.ts:41-126`; (c) `analysisPromises` typed `Map<string, Promise<any>>` with an eslint-disable (`AudioContentPipeline.ts:21-22`) and a `string | undefined | null` tri-state return (`:421`) where `undefined`="no reference" and `null`="couldn't determine" — semantics encoded in nullishness; (d) randomized, English-only `NO_TEXT_MESSAGES` filler spoken for empty chapters (`:108-119,177`) and English-only preroll (`:282-287`) regardless of book language — each random variant also gets its own audio-cache entry; (e) `CostEstimator` hardcodes 2024-era prices for only google/openai while the app ships 4+ cloud-ish providers (`CostEstimator.ts:71-84`) and wraps a 3-line Zustand store in a singleton class; (f) `LexiconCSV.generate` writes header `original,replacement,isRegex,applyBeforeGlobal` while the third column actually contains `matchType` strings (`CsvUtils.ts:66,74`), mirrored in `lexiconSample.ts:1`; (g) `unused import` comment debris (`LexiconService.ts:2`); (h) profile lookup uses raw `bookMetadata.language` as key (`AudioContentPipeline.ts:138`) while playback normalizes via `normalizeLanguageCode` (`AudioPlayerService.ts:294`) — `"en-US"` misses the `"en"` profile.
- **Impact:** Individually trivial; collectively they make the subsystem read as unowned.
- **Fix:** Logger sweep, re-indent, named `ReferenceDetectionOutcome` type, localize/normalize messages or make them deterministic, derive cost table from the provider registry, honest CSV header (accepting both on parse), normalize language before profile lookup.

---

## Problematic couplings

1. **Pipeline → Reader UI store**: `AudioContentPipeline.loadSection` writes `ctx.readerUI.setCurrentSection(...)` (`AudioContentPipeline.ts:104`) as a side effect of building an audio queue. Loading content for *analysis* must not move the user's compass UI. Belongs in `AudioPlayerService`/host.
2. **useTTSStore → LexiconService (imperative push)**: `src/store/useTTSStore.ts:7,365,523` imports the service to push `setGlobalBibleLexiconEnabled` — a store reaching *into* a service singleton, creating the third source of truth described in D6, and a wiring that a worker-hosted engine cannot see.
3. **Engine modules → `src/lib/tts.ts` (reverse type import)**: `TextSegmenter.ts:2`, `AudioContentPipeline.ts:11`, `TableAdaptationProcessor.ts:4` type-import `SentenceNode` from the DOM-coupled ingestion module above their own directory (type-only, so worker-safe, but layering-inverted).
4. **Pipeline/TAP → `dbService` direct**: by documented design (`EngineContext.ts:6-10`), but it couples the content pipeline to the IndexedDB schema (`getTTSContent`, `getTableImages`, `getBookStructure` at `AudioContentPipeline.ts:64,82,321,380,512`; `TableAdaptationProcessor.ts:60,93`); any DB-shape change fans out here.
5. **Pipeline/TAP → `epubjs/src/epubcfi` internal path import** (`AudioContentPipeline.ts:5`, `TableAdaptationProcessor.ts:2`, `cfi-utils.ts:4`) with `@ts-expect-error` on `compare` calls (`AudioContentPipeline.ts:670`, `TableAdaptationProcessor.ts:235,237`) — dependent on a library's unexported internals and untyped API.
6. **Production test seam**: `localStorage.getItem('mockGenAIResponse')` in shipping code (`AudioContentPipeline.ts:473`, `TableAdaptationProcessor.ts:77`).

---

## What's good (keep)

- **The `EngineContext` port architecture** (`engine/EngineContext.ts`) is genuinely well designed: one explicit boundary, type-derived snapshots from store signatures with zero runtime imports, documented rationale for what is and isn't abstracted, three implementations (Zustand / worker / fake). `AudioContentPipeline` and `TableAdaptationProcessor` honoring it via required constructor injection is exactly right. Preserve and extend; do not flatten.
- **`LexiconApplier` / `LexiconService` split** — pure worker-safe application vs. yjs-backed CRUD, with documented intent (`LexiconApplier.ts:1-12`). Right cut; keep.
- **`TextScanningTrie`** — careful, allocation-free, boundary-verified matching with lookup tables, case-fold cache, and both unit + fuzz tests. Keep as-is.
- **Dynamic refinement concept** — storing sentence nodes once and re-merging against current settings at playback (`refineSegments` with reference-equality trie caches) so abbreviation changes don't require re-ingestion. Keep the concept; fix the ingest-time pre-merge (D7).
- **Citation-marker capture** (`tts.ts:73-156`) — rich, well-commented metadata (super/numeric/glued/leading/targetHref, MathML guard, suppress-even-without-CFI semantics) validated by a real-EPUB integration test (`citation-skipping.integration.test.ts`) covering three publisher markup styles. Excellent.
- **Promise-dedup + persisted retry state** for GenAI analyses (in-flight map + status/lastAttempt with loading-timeout and error-backoff, `AudioContentPipeline.ts:421-459`) — sound pattern, just needs extraction.
- **Deterministic shadow detector + telemetry** for offline threshold tuning (`:419-420`, `:538-540`) — a smart evaluation loop; keep the capability, relocate it (D3).
- **Content-addressed audio caching on processed text** (`BaseCloudProvider.getOrFetch` + `TTSCache`) — invalidation-correct by construction, with in-flight request dedup.
- **CFI merge fast/slow paths** (`tryFastMergeCfi` → `mergeCfiSlow`) and `segmenter-cache` locale caching — measured, documented optimizations.
- **Offscreen extraction matching reader CFIs** (`offscreen-renderer.ts`) — rendering through the same epubjs pipeline the reader uses guarantees CFI parity; the XSS serialize hook and sandbox patching are thoughtful.

---

## Target design

**Layering** (each box pure or port-injected, worker-safe except Extraction):

```
INGESTION (main thread, DOM):
  EpubRenderer (offscreen-renderer)
    └─ SentenceExtractor  (DOM walk + CitationMarkerDetector)   [from src/lib/tts.ts]
         └─ persists RAW sentences + markers + table snapshots (content-version stamped)

PLAYBACK (engine, worker-capable):
  SectionQueueBuilder      sentences + TTSSettings → TTSQueueItem[]        [pure]
  SegmentRefiner           refineSegments/mergeByLength (TextSegmenter)    [pure, kept]
  ReferenceSectionDetector strategy = Deterministic | Gemini(shadow)       [ports: genAI, contentAnalysis]
    ├─ CfiGrouper          groupSentencesByRoot, attributeMarkersToGroups  [pure, on cfi-utils]
    ├─ AnalysisCache       persisted status/retry/dedup                    [port: contentAnalysis]
    └─ DetectionTelemetry  optional injected listener
  TableAdapter             cache → Gemini vision → sentence mapping        [kept, on cfi-utils]
  LexiconEngine
    ├─ LexiconAssembler    book/global/system rules + preference resolve   [port: lexicon]
    ├─ SystemLexicons      bible-lexicon as lazy JSON behind an interface
    └─ LexiconApplier      compiled CompiledLexicon value object           [pure, kept]
  Synthesis (out of scope) ← processed text → TTSCache (content-addressed)
```

Key decisions:
1. **One CFI containment library.** `cfiContains`, `stripCfiWrapper`, `preprocessBlockRoots` in `cfi-utils` are the only place that knows CFI string mechanics; D2/D9 disappear by deletion.
2. **Raw-at-rest, refined-at-play.** Ingestion persists unrefined sentences (plus extraction version). All merging is playback-time, making every segmentation setting retroactive.
3. **Offset-safe normalization.** Normalization happens per text node during buffering with an explicit raw↔normalized offset map (or raw-text segmentation), unit-tested against composed/ligature inputs.
4. **`CompiledLexicon` value object** — `{rules, order, language, version}` built by the assembler, cached by store version, applied by the existing applier. The Bible lexicon is one pluggable `SystemLexiconProvider` (lazy JSON), opening the door to other domain lexicons (the extensibility requirement). One preference-resolution function; the imperative store→service push is deleted.
5. **Detection as a strategy interface** with the deterministic detector as the always-available fallback, GenAI as an enhancer, telemetry as an observer. New detectors (e.g. footnote-block, poetry) become new strategies instead of new branches in a 900-line class.
6. **The pipeline never touches UI stores.** `loadSection` returns `{queue, title}`; the host decides what to do with the title.

---

## Migration notes

1. **D1 (NFKD/CFI fix) requires data migration.** Persisted sentence CFIs for books containing decomposable characters are wrong. Plan: (a) add `extractionVersion` to stored TTS content; (b) ship the fixed extractor writing v2; (c) on book open, if version < 2 *and* the book's stored text contains NFKD-unstable characters (cheap scan: `text !== text.normalize('NFKD')` per section), queue a background re-extraction (the offscreen renderer already runs on demand); (d) until re-extraction completes, playback continues on v1 data (current behavior — no regression). Pure-ASCII books can be stamped v2 without re-extraction.
2. **Raw-at-rest change (D7)** also lands behind `extractionVersion`: v2 stores unrefined sentences. Playback already runs `refineSegments`, so v1 (pre-merged) data continues to work — it just refines less. No forced migration; re-extraction upgrades opportunistically (combine with the D1 re-extract pass so books are touched once).
3. **Lexicon changes are non-destructive.** User rules live in the Yjs doc and are untouched. Replacing `bible-${i}` synthetic ids with a provider interface must keep the same matching semantics; snapshot-test `applyLexicon` output over the `BibleLexiconRules.test.ts` corpus before/after. The CSV header fix must keep `parse` accepting both old and new headers (it already skips row 0 unconditionally — preserve round-trip of previously exported files).
4. **TTSCache compatibility:** keys are SHA-256 of processed text + voice + speed. Lexicon refactors that change processed text (e.g. making `processInitialisms` a visible rule but keeping output identical) produce identical keys — verify with a golden test so users' cached audio (potentially large, paid-API-generated) survives. Removing the dead `lexiconHash` param does not change keys (it was always `''`).
5. **Deleting `preprocessTableRoots` (D2)** changes grouping behavior for sections with range-CFI tables — previously-persisted `referenceStartCfi` analyses remain valid (they key on recomputed range CFIs), but expect some sections to classify *better*; no migration needed since analyses are a cache with retry semantics.
6. **Order of operations:** (1) extract cfi-utils canonical helpers + fix D2/D9 (pure, test-covered); (2) fix D4/D5 one-liners; (3) split AudioContentPipeline along the seams in D3 (the `EngineContext` port makes this mechanical — each new class takes the same ctx); (4) lexicon assembler + system-lexicon provider (D5/D6); (5) extractor relocation + NFKD fix + versioned re-ingestion (D1/D7) last, since it carries the data migration; (6) test consolidation (D11) continuously as each module is touched.
