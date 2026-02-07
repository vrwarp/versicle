Design Document: Table Teleprompter Adaptation
==============================================

1\. Overview
------------

The **Table Teleprompter Adaptation** feature improves the Text-to-Speech (TTS) experience for complex data structures. Instead of reading raw table cell text, this feature uses GenAI to "view" pre-captured images of tables and generate a spoken-word adaptation consisting of natural, complete sentences.

2\. Goals
---------

-   **Natural Spoken Flow**: Replace fragmented table data with meaningful narrative descriptions.

-   **Non-Blocking Execution**: Run heavy multimodal analysis in the background to ensure initial playback is immediate.

-   **State Consistency**: Synchronize AI-generated text with the existing `PlaybackStateManager` and progress tracking using **Raw Sentence Indices** for precise replacement.

-   **Persistence & Efficiency**: Store generated adaptations in IndexedDB using the **Root CFI** as the primary key to avoid redundant GenAI calls. Respect a 512-token "thinking budget."

3\. Architecture & Data Flow
----------------------------

### 3.1 Component Responsibilities

-   **`GenAIService`**: Executes multimodal prompts using the default model.

-   **`AudioContentPipeline`**: Orchestrates table detection, grouping, and coordinate mapping. Maps `rootCfi` to `sourceIndices` using strict CFI matching logic.

-   **`DBService`**: Manages persistence of adaptations keyed by CFI within the `content_analysis` store.

-   **`AudioPlayerService`**: Mediates the lifecycle, passing callbacks for state updates.

-   **`PlaybackStateManager`**: Performs the dynamic "swap-and-skip" logic to update the live queue based on raw index matching.

### 3.2 Persistence Strategy

Mirroring the `contentTypes` classification pattern, generated adaptations are stored as part of the `ContentAnalysis` object for each section.

-   **Schema**: A new field `tableAdaptations` (Array of `TableAdaptation` objects) is added to the `content_analysis` store.

-   **Workflow**:

    1.  Check `DBService` for existing adaptations matching a specific `rootCfi`.

    2.  If missing, trigger `GenAIService` with the `rootCfi` as the identifier and its corresponding `imageBlob`.

    3.  Save results back to `DBService` immediately, keyed by `rootCfi`.

### 3.3 Sequence Diagram

1.  **Load**: `AudioPlayerService` calls `loadSection`.

2.  **Initial Queue**: Playback starts immediately with raw text. `AudioContentPipeline` creates the queue with `sourceIndices` populated.

3.  **Background Trigger**: `AudioContentPipeline` continues to execute `processTableAdaptations` in the background (triggered internally).

4.  **Cache Check**: The pipeline checks the database for any existing `tableAdaptations`.

5.  **AI Generation**: For missing tables, `GenAIService` processes table images $\rightarrow$ generates text.

6.  **Store**: Results are persisted to `DBService`.

7.  **Index Mapping**: `AudioContentPipeline` calls `mapSentencesToAdaptations` to map the adaptation's `rootCfi` to the set of `sourceIndices` from the `sentences`.

8.  **Live Update**: `PlaybackStateManager` receives adaptations with indices. It iterates through the queue. If a queue item's `sourceIndices` are fully contained within an adaptation's indices:
    -   The **first** matching item is updated with the adaptation text.
    -   **Subsequent** matching items are marked `isSkipped: true`.

4\. Key Implementation Details
------------------------------

### 4.1 Data Schema Update

```typescript
export interface TableAdaptation {
  rootCfi: string; // The EPUB CFI key for the table block
  text: string;    // The generated spoken-word adaptation
}

export interface ContentAnalysis {
  // ... existing fields
  contentTypes?: ContentTypeResult[];
  tableAdaptations?: TableAdaptation[];
}
```

### 4.2 Interlaced Multimodal Prompting

Prompt strategy remains the same: interlacing text labels with images to ensure ID integrity. `GenAIService` accepts `_thinkingBudget` (unused) as thinking models are not yet fully supported/stable in this context.

### 4.3 Background Processing with Index Mapping

The pipeline maps the GenAI result (keyed by `rootCfi`) to the raw sentence structure.

**Important Implementation Details:**
*   **Range vs. Point CFIs**: Table images are keyed by Range CFIs (e.g., `epubcfi(.../1:0,/1:100)`). Sentences are Point CFIs (e.g., `.../1:50`). The mapping logic handles this by parsing the range to find the **common parent** (ancestor) and matching sentences that start with that parent path.
*   **Nested Tables**: To prevent "parent-swallowing" (where a child table matches its parent's CFI prefix first), the logic sorts table roots by length (descending) to prioritize the most specific (innermost) match.
*   **Boundary Checking**: Strict boundary checking is enforced (valid separators: `/`, `!`, `[`, `:`, `,`) to avoid partial false positives (e.g., `/2` matching `/20`).

```typescript
// src/lib/tts/AudioContentPipeline.ts
public mapSentencesToAdaptations(sentences: SentenceNode[], adaptationsMap: Map<string, string>): { indices: number[], text: string }[] {
    // Sort roots by length descending to handle nested tables
    const tableRoots = Array.from(adaptationsMap.keys()).sort((a, b) => b.length - a.length);
    // ... parse roots to parents ...

    for (const sentence of sentences) {
        // Match sentence CFI to table root parent
        // Collect indices
    }
    return result;
}
```

### 4.4 Playback State Integration: Raw Index "Swap-and-Skip"

Updates the live queue using raw indices. This is more robust than CFI prefix matching because it handles cases where `TextSegmenter` might have merged or split text in complex ways, but `sourceIndices` always track back to the original DOM text nodes.

```typescript
// src/lib/tts/PlaybackStateManager.ts
applyTableAdaptations(adaptations: { indices: number[], text: string }[]) {
    // ...
    for (const adaptation of adaptations) {
        // Find items where sourceIndices are a strict subset of adaptation indices
        const matchingQueueIndices = findQueueItems(queue, adaptation.indices);
        if (matchingQueueIndices.length > 0) {
            // Anchor: Replace first item
            updateItem(matchingQueueIndices[0], adaptation.text, isSkipped: false);
            // Skip: Mark others
            markSkipped(matchingQueueIndices.slice(1));
        }
    }
    // ...
}
```

5\. Deviations & Learnings
-------------------------------

-   **Public Helper for Testing**: `mapSentencesToAdaptations` was extracted as a public method in `AudioContentPipeline` to facilitate the extensive unit testing and fuzzing requested during review.
-   **Trigger Encapsulation**: The background trigger was moved from `AudioPlayerService` into `AudioContentPipeline.loadSection` to improve encapsulation and reduce service coupling.
-   **Thinking Budget**: The `thinking_budget` parameter in `GenAIService` is currently unused (`_thinkingBudget`) as the default model does not support it reliably yet.
-   **CFI Complexity**: Matching Range CFIs (tables) to Point CFIs (content) required explicit parsing of the CFI range to identify the common parent ancestor, rather than simple string prefix matching.
