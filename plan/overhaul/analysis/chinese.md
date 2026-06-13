# Subsystem Analysis: Chinese Language Features

Analyzed: 2026-06-10. All paths relative to repo root. Line numbers from current worktree state (branch `claude/amazing-davinci-d7336e`).

## What it is

The Chinese-language feature set turns Versicle into a Mandarin learning reader: per-character pinyin annotations rendered above book text, on-the-fly Simplified→Traditional conversion, an offline CC-CEDICT dictionary for character/compound lookup, and a Yjs-synced "known characters" vocabulary that suppresses pinyin for characters the user has mastered ("Smart Pinyin"). It is activated per book by `UserInventoryItem.language === 'zh'` (set at EPUB ingestion from `<dc:language>`, overridable in Visual Settings).

The feature was designed across three plan docs (`plan/zh-prd.md`, `plan/zh-plan.md`, `plan/zh-smart-pinyin-design.md`) and shipped in pieces. The runtime code itself is small (~350 lines of dedicated code), but its two most complex parts — pinyin geometry collection and the vocab-triage UI — are **not** in dedicated modules; they live inline inside the two biggest god files in the app (`useEpubReader.ts`, `CompassPill.tsx`).

## File inventory

| File | Role |
|---|---|
| `src/lib/chinese/ChineseTextProcessor.ts` (34 ln) | Lazy-load wrapper for `opencc-js` (cn→tw converter) and `pinyin-pro`; two-phase API (`ensureX()` async, `getPinyin`/`toTraditional` sync, throw if not loaded). Both modules typed `any`. |
| `src/lib/chinese/benchmark.test.ts` (23 ln) | Assertion-free "test" that `console.log`s a perf number. Not a real test. |
| `src/hooks/useEpubReader.ts:599-699, 831-839` | `processChineseContent`: the actual pinyin/traditional engine. Inline closure inside the 1006-line reader god hook. Walks text nodes in the epub.js iframe, mutates `nodeValue` for Traditional mode, computes per-character bounding rects for pinyin, emits `PinyinPosition[]` via callback. Registered as an epub.js content hook (line 749) and re-run on pref change via a ref (837). |
| `src/components/reader/PinyinOverlay.tsx` (85 ln) | Presentational overlay: portals absolutely-positioned pinyin `<span>`s into the epub.js scroll container; filters out known characters at render time; computes text-shadow color from theme. |
| `src/components/reader/ReaderView.tsx:196, 361-363, 490-494, 535, 1313-1318` | Holds `pinyinPositions` state, wires callback → overlay, hides selection popover on Chinese pref changes, clears positions on unmount. |
| `src/hooks/useChineseDictionary.ts` (39 ln) | Fetches `/dict/cedict.json` (14 MB) once per session into a module-level cache; returns `{ dict }` only (no loading/error state). |
| `src/components/ui/CompassPill.tsx:42-159, 198-200, 438-453, 671-755` | Chinese UI embedded in the 828-line multi-variant pill: `getCompoundWord` (longest-match compound lookup), `VocabTile` (tile + dictionary popover), the `vocab-triage` variant, and the GraduationCap entry button. |
| `src/store/useVocabularyStore.ts` (57 ln) | Yjs-synced `knownCharacters: Record<char, timestamp>` + toggle/mark/clear actions. |
| `src/store/useLexiconStore.ts` (112 ln) | Yjs-synced TTS pronunciation rules; Chinese-relevant only via the optional `LexiconRule.language` scoping field (`src/types/db.ts:636-637`). Owned operationally by the TTS subsystem. |
| `src/store/usePreferencesStore.ts:34-37, 72-79` | Device-scoped Chinese prefs: `forceTraditionalChinese`, `showPinyin`, `pinyinSize`; per-language `fontProfiles` (zh default 120% / 1.8). |
| `src/components/reader/VisualSettings.tsx:81-174` | Book Language select; conditional "Chinese Reading" section (toggles + pinyin size slider + CC-CEDICT attribution). |
| `src/components/settings/GeneralSettingsTab.tsx:108-175` | About-page attribution for CC-CEDICT and OpenCC. |
| `src/lib/language-utils.ts` | `normalizeLanguageCode` (ISO 639-2 → 639-1 + subtag strip) used by ingestion. |
| `src/lib/utils/script-loader.ts` (17 ln) | `loadScript` CDN script injector. **Zero importers — dead code.** |
| `scripts/compile-dict.cjs` (155 ln) | Downloads CC-CEDICT from MDBG, compiles into `public/dict/cedict.json` (both simplified & traditional keys, polyphones merged with ` / `). Not wired into any npm script. |
| `public/dict/cedict.json` | 14 MB compiled dictionary, ~198k keys, **committed to git** (15.1 MB blob). |
| `plan/zh-prd.md`, `plan/zh-plan.md`, `plan/zh-smart-pinyin-design.md` | Intended design (see drift notes below). |

