Technical Design Document: Chinese Reading & TTS Support Implementation
=======================================================================

1\. Overview
------------

This technical design document outlines the implementation strategy for the Chinese Reading and TTS Support initiative. The project requires structural changes to the application's state management, text segmentation, rendering pipeline, and local TTS provider.

To ensure stability---specifically preserving Canonical Fragment Identifier (CFI) integrity, cross-device CRDT synchronization, and audio-visual phonetic coherence---the implementation is strictly phased.

> [!IMPORTANT]
> **Architecture Discovery:** The codebase uses a split architecture:
> - **IndexedDB** (`src/db/db.ts`, version 23): Stores immutable/cached data only (STATIC + CACHE domains).
> - **Yjs CRDT** (via `zustand-middleware-yjs`): Stores ALL mutable user data (books, preferences, lexicon, annotations, reading state). This is synced across devices.
> - **localStorage** (via `zustand/middleware/persist`): Stores device-local TTS settings only.
>
> Every schema change must respect this split. User-facing fields go into Yjs stores. Ingestion metadata goes into IndexedDB. Device-local TTS preferences go into localStorage.

Phase 1: Foundation, CRDT Migration, & Data Model
-------------------------------------------------

**Objective:** Update underlying schemas, validation boundaries, and synchronization engines to support multi-lingual context without corrupting existing data.

### 1.1 Schema & Validation Updates (Centralized)

#### 1.1.1 Add `language` to `UserInventoryItem` (Yjs-synced, cross-device)

