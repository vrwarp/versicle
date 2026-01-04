Design Document: Table Teleprompter Adaptation
==============================================

1\. Overview
------------

The **Table Teleprompter Adaptation** feature improves the Text-to-Speech (TTS) experience for complex data structures. Instead of reading raw table cell text, this feature uses GenAI to "view" pre-captured images of tables and generate a spoken-word adaptation consisting of natural, complete sentences.

2\. Goals
---------

-   **Natural Spoken Flow**: Replace fragmented table data with meaningful narrative descriptions.

-   **Non-Blocking Execution**: Run heavy multimodal analysis in the background to ensure initial playback is immediate.

-   **State Consistency**: Synchronize AI-generated text with the existing `PlaybackStateManager` and progress tracking using **EPUB CFIs** as the unique mapping keys.

-   **Persistence & Efficiency**: Store generated adaptations in IndexedDB using the **Root CFI** as the primary key to avoid redundant GenAI calls. Respect a 512-token "thinking budget."

3\. Architecture & Data Flow
----------------------------

### 3.1 Component Responsibilities

-   **`GenAIService`**: Executes multimodal prompts using the default model and a thinking budget of 512.

-   **`AudioContentPipeline`**: Orchestrates table detection, grouping, and coordinate mapping using EPUB CFIs.

-   **`DBService`**: Manages persistence of adaptations keyed by CFI within the `content_analysis` store.

-   **`AudioPlayerService`**: Mediates the lifecycle, triggering background tasks and applying results via callbacks.

-   **`PlaybackStateManager`**: Performs the dynamic "swap-and-skip" logic to update the live queue based on CFI matches.

### 3.2 Persistence Strategy

Mirroring the `contentTypes` classification pattern, generated adaptations are stored as part of the `ContentAnalysis` object for each section.

-   **Schema**: A new field `tableAdaptations` (Array of `TableAdaptation` objects) is added to the `content_analysis` store.

-   **Workflow**:

    1.  Check `DBService` for existing adaptations matching a specific `rootCfi`.

    2.  If missing, trigger `GenAIService` with the `rootCfi` as the identifier and its corresponding `imageBlob`.

    3.  Save results back to `DBService` immediately, keyed by `rootCfi`.

### 3.3 Sequence Diagram

1.  **Load**: `AudioPlayerService` calls `loadSection`.

2.  **Initial Queue**: Playback starts immediately with raw text. `AudioContentPipeline` identifies tables and their `rootCfi`.

3.  **Background Trigger**: `AudioPlayerService` launches `processTableAdaptations` in the background.

4.  **Cache Check**: The pipeline checks the database for any existing `tableAdaptations` matching the detected CFIs.

5.  **AI Generation**: For missing CFIs, `GenAIService` processes table images $\rightarrow$ generates text.

6.  **Store**: Results are persisted to `DBService` under the section's analysis.

7.  **Live Update**: `PlaybackStateManager` iterates through the queue. It identifies all items whose CFI is a descendant of the adapted `rootCfi`, updating the first and skipping the rest.

4\. Key Implementation Details
------------------------------

### 4.1 Data Schema Update

The `ContentAnalysis` type in `src/types/db.ts` is extended to prioritize the CFI key.

**Design Consideration: Granular Storage** By storing adaptations as an array of objects rather than a single blob of text, we allow the system to update the playback queue incrementally. If a section contains three tables and the AI has already processed two of them in a previous session, we only incur the cost (both time and tokens) for the third.

```
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

To ensure the model correctly maps adaptations to specific CFIs, the request parts are interlaced. Each image is preceded by a text part identifying its CFI.

**Design Consideration: Multimodal Context Mapping** Multimodal models can sometimes "hallucinate" which ID belongs to which image if IDs are listed only at the beginning or end of the prompt. Interlacing text labels immediately before the binary data provides the strongest possible contextual bridge.

**Prompt Strategy**: We explicitly tell the model that the `id` in the output JSON must match the provided `cfi` string exactly. This enables automated merging without fuzzy text matching.

```
// src/lib/genai/GenAIService.ts

public async generateTableAdaptations(
  nodes: { rootCfi: string, imageBlob: Blob }[],
  thinkingBudget: number = 512
): Promise<{ cfi: string, adaptation: string }[]> {
  const instructionPrompt = `
    Analyze the provided table images from a book.
    Generate a "teleprompter adaptation" for Text-to-Speech.
    Convert data into natural, complete sentences.
    Return a JSON array of objects: {cfi: string, adaptation: string}.
    Ensure the 'cfi' strictly matches the identifier provided before each image.
  `;

  const parts: any[] = [{ text: instructionPrompt }];

  for (const node of nodes) {
    const base64 = await this.blobToBase64(node.imageBlob);
    // Anchor the image to its unique key in the prompt stream
    parts.push({ text: `Image for CFI: ${node.rootCfi}` });
    parts.push({
      inlineData: {
        data: base64,
        mimeType: node.imageBlob.type
      }
    });
  }

  return this.generateStructured<{ cfi: string, adaptation: string }[]>(
    { contents: [{ role: 'user', parts }] },
    {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          cfi: { type: SchemaType.STRING },
          adaptation: { type: SchemaType.STRING },
        },
        required: ['cfi', 'adaptation'],
      },
    },
    {
      thinking_config: { include_thoughts: true, thinking_budget: thinkingBudget }
    }
  );
}

