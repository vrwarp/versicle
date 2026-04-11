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

5\. UX Designs & Interface Modifications
----------------------------------------

### 5.1 Reader Menu: Language Override

**Location:** Inside the `ReaderControlBar.tsx` (or Book Info modal). **Element:** A straightforward `<Select>` dropdown labeled "Book Language". **Behavior:** Defaults to the imported `<dc:language>`. Changing this immediately reloads the active TTS profile and Lexicon scope.

> [!NOTE]
> **Codebase Finding:** `ReaderControlBar.tsx` delegates all display to the `CompassPill` component. The language selector should be surfaced as a new action in the annotation popover or as a new sub-panel in the `LexiconManager.tsx` dialog (which is already opened from the ReaderControlBar). Alternatively, it could be placed in the `VisualSettings.tsx` popover which already contains reader-specific toggles. The latter is recommended to keep the CompassPill focused.

### 5.2 Visual Settings Tab

**Location:** `VisualSettings.tsx` (accessible via the Reader). **New Elements:**

1.  **Character Set:** A toggle labeled "Force Traditional Chinese". (Hidden if the book language is not set to `zh`).

2.  **Reading Assistance:** A toggle labeled "Show Pinyin".

3.  **Pinyin Size:** A slider (50% to 150%) to independently scale the `<rt>` ruby text size relative to the base character.

> [!NOTE]
> **Codebase Finding:** `VisualSettings.tsx` (132 lines) uses `usePreferencesStore` (Yjs-synced). The new Chinese-specific toggles should also be added to `usePreferencesStore`. The component already imports `Switch`, `Slider`, `Select`, and `Label` from the UI library—all needed for the new elements. The new settings section should be conditionally rendered based on the active book's language.

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