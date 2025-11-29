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

## Implementation Steps

1. **Create Sanitizer Class**
   - Create `src/lib/tts/processors/Sanitizer.ts`.
   - Implement `process(text: string, options: SanitizerOptions): string`.

2. **Define Regex Patterns**
   - **Page Numbers:** `^\s*(Page\s+)?\d+\s*$` (lines that are just numbers).
   - **URLs:** `https?:\/\/[^\s]+`, `www\.[^\s]+`.
   - **Citations:** `\[\d+\]`, `\(Fig\. \d+\)`.
   - **Separators:** `^[\*\-_]{3,}$`.

3. **Implement Replacement Logic**
   - Iteratively apply patterns.
   - For visual separators, replace with a placeholder or just remove (future: insert `<break time="500ms"/>` if supporting SSML).
   - Add safety checks: If a replacement removes >50% of a paragraph, log a warning or skip it (unless it's a known artifact like a page number).

4. **Add Unit Tests**
   - Create `src/lib/tts/processors/Sanitizer.test.ts`.
   - Test cases:
     - "It was the best of times. 42 It was the worst..." -> "It was the best of times. It was the worst..."
     - "See http://google.com." -> "See ."
     - "He was 12." -> "He was 12." (No change).

5. **Integrate with `AudioPlayerService` / `TextSegmenter`**
   - Ideally, sanitization happens *before* segmentation or *during* the queue population.
   - Modify `src/lib/tts/TextSegmenter.ts` or `src/lib/tts/extractSentences.ts` to use `Sanitizer`.
   - Add a setting in `useTTSStore`: `sanitizationEnabled` (default true).

6. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
