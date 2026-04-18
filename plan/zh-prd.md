Product Requirements Document: Chinese Reading & TTS Support
============================================================

1\. Context & Problem Statement
-------------------------------

Versicle currently assumes a monoglotal (US English) operating environment. The local text-to-speech engine (Piper) explicitly filters out non-English models, text segmentation relies entirely on Western punctuation, and the visual renderer assumes standard Latin text flow.

For users who speak Mandarin but require reading assistance---specifically the conversion of Simplified to Traditional Chinese and the injection of Pinyin ruby text---the current architecture is non-functional. Furthermore, the lack of language-scoped settings means users would have to manually swap TTS voices and speeds every time they switch between an English sci-fi novel and a Chinese text.

2\. Core Principles
-------------------

-   **Predictability over Magic:** Heuristic language detection algorithms fail unpredictably on edge cases (e.g., loan words, short sentences). The system will rely on explicit, deterministic user inputs to assign language contexts to books.

-   **Structural Isolation:** A phonetic override for English must not inadvertently corrupt Chinese text. TTS profiles and Lexicon dictionaries must be strictly scoped by language.

-   **Unified Language Context:** The book language is the single source of truth. All downstream systems—audio profile, visual rendering defaults, text segmentation, and lexicon scoping—must derive from the book's language assignment. Users should never need to independently synchronize the audio language and the book language; changing one changes both.

-   **Performance:** DOM mutations for Pinyin injection must be performed efficiently without freezing the reader thread.

3\. Goals & Non-Goals
---------------------

### Goals

-   Enable the ingestion and accurate visual rendering of Chinese EPUBs.

-   Provide an on-the-fly conversion toggle from Simplified to Traditional Chinese.

-   Provide dynamic Pinyin injection (ruby text) to assist reading.

-   Expand Text Segmentation to parse CJK full-width punctuation correctly.

-   Enable the discovery and downloading of Mandarin (`zh_CN`) Piper models.

-   Implement language-scoped TTS profiles and Lexicon rules.

### Non-Goals

-   **UI Localization (i18n):** The application interface will remain strictly in English.

-   **Dynamic Mid-Sentence Voice Swapping:** We will not attempt to hot-swap between an English and Chinese voice model for mixed-language sentences, as this introduces unacceptable latency and erratic pacing.

4\. Technical Requirements
--------------------------

### 4.1 Book Language Assignment

-   **Metadata Parsing:** On import, read `<dc:language>`. Default to `en` if missing or malformed.

-   **Schema Update:** Add `language: string` to the `UserInventoryItem` interface in `useBookStore`.

> [!IMPORTANT]
> **Codebase Finding:** The plan originally called for modifying `src/types/db.ts`. Upon inspection, the canonical per-book user data lives in `UserInventoryItem` (synced via Yjs through `useBookStore`). The `language` field MUST be added here—NOT to the legacy `Book` interface—to ensure cross-device synchronization. The `StaticBookManifest` in IndexedDB should also store the raw `<dc:language>` value from the EPUB OPF for ingestion reference.

-   **Explicit Override:** The user must be able to override this value manually, which dictates the downstream TTS and Lexicon behavior.

### 4.2 Visual Pipeline (Traditional & Pinyin)

-   **Dependency Injection:** Integrate lightweight libraries for character mapping (e.g., `opencc-js` for Traditional/Simplified conversion) and phonetics (e.g., `pinyin-pro` for Pinyin generation).

-   **DOM Mutation:** Within the `useEpubReader` hook, implement a pre-render text processing step that wraps Chinese text nodes in `<ruby>` and `<rt>` tags when Pinyin is enabled.

> [!WARNING]
> **Codebase Finding:** The `useEpubReader` hook (688 lines) already hooks into `rendition.hooks.content` for injecting styles and spacers. Any Pinyin/Traditional overlay MUST be injected through this same hook pattern. Direct text node manipulation will break epub.js CFI generation and cause TTS audio/visual desynchronization. The non-destructive overlay approach (CSS `::after` with `data-pinyin` attributes or a transparent absolute-positioned overlay div) is mandatory.