Sibling features driven by `language === 'zh'` but owned by other subsystems: `TextSegmenter` locale, `PiperProvider` zh_CN voices, `LexiconService.getRules(bookId, language)`, TTS per-language profiles (`useTTSStore.activeLanguage`).

## How it works (data & control flow)

**Activation.** Ingestion extracts `<dc:language>`, normalizes via `normalizeLanguageCode` (`src/lib/ingestion.ts:82,263`), stores it on both `StaticBookManifest` and the Yjs-synced `UserInventoryItem`. `VisualSettings` lets the user override it (`updateBook(bookId, { language })`, only `'en' | 'zh'` offered).

**Render pipeline.** `useEpubReader` registers `processChineseContent` as an epub.js `hooks.content` callback. On each section load it: (1) bails unless `useBookStore...books[bookId].language === 'zh'` (exact match, no normalization — `useEpubReader.ts:606-608`); (2) `await ensureOpenCC()/ensurePinyin()` per active prefs; (3) tree-walks text nodes containing `[一-鿿]`; (4) caches `_originalText` as an expando on each text node, then either writes `toTraditional(originalText)` into `nodeValue` or restores the original; (5) if `showPinyin`, calls `getPinyin(currentText)` (array form) and for each Han code unit creates a `Range` to measure its rect, pushing `{char, pinyin, top, left, width, height}` offset by the iframe's position; (6) fires `onPinyinPositionsUpdate(positions)`.

`ReaderView` stores the array in React state and renders `<PinyinOverlay positions=... containerNode={rendition.manager.container}>`. The overlay portals spans into the epub.js container so pinyin scrolls in lockstep with the iframe at native frame rate. Known-character filtering happens at overlay render time (`positions.filter(pos => !knownCharacters[pos.char])`), so vocabulary toggles never require geometry recomputation — a genuinely elegant design.

Re-processing triggers: a `useEffect` keyed on `[isReady, forceTraditionalChinese, showPinyin, pinyinSize]` re-invokes the processor on all loaded contents (`useEpubReader.ts:831-839`). Pinyin minimum line-height (1.8) is enforced in the theme effect (`useEpubReader.ts:898`).

**Vocabulary loop.** Selecting text containing any CJK char makes CompassPill's annotation variant show a GraduationCap button → `vocab-triage` variant: each char of `popover.text` becomes a `VocabTile` showing dictionary pinyin; tapping toggles `useVocabularyStore.toggleKnownCharacter(char)` (Yjs-synced, instant cross-device); the overlay's filter reacts immediately. The tile popover shows the standalone definition plus the longest dictionary compound overlapping the char (`getCompoundWord`, ±4 char window).

**Dictionary.** `useChineseDictionary(isChineseSelection)` lazily fetches `/dict/cedict.json` into a module global on first Chinese selection and keeps it for the session.

## Technical debt

