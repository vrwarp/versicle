# Plan: Text Sanitization Engine (Cruft Removal)

## Priority: High

Raw EPUB text often contains non-narrative artifacts (page numbers, URLs, citations) that disrupt the listening experience. This plan introduces a sanitization pipeline to clean text before synthesis.

## Status: Implemented

## Goals
- [x] Remove page numbers, URLs, and academic citations from the text stream.
- [x] Replace visual separators (***, ---) with appropriate pauses (if using SSML) or silence.
- [x] Prevent over-aggressive filtering (don't delete "He was 12 years old").
- [x] Allow user configuration (toggle sanitization on/off).

## Implemented Files
- `src/lib/tts/processors/Sanitizer.ts`: Core sanitization logic.
- `src/lib/tts/processors/RegexPatterns.ts`: Repository of regex patterns.
- `src/lib/tts/processors/Sanitizer.test.ts`: Unit tests.

## Feasibility Analysis
The `TextSegmenter` class currently handles basic segmentation. Adding a sanitization step is straightforward. The challenge lies in the regex accuracy—avoiding false positives (deleting real content).

**Integration Point:**
The sanitization occurs **after** text segmentation in `extractSentences` to ensure that original CFI ranges are preserved for highlighting, while the text sent to the TTS engine is clean. This trade-off means highlighting might include the artifacts (e.g. "[12]") but the audio will skip them.

## Implementation Details

1. **`Sanitizer` Class**
   - Implemented `src/lib/tts/processors/Sanitizer.ts` with `sanitize(text: string): string` method.
   - Uses regex patterns to strip unwanted text while collapsing extra whitespace.

2. **Regex Strategy (`RegexPatterns.ts`)**
   - **Page Numbers:** Matches lines that are purely digits or "Page X".
   - **URLs:** Standard URL regex.
   - **Citations:** `\[\d+\]` or `\([A-Z][a-z]+, \d{4}\)` (conservative).
   - **Cruft:** Visual separators like `* * *`.

3. **Integration**
   - Integrated into `src/lib/tts.ts` inside `extractSentences`.
   - The raw text buffer is segmented first to preserve DOM mapping.
   - Then, individual segment text is sanitized if enabled. If the result is empty, the segment is skipped.

4. **Configuration**
   - Added `sanitizationEnabled` boolean to `useTTSStore`.
   - Added UI toggle in `ReaderSettings.tsx` under the new "Audio" section.

5. **Testing**
   - Unit tests cover various edge cases.
   - Frontend verification script ensures the toggle is visible and functional.
