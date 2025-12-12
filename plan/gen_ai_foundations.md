# Gen AI Foundations & Features Design Document

## 1. Introduction
The goal of this document is to outline the architecture and implementation plan for integrating Generative AI (specifically **Gemini 2.5 Flash-Lite**) into Versicle. This integration will enable advanced features such as:
1.  **Smarter Synthetic Table of Contents (TOC):** Generating descriptive chapter titles from content.
2.  **Structural Annotation:** Analyzing chapters to identify structure (Title, Body, Footnotes) for better rendering and navigation.
3.  **Pronunciation Guide:** Generating phonetic rules for unusual words using the existing Lexicon system.

This design emphasizes a **modular approach** and utilizes **Structured Outputs** (JSON Schema) to ensure reliability and type safety.

## 2. Architecture

### 2.1 GenAI Service (`src/lib/genai/`)
A new singleton service, `GenAIService`, will encapsulate all interactions with the LLM provider. It will leverage the Gemini API's native support for `responseSchema` to guarantee valid JSON output.

*   **Responsibilities:**
    *   Managing API keys and model configuration.
    *   Handling rate limiting and error states.
    *   Abstracting the provider to allow future extensibility.
    *   **Enforcing JSON Schemas** for all structured data requests.

```typescript
// Proposed Interface
interface GenAIProvider {
  generateContent(prompt: string): Promise<string>;
  generateStructured<T>(prompt: string, schema: any): Promise<T>;
}

class GenAIService {
  // ... singleton logic
  configure(apiKey: string, model: string): void;

  // Feature-specific methods that use generateStructured internally
  generateTOC(chapterText: string): Promise<{ title: string }>;
  analyzeChapterStructure(text: string): Promise<ChapterStructureResponse>;
  generatePronunciationRules(text: string): Promise<LexiconRuleResponse[]>;
}
```

### 2.2 State Management (`src/store/useGenAIStore.ts`)
A new Zustand store will manage the configuration and state of AI features.

*   **State:**
    *   `apiKey`: string (Persistent).
    *   `model`: string (Default: "gemini-2.5-flash-lite").
    *   `isEnabled`: boolean.
    *   `usageStats`: { totalTokens: number, estimatedCost: number }.

### 2.3 UI Components (`src/components/ui/GlobalSettingsDialog.tsx`)
The `GlobalSettingsDialog` will be updated to include a new **"Generative AI"** tab.
*   **Fields:**
    *   Enable/Disable toggle.
    *   API Key input.
    *   Model selection (Dropdown).

## 3. Data Model Changes
To persist the results of AI analysis without cluttering the core metadata, we will introduce new object stores or expand existing ones in IndexedDB (`src/types/db.ts`).

### 3.1 Content Analysis Store
We will store structural analysis per section.

```typescript
interface ContentAnalysis {
  id: string; // composite bookId-sectionId
  bookId: string;
  sectionId: string;
  structure: {
    title?: string;
    footnoteMatches: string[]; // Text snippets to find
  };
  summary?: string;
  lastAnalyzed: number;
}
```

### 3.2 Book Metadata
We will update `BookMetadata` to include a flag or status for AI processing.

```typescript
interface BookMetadata {
  // ... existing fields
  aiAnalysisStatus?: 'none' | 'partial' | 'complete';
}
```

## 4. Feature Specifications

### 4.1 Smarter Synthetic TOC
*   **Problem:** Current TOC is based on naive DOM parsing.
*   **AI Implementation:**
    *   **Prompt:** "Generate a concise chapter title (max 6 words) based on the text."
    *   **Schema:** `{"type": "object", "properties": {"title": {"type": "string"}}, "required": ["title"]}`
    *   **Action:** Update `syntheticToc` in DB with the returned `title`.
*   **UI Integration:**
    *   **Location:** `src/components/reader/ReaderView.tsx`.
    *   **Placement:** In the TOC Sidebar (when `showToc` is true), add an "Enhance Titles with AI" button below the "Generated Titles" switch.
    *   **Flow:** User clicks button -> Show progress -> Update DB -> Refresh TOC state.