### CH-1. Pinyin misalignment for astral-plane characters (verified bug)
- **Severity:** high | **Category:** correctness
- **Evidence:** `useEpubReader.ts:664-669` — `const pinyinArray = getPinyin(currentText)` then `for (let i = 0; i < currentText.length; i++) ... pinyinArray[i]`. `pinyin-pro` with `{type:'array'}` returns **one entry per code point**, while the loop indexes by **UTF-16 code unit**. Verified with the installed package: for `'😀你好'`, `pinyin()` returns `["😀","nǐ","hǎo"]` (len 3) vs `text.length === 4`; the loop annotates **你 with "hǎo"** — the wrong pinyin for the wrong character. Every Han character after any surrogate pair (emoji, CJK Ext-B like 𠀀, which real Chinese ebooks contain) is shifted by one per preceding astral char.
- **Impact:** Silently teaches language learners wrong pronunciations — the worst possible failure mode for the feature's core promise. Undetectable without a CJK-savvy reader.
- **Fix:** Iterate code points (`Array.from(currentText)`) and maintain a parallel code-unit offset for `Range.setStart`; or use pinyin-pro's `{ type: 'all' }` with `origin` matching. Add a regression test with emoji/Ext-B fixtures.

### CH-2. Overlay lifecycle is incidental: replaced-not-merged positions, no relocation/resize recompute, language-change reactivity by accident
- **Severity:** high | **Category:** correctness
- **Evidence:** (a) `processChineseContent` computes positions for **one** `contents` (section iframe) and `onPinyinPositionsUpdate(pinyinPositions)` **replaces** the whole array (`useEpubReader.ts:696-698`; `ReaderView.tsx:361-363` does `setPinyinPositions(positions)`). The code explicitly anticipates multiple stacked iframes in scrolled-doc mode (`useEpubReader.ts:631-634` adds `iframeOffsetTop/Left` per iframe), yet whenever a second section loads, the first section's pinyin is wiped. (b) No `relocated`/resize recompute: the `relocated` handler (`useEpubReader.ts:476-505`) and the ResizeObserver (797-827) never touch pinyin; correctness after re-layout depends entirely on epub.js happening to re-fire content hooks. (c) Changing the **book language** to `zh` does not re-trigger processing — the effect deps are only `[isReady, forceTraditionalChinese, showPinyin, pinyinSize]` (`useEpubReader.ts:839`); it works today only because the zh font profile (120%/1.8) differs from en, so the theme effect's `flow()` call (915) rebuilds views as a side effect. If a user's en and zh profiles are equal, switching language with pinyin already enabled shows nothing.
- **Impact:** Pinyin disappears or floats detached from glyphs in scrolled mode, after rotation, or after font changes; feature activation depends on an unrelated side effect. Any reader-core refactor (e.g., replacing the `flow()` thrash) will silently break Chinese rendering.
- **Fix:** Key positions by section/content (e.g., `Map<sectionHref, PinyinPosition[]>`; merge on update, drop on view destroy), and recompute explicitly on `relocated`, resize, font-profile change, and `book.language` change. This falls out naturally from CH-3's extraction.

### CH-3. The pinyin/traditional engine is welded inside the `useEpubReader` god hook
- **Severity:** high | **Category:** architecture
- **Evidence:** `processChineseContent` is a closure defined inside the book-loading effect (`useEpubReader.ts:601-699`), exported to other effects via `processChineseContentRef` (262, 701, 837). It reaches into three stores via `getState()` (`usePreferencesStore` at 605, `useBookStore` at 606) and is callback-coupled to ReaderView via an `any[]`-typed option (`onPinyinPositionsUpdate?: (positions: any[]) => void`, line 204) even though `PinyinPosition` is properly defined in `PinyinOverlay.tsx:9-16`.
- **Impact:** The most algorithmically delicate code in the subsystem (Range measurement, code-unit bookkeeping, DOM mutation/restore) is untestable in isolation — and indeed has zero tests (CH-9), which is why CH-1 shipped. Every reader change risks Chinese regressions and vice versa; the core reader is not free of optional-feature logic.
- **Fix:** Extract `src/lib/chinese/PinyinGeometryEngine.ts` (pure: `(doc, text nodes, prefs) → PinyinPosition[]`) and `TraditionalConverter.ts` (mutate/restore with the original-text cache), unit-test them against jsdom fixtures, and have the reader call a single `ChineseContentProcessor.process(contents)` facade. Type the callback with the shared `PinyinPosition` (move the type to `src/lib/chinese/types.ts`).

