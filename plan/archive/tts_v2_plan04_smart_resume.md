# Plan: Smart Resume ("Recall" Buffer)

## Status: Completed

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

## Feasibility Analysis
This is a high-impact, low-effort feature. `useTTSStore` is the correct place to persist `lastPauseTime`. The `AudioPlayerService` has a centralized `resume()` method where this logic can live.

**Technical Constraint:**
Rewinding by *time* (seconds) is easy with `AudioElementPlayer` or `WebAudioEngine`. However, `WebSpeechProvider` (local TTS) does not support seeking by time, only by utterance boundary.
- **Strategy:** For Cloud TTS, seek -10s. For WebSpeech, seek -1 or -2 sentences (index decrements).

## Implementation Plan

1. **Update State Management**
   - In `src/store/useTTSStore.ts`, add `lastPauseTime: number | null`.
   - In `AudioPlayerService.pause()` or `stop()`, update this timestamp via the store action.

2. **Implement Logic in `AudioPlayerService`**
   - In `resume()`:
     - Read `lastPauseTime` from store.
     - Calculate `elapsed = Date.now() - lastPauseTime`.
     - Decide rewind amount:
       - `WebSpeechProvider`: If elapsed > 5min, `currentIndex = max(0, currentIndex - 2)`.
       - `CloudProvider`: If elapsed > 5min, `seek(currentTime - 10)`.
   - Update `lastPauseTime` to null after processing.

3. **Handle Edge Cases**
   - If rewind goes before 0s, clamp to 0s.
   - Ideally, do not rewind across chapter boundaries (too complex for v1).

4. **User Feedback**
   - Optional: Show a small toast "Rewound 10s" so the user knows why it happened.

5. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
