# Plan: Media Session Integration

## Priority: Critical (Usability)

This plan focuses on integrating the Media Session API (`navigator.mediaSession`) to allow users to control playback via lock screen, control center, and hardware media keys. This is essential for a mobile-first audiobook experience.

## Goals
- Provide rich metadata (Title, Author, Cover Art) to the OS.
- Enable Play/Pause, Next/Prev Track, and Seek Backward/Forward controls.
- Ensure state stays synchronized with `AudioPlayerService`.

## Proposed Files
- `src/lib/tts/MediaSessionManager.ts`: Dedicated class for managing the Media Session API.

## Implementation Steps

1. **Create `MediaSessionManager`**
   - Create `src/lib/tts/MediaSessionManager.ts`.
   - Define interface for `MediaMetadata` inputs.
   - Implement `updateMetadata(metadata)` to set `navigator.mediaSession.metadata`.
   - Implement `setPlaybackState(state)` ('playing' | 'paused' | 'none').

2. **Implement Action Handlers**
   - Define a callback interface for player actions (`onPlay`, `onPause`, `onSeekBackward`, `onSeekForward`, `onNext`, `onPrev`).
   - Register handlers:
     - `play`, `pause`: Map to resume/pause.
     - `previoustrack`, `nexttrack`: Map to previous/next paragraph (or chapter).
     - `seekbackward`, `seekforward`: Map to +/- 10s or 15s.
     - `seekto`: (Optional) Allow scrubbing.

3. **Integrate with `AudioPlayerService`**
   - Remove inline `setupMediaSession` from `src/lib/tts/AudioPlayerService.ts`.
   - Instantiate `MediaSessionManager` in `AudioPlayerService`.
   - Call `mediaSessionManager.updateMetadata(...)` whenever the current item changes (in `play` or `setQueue`).
   - Call `mediaSessionManager.setPlaybackState(...)` in `setStatus`.
   - Wire up the action callbacks to `AudioPlayerService` methods (`resume`, `pause`, `next`, `prev`).

4. **Cover Art Handling**
   - Ensure the cover image URL passed to metadata is valid and reasonably sized.
   - If `epub.js` provides a blob URL, ensure it persists long enough for the OS to grab it.

5. **Testing & Verification**
   - Verify lock screen controls on a mobile device or simulator.
   - Check if the "Now Playing" info matches the current book/chapter.
   - Verify hardware media keys (keyboard) work on desktop.

6. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