### CH-4. Vocab-triage UI embedded in the CompassPill god component
- **Severity:** high | **Category:** architecture
- **Evidence:** `CompassPill.tsx` (828 lines) multiplexes seven variants; the Chinese feature owns `getCompoundWord` (42-61), `VocabTile` (64-159), the `vocab-triage` branch (671-755), plus per-render dictionary triggering (199-200). The pill also handles TTS transport, annotation editing, audio triage, and sync alerts.
- **Impact:** A generic HUD component imports the Chinese dictionary hook and vocabulary store; every Chinese UI change churns the file that also controls TTS playback. Unrelated variants share local state and re-render together; the dictionary fetch is wired to a component whose primary job is audio control.
- **Fix:** Split each variant into its own component under `components/reader/compass/`; move `VocabTile`, `getCompoundWord`, and the triage card to `src/components/chinese/VocabTriageCard.tsx`. `getCompoundWord` is pure — move it next to the dictionary module and test it.

### CH-5. Dictionary delivery: 14 MB JSON in git, fully parsed into memory, not offline-capable
- **Severity:** high | **Category:** performance
- **Evidence:** `public/dict/cedict.json` is 14 MB / ~198k keys and tracked in git (15.1 MB blob; commit 13ee3970). `useChineseDictionary.ts:19-31` fetches and `res.json()`s the whole file into a module-level global — measured ~80 MB heap retained for the session. The trigger is any selection containing one CJK character in **any** book (`CompassPill.tsx:199-200`). The PWA never caches it: `src/sw.ts` has no runtime caching routes, and the precache manifest can't include it (`vite.config.ts:52` caps precache at 4 MB; injectManifest glob is js/css/html anyway). `plan/zh-smart-pinyin-design.md` (Step 2) promised "<4 MB, ~1.3 MB over the wire, automatically cached offline" — none of which holds (the compiler indexes both simplified+traditional keys and merges polyphones, doubling the planned size).
- **Impact:** ~80 MB heap on memory-constrained Android WebViews for a tooltip feature; a 14 MB download on metered connections triggered by selecting one Chinese word in an English book; dictionary silently unavailable offline, contradicting the app's local-first promise; repo clones permanently carry 15 MB.
- **Fix:** Move the dictionary into IndexedDB via DBService (one-time import, versioned), or shard the JSON by first-character prefix and fetch shards on demand; add an SW runtime cache route as a fallback; gate the fetch on book language or first triage open rather than any CJK selection; remove the artifact from git (build-time download in CI, or Git LFS).

### CH-6. Simplified/Traditional identity split in vocabulary and dictionary keys
- **Severity:** medium | **Category:** correctness
- **Evidence:** `knownCharacters` is keyed by the **displayed** character. With `forceTraditionalChinese` on, `processChineseContent` emits traditional chars into positions (`useEpubReader.ts:652-654` converts before pinyin collection) and `popover.text` comes from the converted DOM, so triage stores traditional keys; with it off, simplified keys. `PinyinOverlay.tsx:61` filters by exact key. Marking 们 as known does nothing for 們 and vice versa.
- **Impact:** Users who toggle the conversion setting lose their vocabulary's effect (pinyin reappears for "known" characters); the synced vocabulary silently bifurcates into two incompatible keyspaces.
- **Fix:** Canonicalize on simplified at the store boundary (`toSimplified(char)` via an opencc tw→cn converter, or a static trad→simp map) for both writes (`toggleKnownCharacter`) and reads (overlay filter, tile `isKnown`). Migration: one-time pass over existing `knownCharacters` converting traditional keys to simplified (merge timestamps with `Math.min`).

