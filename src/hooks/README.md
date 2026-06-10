# Hooks

This directory contains custom React hooks that encapsulate reusable logic and integrate with application services.

## Files

*   **`useTTS.ts`**: The primary interface between the React UI and the `AudioPlayerService`. It exposes playback controls (`play`, `pause`, `next`, `prev`), state (`isPlaying`, `currentSentence`), and manages event subscriptions to update the UI during playback.
    *   `useTTS.test.ts`: Unit tests verifying the hook's interaction with the audio service.
