# Plan: Text Sanitization Engine (Cruft Removal)

## Priority: High

Raw EPUB text often contains non-narrative artifacts (page numbers, URLs, citations) that disrupt the listening experience. This plan introduces a sanitization pipeline to clean text before synthesis.

## Goals
- Remove page numbers, URLs, and academic citations from the text stream.
- Replace visual separators (***, ---) with appropriate pauses (if using SSML) or silence.
- Prevent over-aggressive filtering (don't delete "He was 12 years old").
- Allow user configuration (toggle sanitization on/off).

## Proposed Files
- `src/lib/tts/processors/Sanitizer.ts`: Core sanitization logic.
- `src/lib/tts/processors/RegexPatterns.ts`: Repository of regex patterns.

## Feasibility Analysis
The `TextSegmenter` class currently handles basic segmentation. Adding a sanitization step is straightforward. The challenge lies in the regex accuracy—avoiding false positives (deleting real content).

**Integration Point:**
The sanitization should ideally occur **before** the text is queued in `AudioPlayerService`. A good place is `extractSentences` (which creates the queue items) or inside `TextSegmenter` if we want it to be intrinsic to segmentation.

Given `TextSegmenter` deals with structural splitting, `Sanitizer` should probably run on the raw text blocks *before* they are fed into `TextSegmenter`, or on the segments *after* they are split but before being returned. Running it on the raw block text in `extractSentences.ts` seems safest to preserve sentence boundaries.

## Implementation Plan

1. **Develop `Sanitizer` Class**
   - Create `src/lib/tts/processors/Sanitizer.ts`.
   - Implement a `sanitize(text: string): string` method.
   - Use a chain of regex replacements.

2. **Regex Strategy (`RegexPatterns.ts`)**
   - **Page Numbers:** Match lines that are purely digits or "Page X".
   - **URLs:** Standard URL regex.
   - **Citations:** `\[\d+\]` or `\([A-Z][a-z]+, \d{4}\)`.
   - **Cruft:** Remove distinct visual separators like `* * *` (replace with a pause marker if possible, or just silence).

3. **Integrate into Extraction Pipeline**
   - Open `src/lib/tts/extractSentences.ts` (or wherever `extractText` logic resides).
   - Import `Sanitizer`.
   - Before passing text to `TextSegmenter`, run `Sanitizer.sanitize(text)`.
   - *Alternative:* Pass a `sanitize` flag to `TextSegmenter` and do it there.

4. **Configuration**
   - Add `sanitizationEnabled` boolean to `useTTSStore`.
   - Pass this flag down to the extraction logic.

5. **Testing**
   - Create a test suite with snippet examples from real books (academic, fiction with breaks, etc.).
   - Verify that "Chapter 1" headers aren't deleted if we want them spoken (or maybe they *should* be deleted if they are just numbers).

6. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
