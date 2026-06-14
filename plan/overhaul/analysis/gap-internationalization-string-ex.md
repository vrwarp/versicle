# Gap analysis: Internationalization / string externalization strategy

Subsystem key: `gap-internationalization-string-ex`
Status: **gap — this subsystem does not exist.** This report documents the absence, quantifies the surface that would be affected, identifies where the absence is already causing user-visible defects today, and — most importantly — shows why the decision must be made *before* the overhaul's app-shell/error/toast/settings rewrites, because those rewrites are exactly the seams where string externalization is nearly free if planned and brutal if retrofitted.

---

## What it is

Versicle has **no internationalization layer of any kind**:

- No i18n library in `package.json` (no react-i18next, lingui, formatjs/react-intl, paraglide, typesafe-i18n). Verified against the full dependency list.
- `navigator.language` / `navigator.languages` is **never read anywhere** in `src/` (grep returns zero hits).
- No UI-language/locale preference exists in any store (`src/store/usePreferencesStore.ts`, `src/store/useUIStore.ts` — checked; nothing).
- No i18n TODOs, scaffolding, or doc mentions. `architecture.md`'s only "locale" hit is the `Intl.Segmenter` cache note (architecture.md:584). No sibling overhaul report addresses i18n as a dimension; the closest is a "low: English-only fillers" nit in `plan/overhaul/analysis/tts-content.md` (item d under hygiene).
- `index.html:2` hardcodes `<html lang="en">`; no `lang=` attribute appears anywhere in JSX (grep returns zero hits); the PWA manifest (vite.config.ts:55-58) has English `name`/`description` and no `lang`/`dir` fields.

Meanwhile the product is explicitly **a Mandarin-learner's reading tool**: pinyin annotation (`src/components/reader/PinyinOverlay.tsx`), OpenCC simplified→traditional conversion, CC-CEDICT dictionary (`src/hooks/useChineseDictionary.ts`), vocabulary tracking (`src/store/useVocabularyStore.ts`), per-language font profiles, zh TTS voices. A Chinese UI locale is the obvious eventual ask, and a meaningful fraction of the realistic user base has a zh system locale today.

What *does* exist — and is sound — is a **content-language** pipeline: `book.language` extracted from EPUB OPF at ingestion (`src/lib/ingestion.ts:82,263` via `normalizeLanguageCode`, `src/lib/language-utils.ts:5-41`), per-book user override (`src/components/reader/VisualSettings.tsx:84-92`), and consumption by font profiles, lexicon filtering, TTS segmentation, and the engine (`src/lib/tts/engine/createZustandEngineContext.ts:85`). Content language and UI language are correctly *not* conflated today — because UI language simply doesn't exist as a concept.

## File inventory

There is no i18n module to inventory. Instead, this is the inventory of the *string surface* and the *locale-sensitive call sites* that an i18n layer (or an explicit non-goal decision) governs.

### Quantified string surface (all non-test `src/`)

| Surface | Count | How counted |
|---|---|---|
| Component files | 94 `.tsx` (non-test) | `find src/components` |
| Double-quoted multi-word English phrases in components | ~348 | regex `"[A-Z][A-Za-z]+( ...)+"` |
| JSX text nodes starting with a capitalized word | ~186 across 47+ files | regex `>[A-Z][A-Za-z]+ ...` |
| `aria-label=` sites | 159 | grep |
| `placeholder=` sites | 32 | grep |
| `title="` attribute sites | 45 | grep |
| `showToast(...)` call sites with inline English | 81 | grep |
| Native `confirm(...)` sites | 17 | grep |
| Native `alert(...)` sites | 7 | grep |
| `throw new Error('...')` in lib/services/db | 53 (several user-facing) | grep |
| `toLocale*` formatting call sites | 16 | grep (list below) |

Total order of magnitude: **~800+ user-visible strings concentrated in ~100 files**, plus ~25 user-facing strings in non-UI layers (errors, TTS pipeline).

### Key files by role