### CH-7. Traditional conversion mutates live text nodes against the plan's own invariant
- **Severity:** medium | **Category:** correctness
- **Evidence:** `useEpubReader.ts:643-660` caches `_originalText` as an expando and writes `textNode.nodeValue = toTraditional(originalText)`. `plan/zh-plan.md` (Phase 3 CAUTION) mandates: "Do NOT replace or modify text nodes… All visual modifications must be done through CSS or overlay elements." Safety currently rests on opencc-js `cn→tw` being length-preserving (spot-checked true for phrase conversions like 头发→頭髮, 干部→幹部, but it is not a documented contract of the library). CFIs/annotations created while converted embed traditional text; the async processor has no cancellation, so rapid toggles can interleave two runs over the same nodes.
- **Impact:** If any opencc mapping ever changes string length (library upgrade, `twp` phrase mode), character offsets shift and CFI-anchored annotations/TTS highlights corrupt silently. Saved annotation text differs by script depending on a device-local toggle.
- **Fix:** Keep nodeValue mutation only if guarded: assert `translated.length === originalText.length` and skip + log otherwise (cheap, preserves UX); add a cancellation token per processing run. Long-term, render Traditional via the same overlay strategy or accept and document the invariant with a pinned opencc-js version and a length-preservation test over the full dictionary.

### CH-8. Language normalization triplicated; activation check uses none of it
- **Severity:** medium | **Category:** duplication
- **Evidence:** Four behaviors for the same concern: `lib/language-utils.ts` (full ISO 639-2 + subtag handling, used at ingestion); `VisualSettings.tsx:58` (`bookLang.split('-')[0]`) — but **reads** profile from `fontProfiles[baseLang] || fontProfiles[bookLang]` (61) while **writing** to `setFontProfile(bookLang, …)` (191, 199, 244, 248), so a book with stored `zh-CN` writes to key `'zh-CN'` that the read path (and `ReaderView.tsx:213-214`, which normalizes) never prefers; `useEpubReader.ts:606-608` does an exact `bookLang !== 'zh'` comparison with **no** normalization, so the same `zh-CN` book gets zh fonts but no pinyin/traditional at all. Unnormalized values are reachable: `updateBook` accepts any string, and books synced from clients predating `normalizeLanguageCode` carry raw metadata (acknowledged in `plan/zh-plan.md:930`).
- **Impact:** Split-brain behavior per book (fonts say Chinese, reader says not); font sliders that appear dead for subtagged languages; every new consumer of `book.language` re-invents normalization.
- **Fix:** Normalize once at the store boundary (in `useBookStore.updateBook` and a one-time migration over existing inventory), then delete all call-site `.split('-')` logic and compare `language === 'zh'` directly. Export a single `getBookBaseLanguage(book)` helper meanwhile.

### CH-9. Zero behavioral test coverage for the entire pipeline
- **Severity:** medium | **Category:** testing
- **Evidence:** The only test under `src/lib/chinese/` is `benchmark.test.ts` — no assertions, just `console.log` of a timing. No tests exist for `processChineseContent` (the grep across `*.test.*` finds no references to `PinyinOverlay`, `useVocabularyStore`, `useChineseDictionary`, or `ChineseTextProcessor` beyond that benchmark). `VisualSettings.test.tsx:90-94` and `ReaderView_VersionCheck.test.tsx:60-61` merely mock the pref fields. Contrast with the lexicon side, which has 10+ test files.
- **Impact:** CH-1 (verified wrong-pinyin bug) and CH-2 shipped and survived; any refactor of the reader hook has no safety net for Chinese behavior.
- **Fix:** After CH-3 extraction, add unit tests: code-point alignment (emoji/Ext-B), known-character filtering, traditional round-trip restore, multi-section position merging, dictionary compound lookup, simp/trad vocab canonicalization. Delete or convert the benchmark to an asserted perf budget.

