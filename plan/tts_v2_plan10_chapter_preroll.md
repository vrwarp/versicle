# Plan: Chapter Pre-roll (Announcer)

## Priority: Low (Delight)

Announces "Chapter [N]" and estimated time before reading the text, providing a mental bookmark.

## Goals
- Detect chapter transitions.
- Synthesize an announcement: "Chapter X. Title. Estimated time: Y minutes."
- Inject this audio before the chapter text.

## Proposed Files
- Modify `src/lib/tts/AudioPlayerService.ts`.

## Feasibility Analysis
Detecting chapter transitions is easy in `AudioPlayerService` because `setQueue` is called when loading a new chapter.
- **Challenge:** Mixing the "Announcement" audio with the "Text" audio in the queue.
- **Solution:** Add a special `TTSQueueItem` at index -1 or 0 that contains the announcement text.
- **Timing:** Need to calculate word count of the chapter to estimate time. `queue.reduce(...)` works.

## Implementation Plan

1. **Generate Announcement Text**
   - Helper function: `generatePreroll(chapterTitle: string, wordCount: number, speed: number): string`.
   - "Chapter 5. The Wedding. Estimated reading time: 14 minutes."

2. **Inject into Queue**
   - In `AudioPlayerService.setQueue(items)`:
     - Check `userSettings.prerollEnabled`.
     - Create an announcement item.
     - `this.queue = [announcementItem, ...items]`.
     - `this.currentIndex = 0` (points to announcement).
     - **Note:** The announcement item needs a null CFI or a special flag so it doesn't try to highlight text in the book.

3. **Handle Highlighting**
   - If item has no CFI, `SyncEngine` should do nothing (or clear highlights).

4. **Settings**
   - Toggle in Audio Settings.

5. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
