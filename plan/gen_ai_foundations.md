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
    *   **Schema:**
        ```json
        {
          "type": "object",
          "properties": {
            "title": { "type": "string" }
          },
          "required": ["title"]
        }
        ```
    *   **Action:** Update `syntheticToc` in DB with the returned `title`.

### 4.2 Structural Annotation (Header, Body, Footer)
*   **Problem:** LLMs are poor at returning exact character indices.
*   **AI Implementation:**
    *   **Strategy:** Ask the LLM to identify the *text content* of the title and footnotes. The application then fuzzy-matches these strings in the original text to create robust DOM Ranges/CFIs.
    *   **Schema:**
        ```json
        {
          "type": "object",
          "properties": {
            "titleText": { "type": "string", "description": "The exact text of the chapter title/header" },
            "hasTitle": { "type": "boolean" },
            "footnotes": {
              "type": "array",
              "items": { "type": "string", "description": "The text content of distinct footnotes" }
            }
          },
          "required": ["hasTitle", "footnotes"]
        }
        ```
    *   **Action:**
        1.  Receive JSON.
        2.  Search `chapterText` for `titleText`. Create Range.
        3.  Search `chapterText` for each `footnote`. Create Ranges.
        4.  Save ranges to `ContentAnalysis` store.

### 4.3 Pronunciation Guide
*   **Goal:** Improve TTS quality.
*   **AI Implementation:**
    *   **Prompt:** "Identify unusual proper nouns or foreign words and provide phonetic replacements."
    *   **Schema:**
        ```json
        {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "original": { "type": "string" },
              "replacement": { "type": "string", "description": "Phonetic spelling" },
              "ipa": { "type": "string", "description": "International Phonetic Alphabet representation" }
            },
            "required": ["original", "replacement"]
          }
        }
        ```
    *   **Action:** Convert results to `LexiconRule` objects and save via `LexiconService`.

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
1.  **Smart TOC:** Implement "Enhance TOC" workflow.
2.  **Pronunciation:** Implement "Generate Guide" workflow.
3.  **Structure:** Implement analysis and Reader integration.

### Phase 4: Verification & Polish
1.  Add error handling.
2.  Add progress indicators.
3.  **Prompt Testing:** Verify schemas against various book styles.

## 6. Security & Privacy
*   **User Keys:** Stored locally.
*   **Data Usage:** Content sent to Google/Provider. Requires user consent/disclaimer.