| File | Role in this gap |
|---|---|
| `index.html:2` | Fixed `lang="en"` on the document that renders Chinese book titles, pinyin, CC-CEDICT content. |
| `vite.config.ts:55-72` | PWA manifest: English-only name/description, no `lang`/`dir`. |
| `src/lib/language-utils.ts` | `normalizeLanguageCode` — the one good locale utility (ISO 639-2→639-1, subtag strip). Content-language only. |
| `src/types/errors.ts` | Error classes embed full English UI sentences (`StorageFullError` :38, `DuplicateBookError` :48, `WorkspaceDeletedError` :57). |
| `src/store/useToastStore.ts` | Single-slot toast store; `showToast(message: string)` — message is a raw string at the API boundary (81 call sites). |
| `src/components/GlobalSettingsDialog.tsx` (718 ln) | Largest single concentration: 7 confirm/alert sites (:128,141,156,241,264,276,294,363,442), toasts, status strings. |
| `src/components/ui/CompassPill.tsx` (828 ln) | `formatTime` :335-339 (`-M:SS remaining`), `formatTimeAccessible` :342-349 (hand-rolled English pluralization), play/pause aria copy :799. |
| `src/components/devices/DeviceList.tsx:80-86` | Ad-hoc relative time impl #1 ("Just now", "Nm ago" mixed with system-locale `toLocaleDateString`). |
| `src/components/drive/DriveImportDialog.tsx:12-24` | Ad-hoc relative time impl #2. |
| `src/components/sync/SyncPulseIndicator.tsx:59` | Ad-hoc relative time impl #3 ('Just now' + `toLocaleTimeString`). |
| `src/components/library/BookListItem.tsx:31-37` | `formatBytes` helper (B/KB/MB/GB) — duplicated ad-hoc at ContentMissingDialog.tsx:184, DriveImportDialog.tsx:77, ContentAnalysisLegend.tsx:402, DiagnosticsTab.tsx:170. |
| `src/lib/tts/AudioContentPipeline.ts:108-119, 286` | English-only spoken filler messages and preroll — *spoken UI copy living in the worker-side engine layer*. |
| `src/lib/cfi-utils.ts:418` | `getCachedSegmenter('en')` hardcoded for CFI sentence-snapping regardless of book language. |
| `src/lib/genai/GenAIService.ts:228-243` | Non-English books get "English Title (Original Title)" TOC format baked into generated (persisted) smart-TOC data. |
| `src/lib/export-notes.ts:5,12` | English template + system-locale dates baked into exported Markdown. |
| `android/app/src/main/res/values/strings.xml` | Only app identity strings — native layer is essentially string-free (good). |

## How it works (data & control flow today)

1. **UI strings**: authored inline at every render site. No indirection, no catalog, no key space. `<html lang="en">` is static; the app never inspects the system locale.
2. **Toasts**: components call `useToastStore.getState().showToast('English sentence', type)` (81 sites). Several pass *raw error messages from the service layer through to the user*: `LibraryView.tsx:235,295` (`Import failed: ${err.message}`), `FileUploader.tsx:282`, `App.tsx:126` (global `unhandledrejection` → `showToast(event.reason.message)`), `SmartLinkDialog.tsx:93`, `DataRecoveryView.tsx:64`, `ReprocessingInterstitial.tsx:35`. So the *effective* UI copy for failures is authored in `src/lib/**` and `src/types/errors.ts` — the service layer owns user-facing prose.
3. **Confirm/alert**: 24 native `confirm()`/`alert()` sites with inline English, concentrated in GlobalSettingsDialog, App.tsx:303-312, TTSAbbreviationSettings.tsx:103-124, LexiconManager.tsx:245, SyncSettingsTab.tsx:165, DeviceManager.tsx:17,47, AnnotationList.tsx:26, AnnotationCard.tsx:23, ContentAnalysisLegend.tsx:266, DiagnosticsTab.tsx:52.
4. **Dates/times/numbers**: 16 `toLocale*` sites, each no-arg or `[]` (= system default locale). Three independent hand-rolled relative-time implementations, five byte-size formatters, 12+ hand-rolled percent formatters, three hand-rolled English pluralizations (CompassPill.tsx:346-348, AudioContentPipeline.ts:286, EditReadingListEntryDialog.tsx:148). `Intl.RelativeTimeFormat`, `Intl.NumberFormat`, and `Intl.Collator` are used **zero** times. Sorting uses bare `localeCompare` (LibraryView.tsx:361,364; ReassignBookDialog.tsx:44).
5. **Spoken strings (TTS)**: when a chapter is empty, the engine enqueues one of ten random English sentences (`AudioContentPipeline.ts:108-119`); preroll announcements are English with English pluralization (:286); fallback section titles are `Section ${n+1}` (:101). These are synthesized by whatever voice is active — for a zh book with a zh_CN Piper voice, the engine speaks English text through a Chinese voice model.
6. **Content language** (the part that works): EPUB `dc:language` → `normalizeLanguageCode` → `book.language` → drives pinyin/OpenCC activation (`useEpubReader.ts:606-612`), font profiles (`ReaderView.tsx:213-214`), lexicon rule filtering (`LexiconService.ts:62-126`), TTS segmentation locale (`tts.ts:196`, `PiperProvider.ts:76-80`), and engine replication (`replicationSpec.ts:104,141`).