```

### 4.3 Background Processing with CFI-Keyed Caching

The pipeline verifies DB state before executing heavy AI tasks.

**Design Consideration: Non-Blocking User Experience** Multimodal generation can take 5--15 seconds. If this were synchronous, the TTS "Play" button would feel broken. By running this in the background, the user hears the original table text (or surrounding paragraphs) immediately. When the AI finishes, the "Swap-and-Skip" logic (see 4.4) ensures the transition to the natural adaptation is seamless.

```
// src/lib/tts/AudioContentPipeline.ts
async processTableAdaptations(bookId, sectionId, sentences, onAdaptationsFound) {
    const analysis = await dbService.getContentAnalysis(bookId, sectionId);

    // 1. Identify tables that actually exist in the current section
    const tableGroups = this.groupSentencesByRoot(...);

    // 2. Filter for those missing from the cache
    const workSet = tableGroups.filter(g =>
        !analysis?.tableAdaptations?.find(a => a.rootCfi === g.rootCfi)
    );

    if (workSet.length > 0) {
        // ... call GenAIService ...
        // 3. Update the analysis record with new results
        await dbService.saveTableAdaptations(bookId, sectionId, results.map(r => ({
            rootCfi: r.cfi,
            text: r.adaptation
        })));
    }

    // 4. Always return the union of cached and new adaptations
    const updatedAnalysis = await dbService.getContentAnalysis(bookId, sectionId);
    onAdaptationsFound(new Map(updatedAnalysis.tableAdaptations.map(a => [a.rootCfi, a.text])));
}

```

### 4.4 Playback State Integration: The CFI "Swap-and-Skip"

Updates the live queue using prefix matching on segment CFIs.

**Design Consideration: Maintaining Queue Integrity** A table is usually composed of dozens of segments (cells). We cannot just delete segments from the queue because it would break the user's current index and character-based progress tracking.

Instead, we use a **Swap-and-Skip** strategy:

1.  **Prefix Matching**: A table root CFI like `.../4[table1]` is the parent of cell CFIs like `.../4[table1]/2/1`. We use `startsWith` to identify all queue items belonging to the table.

2.  **Anchor Entry**: The first item found in the group is updated with the *entire* GenAI adaptation.

3.  **Silent Survivors**: Every subsequent item in that table group is marked `isSkipped: true`. This keeps the items in the list (preserving index logic) but prevents the audio player from trying to synthesize them.

```
// src/lib/tts/PlaybackStateManager.ts
applyTableAdaptations(adaptations: Map<string, string>) {
    const handledRoots = new Set<string>();

    this._queue = this._queue.map((item) => {
        if (!item.cfi) return item;

        for (const [rootCfi, text] of adaptations) {
            // Check if segment is a child of the table root
            if (item.cfi.startsWith(rootCfi.replace(')', ''))) {
                if (!handledRoots.has(rootCfi)) {
                    handledRoots.add(rootCfi);
                    // Update only the anchor item with the full natural adaptation
                    return { ...item, text, isSkipped: false };
                } else {
                    // Mark cell data as skipped to avoid double-reading
                    return { ...item, isSkipped: true };
                }
            }
        }
        return item;
    });

    // CRITICAL: Narrated text length has changed; recalculate progress markers
    this.calculatePrefixSums();
    this.notifyListeners();
}

```

5\. Considerations & Edge Cases
-------------------------------

-   **Batching Limits**: If a section has an excessive number of tables (e.g., a reference manual), passing all images in one GenAI call may hit the model's context window or exceed the 512-token thinking budget. The pipeline should batch in groups of 5 tables if necessary.

-   **CFI Accuracy**: Tables captured as images during ingestion must use the exact same root CFI as the `SentenceNode` grouping logic. Any mismatch results in "leakage" where raw text and AI text are both audible.

-   **State Race Conditions**: If the AI returns an adaptation for Table A while the user is already listening to Table A (raw text), the `PlaybackStateManager` will update the text for the *next* segment if the current one has already finished. This is acceptable, as the user will simply hear a better version of the data going forward.

-   **Recalculation Overhead**: Calling `calculatePrefixSums` on every adaptation update is computationally cheap (O(N) where N is queue length) but essential for keeping the "Time Remaining" and progress bar accurate.
