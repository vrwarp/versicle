# Plan: Media Session Integration

## Priority: Critical (Usability)

This plan focuses on integrating the Media Session API (`navigator.mediaSession`) to allow users to control playback via lock screen, control center, and hardware media keys. This is essential for a mobile-first audiobook experience.

## Goals
- Provide rich metadata (Title, Author, Cover Art) to the OS.
- Enable Play/Pause, Next/Prev Track, and Seek Backward/Forward controls.
- Ensure state stays synchronized with `AudioPlayerService`.

## Proposed Files
- `src/lib/tts/MediaSessionManager.ts`: Dedicated class for managing the Media Session API.

## Feasibility Analysis
The `AudioPlayerService` already contains rudimentary inline Media Session logic (`setupMediaSession`, `updateMediaSessionMetadata`). Extracting this into a dedicated `MediaSessionManager` is a low-risk refactoring task that will improve code maintainability and feature completeness. The browser API is widely supported on modern mobile and desktop browsers.

**Dependencies:**
- `AudioPlayerService` needs to expose methods for the manager to call (`resume`, `pause`, `next`, `prev`).

## Implementation Plan

1. **Extract `MediaSessionManager`**
   - Create `src/lib/tts/MediaSessionManager.ts`.
   - Move the `MediaMetadata` creation logic here.
   - Define a configuration interface: `interface MediaSessionCallbacks { onPlay: () => void; onPause: () => void; ... }`.

2. **Enhance Metadata Handling**
   - Ensure `coverUrl` is properly handled. Blob URLs from `epub.js` might need to be carefully managed or converted to base64 if the OS struggles with them (though Blob URLs usually work).
   - Add chapters info if available (to support "Next Track" logically).

3. **Integrate into `AudioPlayerService`**
   - Remove private methods `setupMediaSession` and `updateMediaSessionMetadata`.
   - Instantiate `MediaSessionManager` in the constructor.
   - Wire up the callbacks to `this.resume()`, `this.pause()`, etc.
   - In `setStatus`, call `mediaSessionManager.setPlaybackState(status)`.
   - In `play()`, call `mediaSessionManager.setMetadata(...)`.

4. **Add Seek Support**
   - Implement `seekbackward` (-10s) and `seekforward` (+10s) handlers.
   - Since the player operates on a sentence queue, "seeking" might mean jumping back/forward by sentence index if fine-grained time seeking isn't fully implemented in the engine yet. Ideally, use `AudioElementPlayer.currentTime` or `WebAudioEngine` time.

5. **Testing**
   - Verify on mobile device (lock screen).
   - Verify hardware keys on desktop.

6. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