## Technical debt

### I18N-1. No UI-locale dimension exists and no decision is recorded — **high / architecture**
- **Evidence:** package.json (no i18n dep); zero `navigator.language` reads in `src/`; no locale preference in `usePreferencesStore.ts`/`useUIStore.ts`; `index.html:2` static `lang="en"`; architecture.md silent; no sibling overhaul report covers it.
- **Impact:** The overhaul is about to rewrite *exactly* the choke points where i18n plugs in (presentError mapper per `type-safety-errors.md`, queue-based toast store and `useConfirm()` per `app-shell-ui.md` D7/D8, settings-panel registry per D3, CompassPill rewrite). If those new APIs are designed around raw `string` messages, a later zh-UI request means re-touching every one of the ~800 call sites *plus* the freshly rewritten infrastructure — i.e., paying the migration twice. Conversely, if i18n is a deliberate non-goal, that needs recording so future agents stop half-gesturing at it (e.g., the `[]` locale args scattered around).
- **Fix:** Make the decision now, as an ADR, before the app-shell rewrites: either (a) "i18n-ready, en-only" — adopt a message-catalog layer during the planned rewrites with English as the only shipped locale, or (b) explicit non-goal — record it, and still centralize formatting + error copy (I18N-3/4) for consistency. Recommendation: (a), given the Mandarin-learner product identity. See Target design.

### I18N-2. Service layer authors user-facing English prose; UI surfaces `err.message` verbatim — **high / architecture**
- **Evidence:** `src/types/errors.ts:38` (`'Storage limit exceeded. Please delete some books or clear space.'` inside `StorageFullError`), :48, :57; `BookImportService.ts:96,107`; `BackupService.ts:133` (`'Unsupported file format. Please use .json or .zip files.'`); ~53 `throw new Error('...')` across `src/lib|services|db`. Surfaced raw at `App.tsx:126` (unhandledrejection → toast of `reason.message`), `LibraryView.tsx:235,295`, `FileUploader.tsx:282`, `SmartLinkDialog.tsx:93`, `DataRecoveryView.tsx:64`.
- **Impact:** UI copy ownership leaks into persistence/sync/import layers; messages can't be localized, restyled, or even consistently worded without touching dozens of service files. This is the same defect `type-safety-errors.md` flags from the type angle; from the i18n angle it means the planned `presentError(err)` helper is the one and only place message selection should happen — and it must select by `code`, not pass through `message`.
- **Fix:** Errors carry `code` + structured params (e.g., `{ code: 'DUPLICATE_BOOK', filename }`); `message` stays as an English developer/log string. `presentError(err)` resolves `code → catalog key → localized string`. The unhandledrejection handler shows a generic localized message + diagnostic snapshot, never `reason.message`.

