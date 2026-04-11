Technical Design Document: Chinese Reading & TTS Support Implementation
=======================================================================

1\. Overview
------------

This technical design document outlines the implementation strategy for the Chinese Reading and TTS Support initiative. The project requires structural changes to the application's state management, text segmentation, rendering pipeline, and local TTS provider.

To ensure stability---specifically preserving Canonical Fragment Identifier (CFI) integrity, cross-device CRDT synchronization, and audio-visual phonetic coherence---the implementation is strictly phased.

Phase 1: Foundation, CRDT Migration, & Data Model
-------------------------------------------------

**Objective:** Update underlying schemas, validation boundaries, and synchronization engines to support multi-lingual context without corrupting existing data.

### 1.1 Schema & Validation Updates (Centralized)

-   **`src/types/db.ts`:**

    -   Update the core `Book` interface to include `language?: string`.

    -   Update `LexiconEntry` to require a `language: string` field.

-   **`src/db/validators.ts`:**

    -   Update Zod/validation schemas to enforce the new `language` fields for incoming sync payloads. Use `.default('en')` or `.catch('en')` to gracefully handle legacy payloads.

-   **`useTTSStore.ts`:**

    -   Refactor the flat configuration (`voiceId`, `rate`, `pitch`) into a dictionary of profiles to prevent wiping settings during language swaps:

    ```
    interface TTSState {
      activeLanguage: string;
      profiles: Record<string, { voiceId: string | null; rate: number; pitch: number; volume: number }>;
    }

    ```

### 1.2 CRDT & Sync Migration

-   **`src/lib/sync/MigrationStateService.ts`:**

    -   Implement a formal schema migration step. When a legacy client connects, gracefully coalesce missing `language` fields on books and lexicon entries to `'en'` locally before propagating to the sync engine. This prevents race conditions where legacy and updated clients battle over field definitions.

### 1.3 EPUB Ingestion Updates

-   **`src/lib/ingestion.ts`:**

    -   Modify the metadata parsing logic to extract `<dc:language>`.

    -   Normalize the extracted string to standard ISO 639-1 format (e.g., `zh`, `en`). Default to `en` if the tag is missing, malformed, or empty.

Phase 2: User Interface & Context Wiring
----------------------------------------

**Objective:** Build the UI components required for users to manually correct language metadata and scope their settings.

### 2.1 Reader Control Menu

-   **`ReaderControlBar.tsx`:**

    -   Implement a "Book Language" `<Select>` dropdown.

    -   Wiring: On change, commit the `language` update to the synced `Book` record. The `AudioContentPipeline` and visual renderer must react to this change immediately.

### 2.2 Global TTS Settings

-   **`TTSSettingsTab.tsx`:**

    -   Introduce a top-level "Configure Language Profile" dropdown.

    -   Bind the Voice Selector and Rate/Pitch sliders to the currently selected language's `TTSProfile` rather than the root store.

    -   Warn the user if "Chinese (zh)" is selected but no `zh_CN` Piper model is currently downloaded.

### 2.3 Lexicon Manager

-   **`LexiconManager.tsx`:**

    -   Add a "Filter by Language" dropdown to the list view (defaulting to the current book's language).

    -   Add a mandatory "Target Language" select field to the creation form.

Phase 3: Visual Pipeline (Non-Destructive Ruby Overlay)
-------------------------------------------------------

**Objective:** Inject Pinyin reading assistance visually without corrupting `epub.js` text nodes, which would permanently break text selection and CFI generation.

### 3.1 Dependency Integration

-   Install `opencc-js` for Simplified-to-Traditional character conversion.

-   Install `pinyin-pro` for Hanzi-to-Pinyin phonetic generation.

### 3.2 Reader Visual Settings

-   **`VisualSettings.tsx`:**

    -   Add a "Force Traditional Chinese" toggle.

    -   Add a "Show Pinyin" toggle.

    -   Add a "Pinyin Size" slider.

### 3.3 Non-Destructive Overlay Engine

-   **`useEpubReader.ts` & Overlay logic:**

    -   **CRITICAL:** Do *not* extract and replace raw text nodes with Document Fragments. This destroys the DOM map `epub.js` relies on.

    -   Instead, hook into `rendition.hooks.content` (or trigger on pagination).

    -   If `zh` and Pinyin is enabled:

        1.  Parse the visible text using `pinyin-pro`.

        2.  Extract the bounding client rects of the corresponding Chinese characters via standard DOM Range API.

        3.  Generate a transparent absolute-positioned overlay `<div>` on top of the iframe.

        4.  Render the `<ruby>`/`<rt>` Pinyin elements inside this isolated overlay layer perfectly aligned with the base text underneath.

    -   Alternatively, use `epub.js`'s `rendition.annotations.mark()` API to inject CSS classes hooked to `::after { content: attr(data-pinyin) }`, allowing CSS to handle the positioning without severing the original text node.

Phase 4: Audio Pipeline & Segmentation
--------------------------------------

**Objective:** Secure the local TTS engine against massive CJK character strings and prevent audio-visual desync regarding polyphone pronunciation.

### 4.1 Piper Provider Expansion

-   **`PiperProvider.ts`:**

    -   Remove the hardcoded `en_US` restriction when parsing the HuggingFace `voices.json`.

    -   Expose high-quality, single-speaker `zh_CN` models for download.

### 4.2 CJK Text Segmentation Constraints

-   **`TextSegmenter.ts`:**

    -   Update regular expression boundaries to split on CJK full-width punctuation: `。`, `！`, `？`, `；`, `，`, and `、`.

    -   **Dynamic Merging Thresholds:** Because Chinese characters carry exponentially more semantic density than Latin letters, apply a conditional threshold limit. If `activeLanguage === 'zh'`, drastically lower the maximum chunk length (e.g., from 250 characters down to ~50 characters) to prevent Piper worker OOM timeouts.

### 4.3 Phonetic Coherence & Lexicon Scoping

-   **`AudioContentPipeline.ts`:**

    -   Scope Lexicon rules to `rule.language === book.language`.

    -   **Prevent Audio/Visual Desync:** Ensure Piper doesn't hallucinate a pronunciation (via eSpeak) that differs from the Pinyin currently rendered on screen (via `pinyin-pro`).

    -   If Pinyin reading assistance is active, the `AudioContentPipeline` must pass the *exact resolved phonetic string* (or the exact Pinyin outputted by `pinyin-pro`) directly to the TTS provider, rather than passing the raw ambiguous Chinese characters. This guarantees the audio maps exactly to what the user reads.

Phase 5: Verification & Quality Assurance
-----------------------------------------

**Objective:** Validate that the multi-lingual pipeline does not cause regressions to the core English experience.

### 5.1 Unit & Integration Testing

-   Validate `src/types/db.ts` and `src/db/validators.ts` correctly reject corrupted multi-lingual states.

-   Test `TextSegmenter.ts` using dense CJK text to ensure the chunking limit appropriately kicks in before limits are reached.

-   Verify `AudioContentPipeline` applies language-matching Lexicon rules exclusively.

### 5.2 End-to-End (E2E) Journey Verification

-   Execute test suites ensuring legacy CFI locations still resolve accurately after Pinyin injection logic is toggled.

-   Verify that swapping a book from `en` to `zh` successfully triggers the appropriate context shift across the `TextSegmenter`, `AudioContentPipeline`, and `VisualSettings`.