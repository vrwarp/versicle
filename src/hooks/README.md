# Hooks

This directory contains custom React hooks that encapsulate reusable logic and integrate with application services.

## Files

*   **`use-local-storage.ts`**: A hook that synchronizes a React state variable with `window.localStorage`, allowing for persistent UI state (e.g., small preferences).
    *   `use-local-storage.test.ts`: Unit tests verifying persistence and updates.
    *   `use-local-storage-bug.test.ts`: Regression tests covering specific edge cases or bugs.
*   **`useTTS.ts`**: The primary interface between the React UI and the `AudioPlayerService`. It exposes playback controls (`play`, `pause`, `next`, `prev`), state (`isPlaying`, `currentSentence`), and manages event subscriptions to update the UI during playback.
    *   `useTTS.test.ts`: Unit tests verifying the hook's interaction with the audio service.