### 4.3 Text Segmentation Refactor

-   **CJK Punctuation:** Update `TextSegmenter.ts` to split on `。`, `！`, `？`, `；`, `，`, and `、`.

> [!NOTE]
> **Codebase Finding:** `TextSegmenter.ts` already uses `Intl.Segmenter` with a locale parameter (defaults to `'en'`). Passing `'zh'` to the constructor activates CJK-aware segmentation automatically. The main work is: (1) using the book's language to select the correct locale, and (2) adjusting the fallback regex `RE_SENTENCE_FALLBACK` which currently only handles `.!?`. The `segmenter-cache.ts` already caches segmenters by locale.

-   **Chunk Sizing:** Ensure Chinese character chunks respect the Piper worker's memory limits without splitting idioms (成语) or hyphenated concepts.

### 4.4 TTS & Lexicon Language Scoping

-   **State Restructure:** Refactor `useTTSStore` from singular state variables (`voice`, `rate`, `pitch`) to a dictionary of profiles keyed by language code.

> [!IMPORTANT]
> **Codebase Finding:** `useTTSStore` (372 lines) is a Zustand store persisted to `localStorage` via `zustand/middleware/persist`. It uses `partialize` to select fields for serialization. The refactor must: (1) introduce a `profiles: Record<string, TTSProfile>` field in the partialised state, (2) add an `activeLanguage: string` field, and (3) provide migration logic in the `version` option of the persist config to hydrate legacy flat `voice/rate/pitch` into `profiles.en`. The `onRehydrateStorage` callback must also be updated to restore from the active profile.

-   **Piper Provider:** Remove the `en_US` hardcode in `PiperProvider.ts`. Expose single-speaker `zh_CN` models.

> [!NOTE]
> **Codebase Finding:** `PiperProvider.ts` line 89 contains `if (!key.startsWith('en_US')) continue;`. This is a single-line filter that must be expanded to also allow `zh_CN` prefixes. The voice data structure (`PiperVoiceInfo.language`) already includes `code`, `family`, `region`, and `name_english`—no schema changes needed. The HuggingFace `voices.json` already contains zh_CN models.

-   **Lexicon Schema:** Add `language: string` to Lexicon entries. The `AudioContentPipeline` must filter the lexicon array by the active book's language before processing.

> [!NOTE]
> **Codebase Finding:** `LexiconRule` in `src/types/db.ts` currently has `bookId?: string` for scoping. Adding `language?: string` is additive and backward-compatible. `LexiconService.getRules()` already supports filtering by `bookId`; adding a `language` parameter is a small extension. The `useLexiconStore` (Yjs-backed) will propagate the new field automatically.

### 4.5 Unified Book Language ↔ Audio Language Profile

-   **Problem:** The current implementation maintains two independent language selectors: the "Book Language" dropdown in `VisualSettings.tsx` and the "Active Language Profile" selector in both `UnifiedAudioPanel.tsx` and `TTSSettingsTab.tsx`. Users can set a book to Chinese while the audio language profile remains on English, causing the wrong TTS voice to be loaded and lexicon rules to be misapplied.

-   **Requirement:** The book's `language` field (in `UserInventoryItem`) is the **single source of truth**. The TTS store's `activeLanguage` must be a **derived value**, not an independent setting.

-   **Behavior:**
    1. When a book is opened in the reader, the system sets `useTTSStore.activeLanguage` to match the book's language. *(Already implemented in `AudioPlayerService.setBookId()`.)*
    2. When the user changes the "Book Language" in `VisualSettings.tsx`, the system must **also** update `useTTSStore.activeLanguage` to the new value.
    3. The standalone "Active Language Profile" selector in `UnifiedAudioPanel.tsx` must be **removed**. It is a source of desynchronization. Users should change the book's language from `VisualSettings`, and the audio profile follows automatically.
    4. The "Language Profile" selector in `TTSSettingsTab.tsx` (Global Settings) is retained for **configuration purposes only** (e.g., downloading voices, adjusting speed presets for a language). It does NOT affect which profile is active during playback—that is always determined by the open book's language.