### I18N-3. ~800 hardcoded strings with zero indirection and no lint guard — **high / architecture**
- **Evidence:** Counts in the inventory table: ~348 quoted phrases + ~186 JSX text nodes in 47+ files, 159 aria-labels, 32 placeholders, 45 title attrs, 81 toast messages, 24 confirm/alert sites. No ESLint rule (eslint.config.js) prevents new literals.
- **Impact:** This is the bulk cost of any future localization, and it grows monotonically. The overhaul's component rewrites (settings registry, library, CompassPill, reader panels) will *re-author* a large share of these strings; doing so without a catalog wastes the only cheap externalization window the project will ever have.
- **Fix:** Adopt the catalog (I18N-1a) and externalize opportunistically *during* each planned component rewrite — never as a standalone big-bang pass. Enforce with `eslint-plugin-i18next`'s `no-literal-string` (or lingui equivalent) enabled per-directory as directories are migrated.

### I18N-4. No locale policy for formatting; triplicated relative-time, 5x byte-size, hand-rolled plurals/percents — **medium / duplication**
- **Evidence:** 16 `toLocale*` sites all defaulting to system locale: ReadingListDialog.tsx:59; ReadingHistoryPanel.tsx:120-121; SyncStatusPanel.tsx:86; AnnotationList.tsx:112; GenAISettingsTab.tsx:260; DiagnosticsTab.tsx:74,166; RecoverySettingsTab.tsx:115; RemoteSessionsSubMenu.tsx:72; SyncPulseIndicator.tsx:59; DeviceList.tsx:85; AnnotationCard.tsx:113; DriveImportDialog.tsx:77; export-notes.ts:5,12. Relative time hand-rolled 3x (DeviceList.tsx:80-86, DriveImportDialog.tsx:12-24, SyncPulseIndicator.tsx:59). Byte formatting 5x (BookListItem.tsx:31-37 and four ad-hoc). English plurals hand-rolled (CompassPill.tsx:346-348, EditReadingListEntryDialog.tsx:148, AudioContentPipeline.ts:286). Zero uses of `Intl.RelativeTimeFormat`/`Intl.NumberFormat`/`Intl.Collator`.
- **Impact:** *Today*, on a zh/de/fr system locale, users see chimera strings — English "Just now"/"5m ago" mixed with `2026/6/10` system-format dates in the same widget (DeviceList.tsx:82-85). When a UI locale is introduced, every one of these sites needs hunting again. The duplication also means three subtly different "ago" thresholds.
- **Fix:** One `src/lib/locale/format.ts` module: `formatDate/Time/DateTime`, `formatRelativeTime` (Intl.RelativeTimeFormat), `formatBytes` (Intl.NumberFormat `unit` style), `formatPercent`, `formatDuration` — all reading a single `getUILocale()` with cached Intl instances (same pattern as the existing, good `segmenter-cache.ts`). Migrate all 16+ sites; delete the three relative-time impls and four ad-hoc byte formatters.

### I18N-5. `<html lang="en">` fixed; no `lang` attributes anywhere despite Chinese content rendered in the top document — **medium / correctness**
- **Evidence:** index.html:2; grep for `lang=` in `src/**/*.tsx` returns zero hits. Chinese text renders in the *top* document (not the EPUB iframe) in library cards (zh book titles/authors), notes view, vocabulary, ReadingListDialog, and the GenAI smart-TOC sidebar. PWA manifest has no `lang`/`dir` (vite.config.ts:55-72).
- **Impact:** Han-unification font selection: under `lang="en"` the browser may pick Japanese-variant glyphs for shared CJK codepoints in book titles; screen readers choose an English voice for Chinese text; CSS `quotes`/line-breaking rules are wrong for zh runs. This is a *today* defect for the product's core audience, independent of UI translation.
- **Fix:** Set `document.documentElement.lang` from the locale module at boot/change. Add `lang={book.language}` on elements rendering book-sourced text in the top document (BookCard title/author, notes excerpts, TOC labels, dictionary entries). The EPUB iframe already inherits the book's own markup — leave it. Add `lang` to the PWA manifest.

