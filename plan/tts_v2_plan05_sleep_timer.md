# Plan: Sleep Timer (Fade Out)

## Priority: High

A sleep timer that fades out audio gradually provides a better user experience than an abrupt stop.

## Goals
- Add Sleep Timer functionality (15m, 30m, 45m, End of Chapter).
- Implement a linear volume fade-out over the last 60 seconds.
- Pause playback when the timer expires.

## Proposed Files
- Modify `src/store/useTTSStore.ts`: Add `sleepTimerDuration`, `sleepTimerEndTime`.
- Modify `src/lib/tts/AudioPlayerService.ts`: Timer logic and volume control.
- `src/components/reader/SleepTimerMenu.tsx`: UI for selecting duration.

## Feasibility Analysis
The logic is standard. The main technical detail is the fade-out.
- **Web Audio:** `gainNode.gain.linearRampToValueAtTime` makes this trivial.
- **Audio Element:** Requires a `setInterval` loop to decrement `volume`.
- **Web Speech:** Cannot control volume dynamically during utterance reliably. We will just stop abruptly or support fade-out only for Cloud TTS.

**End of Chapter Logic:**
Checking "End of Chapter" requires comparing `currentIndex` with `queue.length`. If the queue represents only the current chapter (which it does), "End of Chapter" is just "Wait for `onEnded` of the last item".

## Implementation Plan

1. **Store Updates**
   - Add `sleepTimer: { status: 'active' | 'inactive', endTime: number | null }` to `useTTSStore`.

2. **Service Logic (`AudioPlayerService`)**
   - Add `startSleepTimer(minutes: number)`.
   - Use `setInterval` to check time every second.
   - **Fade Logic:** When `now >= endTime - 60s`:
     - Calculate volume factor (0.0 to 1.0).
     - Apply to `audioPlayer.setVolume(factor)` (need to add this method if missing).
   - **Stop:** When `now >= endTime`, call `pause()`, reset volume to 1.0, and clear timer.

3. **UI Component**
   - Create `SleepTimerMenu` (popover).
   - Options: 15, 30, 45, 60 min, End of Chapter.

4. **Persistence**
   - Sleep timer state usually doesn't need to persist across reloads (it's a session thing), but `useTTSStore` persists by default. We should probably reset it on app launch if it's expired.

5. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