> [!IMPORTANT]
> **Codebase Finding:** `UnifiedAudioPanel.tsx` currently imports `activeLanguage` and `setActiveLanguage` from `useTTSStore` and renders a full language selector in its settings view (lines 38–39, 147–158). This selector must be removed. `VisualSettings.tsx` already calls `updateBook(currentBookId, { language: lang })` on line 143 but does NOT call `useTTSStore.setActiveLanguage()`, creating the desync. The fix is to add a `setActiveLanguage(lang)` call inside the `VisualSettings` language change handler, and remove the redundant selector from `UnifiedAudioPanel`.

### 4.6 Language-Dependent Font Rendering Defaults

-   **Problem:** The current `usePreferencesStore` stores a single global `fontSize` (percentage) and `lineHeight` value. Chinese text rendered at the same font size as English text is harder to read because CJK glyphs are structurally more complex and visually denser. Similarly, the optimal line height differs: Latin text reads well at 1.5× line height, but CJK text typically requires 1.6–1.8× for comfortable reading due to the visual weight and stroke density of characters.

-   **Requirement:** Font rendering parameters (`fontSize`, `lineHeight`) must be stored **per language**, similar to how TTS profiles are stored per language.

-   **Behavior:**
    1. The `usePreferencesStore` introduces a `fontProfiles: Record<string, { fontSize: number; lineHeight: number }>` map.
    2. When the user adjusts font size or line height in `VisualSettings.tsx`, the change is saved to the profile matching the current book's language.
    3. When the user opens a book or switches the book's language, the renderer loads the font profile for that language.
    4. Default profiles are provided: `en: { fontSize: 100, lineHeight: 1.5 }`, `zh: { fontSize: 120, lineHeight: 1.8 }`.
    5. The existing global `fontSize` and `lineHeight` fields are retained for backward compatibility and migrate into `fontProfiles.en` on first load.

> [!NOTE]
> **Codebase Finding:** `usePreferencesStore.ts` stores `fontSize: number` (default 100) and `lineHeight: number` (default 1.5) as flat top-level fields (lines 17–18). These are consumed by `useEpubReader.ts` to inject styles into the epub.js iframe. The refactor must: (1) add a `fontProfiles` map alongside the existing flat fields, (2) add a helper `getFontProfile(lang: string)` that returns the profile for a language (falling back to the global defaults), (3) update `VisualSettings.tsx` to read/write through the profile keyed by the current book's language, and (4) update `useEpubReader.ts` to apply the language-specific profile.

5\. UX Designs & Interface Modifications
----------------------------------------

### 5.1 Reader Menu: Language Override

**Location:** Inside the `ReaderControlBar.tsx` (or Book Info modal). **Element:** A straightforward `<Select>` dropdown labeled "Book Language". **Behavior:** Defaults to the imported `<dc:language>`. Changing this immediately reloads the active TTS profile, Lexicon scope, **and font rendering profile**.

> [!NOTE]
> **Codebase Finding:** `ReaderControlBar.tsx` delegates all display to the `CompassPill` component. The language selector should be surfaced as a new action in the annotation popover or as a new sub-panel in the `LexiconManager.tsx` dialog (which is already opened from the ReaderControlBar). Alternatively, it could be placed in the `VisualSettings.tsx` popover which already contains reader-specific toggles. The latter is recommended to keep the CompassPill focused.
>
> **Update (Post-Implementation):** The selector was placed in `VisualSettings.tsx` as recommended. Changing the book language must now also: (1) call `useTTSStore.setActiveLanguage()` to couple the audio profile, and (2) load the corresponding font rendering profile from `usePreferencesStore.fontProfiles`.

### 5.2 Visual Settings Tab

**Location:** `VisualSettings.tsx` (accessible via the Reader). **New Elements:**

1.  **Character Set:** A toggle labeled "Force Traditional Chinese". (Hidden if the book language is not set to `zh`).

2.  **Reading Assistance:** A toggle labeled "Show Pinyin".