### I18N-6. TTS speaks English filler/preroll regardless of book language, from the engine layer — **medium / correctness**
- **Evidence:** `AudioContentPipeline.ts:108-119` (ten random English `NO_TEXT_MESSAGES`), `:286` (`${chapterTitle}. Estimated reading time: N minute(s).` with English plural), `:101` (`Section ${n+1}` fallback). The pipeline runs inside the TTS worker (`src/workers/tts.worker.ts` path).
- **Impact:** A zh book played with a zh voice *speaks English sentences* (often mangled by the zh voice model). The randomization also fragments the audio cache (one entry per variant — noted in tts-content.md). Architecturally: spoken UI copy is authored in the engine layer, so any i18n solution must be loadable inside a Web Worker — a hard requirement that rules out React-context-only i18n and must be known *before* choosing a library.
- **Fix:** Single deterministic message per situation, resolved from the catalog with `locale = book.language` (not UI locale — it's spoken by the book's voice). Catalog access must work in plain TS modules and workers (see Target design library constraints).

### I18N-7. CFI sentence-snapping hardcodes the `'en'` segmenter — **medium / correctness**
- **Evidence:** `src/lib/cfi-utils.ts:418` `getCachedSegmenter('en')` when snapping an arbitrary CFI to the nearest sentence start, while every other segmentation call site threads `book.language` (tts.ts:196, PiperProvider.ts:76-80, ingestion locale param).
- **Impact:** Sentence-boundary detection on zh/ja text with English rules produces wrong snap targets for annotations/TTS-start positions in non-English books — the exact books the product is for. (Sibling issue to the normalization CFI-drift bug in tts-content.md, but a distinct call site.)
- **Fix:** Thread `bookLanguage` into the CFI utility (callers have the bookId); default `'en'` only as last resort.

### I18N-8. Book-language override UI only offers en/zh; data model supports ~20+ — **medium / correctness**
- **Evidence:** `VisualSettings.tsx:88-91` — the Select offers exactly `en` and `zh`, but `normalizeLanguageCode` (language-utils.ts:11-34) maps fr/es/de/ja/ko/it/ru/pt/nl/sv/no/da/pl/tr/ar/hi, ingestion stores whatever the EPUB declares, and lexicon rules/ font profiles/ TTS profiles key off arbitrary codes (LexiconService.ts:62-126, ReaderView.tsx:213).
- **Impact:** Opening the override for a French book forcibly corrupts `book.language` to en or zh (the Select renders an unknown value as unselected; any interaction writes en/zh), which cascades into segmentation locale, font profile, lexicon filtering, and Piper voice matching.
- **Fix:** Drive the Select options from a single supported-language list (shared with `normalizeLanguageCode`), always including the book's current code; display names via `Intl.DisplayNames(uiLocale, {type:'language'})` instead of hardcoded "English (en)".

### I18N-9. GenAI smart-TOC bakes "English Title (Original Title)" into persisted derived data for non-English books — **medium / architecture**
- **Evidence:** `GenAIService.ts:232-243` — for any non-`en` book the prompt *mandates* English-first titles; results are persisted as smart-TOC data (consumed by `useSmartTOC.ts`).
- **Impact:** A UI-language assumption (English-first) is frozen into stored per-book data at generation time. When a zh UI ships, every previously processed zh book shows English-first navigation with no way to re-render it; regeneration costs GenAI quota.
- **Fix:** Store structured titles (`{ original, english? }` or `{ titles: Record<lang,string> }`) and compose the display string at render time according to UI locale. Migration: existing strings parse with the documented `"X (Y)"` format; fall back to raw.

### I18N-10. Library/notes sorting uses bare `localeCompare`; no collation policy — **low / hygiene**
- **Evidence:** `LibraryView.tsx:361,364`, `ReassignBookDialog.tsx:44` — no locale argument, no `Intl.Collator` (zero uses repo-wide), no numeric option.
- **Impact:** zh titles sort by system-locale default collation (codepoint-ish under en), not pinyin order (`zh-u-co-pinyin`); "Book 10" sorts before "Book 2". Per-comparison `localeCompare` is also the slow path for the 100s-of-books library.
- **Fix:** One cached `Intl.Collator(uiLocale, { numeric: true })` in the locale module; expose `compareTitles`. Consider per-content-language collation later (out of scope).

### I18N-11. Exported artifacts hardcode English templates + system-locale dates — **low / hygiene**
- **Evidence:** `export-notes.ts:5` (`*Exported from Versicle on ${date}*`), :12; CSV export of reading list percentages `ReadingListDialog.tsx:216`; lexicon CSV headers (CsvUtils.ts).
- **Impact:** Minor; but exports are user-facing documents and should follow the same catalog/locale policy. File-format headers (CSV) must stay locale-*independent* — worth stating in the policy so nobody localizes a parse format.
- **Fix:** Route export prose through the catalog; pin machine-parsed headers as invariant.