### CH-10. Dead code and unshipped PRD surface
- **Severity:** medium | **Category:** dead-code
- **Evidence:** `src/lib/utils/script-loader.ts` has zero importers anywhere in `src/` or `android/`. `useVocabularyStore.markAsKnown`, `markAsUnknown`, `clearAll` (`useVocabularyStore.ts:40-53`) have no consumers — they exist for the PRD's "Character Vault" settings tab (`zh-smart-pinyin-design.md` §1.C: search/add, master list, stats), which was never built; today there is **no UI to view or un-know vocabulary** except re-selecting the exact text in a book.
- **Impact:** Misleading API surface; users who fat-finger a character "known" have no discoverable way to undo it; dead module invites cargo-cult reuse.
- **Fix:** Delete `script-loader.ts`. Either build the minimal Character Vault (list + remove + count — the store already supports it) or delete the unused actions until it's scheduled.

### CH-11. `any`-typed seams and theme constant duplication
- **Severity:** low | **Category:** type-safety
- **Evidence:** `ChineseTextProcessor.ts:1-4` types both libraries `any` (opencc-js lacks types, pinyin-pro ships its own — the `any` is unnecessary for pinyin-pro); `useEpubReader.ts:204` types the positions callback `any[]`; `PinyinOverlay.tsx:47` casts `currentTheme as string` to compare against `'custom'`, which is missing from the `PreferencesState.currentTheme` union (`usePreferencesStore.ts:19`) despite `'custom'` being a real theme registered at `useEpubReader.ts:850`; the overlay hardcodes theme backgrounds (`'#1a1a1a'`, `'#f4ecd8'` at PinyinOverlay.tsx:48-53) duplicating the same literals in `useEpubReader.ts:938-941`.
- **Impact:** Type system can't catch position-shape or theme drift; adding a theme requires editing magic hexes in two files.
- **Fix:** Widen the theme union to include `'custom'`; export shared `READER_THEME_COLORS`; use pinyin-pro's real types; type the callback with `PinyinPosition[]`.

### CH-12. Dictionary build pipeline is unwired and can silently ship an 11-entry mock
- **Severity:** low | **Category:** hygiene
- **Evidence:** `scripts/compile-dict.cjs` is referenced by no `package.json` script; the committed JSON is a hand-run artifact of unknown vintage. On download failure the script **writes a mock dictionary of 11 entries to the production asset path and exits 0** (`compile-dict.cjs:48-65`); it also shells out to system `unzip` (70).
- **Impact:** A future regeneration on a flaky network would silently replace the full dictionary with a toy; no provenance/refresh story for licensed CC-BY-SA data.
- **Fix:** Make failure fatal (no mock fallback to the real output path — write mocks only under a `--mock` flag for tests); add `npm run compile-dict`; record source version/date into the artifact; use a JS unzip lib.