**File:** [src/types/db.ts](file:///Users/btsai/antigravity/versicle/versicle/src/types/db.ts)

-   **What:** Add `language?: string` field to the `UserInventoryItem` interface (line ~94).

-   **Where exactly:** After the `coverPalette?: number[]` field on line 132, add:
    ```typescript
    /** ISO 639-1 language code (e.g., 'en', 'zh'). Defaults to 'en'. */
    language?: string;
    ```

-   **Why optional:** Backward compatibility. Existing books without this field default to `'en'` at runtime.

-   **Impact:** This field is part of `useBookStore` (Yjs share name `'library'`), so it syncs across devices automatically. No IndexedDB migration needed.

#### 1.1.2 Add `language` to `LexiconRule` (Yjs-synced)

**File:** [src/types/db.ts](file:///Users/btsai/antigravity/versicle/versicle/src/types/db.ts)

-   **What:** Add `language?: string` field to the `LexiconRule` interface (line ~556).

-   **Where exactly:** After the `order?: number` field on line 576, add:
    ```typescript
    /** ISO 639-1 language code this rule applies to. If undefined, applies to all languages. */
    language?: string;
    ```

-   **Why optional:** Existing rules apply to all books (legacy behavior). Only new rules created after this change will have explicit language scoping.

#### 1.1.3 Add `language` to `StaticBookManifest` (IndexedDB, per-device)

**File:** [src/types/db.ts](file:///Users/btsai/antigravity/versicle/versicle/src/types/db.ts)

-   **What:** Add `language?: string` to `StaticBookManifest` (line ~22).

-   **Where exactly:** After the `coverPalette?: number[]` field on line 49, add:
    ```typescript
    /** Raw dc:language from EPUB OPF metadata. Used as default for UserInventoryItem.language. */
    language?: string;
    ```

-   **Why:** Preserves the raw EPUB metadata for reference during re-ingestion or re-processing. Does NOT drive runtime behavior—`UserInventoryItem.language` is authoritative.

#### 1.1.4 Update Sync Validators

**File:** [src/lib/sync/validators.ts](file:///Users/btsai/antigravity/versicle/versicle/src/lib/sync/validators.ts)

-   **What:** Add `language` to the `UserInventoryItemSchema` Zod object.

-   **How:** After the `coverPalette` field (line 17), add:
    ```typescript
    language: z.string().optional().default('en'),
    ```

-   **What:** Add `language` to the lexicon rule schema in `UserOverridesSchema`.

-   **How:** In the lexicon array item object (line ~62), add:
    ```typescript
    language: z.string().optional(),
    ```

#### 1.1.5 Update DB Validators

**File:** [src/db/validators.ts](file:///Users/btsai/antigravity/versicle/versicle/src/db/validators.ts)

-   No changes needed. The `validateBookMetadata` function validates the legacy `Book` interface, not `UserInventoryItem`. The Yjs stores handle their own validation via the sync validators.

### 1.2 TTS Store Refactor (Language Profiles)

**File:** [src/store/useTTSStore.ts](file:///Users/btsai/antigravity/versicle/versicle/src/store/useTTSStore.ts)

This is the highest-risk change in Phase 1. The TTS store is persisted to `localStorage` and must be migrated carefully.

#### Step-by-step:

1.  **Define `TTSProfile` interface** (add at top of file, ~line 16):
    ```typescript
    interface TTSProfile {
      voiceId: string | null;
      rate: number;
      pitch: number;
      volume: number;
    }
    ```

2.  **Add new state fields** to `TTSState` interface (after `lastError`, ~line 39):
    ```typescript
    /** Active language for TTS profile selection. */
    activeLanguage: string;
    /** Per-language TTS profiles. */
    profiles: Record<string, TTSProfile>;
    ```

3.  **Add new actions** (after `clearError`, ~line 105):
    ```typescript
    setActiveLanguage: (lang: string) => void;
    ```

4.  **Update initial state** (~line 126):
    ```typescript
    activeLanguage: 'en',
    profiles: {
      en: { voiceId: null, rate: 1.0, pitch: 1.0, volume: 1.0 },
    },
    ```

5.  **Implement `setActiveLanguage` action:**
    ```typescript
    setActiveLanguage: (lang) => {
      set({ activeLanguage: lang });
      const profile = get().profiles[lang];
      if (profile) {
        set({ rate: profile.rate, pitch: profile.pitch, voice: null });
        AudioPlayerService.getInstance().setSpeed(profile.rate);
      }
    },
    ```

6.  **Update `setRate`, `setPitch`, `setVoice`** to also save into the active profile:
    ```typescript
    setRate: (rate) => {
      const lang = get().activeLanguage;
      AudioPlayerService.getInstance().setSpeed(rate);
      set((state) => ({
        rate,
        profiles: {
          ...state.profiles,
          [lang]: { ...state.profiles[lang], rate }
        }
      }));
    },
    ```

7.  **Update `partialize`** (~line 338) to include the new fields:
    ```typescript
    activeLanguage: state.activeLanguage,
    profiles: state.profiles,
    ```

8.  **Add migration logic** using the persist middleware's `version` + `migrate` options:
    ```typescript
    {
      name: 'tts-storage',
      version: 2, // Bump from implicit 0
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState: any, version: number) => {
        if (version < 2) {
          // Migrate flat fields into profiles
          persistedState.activeLanguage = 'en';
          persistedState.profiles = {
            en: {
              voiceId: persistedState.voice?.id || null,
              rate: persistedState.rate || 1.0,
              pitch: persistedState.pitch || 1.0,
              volume: 1.0,
            }
          };
        }
        return persistedState;
      },
      partialize: (state) => ({ ... }),
    }
    ```

9.  **Update existing tests** in `src/store/useTTSStore.test.ts` and `src/store/useTTSStore_platform.test.ts` to account for the new fields.

### 1.3 EPUB Ingestion Updates

**File:** [src/lib/ingestion.ts](file:///Users/btsai/antigravity/versicle/versicle/src/lib/ingestion.ts)

#### Step-by-step:

1.  **Extract `<dc:language>` from EPUB metadata** (~line 207, after `const metadata = await (book.loaded as any).metadata;`):
    ```typescript
    // Extract language (ISO 639-1), normalize, default to 'en'
    let rawLanguage: string = metadata.language || metadata.lang || 'en';
    rawLanguage = rawLanguage.trim().toLowerCase().split('-')[0]; // 'zh-CN' -> 'zh'
    if (!/^[a-z]{2,3}$/.test(rawLanguage)) rawLanguage = 'en';
    ```

2.  **Add to `StaticBookManifest`** (~line 325, in the manifest object literal):
    ```typescript
    language: rawLanguage,
    ```

3.  **Add to `UserInventoryItem`** (~line 354, in the inventory object literal):
    ```typescript
    language: rawLanguage,
    ```

4.  **Add a unit test** to `src/lib/ingestion.test.ts`:
    - Test that a Chinese EPUB with `<dc:language>zh-CN</dc:language>` correctly sets `language: 'zh'`.
    - Test that an EPUB with missing `<dc:language>` defaults to `language: 'en'`.
    - Test that malformed values (e.g., `<dc:language>invalidlanguage</dc:language>`) default to `'en'`.

### 1.4 CRDT Backward Compatibility

**File:** No new file needed. The Yjs middleware handles missing fields gracefully.

-   **How it works:** When a legacy client (without the `language` field) syncs with an updated client, the Yjs merge will simply not have a `language` key in the synced map. The consuming code must use `book.language || 'en'` everywhere.

-   **Defensive pattern (mandatory for all consumers):**
    ```typescript
    const bookLanguage = book.language || 'en';
    ```

-   **Where to apply:** Add this pattern in:
    - `AudioContentPipeline.loadSection()` when determining active language
    - `LexiconService.getRules()` when filtering by language
    - `VisualSettings.tsx` when deciding to show Chinese-specific toggles
    - `TTSSettingsTab.tsx` when auto-selecting the language profile

---

Phase 2: User Interface & Context Wiring
----------------------------------------

**Objective:** Build the UI components required for users to manually correct language metadata and scope their settings.

### 2.1 Visual Settings: Book Language & Chinese Toggles

**File:** [src/components/reader/VisualSettings.tsx](file:///Users/btsai/antigravity/versicle/versicle/src/components/reader/VisualSettings.tsx)

This is the recommended location for the "Book Language" selector (not `ReaderControlBar.tsx`, which delegates to `CompassPill`).

#### Step-by-step:

1.  **Add new state fields to `usePreferencesStore`:**

    **File:** [src/store/usePreferencesStore.ts](file:///Users/btsai/antigravity/versicle/versicle/src/store/usePreferencesStore.ts)

    Add the following fields to the state interface and defaults:
    ```typescript
    // Chinese reading assistance
    forceTraditionalChinese: boolean;    // default: false
    showPinyin: boolean;                 // default: false
    pinyinSize: number;                  // default: 100 (percentage)
    
    // Actions
    setForceTraditionalChinese: (force: boolean) => void;
    setShowPinyin: (show: boolean) => void;
    setPinyinSize: (size: number) => void;
    ```

2.  **Update `VisualSettings.tsx`** to conditionally render Chinese toggles:

    - Import `useBookStore`, `useReaderUIStore` (to get current book ID and its language).
    - Add a "Book Language" `<Select>` dropdown at the top with common language options: `en` (English), `zh` (Chinese).
    - On change, call `useBookStore.getState().updateBook(bookId, { language: newLang })`.
    - Below the dropdown, conditionally render (only when `language === 'zh'`):
      - "Force Traditional Chinese" `<Switch>` toggle
      - "Show Pinyin" `<Switch>` toggle  
      - "Pinyin Size" `<Slider>` (50–150%, step 10)

3.  **Wire reactivity:** The Chinese toggles should immediately invoke the overlay engine (Phase 3). For now, only add the UI controls and store persistence.

4.  **Add tests** to `src/components/reader/VisualSettings.test.tsx`:
    - Test that Chinese toggles are hidden when book language is `'en'`.
    - Test that Chinese toggles are visible when book language is `'zh'`.
    - Test that changing the book language updates the store.

### 2.2 Global TTS Settings: Language Profile Selector

**File:** [src/components/settings/TTSSettingsTab.tsx](file:///Users/btsai/antigravity/versicle/versicle/src/components/settings/TTSSettingsTab.tsx)

#### Step-by-step:

1.  **Add new props to `TTSSettingsTabProps`** (~line 20):
    ```typescript
    /** Currently selected language profile */
    activeLanguage: string;
    /** Callback when user switches language profile */
    onActiveLanguageChange: (lang: string) => void;
    ```

2.  **Add a "Language Profile" `<Select>`** at the top of the component (before "Provider Configuration"):
    ```jsx
    <div className="space-y-2 mb-6">
      <Label htmlFor="tts-language-select" className="text-sm font-medium">Language Profile</Label>
      <Select value={activeLanguage} onValueChange={onActiveLanguageChange}>
        <SelectTrigger id="tts-language-select" data-testid="tts-language-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="en">English</SelectItem>
          <SelectItem value="zh">Chinese (Mandarin)</SelectItem>
        </SelectContent>
      </Select>
    </div>
    ```

3.  **Filter voice list by language:** When `activeLanguage === 'zh'`, filter `voices` to only show voices where `v.lang.startsWith('zh')`. When `activeLanguage === 'en'`, filter to `v.lang.startsWith('en')`.

4.  **Add "No voice" warning:** If `activeLanguage === 'zh'` and no zh voices are downloaded, render:
    ```jsx
    <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-md text-sm text-yellow-800 dark:text-yellow-200">
      ⚠️ No Mandarin voice installed. Audio playback will fail for Chinese books.
    </div>
    ```

5.  **Wire in `GlobalSettingsDialog.tsx`:**

    **File:** [src/components/GlobalSettingsDialog.tsx](file:///Users/btsai/antigravity/versicle/versicle/src/components/GlobalSettingsDialog.tsx)

    - Read `activeLanguage` from `useTTSStore`.
    - Pass `activeLanguage` and `onActiveLanguageChange: ttsStore.setActiveLanguage` to `TTSSettingsTab`.

6.  **Update tests** in `src/components/settings/TTSSettingsTab.test.tsx`.

### 2.3 Lexicon Manager: Language Scoping

**File:** [src/components/reader/LexiconManager.tsx](file:///Users/btsai/antigravity/versicle/versicle/src/components/reader/LexiconManager.tsx)

#### Step-by-step:

1.  **Add "Filter by Language" `<Select>`** above the rule list:
    - Options: "All", "English", "Chinese", "Unscoped (Legacy)"
    - Default to the current book's language if a book is active, otherwise "All".
    - Filter the displayed rules: `rules.filter(r => !languageFilter || !r.language || r.language === languageFilter)`.

2.  **Add "Target Language" `<Select>`** to the rule creation form:
    - Options: "All Languages" (empty string), "English" (`en`), "Chinese" (`zh`)
    - This maps to the `language` field on the `LexiconRule`.

3.  **Update `LexiconService.getRules()`:**

    **File:** [src/lib/tts/LexiconService.ts](file:///Users/btsai/antigravity/versicle/versicle/src/lib/tts/LexiconService.ts)

    - Add an optional `language?: string` parameter to `getRules()`.
    - When filtering rules, add: `const isLangMatch = !r.language || r.language === language;`
    - Apply this filter alongside the existing `bookId` filter.

4.  **Update `AudioContentPipeline.loadSection()`:**

    **File:** [src/lib/tts/AudioContentPipeline.ts](file:///Users/btsai/antigravity/versicle/versicle/src/lib/tts/AudioContentPipeline.ts)

    - Fetch the book's language: `const bookLang = inventory?.language || 'en';`
    - Pass it to lexicon: `const rules = await lexiconService.getRules(bookId, bookLang);`

---

Phase 3: Visual Pipeline (Non-Destructive Ruby Overlay)
-------------------------------------------------------

**Objective:** Inject Pinyin reading assistance visually without corrupting `epub.js` text nodes, which would permanently break text selection and CFI generation.

### 3.1 Dependency Integration

#### Step-by-step:

1.  **Install dependencies:**
    ```bash
    npm install opencc-js pinyin-pro
    ```

2.  **Verify bundle sizes** (critical for a PWA):
    - `opencc-js`: ~2.5 MB (dictionary data). Consider lazy-loading.
    - `pinyin-pro`: ~300 KB. Acceptable.

3.  **Create lazy-loading wrapper:**

    **File (NEW):** `src/lib/chinese/ChineseTextProcessor.ts`
    ```typescript
    let openccInstance: any = null;
    let pinyinModule: any = null;

    export async function getOpenCC() {
      if (!openccInstance) {
        const OpenCC = await import('opencc-js');
        openccInstance = OpenCC.Converter({ from: 'cn', to: 'tw' });
      }
      return openccInstance;
    }

    export async function getPinyin(text: string): Promise<string[]> {
      if (!pinyinModule) {
        pinyinModule = await import('pinyin-pro');
      }
      return pinyinModule.pinyin(text, { type: 'array', toneType: 'symbol' });
    }

    export async function toTraditional(text: string): Promise<string> {
      const converter = await getOpenCC();
      return converter(text);
    }
    ```

### 3.2 Reader Visual Settings Integration

Already covered in Phase 2 (Section 2.1). The store fields `forceTraditionalChinese`, `showPinyin`, and `pinyinSize` will be read by the overlay engine.

### 3.3 Non-Destructive Overlay Engine

**File:** [src/hooks/useEpubReader.ts](file:///Users/btsai/antigravity/versicle/versicle/src/hooks/useEpubReader.ts)

> [!CAUTION]
> **Critical Constraint:** Do NOT replace or modify text nodes in the epub.js iframe. This will break CFI generation, text selection, TTS highlighting, and annotations. All visual modifications must be done through CSS or overlay elements.

#### Recommended Approach: CSS `data-*` Attribute Overlay

This approach annotates existing elements with `data-pinyin` attributes and uses CSS `::before` pseudo-elements to display the ruby text. It does NOT alter text content.

#### Step-by-step:

1.  **Create a content hook function** (~in `useEpubReader.ts`, inside the `injectExtras` function at line 406):

    ```typescript
    const injectChineseOverlay = async (contents: any) => {
      const doc = contents.document;
      if (!doc) return;
      
      const prefs = usePreferencesStore.getState();
      const bookLang = /* get from book store */;
      
      if (bookLang !== 'zh') return;
      
      // Remove previous overlay if settings changed
      const existingOverlay = doc.getElementById('pinyin-overlay-styles');
      if (existingOverlay) existingOverlay.remove();
      
      if (prefs.showPinyin || prefs.forceTraditionalChinese) {
        // Process text nodes
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
        const textNodes: Text[] = [];
        let node: Text | null;
        while ((node = walker.nextNode() as Text)) {
          if (node.textContent && /[\u4e00-\u9fff]/.test(node.textContent)) {
            textNodes.push(node);
          }
        }
        
        for (const textNode of textNodes) {
          const parent = textNode.parentElement;
          if (!parent || parent.tagName === 'RT' || parent.tagName === 'RUBY') continue;
          
          const text = textNode.textContent || '';
          const chars = [...text];
          
          // Wrap each Chinese character in a <span> with data-pinyin
          const fragment = doc.createDocumentFragment();
          for (const char of chars) {
            if (/[\u4e00-\u9fff]/.test(char)) {
              const span = doc.createElement('span');
              span.textContent = prefs.forceTraditionalChinese 
                ? await toTraditional(char) 
                : char;
              if (prefs.showPinyin) {
                const py = await getPinyin(char);
                span.setAttribute('data-pinyin', py[0] || '');
              }
              span.classList.add('zh-annotated');
              fragment.appendChild(span);
            } else {
              fragment.appendChild(doc.createTextNode(char));
            }
          }
          parent.replaceChild(fragment, textNode);
        }
        
        // Inject CSS for ruby rendering
        const style = doc.createElement('style');
        style.id = 'pinyin-overlay-styles';
        style.textContent = `
          .zh-annotated {
            position: relative;
            display: inline-block;
          }
          .zh-annotated[data-pinyin]::before {
            content: attr(data-pinyin);
            position: absolute;
            top: -1.2em;
            left: 50%;
            transform: translateX(-50%);
            font-size: ${prefs.pinyinSize}%;
            color: inherit;
            opacity: 0.7;
            white-space: nowrap;
            pointer-events: none;
          }
          body { padding-top: 1.5em !important; }
        `;
        doc.head.appendChild(style);
      }
    };
    ```

2.  **Register the hook** (after the existing `injectExtras` registration, ~line 485):
    ```typescript
    (newRendition.hooks.content as any).register(injectChineseOverlay);
    ```

3.  **Handle re-rendering on settings change:** Add the Chinese preference fields to the `useEffect` dependency array (~line 675) that currently handles theme/font changes. When they change, trigger a re-render of the current page.

> [!WARNING]
> **Performance Consideration:** The `data-pinyin` approach wraps each Chinese character in a `<span>`. For a chapter with 5,000 Chinese characters, this creates 5,000 new DOM elements. To mitigate:
> - Process only the currently visible page (not the entire chapter).
> - Use `requestIdleCallback` or chunked processing.
> - Consider caching pinyin results per character (there are ~3,500 unique common characters).

---

Phase 4: Audio Pipeline & Segmentation
--------------------------------------

**Objective:** Secure the local TTS engine against massive CJK character strings and prevent audio-visual desync regarding polyphone pronunciation.

### 4.1 Piper Provider Expansion

**File:** [src/lib/tts/providers/PiperProvider.ts](file:///Users/btsai/antigravity/versicle/versicle/src/lib/tts/providers/PiperProvider.ts)

#### Step-by-step:

1.  **Remove the `en_US` hardcode** (line 89):
    ```diff
    - if (!key.startsWith('en_US')) continue;
    + // Allow English and Chinese voices
    + if (!key.startsWith('en_US') && !key.startsWith('zh_CN')) continue;
    ```

2.  **Keep single-speaker filter** (line 90): `if (info.num_speakers > 1) continue;` — This is still correct for `zh_CN`.

3.  **Verify HuggingFace data:** The `voices.json` at `https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/voices.json` contains zh_CN entries. Verify the model files exist and are downloadable.

4.  **Add test** to `src/lib/tts/providers/PiperProvider.test.ts`:
    - Mock `voices.json` to include a `zh_CN` entry.
    - Assert that the voice list includes the Chinese voice.

### 4.2 CJK Text Segmentation Constraints

**File:** [src/lib/tts/TextSegmenter.ts](file:///Users/btsai/antigravity/versicle/versicle/src/lib/tts/TextSegmenter.ts)

#### Step-by-step:

1.  **Updated Constructor** — The `TextSegmenter` already accepts a `locale` parameter and uses `Intl.Segmenter` (line 108). When `locale='zh'`, `Intl.Segmenter` handles CJK punctuation natively. **No changes needed for the primary path.**

2.  **Update Fallback Regex** (line 80):
    ```diff
    - export const RE_SENTENCE_FALLBACK = /([^.!?]+[.!?]+)/g;
    + export const RE_SENTENCE_FALLBACK = /([^.!?。！？]+[.!?。！？]+)/g;
    ```

3.  **Dynamic Chunk Length for PiperProvider** — Update `PiperProvider.fetchAudioData()` (line 206):
    ```diff
    - const MAX_CHARS = 500;
    + // Chinese characters are semantically denser; use smaller chunks to prevent OOM
    + const isCJK = /[\u4e00-\u9fff]/.test(text);
    + const MAX_CHARS = isCJK ? 100 : 500;
    ```

4.  **Update `splitLongSentence`** (PiperProvider.ts, line 25) to handle CJK clause boundaries:
    ```diff
    - const clauseRegex = /[,;:—–]/g;
    + const clauseRegex = /[,;:—–，；：、。！？]/g;
    ```

5.  **Pass book language to TextSegmenter during playback:**

    **File:** [src/lib/tts/AudioContentPipeline.ts](file:///Users/btsai/antigravity/versicle/versicle/src/lib/tts/AudioContentPipeline.ts)

    The segmenter is currently created with the default locale `'en'` (via `PiperProvider` constructor). We need to pass the book's language. This requires:
    - Adding a `language` parameter to the pipeline's context.
    - Creating the appropriate `TextSegmenter(bookLang)` in the pipeline.
    - The `segmenter-cache.ts` already handles caching by locale.

6.  **Add tests** to `src/lib/tts/TextSegmenter.test.ts`:
    - Test segmentation of Chinese text with `。`, `！`, `？`.
    - Test that `Intl.Segmenter('zh')` correctly segments a Chinese paragraph.
    - Test the fallback regex handles CJK punctuation.
    - Test chunk size limits for CJK text.

### 4.3 Phonetic Coherence & Lexicon Scoping

**File:** [src/lib/tts/AudioContentPipeline.ts](file:///Users/btsai/antigravity/versicle/versicle/src/lib/tts/AudioContentPipeline.ts)

#### Step-by-step:

1.  **Scope Lexicon rules to book language:**
    - In `loadSection()` (~line 138), after fetching the bible preference:
    ```typescript
    const bookInventory = useBookStore.getState().books[bookId];
    const bookLang = bookInventory?.language || 'en';
    const rules = await LexiconService.getInstance().getRules(bookId, bookLang);
    ```

2.  **Prevent audio/visual desync for Pinyin:**
    - If Pinyin is enabled and the book is `zh`, and a lexicon rule modifies the text, ensure the modification matches what `pinyin-pro` would generate.
    - This is an edge case that can be documented as a known limitation for v1. Full phonetic integration (passing exact Pinyin to Piper) requires Piper to support phoneme input, which is model-dependent.

**File:** [src/lib/tts/LexiconService.ts](file:///Users/btsai/antigravity/versicle/versicle/src/lib/tts/LexiconService.ts)

3.  **Update `getRules` signature** (~line 67):
    ```diff
    - async getRules(bookId?: string): Promise<LexiconRule[]> {
    + async getRules(bookId?: string, language?: string): Promise<LexiconRule[]> {
    ```

4.  **Add language filtering** (~line 76, in the global rules filter):
    ```typescript
    const globalRules = allRules
      .filter(r => !r.bookId || r.bookId === 'global')
      .filter(r => !r.language || r.language === language) // NEW
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    ```

5.  **Apply same filter to book-specific rules** (~line 84):
    ```typescript
    const bookRules = allRules
      .filter(r => r.bookId === bookId)
      .filter(r => !r.language || r.language === language); // NEW
    ```

---

Phase 5: Verification & Quality Assurance
-----------------------------------------

**Objective:** Validate that the multi-lingual pipeline does not cause regressions to the core English experience.

### 5.1 Unit & Integration Testing

| Test File | What to Test |
|---|---|
| `src/lib/ingestion.test.ts` | Language extraction from `<dc:language>`, defaults, normalization |
| `src/lib/tts/TextSegmenter.test.ts` | Chinese segmentation, CJK fallback regex, chunk limits |
| `src/lib/tts/LexiconService.test.ts` | Language-scoped rule filtering |
| `src/lib/tts/providers/PiperProvider.test.ts` | zh_CN voice discovery |
| `src/store/useTTSStore.test.ts` | Profile migration, language switching |
| `src/lib/sync/validators.test.ts` | Schema validation with language fields |

**Run all existing tests to check for regressions:**
```bash
npm test
```

### 5.2 End-to-End (E2E) Journey Verification

Create a new Playwright test file: `verification/test_journey_chinese.py`

**Test Journey: Chinese Book Import and Visual Reading**

1.  Import a prepared Chinese EPUB test fixture.
2.  Verify the book appears in the library with the correct language set.
3.  Open the book and verify it renders.
4.  Open Visual Settings and verify Chinese toggles appear.
5.  Toggle "Show Pinyin" and screenshot to verify pinyin appears above characters.
6.  Toggle "Force Traditional Chinese" and screenshot to verify character conversion.

**Test Journey: Chinese TTS Setup**

1.  Open Global Settings > TTS.
2.  Switch language profile to "Chinese".
3.  Verify voice list shows zh_CN voices (or shows the "no voice" warning).

### 5.3 Build & Lint Verification

```bash
npm run build
npm run lint
```

Ensure no TypeScript compilation errors from the new optional fields.

---

## Appendix A: File Change Summary

| Phase | File | Change Type | Risk |
|-------|------|-------------|------|
| 1 | `src/types/db.ts` | Add fields to 3 interfaces | Low |
| 1 | `src/lib/sync/validators.ts` | Add Zod fields | Low |
| 1 | `src/store/useTTSStore.ts` | Major refactor (profiles) | **High** |
| 1 | `src/lib/ingestion.ts` | Add language extraction | Low |
| 2 | `src/store/usePreferencesStore.ts` | Add Chinese prefs | Low |
| 2 | `src/components/reader/VisualSettings.tsx` | Add language/Chinese UI | Medium |
| 2 | `src/components/settings/TTSSettingsTab.tsx` | Add language profile UI | Medium |
| 2 | `src/components/GlobalSettingsDialog.tsx` | Wire new props | Low |
| 2 | `src/components/reader/LexiconManager.tsx` | Add language filter/field | Medium |
| 2 | `src/lib/tts/LexiconService.ts` | Add language param | Low |
| 3 | NEW: `src/lib/chinese/ChineseTextProcessor.ts` | New file | Medium |
| 3 | `src/hooks/useEpubReader.ts` | Add overlay hook | **High** |
| 3 | `package.json` | Add opencc-js, pinyin-pro | Low |
| 4 | `src/lib/tts/providers/PiperProvider.ts` | Remove en_US filter | Low |
| 4 | `src/lib/tts/TextSegmenter.ts` | Add CJK fallback | Low |
| 4 | `src/lib/tts/AudioContentPipeline.ts` | Add language scoping | Medium |

## Appendix B: New Dependencies

| Package | Purpose | Size | Loading Strategy |
|---------|---------|------|------------------|
| `opencc-js` | Simplified ↔ Traditional conversion | ~2.5 MB | Dynamic import (lazy) |
| `pinyin-pro` | Hanzi → Pinyin generation | ~300 KB | Dynamic import (lazy) |

## Appendix C: Risk Mitigation

1.  **TTS Store Migration:** Test on a real device with existing localStorage data before merging. The `migrate` function must handle undefined `version` (first-time persist users).

2.  **CFI Breakage:** The Pinyin overlay wraps text nodes in `<span>` elements. While this preserves text content, it changes the DOM structure. Test that existing CFI bookmarks and annotations still resolve correctly after the overlay is applied and removed.

3.  **Bundle Size:** `opencc-js` is 2.5 MB. Consider hosting the dictionary data externally (CDN) or splitting it into a separate chunk loaded only when a Chinese book is opened.

4.  **Piper zh_CN Model Quality:** Chinese Piper models may have lower quality than English ones. Test with real Chinese text and document known pronunciation issues.