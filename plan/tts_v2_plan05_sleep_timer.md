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

## Implementation Steps

1. **Update Store**
   - Add state for the timer: `sleepTimerState: 'active' | 'inactive'`, `endTime: number`.

2. **Implement Timer Logic in `AudioPlayerService`**
   - Add `setSleepTimer(minutes: number)`.
   - Use `setTimeout` or a `setInterval` check.
   - When `remainingTime <= 60s`, start fading volume.

3. **Implement Fade Out**
   - If using `WebAudioEngine` (from Plan 1), use `gainNode.gain.linearRampToValueAtTime(0, endTime)`.
   - If using `AudioElement`, use a `setInterval` to decrease `volume` property every 100ms.
   - *Note:* `WebSpeechProvider` volume cannot be changed mid-utterance easily on all browsers. We might only support fade-out for Cloud TTS (AudioElement/WebAudio). For WebSpeech, just stop.

4. **UI Integration**
   - Add a "Moon" icon/button in `ReaderView` or `ReaderSettings`.
   - Dropdown menu: 15m, 30m, 60m, Off.
   - Display countdown if active.

5. **Testing**
   - Set short timer (e.g., 1 min for testing).
   - Verify fade out starts.
   - Verify playback stops at end.
   - Verify volume resets to original level after stop.

6. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