## Problematic couplings

1. **Service/persistence layers → UI copy** (the inverse of healthy direction): `src/types/errors.ts:38-57`, `src/lib/BookImportService.ts:96,107`, `src/lib/BackupService.ts:133`, `src/lib/sync/CheckpointService.ts:179` author English sentences that `src/App.tsx:126`, `src/components/library/LibraryView.tsx:235,295`, `src/components/library/FileUploader.tsx:282` display verbatim. Any copy change or localization requires edits across lib/sync/db.
2. **TTS engine (worker) → spoken UI copy**: `src/lib/tts/AudioContentPipeline.ts:108-119,286` means the i18n runtime must be importable from `src/workers/tts.worker.ts`'s dependency graph — a constraint on library choice owned by this gap but binding on the tts-engine subsystem.
3. **GenAI subsystem → persisted English-first derived data**: `src/lib/genai/GenAIService.ts:232-243` (smart-TOC titles), consumed by `src/hooks/useSmartTOC.ts`.
4. **App-shell rewrite seams (owned by app-shell-ui / type-safety-errors plans)**: the new toast queue API, `useConfirm()`, the settings registry `{id, label, ...}` descriptors, and `presentError()` will each freeze a string-passing contract. If they take `string`, i18n is locked out; they must take message keys + params (or accept both during migration). This coupling is temporal — it's why this decision has a deadline.
5. **`src/lib/cfi-utils.ts:418` → segmentation locale**: annotation/CFI logic silently depends on an English segmenter while the rest of the system threads `book.language`.

## What's good (keep)

- **The content-language pipeline.** `book.language` as ingested+normalized data (`language-utils.ts`, `ingestion.ts:82,263`), per-book override, per-language font profiles, lexicon language filtering, TTS segmentation locale threading, engine `getBookLanguage`. This is the *hard* half of i18n for a reader app and it's already modeled correctly. The overhaul must preserve the content-language vs UI-language distinction this implies: UI locale must never drive content behavior (segmentation, voices, pinyin), and nothing today wrongly does.
- **`segmenter-cache.ts`** — per-locale cached `Intl.Segmenter` instances; exactly the pattern the new formatter module should copy for `Intl.DateTimeFormat`/`NumberFormat`/`Collator`/`RelativeTimeFormat`.
- **Near string-free native Android layer** (`android/app/src/main/res/values/strings.xml` holds only app identity). All UI flows through the web view, so one i18n system covers web + PWA + Android.
- **Broad aria-label coverage** (159 sites) — the accessibility strings exist and are well-placed; they just need externalizing in place, not authoring.
- **`normalizeLanguageCode`** — small, correct, tested-by-use utility; becomes the shared base for the supported-language list (I18N-8 fix).
- **GenAI language awareness** — the prompt layer already knows and branches on book language (GenAIService.ts:232); only the output *shape* is wrong (I18N-9).

## Target design

**Decision (proposed): "i18n-ready, en-only at launch."** Adopt a message-catalog layer during the already-planned rewrites; ship English as the only locale; make zh-Hans/zh-Hant a content-complete follow-up that touches *catalog files only*. If the owner instead declares i18n a permanent non-goal, record that ADR and still execute I18N-2, I18N-4, I18N-5, I18N-7, I18N-8 (they are correctness/consistency fixes independent of translation).