3.  **Pinyin Size:** A slider (50% to 150%) to independently scale the `<rt>` ruby text size relative to the base character.

> [!NOTE]
> **Codebase Finding:** `VisualSettings.tsx` (now ~210 lines) uses `usePreferencesStore` (Yjs-synced). The new Chinese-specific toggles should also be added to `usePreferencesStore`. The component already imports `Switch`, `Slider`, `Select`, and `Label` from the UI library—all needed for the new elements. The new settings section should be conditionally rendered based on the active book's language.

> [!IMPORTANT]
> **Update (Post-Implementation):** The font size slider and line height controls in the "Legibility" and "Layout" sections must now read from and write to the **language-specific font profile** (`fontProfiles[currentLanguage]`), not the global flat fields. This ensures that adjusting font size while reading a Chinese book does not alter the English font size, and vice versa.

### 5.3 Global TTS Settings

**Location:** `TTSSettingsTab.tsx` in the Global Settings dialog. **Redesign:**

-   **Top-level Control:** Add a "Configure Language Profile" dropdown (Options: English, Chinese, etc.).

-   **Contextual UI:** The sections below it (Voice Selection, Speech Rate, Pitch) visually update to reflect the saved settings for the selected language.

-   **Empty State:** If the user selects "Chinese" but has no voice downloaded, display a prominent warning: *"No Mandarin voice installed. Audio playback will fail for Chinese books."*

> [!NOTE]
> **Codebase Finding:** `TTSSettingsTab.tsx` (281 lines) is a controlled component receiving all state via props from `GlobalSettingsDialog.tsx`. The language profile selector must be added to the props interface (`TTSSettingsTabProps`) and wired through `GlobalSettingsDialog.tsx` which reads from `useTTSStore`. The Piper voice list already contains a `lang` field that can be used to filter voices per language profile.

### 5.4 Lexicon Manager

**Location:** `LexiconManager.tsx` in Global Settings. **Redesign:**

-   **List View Filter:** Add a "Filter by Language" dropdown at the top of the rule list. Defaults to the language of the currently active book (if any).

-   **Creation Form:** Add a mandatory "Target Language" dropdown to the "Add New Rule" form.

> [!NOTE]
> **Codebase Finding:** `LexiconManager.tsx` is 37,357 bytes (~1000+ lines). It's a complex component with drag-and-drop reordering, CSV import/export, and inline editing. The language filter should be implemented as a `<Select>` above the existing rule list, and the creation form needs a new `language` field. The existing `useLexiconStore` actions (`addRule`, `updateRule`) will propagate the new field through Yjs automatically.

6\. Critical User Journeys (CUJs)
---------------------------------

### CUJ 1: Importing and Configuring a Chinese Book for Visual Reading

**Actor:** A user who speaks Mandarin but struggles to read pure character text, specifically Simplified Chinese.

1.  **Import:** The user drags and drops a Chinese EPUB into the library.

2.  **Open:** They open the book. It renders in Simplified Chinese without pronunciation guides.

3.  **Language Assignment:** The user opens the Book Info/Control menu and verifies the "Book Language" is set to "Chinese (zh)".

4.  **Visual Configuration:** The user opens Visual Settings. They toggle on "Force Traditional Chinese" and "Show Pinyin".

5.  **Result:** The reader re-renders. The text is now in Traditional characters, with Pinyin ruby text displayed cleanly above each character. The user adjusts the "Pinyin Size" slider until it is legible.

### CUJ 2: Setting up Mandarin TTS Playback

**Actor:** A user who wants to listen to the Chinese book while commuting.

1.  **Configuration:** The user opens Global Settings > TTS Engine.

2.  **Profile Selection:** They select "Chinese" from the new "Language Profile" dropdown.

3.  **Voice Acquisition:** The voice list populates with `zh_CN` Piper models. The user selects a high-quality single-speaker model and clicks "Download".

4.  **Playback:** Returning to the book, the user presses Play on the UnifiedAudioPanel.

