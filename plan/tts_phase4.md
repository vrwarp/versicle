# **Phase 4: Advanced Sync & Polish**

## **1. Objectives**

Phase 4 is about refining the user experience. Now that the engines are working, we need to improve the granularity of text splitting (better sentence detection), provide a better visual interface (playlist/queue view), and ensure the app handles edge cases (quota limits, network failures) gracefully.

## **2. Design Specifications**

### 2.1. Improved Text Segmentation (`src/lib/tts/TextSegmenter.ts`) [Completed]

The current regex-based splitter (`src/lib/tts.ts`) is naive. It breaks on "Mr. Smith" or "e.g.".

*   **Solution**: Use `Intl.Segmenter` (supported in modern browsers) for locale-aware sentence segmentation.
    ```typescript
    const segmenter = new Intl.Segmenter(lang, { granularity: 'sentence' });
    const segments = segmenter.segment(text);
    ```
*   **Fallback**: Keep regex for older browsers if necessary, but `Intl.Segmenter` is widely supported.
*   **Integration**: Update the `extractSentences` function used by the `AudioPlayerService` queue generator.

### **2.2. Playlist / Queue UI** (Completed)

A visual representation of what is being read helps users understand context and navigation.

*   **Component**: `TTSQueue.tsx` (or inside `TTSControls`).
*   **Display**: List of upcoming sentences.
*   **Interaction**: Click a sentence to jump the queue (and seeking in the book).
*   **Auto-Scroll**: The active sentence in the list should scroll into view.
*   **Status**: Implemented in `src/components/reader/TTSQueue.tsx` and integrated into `ReaderView.tsx`.

### **2.3. Pre-fetching / buffering**

To ensure seamless playback between sentences when using Cloud TTS.

*   **Logic**:
    *   `AudioPlayerService` maintains a `buffer` of the *next* 1-2 segments.
    *   When playing segment `N`, trigger synthesis/fetch for `N+1` and `N+2`.
    *   This masks the network latency of the API calls.

### **2.4. Error Handling & Fallbacks**

*   **Scenario**: User is on Google Cloud voice, but internet drops or API quota exceeded.
*   **Fallback**:
    *   Catch error in `AudioPlayerService`.
    *   Toast notification: "Cloud voice failed, switching to local backup."
    *   Automatically switch `provider` to `WebSpeechProvider` and continue playback.

### **2.5. Cost Controls**

*   **UI**: Show an estimate of characters synthesized in the current session.
    *   *Status:* Implemented via `CostEstimator` and `TTSCostIndicator`.
*   **Warning**: "You are about to listen to a whole chapter (~20k chars). Proceed with Cloud Voice?" (Optional toggle in settings).
    *   *Status:* Implemented via `ReaderView` check (threshold 5000 chars) and confirmation dialog.

## **3. Implementation Plan**

1.  **Cost Controls (Completed)**:
    *   Implement `CostEstimator` service.
    *   Integrate tracking into `AudioPlayerService`.
    *   Add `TTSCostIndicator` to `ReaderView`.
    *   Add warning dialog for large text blocks in `ReaderView`.
2.  **Refactor Segmentation**:
    *   Replace `extractSentences` regex logic with `Intl.Segmenter`.
    *   Test with complex sentences ("Dr. Jones said...", "Item 1.2...").
2.  **Buffering Logic**:
    *   Update `AudioPlayerService` to look ahead in the queue.
    *   Implement `prepare(segment)` method in providers (which checks cache or fetches).
3.  **UI Enhancements**:
    *   Add the Queue view.
    *   Add error toasts.
4.  **Resiliency**:
    *   Implement the try-catch-fallback loop in the player service.

## **4. Verification Steps**

*   **Segmentation Test**: Verify "Mr. Smith" is treated as one sentence, not two.
*   **Gapless Playback**: Listen to a transition between two cloud-generated sentences. It should be instant (due to pre-fetching).
*   **Disconnect Test**: While playing cloud voice, disconnect network. Verify app falls back to local voice (after current buffer runs out) instead of crashing.
