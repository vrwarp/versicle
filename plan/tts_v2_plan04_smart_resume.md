# Plan: Smart Resume ("Recall" Buffer)

## Priority: High

This feature improves the resumption experience by rewinding slightly based on how long the user has been away, helping them regain context.

## Goals
- Track the timestamp when playback paused.
- On resume, calculate the pause duration.
- Rewind audio (seek backward) by a dynamic amount:
  - < 5 min: 0s
  - 5 min - 24h: 10s
  - > 24h: 60s
- Handle chapter boundaries if the rewind crosses them (optional/stretch).

## Proposed Files
- Modify `src/store/useTTSStore.ts`: Add `lastPauseTime`.
- Modify `src/lib/tts/AudioPlayerService.ts`: Implement smart resume logic.

## Implementation Steps

1. **Update Store**
   - In `useTTSStore`, add `lastPauseTime: number | null`.
   - Update `setPlaybackStatus`: When status becomes `paused` or `stopped`, set `lastPauseTime = Date.now()`.

2. **Implement Logic in `AudioPlayerService`**
   - In `resume()` method:
     - Retrieve `lastPauseTime` from store.
     - Calculate `delta = Date.now() - lastPauseTime`.
     - Determine rewind amount (`rewindSeconds`).
     - Calculate `newTime = currentTime - rewindSeconds`.
     - Call `this.audioPlayer.seek(newTime)` (or `this.jumpTo(prevIndex)` if using sentence index).

3. **Handle Sentence-Based Rewind (WebSpeech)**
   - For `WebSpeechProvider`, we can't seek in seconds easily.
   - Logic: Go back N sentences.
     - Medium pause: Go back 1-2 sentences.
     - Long pause: Go back 5-10 sentences.
   - Check `currentIndex` boundaries.

4. **UI Feedback (Optional)**
   - Show a toast: "Rewound 10s for context" to explain the jump.

5. **Testing**
   - Manual test: Pause, wait (mock time), resume. Verify position changed.
   - Unit test: Mock `Date.now()` and check logic.

6. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