5.  **Result:** The system recognizes the book is `zh`, loads the Chinese TTS profile, and passes the text to the Piper worker. The audio plays smoothly, pausing naturally at Chinese periods (。) and commas (，).

### CUJ 3: Resolving a Polyphone via the Lexicon

**Actor:** A user listening to a Chinese book encounters a mispronounced character.

1.  **The Error:** The Piper engine encounters the character 行 in the context of "银行" (bank) but incorrectly pronounces it as *xíng* (to walk) instead of *háng*.

2.  **Access Lexicon:** The user opens Settings > Dictionary > Lexicon Manager.

3.  **Create Rule:** They add a new rule.

    -   *Target Language:* Chinese

    -   *Match:* 银行

    -   *Replacement:* yin hang (mapped to the specific phonetic string the Piper engine expects).

4.  **Resume:** The user saves the rule and resumes playback.

5.  **Result:** The `AudioContentPipeline` applies the `zh`-scoped rule. The TTS engine now correctly pronounces the word. English books are unaffected because the rule is isolated to the Chinese scope.

### CUJ 4: Seamless Language Context Switching

**Actor:** A user who reads books in both English and Chinese on the same device.

1.  **Setup:** The user has an English book configured with a serif font at 100% size, line height 1.5, and an English TTS voice at 1.2× speed. They also have a Chinese book configured with a sans-serif font at 120% size, line height 1.8, and a Chinese TTS voice at 1.0× speed.

2.  **Opening English Book:** The user opens their English novel. The reader loads the English font profile (100%, 1.5 line height) and the English TTS profile (voice + speed). Everything matches.

3.  **Switching to Chinese Book:** The user returns to the library and opens a Chinese book. Without any manual intervention, the reader loads the Chinese font profile (120%, 1.8 line height) and the Chinese TTS profile. The lexicon rules are scoped to Chinese.

4.  **Result:** The user never has to manually switch the "Active Language Profile" for audio. They never have to readjust font sizes when switching languages. Each book carries its language, and all downstream rendering and audio settings follow automatically.

### CUJ 5: Correcting a Misclassified Book Language

**Actor:** A user who imports a book with incorrect or missing `<dc:language>` metadata.

1.  **Import:** The user imports a Chinese EPUB that has `<dc:language>en</dc:language>` (incorrectly tagged).

2.  **Open:** The book opens with English defaults—wrong font profile, no Chinese settings visible.

3.  **Correction:** The user opens Visual Settings and changes the "Book Language" to Chinese.

4.  **Result:** Immediately, the font profile switches to Chinese defaults (larger size, more line spacing), the Chinese settings section appears (Pinyin, Traditional conversion), and the TTS audio language profile switches to Chinese. A single action corrects everything.

## Implementation Notes (Phase 2 completion)
- Migrated legacy `fontSize` and `lineHeight` state into a `fontProfiles: Record<string, FontProfile>` map within `usePreferencesStore.ts` with `en` and `zh` specific sensible defaults.
- Added `getFontProfile` and `setFontProfile` to properly access rendering metadata on a language-contextual level, eliminating independent styling settings.
- Wired `useEpubReader.ts` and `VisualSettings.tsx` to utilize `fontProfiles` based on the actively loaded book's semantic language.
- Updated `TTSSettingsTab.tsx` to include a dropdown dictating the `activeLanguage` for the settings context, and implemented the list filtration of valid `zh_CN` and `en_US` model voices per selection alongside a warning empty-state.
- Handled propagation of `<TTSSettingsTab>`'s new `activeLanguage` props downward via `GlobalSettingsDialog.tsx`.

## Implementation Notes (Phase 3 & 4 completed)
- Created `ChineseTextProcessor.ts` wrapping `opencc-js` and `pinyin-pro` with dynamic imports.
- Added `injectChineseOverlay` to `useEpubReader.ts` generating CSS-based ruby text on `data-pinyin` to preserve original DOM text.
- Re-added missing state fields to `usePreferencesStore.ts` and `VisualSettings.tsx` UI (these were missing in the `main` branch despite the Phase 2 claim).
- Updated `PiperProvider.ts` to accept `zh_CN` voices and dynamically reduce chunk size to 100 characters for CJK texts.
- Added CJK boundary fallback regex to `TextSegmenter.ts`.
- Added `PiperProvider.test.ts` and `TextSegmenter.test.ts` to verify the behavior.