### 4.2 Structural Annotation (Header, Body, Footer)
*   **Problem:** LLMs are poor at returning exact character indices.
*   **AI Implementation:**
    *   **Strategy:** Ask the LLM to identify the *text content* of the title and footnotes. The application then fuzzy-matches these strings in the original text to create robust DOM Ranges/CFIs.
    *   **Schema:** `{"type": "object", "properties": {"titleText": {"type": "string"}, "hasTitle": {"type": "boolean"}, "footnotes": {"type": "array", "items": {"type": "string"}}}, "required": ["hasTitle", "footnotes"]}`
*   **UI Integration:**
    *   **Logic:** `src/hooks/useEpubReader.ts`.
    *   **Mechanism:** Use `rendition.hooks.content.register` to access the DOM when a chapter loads.
    *   **Action:** Query `ContentAnalysis` store. If analysis exists, find the text nodes matching `titleText` and apply a CSS class (e.g., `ai-structure-title`).
    *   **User Control:** Add a "Distraction Free" toggle in `VisualSettings.tsx` that sets `.ai-structure-title { display: none; }` via `rendition.themes`.

### 4.3 Pronunciation Guide
*   **Goal:** Improve TTS quality.
*   **AI Implementation:**
    *   **Prompt:** "Identify unusual proper nouns or foreign words and provide phonetic replacements."
    *   **Schema:** `{"type": "array", "items": {"type": "object", "properties": {"original": {"type": "string"}, "replacement": {"type": "string"}, "ipa": {"type": "string"}}, "required": ["original", "replacement"]}}`
    *   **Action:** Convert results to `LexiconRule` objects and save via `LexiconService`.
*   **UI Integration:**
    *   **Location:** `src/components/reader/LexiconManager.tsx`.
    *   **Placement:** Add a "Generate Guide" button in the toolbar (next to Import/Export).
    *   **Flow:** User clicks button -> Scan current book/chapter -> AI Process -> Populate list with new rules (marked as "New" until saved).

## 5. Implementation Roadmap

### Phase 1: Foundation
1.  Add `@google/generative-ai` dependency.
2.  Create `src/store/useGenAIStore.ts`.
3.  Implement `src/lib/genai/GenAIService.ts` using `responseSchema`.
4.  Update `GlobalSettingsDialog`.

### Phase 2: Data & Ingestion
1.  Update `src/types/db.ts` and `src/db/DBService.ts`.
2.  Implement text matching utilities (for structural annotation).

### Phase 3: Feature Implementation
1.  **Smart TOC:** Implement "Enhance TOC" workflow in `ReaderView.tsx`.
2.  **Pronunciation:** Implement "Generate Guide" workflow in `LexiconManager.tsx`.
3.  **Structure:** Implement analysis hook in `useEpubReader.ts` and DOM manipulation logic.

### Phase 4: Verification & Polish
1.  Add error handling.
2.  Add progress indicators.
3.  **Prompt Testing:** Verify schemas against various book styles.

## 6. Security & Privacy
*   **User Keys:** Stored locally.
*   **Data Usage:** Content sent to Google/Provider. Requires user consent/disclaimer.

## 7. Future Ideas (Post-Foundation)

### 7.1 Semantic Search & RAG
*   **Concept:** Move beyond keyword search (`FlexSearch`) to conceptual search.
*   **Implementation:**
    *   Use Gemini's embedding API (or a local model like `transformers.js`) to vectorise book chunks during ingestion.
    *   Store vectors in a specialized IndexedDB store.
    *   **"Chat with Book":** Retrieve relevant chunks based on user questions and use the LLM to synthesize an answer (Retrieval Augmented Generation).

### 7.2 Auto-Tagging & Library Organization
*   **Concept:** Automatically categorize books by genre, tone, and themes.
*   **Implementation:**
    *   Analyze the first 5000 characters + metadata.
    *   Prompt: "Categorize this book into standard genres and provide 5 semantic tags."
    *   Update `BookMetadata` tags for filtering in the Library view.

### 7.3 Character Maps
*   **Concept:** Visualize relationships between characters.
*   **Implementation:**
    *   Scan the text for proper nouns and relationship verbs.
    *   Generate a graph data structure (nodes = characters, edges = interactions).
    *   Render using a graph library (e.g., React Flow) in a new "Analysis" view.

### 7.4 Context-Aware Translation
*   **Concept:** Translate difficult passages or foreign phrases in context.
*   **Implementation:**
    *   User selects text -> "Translate".
    *   Prompt includes surrounding sentences to resolve ambiguity.
    *   Display translation in a popover or inline annotation.
