# Plan: Media Session Integration

## Priority: Critical (Usability)

This plan focuses on integrating the Media Session API (`navigator.mediaSession`) to allow users to control playback via lock screen, control center, and hardware media keys. This is essential for a mobile-first audiobook experience.

## Goals
- Provide rich metadata (Title, Author, Cover Art) to the OS.
- Enable Play/Pause, Next/Prev Track, and Seek Backward/Forward controls.
- Ensure state stays synchronized with `AudioPlayerService`.

## Status
- **Completed**: The `MediaSessionManager` has been implemented and integrated into `AudioPlayerService`.

## Implementation Details
- `src/lib/tts/MediaSessionManager.ts`: A dedicated class for managing the Media Session API.
- `src/lib/tts/AudioPlayerService.ts`: Refactored to use `MediaSessionManager`.
- Tests added in `src/lib/tts/MediaSessionManager.test.ts`.

## Verification
- Unit tests pass.
- Playwright verification tests pass (no regressions).
