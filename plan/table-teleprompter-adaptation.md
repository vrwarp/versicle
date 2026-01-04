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

-   **`GenAIService`**: Executes multimodal prompts using the default model and a thinking budget of 512.

-   **`AudioContentPipeline`**: Orchestrates table detection, grouping, and coordinate mapping. Maps `rootCfi` to `sourceIndices`.

-   **`DBService`**: Manages persistence of adaptations keyed by CFI within the `content_analysis` store.

-   **`AudioPlayerService`**: Mediates the lifecycle, triggering background tasks and applying results via callbacks.

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

7.  **Index Mapping**: `AudioContentPipeline` maps the adaptation's `rootCfi` to the set of `sourceIndices` from the `sentences` belonging to that table group.

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

Prompt strategy remains the same: interlacing text labels with images to ensure ID integrity. `GenAIService` accepts `_thinkingBudget` (unused).

### 4.3 Background Processing with Index Mapping

The pipeline maps the GenAI result (keyed by `rootCfi`) to the raw sentence structure.

```typescript
// src/lib/tts/AudioContentPipeline.ts
const buildAdaptationResult = async (adaptationsMap: Map<string, string>) => {
    // ...
    const groups = this.groupSentencesByRoot(targetSentences, tableCfis);
    for (const group of groups) {
         // Match group to adaptation key using parent CFI logic
         if (matches(group, adaptRoot)) {
             result.push({ indices: group.getAllIndices(), text: text });
         }
    }
    return result;
};
```

### 4.4 Playback State Integration: Raw Index "Swap-and-Skip"

Updates the live queue using raw indices. This is more robust than CFI prefix matching because it handles cases where `TextSegmenter` might have merged or split text in complex ways, but `sourceIndices` always track back to the original DOM text nodes.

```typescript
// src/lib/tts/PlaybackStateManager.ts
applyTableAdaptations(adaptations: { indices: number[], text: string }[]) {
    // ...
    for (const adaptation of adaptations) {
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

5\. Considerations & Edge Cases
-------------------------------

-   **Partial Matches**: If a queue item contains text from both inside and outside the table (rare, but possible with aggressive merging), it will *not* be matched/skipped because its `sourceIndices` won't be a subset of the table indices. This is the desired safe behavior to avoid hiding non-table content.
-   **Performance**: Mapping indices is fast (set lookups). Recalculating prefix sums is efficient.