## Implementation Notes (Phase 5 completion)
- Completed the multi-lingual pipeline verifications.
- Modified `src/lib/tts.ts` and `src/lib/ingestion.ts` to ensure `rawLanguage` is extracted from metadata and correctly passed down to `TextSegmenter` during sentence extraction.
- Developed `verification/test_journey_chinese.py` Playwright E2E script covering Chinese EPUB upload, rendering adjustments (Pinyin and Traditional modes), and correctly identifying the TTS Mandarin profile empty state without breaking English contexts.
- Added data-testid to settings warnings to resolve brittle React text selectors in Playwright.

## Implementation Notes (Phase 1 completion)
- Completed the migration in `useTTSStore.ts` converting the flat `voice`, `pitch`, and `rate` configuration into language-specific profiles under `profiles` record, driven by `activeLanguage`.
- Replaced the stubbed `setActiveLanguage` with the full implementation, correctly applying new properties from the newly selected language profile, and updating the state and underlying player.
- Updated `useTTSStore` property setters to also mutate the active profile so user configurations persist independently by language.
- Set up migration configurations (`version`, `migrate`) so previous storage structures resolve gracefully into the `en` active language profile on load.

## Implementation Progress (FINAL)
- [x] Phase 1: Store Migration (Zustand & Persist)
- [x] Phase 2: TTS Store Multi-Language Support
- [x] Phase 3: Text Processing Pipeline
- [x] Phase 4: Reader UI & UX
- [x] Phase 5: Testing & Hardening
- [x] Phase 6: Scoped Font Profiles & UI Coupling (FINAL)

## Final Architecture Notes (Post-Phase 6)

### Language-Scoped Settings
- All font-related preferences (fontSize, lineHeight) are now scoped per language using the `fontProfiles` map in `usePreferencesStore`.
- Changing the language of a book in `VisualSettings` automatically triggers a TTS profile switch via `useTTSStore.setActiveLanguage`.
- The `AudioPlayerService` successfully propagates language changes down to the `TTSProviderManager` and individual providers (e.g., `PiperProvider`).

### Non-Destructive Rendering
- Chinese overlays (Pinyin/Traditional) remain non-destructive, injected via late hooks in `useEpubReader.ts`.
- The reader correctly handles dynamic settings changes without reloading the book.

## Final Stabilization Notes
- Discovered and fixed a syntax error (extra brace) in `src/store/usePreferencesStore.ts` that caused cross-file transform errors during testing.
- Fixed a missing store selector field in `VisualSettings.tsx` because of a `TypeError` when accessing `fontProfiles`.
- Critical Discovery: `opencc-js` and `pinyin-pro` dependencies were missing from the local `node_modules` despite being in `package.json`. Installed them to fix ReaderView transform errors.
- Hardened test mocks in `VisualSettings.test.tsx`, `ReaderView.test.tsx`, and `ReaderView_VersionCheck.test.tsx` to include the now-mandatory `fontProfiles` initial state.
- All 211 test files (1491 tests) are confirmed passing.
## Final Stabilization & Build Fixes
- **Robust Language Matching**: Updated `VisualSettings.tsx` and `ReaderView.tsx` to handle regional language sub-tags (e.g., `zh-CN` → `zh`) when looking up font profiles. This ensures that books with specific locale metadata correctly pick up their language-optimized settings.
- **Build Optimization**: Resolved `TS6133` (unused variables) in `VisualSettings.tsx` and `TS2345` (type mismatch) in `AudioPlayerService.ts`, ensuring a clean production build (`npm run build`).
- **Verified E2E**: Stabilized `verification/test_font_profiles.py` by removing the unsupported `host` fixture and implementing robust book selection logic. Confirmed end-to-end success in the Playwright verification suite.