### CH-13. `useChineseDictionary` hook ergonomics
- **Severity:** low | **Category:** hygiene
- **Evidence:** `useChineseDictionary.ts` returns `{ dict }` only — the design doc's `loading` flag was dropped, and errors are logged but never surfaced (32-35); the parameter is named `isChineseBook` but the sole caller passes "selection contains a CJK char" (`CompassPill.tsx:199-200`); module-level `isFetching` is a cross-component global with no retry/backoff semantics.
- **Impact:** Vocab tiles silently show empty pinyin/definitions on fetch failure with no user feedback; misleading name invites misuse.
- **Fix:** Return `{ dict, status: 'idle'|'loading'|'error' }`, rename the param, and show a fallback notice in the triage card. (Subsumed by CH-5's dictionary-service redesign.)

## Problematic couplings

1. **Core reader → Chinese feature (wrong direction).** `useEpubReader.ts:12-16` imports `ChineseTextProcessor` and inlines the whole pipeline (599-699); the reader hook also reads `useBookStore`/`usePreferencesStore` via `getState()` inside the closure. An optional language feature is compiled into the reader's hot path; the reader cannot be understood or tested without it. The pinyin line-height floor is also baked into the theme effect (`useEpubReader.ts:898`).
2. **CompassPill (TTS/annotation HUD) → dictionary + vocabulary.** `CompassPill.tsx:6-7,198-200` — the audio control pill owns Chinese triage UI and triggers the 14 MB dictionary fetch (see CH-4, CH-5).
3. **ReaderView as a manual message bus.** Pinyin positions flow `useEpubReader → callback → ReaderView state → PinyinOverlay` with an `any[]` seam (`useEpubReader.ts:204`), plus side-channel effects (`ReaderView.tsx:490-494` hides popovers on pref change because the engine is about to mutate DOM under them — a coupling comment that admits the mutation hazard of CH-7).
4. **TTS subsystem dependencies (documented here, owned there):** `LexiconService.getRules(bookId, language)` filtering (`src/lib/tts/LexiconService.ts:45-70,95,126`), `TextSegmenter` locale via ingestion (`src/lib/ingestion.ts:113,308`), Piper zh_CN voices, and `useTTSStore` per-language profiles — all keyed off the same `book.language` field with the same normalization fragility as CH-8.
5. **Theme constants duplicated** between `PinyinOverlay` and `useEpubReader.applyStyles` (CH-11).

## What's good (keep)

- **The geometry-overlay architecture.** Measuring per-character rects and portaling pinyin spans into the epub.js container (`PinyinOverlay` + `processChineseContent`'s Range measurement) preserves DOM integrity, CFIs, selection, and TTS highlighting, and scrolls at native frame rate. It is strictly better than the span-wrapping approach the plan originally specified. Keep the approach; fix its lifecycle (CH-2).
- **Render-time vocabulary filtering.** Filtering known characters in `PinyinOverlay` instead of during geometry collection means vocab toggles are instant and never touch the iframe — simpler than the design doc's plan (which wanted filtering inside `useEpubReader` with a store dependency). Keep.
- **`useVocabularyStore` shape.** `Record<char, timestamp>` in a Yjs map: O(1) lookup, conflict-free merge, trivially syncable. Keep as-is (with CH-6 canonicalization).
- **Lazy two-library loading.** Dynamic `import()` of opencc-js/pinyin-pro keeps ~2.8 MB out of the main bundle; only Chinese readers pay.
- **Ingestion-side language normalization** (`normalizeLanguageCode`) is thorough (ISO 639-2 map + subtags). Make it the single authority (CH-8) rather than replacing it.
- **Per-language `fontProfiles`** in preferences with zh defaults (120%/1.8) — clean, extensible design.
- **`LexiconRule.language` optional scoping** — additive, backward compatible, correctly filtered with prefix matching in `LexiconService`.
- **Licensing hygiene.** CC-CEDICT/MDBG/OpenCC attribution with CC BY-SA links in both VisualSettings and the About tab.
- **Vocab triage UX itself** (tiles, compound lookup, punctuation placeholders, autosave) matches the design doc and is genuinely good product work — it just lives in the wrong file.

## Target design

A self-contained, lazily-loaded feature module with one narrow seam to the reader:

```
src/features/chinese/
  index.ts                  // public surface: useChineseReading(), VocabTriageCard, ChineseSettingsSection
  engine/
    PinyinGeometryEngine.ts // pure: (Document, prefs, opts) -> PinyinPosition[]; code-point safe
    TraditionalConverter.ts // mutate/restore with length-guard + cancellation
    ChineseContentProcessor.ts // facade the reader calls per content view; keyed per section
  dictionary/
    DictionaryService.ts    // IndexedDB-backed (or sharded fetch); status/error surface; SW cache route
    compoundLookup.ts       // getCompoundWord (pure, tested)
  vocabulary/
    useVocabularyStore.ts   // moved; simplified-canonical keys; + VocabularyVault UI
  ui/
    PinyinOverlay.tsx
    VocabTriageCard.tsx     // extracted from CompassPill
    ChineseReadingSettings.tsx // extracted from VisualSettings
  types.ts                  // PinyinPosition, DictEntry
```

Reader integration shrinks to a registry: the reader exposes a typed `ContentProcessor` hook point (`register(processor: (view: ContentView) => Promise<void>)`) and an overlay slot; the Chinese module registers itself only when `getBookBaseLanguage(book) === 'zh'`. The reader core has **zero** imports from `features/chinese`. Position state lives inside the module as `Map<sectionId, PinyinPosition[]>`, merged for the overlay, invalidated on relocate/resize/destroy events the reader already emits.

`book.language` is normalized at the `useBookStore` write boundary; all consumers (Chinese module, TTS profiles, lexicon, segmenter) compare plain ISO 639-1 codes. Vocabulary keys are canonical simplified. The dictionary becomes an offline-first service (IndexedDB import, versioned, with an explicit download step on first Chinese-book open and visible progress), removing the 14 MB blob from git.

CompassPill becomes a thin variant router; the triage card is owned by the Chinese module. The unshipped Character Vault gets a minimal implementation (list, search, remove, count) to close the orphaned-vocabulary hole, or the dead store actions are removed until it ships.

## Migration notes

Safe sequencing (each step independently shippable):

1. **Fix CH-1 in place first** (small, user-facing correctness): code-point iteration in `processChineseContent` + regression test. No data impact.
2. **Extract pure modules** (CH-3): move geometry/conversion logic to `src/features/chinese/engine/` with the reader calling a facade; behavior-identical, covered by new unit tests (CH-9). Then fix CH-2 inside the module (per-section position maps + explicit invalidation on `relocated`/resize/language change).
3. **Language normalization** (CH-8): add normalization to `useBookStore.updateBook`; run a one-time inventory migration (Yjs map walk: `language: normalizeLanguageCode(language)`); this is idempotent and merge-safe under CRDT semantics (last-writer-wins on the same normalized value). Only then delete call-site `.split('-')` code.
4. **Vocabulary canonicalization** (CH-6): introduce `canonicalizeChar()`; migrate existing `knownCharacters` (trad→simp, merge with min-timestamp). Run the migration on each device at store init guarded by a version flag stored in the same Yjs map (e.g., `__schema: 2`) so concurrent old clients' writes are re-canonicalized on next migration pass — old clients writing traditional keys post-migration is tolerable because the read path also canonicalizes.
5. **Dictionary re-platform** (CH-5): ship the IndexedDB/sharded DictionaryService behind the same hook signature; keep `/dict/cedict.json` served for one release as fallback; add SW runtime caching; then remove the blob from git (regenerate at build/CI time via the repaired `compile-dict` (CH-12)). No user data migration — the dictionary is static content.
6. **UI extraction** (CH-4): move VocabTriageCard out of CompassPill, ChineseReadingSettings out of VisualSettings. Pure refactor; protect with existing CompassPill tests plus new triage tests.
7. **Cleanup**: delete `script-loader.ts`, the assertion-free benchmark (or assert a budget), unused vocab actions (or ship the Vault); update `plan/zh-plan.md` implementation notes, which currently claim the abandoned `data-pinyin` span approach shipped (`zh-plan.md:903-905`) — the docs must describe the overlay architecture or be archived.

User-visible risk concentrates in steps 3-4 (data migrations). Both are idempotent, additive, and reversible (normalization never destroys the original metadata — `StaticBookManifest.language` retains the raw value; vocabulary migration can keep a backup key set for one release). Everything else is behavior-preserving refactor guarded by the new test suite.
