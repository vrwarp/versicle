# Plan: Chapter Pre-roll (Announcer)

## Priority: Low (Delight)

Announces "Chapter [N]" and estimated time before reading the text, providing a mental bookmark.

## Goals
- Detect chapter transitions.
- Synthesize an announcement: "Chapter X. Title. Estimated time: Y minutes."
- Inject this audio before the chapter text.

## Proposed Files
- Modify `src/lib/tts/AudioPlayerService.ts`.

## Implementation Steps

1. **Detect Transition**
   - In `playNext()` or `setQueue()`, detect if the new item belongs to a different chapter than the previous one.

2. **Generate Announcement**
   - Construct text string.
   - Calculate duration: `wordCount / wpm`.

3. **Inject into Queue**
   - This is tricky. We can either:
     - Insert a fake `TTSQueueItem` into the queue at runtime.
     - Or, handle it as a "pre-flight" action in `play()`.
   - Approach: "Pre-flight". When `play()` is called for the first item of a chapter:
     - Synthesize announcement.
     - Play announcement.
     - *Then* play the actual text.

4. **UI Feedback**
   - Show "Announcing..." toast.

5. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