**Library constraints (binding, from this codebase):**
1. Usable from plain TS modules and **inside the TTS Web Worker** (I18N-6) — not React-context-bound.
2. Type-safe message keys (the overhaul's type-safety goals; catches missing/renamed keys at compile time).
3. ICU plural/select support (kills the hand-rolled `s` ternaries).
4. Small runtime + lazy locale loading (PWA/mobile bundle budget; bundle analyzer already wired).
5. Per-message tree-shaking preferred.

Both **paraglide-js (inlang)** — compile-time, zero-runtime, fully typed per-message functions, Vite plugin — and **@lingui/core + @lingui/react** — compile-time extraction, ~8 kB runtime, mature ICU — satisfy all five; react-i18next satisfies 1/3/4 but not 2/5 without bolt-ons. Recommend paraglide first, lingui as fallback if its message-function model fights the worker bundling.

**Architecture:**
- `src/lib/locale/` module owning: `getUILocale()` (resolution: explicit user pref → `navigator.language` → `'en'`), a subscribe hook, `document.documentElement.lang` sync, and cached Intl formatters (`formatDate`, `formatRelativeTime`, `formatBytes`, `formatPercent`, `formatDuration`, `compareTitles`). UI-locale preference is a **per-device** setting (localStorage-backed store slice, NOT the Yjs doc — devices legitimately differ, and it must be readable before the doc loads for boot-path strings in SafeModeView/ErrorBoundary).
- **Catalog shape:** domain-namespaced keys (`library.import.failed`, `settings.sync.deleteWorkspace.confirm`), with an `errors.*` namespace keyed 1:1 by error `code` so `presentError(code, params)` is a pure catalog lookup. TTS spoken strings live in their own namespace resolved by *book* language.
- **Choke-point contracts:** toast queue store, `useConfirm()`, settings registry labels, and `presentError` accept `MsgKey + params` (typed), not prose. Components may still render prose directly via `t()`/message functions.
- **Two-locale rule, stated in architecture.md:** UI locale governs chrome, formatting, collation; `book.language` governs segmentation, voices, pinyin/OpenCC, spoken filler, content `lang=` attributes. Neither ever substitutes for the other.
- **Lint:** `no-literal-string`-style rule enabled per-directory as each is migrated; `no-alert` once `useConfirm` lands (already proposed in app-shell-ui.md).

## Migration notes

Sequenced to ride the other subsystems' rewrites; no big-bang string pass.

1. **ADR first** (blocks app-shell/type-safety rewrites): record the decision, library choice, two-locale rule, and catalog key conventions.
2. **Locale module + formatters** (standalone, zero behavior change while locale='en'... actually fixes I18N-4's mixed-language output by pinning UI locale explicitly): land `src/lib/locale/`, migrate the 16 `toLocale*` sites, delete the 3 relative-time and 4 byte-size duplicates. Set `documentElement.lang`.
3. **Choke points catalog-aware from birth**: when type-safety-errors builds `presentError` and app-shell builds the toast queue/`useConfirm`/settings registry, their signatures take keys+params. Error classes lose UI prose (keep dev `message`), gain `code`+params (I18N-2, I18N-9 structured titles).
4. **Opportunistic externalization**: every component rewrite already scheduled (GlobalSettingsDialog decomposition, CompassPill, library views, reader panels) moves its strings into the catalog as part of the rewrite; enable the lint rule for that directory on completion. Extraction tooling (`lingui extract` / paraglide machine translation stubs) builds the en catalog mechanically.
5. **TTS spoken strings**: replace `NO_TEXT_MESSAGES` randomization with one deterministic catalog message per situation, resolved by `book.language` (also fixes audio-cache churn); preroll via ICU plural. Verify catalog import works in the worker bundle (vitest worker tests exist to extend).
6. **Content `lang=` attributes** (I18N-5): mechanical pass over book-text render sites; add `lang` to PWA manifest.
7. **Point fixes**: cfi-utils segmenter locale (I18N-7, needs a bookLanguage parameter threaded from callers), VisualSettings language list via `Intl.DisplayNames` (I18N-8), export templates (I18N-11).
8. **When zh ships** (out of overhaul scope, but the test of success): add catalog files, a settings dropdown writing the per-device pref, zh font-stack audit for UI chrome, `Intl.Collator('zh-u-co-pinyin')` option for library sort. No data migrations except optionally re-rendering smart-TOC display strings from the structured form introduced in step 3.

**Data migrations:** none required for steps 1-7 (no persisted user-visible strings change shape) except the smart-TOC structured-title change (I18N-9), which needs a lazy parse-on-read migration of existing `"English (Original)"` strings. User settings gain one new per-device key (`ui.locale`), defaulting to system — no Yjs schema impact.
